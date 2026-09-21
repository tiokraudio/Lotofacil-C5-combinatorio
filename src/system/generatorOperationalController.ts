/**
 * Controlador Operacional do Gerador e Painel de Concursos C₅ (v1.6.0)
 *
 * Módulo operacional puro extraído para reutilização estrita entre:
 * - Interface de Produção (GeneratorView, OfficialResultSection)
 * - Suíte de Testes de Integração e Certificação Multiaba
 *
 * Princípios Arquiteturais Inegociáveis:
 * 1. O IndexedDB é a Fonte Única da Verdade (Source of Truth).
 * 2. Eventos remotos do BroadcastChannel são sinais de invalidação (zero payload trusting).
 * 3. ZERO chamadas à CAIXA por evento remoto (zero polling, zero auto-fetch).
 * 4. Proteção estrita contra race conditions (syncSequence monotônico).
 *    Respostas externas em voo são imediatamente descartadas se o concurso mudar ou for pontuado remotamente.
 * 5. Falhas de leitura após eventos remotos bloqueiam a operação de forma segura (storageBlocked),
 *    sem inventar estados, sem fallback de dados e sem disparar consultas à rede.
 */

import type { ContestRecord } from "../c5/types.ts";
import { ContestRepository, repository as defaultRepository } from "../storage/contestRepository.ts";
import {
  RefreshCoordinator,
  refreshCoordinator as defaultRefreshCoordinator,
  type DataMutationReason,
} from "./refreshCoordinator.ts";
import {
  getLotteryProvider,
  type LotteryResultProvider,
  LotteryFetchError,
} from "../lottery/index.ts";
import { buildContestSyncState, type ContestSyncState } from "../sync/index.ts";
import { actionLockController } from "./actionLock.ts";
import { classifyOperationalError } from "./operationalErrors.ts";
import {
  type OfficialResultPreviewState,
  INITIAL_OFFICIAL_PREVIEW_STATE,
  officialResultPreviewReducer,
  canScoreOfficialPreview,
  evaluateIncomingPreviewAction,
} from "../sync/officialResultPreviewState.ts";
import {
  validateOfficialResult,
  createOfficialResultPreview,
} from "../sync/operationalState.ts";

export interface GeneratorOperationalState {
  activeRecord: ContestRecord | null;
  localRecords: ContestRecord[];
  storageBlocked: boolean;
  syncState: ContestSyncState | null;
  latestContestInfo: {
    lastContest: number;
    drawDate: string;
    suggestedNext: number;
  } | null;
  previewState: OfficialResultPreviewState;
  syncSequence: number;
  isSyncing: boolean;
  isFetchingLatest: boolean;
  isFetchingPreview: boolean;
  storageError: string | null;
  feedback: {
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
  } | null;
}

export type OperationalStateListener = (state: GeneratorOperationalState) => void;

export class GeneratorOperationalController {
  private repository: ContestRepository;
  private coordinator: RefreshCoordinator;
  private providerGetter: () => LotteryResultProvider;
  private listeners: Set<OperationalStateListener> = new Set();
  private coordinatorUnsub: (() => void) | null = null;

  private state: GeneratorOperationalState = {
    activeRecord: null,
    localRecords: [],
    storageBlocked: false,
    syncState: null,
    latestContestInfo: null,
    previewState: { ...INITIAL_OFFICIAL_PREVIEW_STATE },
    syncSequence: 0,
    isSyncing: false,
    isFetchingLatest: false,
    isFetchingPreview: false,
    storageError: null,
    feedback: null,
  };

  constructor(
    repository: ContestRepository = defaultRepository,
    coordinator: RefreshCoordinator = defaultRefreshCoordinator,
    providerGetter: () => LotteryResultProvider = getLotteryProvider,
    autoAttach = true
  ) {
    this.repository = repository;
    this.coordinator = coordinator;
    this.providerGetter = providerGetter;

    if (autoAttach) {
      this.attachCoordinator(this.coordinator);
    }
  }

  /**
   * Obtém o snapshot imutável do estado operacional atual.
   */
  getState(): GeneratorOperationalState {
    return { ...this.state };
  }

  /**
   * Retorna o sequenceId monotônico atual de produção.
   */
  getSequenceId(): number {
    return this.state.syncSequence;
  }

  /**
   * Inscreve um ouvinte para atualizações de estado operacional.
   */
  subscribe(listener: OperationalStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const snapshot = this.getState();
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("Erro em listener operacional do gerador:", err);
      }
    }
  }

  /**
   * Conecta o controlador ao RefreshCoordinator.
   */
  attachCoordinator(coordinator: RefreshCoordinator): void {
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
    }
    this.coordinator = coordinator;
    this.coordinatorUnsub = this.coordinator.subscribe(
      (_rev, reason, contestNumber, isRemote) => {
        // Evento remoto ou local: relê o IndexedDB
        // Zero chamadas à CAIXA provocadas por este evento
        this.refreshLocalState(Boolean(isRemote), reason, contestNumber);
      }
    );
  }

  /**
   * Desconecta o controlador de eventos externos e limpa ouvintes.
   */
  destroy(): void {
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
      this.coordinatorUnsub = null;
    }
    this.listeners.clear();
  }

  /**
   * Define manualmente o concurso ativo aberto na tela.
   */
  setActiveRecord(record: ContestRecord | null): void {
    this.state.syncSequence++;
    const prevContest = this.state.activeRecord?.contestNumber;
    this.state.activeRecord = record;

    if (record?.contestNumber !== prevContest || record?.status !== "FROZEN") {
      this.clearPreview();
    }
    this.notifyListeners();
  }

  /**
   * Limpa feedbacks da interface.
   */
  clearFeedback(): void {
    this.state.feedback = null;
    this.notifyListeners();
  }

  /**
   * Descarta e limpa a prévia de resultado oficial e o erro de prévia.
   */
  clearPreview(): void {
    this.state.previewState = { ...INITIAL_OFFICIAL_PREVIEW_STATE };
    this.state.isFetchingPreview = false;
    this.notifyListeners();
  }

  /**
   * Carrega os dados locais do IndexedDB (Fonte Única da Verdade).
   * ZERO chamadas à rede/CAIXA.
   */
  async refreshLocalState(
    isRemoteSync = false,
    _reason?: DataMutationReason,
    _affectedContestNumber?: number
  ): Promise<void> {
    const sequenceId = ++this.state.syncSequence;

    try {
      const records = await this.repository.getAllContestRecords();

      if (sequenceId === this.state.syncSequence) {
        this.state.localRecords = records;
        this.state.storageBlocked = false;
        this.state.storageError = null;
      }

      // Se houver um concurso atualmente aberto na tela:
      const currentActive = this.state.activeRecord;
      if (currentActive) {
        const freshRecord = await this.repository.getContestRecord(
          currentActive.contestNumber
        );

        if (sequenceId === this.state.syncSequence) {
          if (!freshRecord) {
            // Concurso foi excluído no IndexedDB por outra aba (DELETE)
            this.state.activeRecord = null;
            this.clearPreview();

            if (isRemoteSync) {
              this.state.feedback = {
                type: "info",
                title: "Concurso Atualizado",
                message:
                  "Este concurso foi excluído em outra aba. A tela foi atualizada.",
              };
            }
          } else {
            const hasChanged =
              freshRecord.status !== currentActive.status ||
              freshRecord.integrityHash !== currentActive.integrityHash ||
              freshRecord.frozenAt !== currentActive.frozenAt ||
              freshRecord.scoredAt !== currentActive.scoredAt ||
              freshRecord.betPlacedAt !== currentActive.betPlacedAt;

            if (hasChanged) {
              this.state.activeRecord = freshRecord;

              // CRÍTICO: Se o concurso passou para SCORED, invalida e descarta imediatamente qualquer preview
              if (freshRecord.status === "SCORED") {
                this.clearPreview();
              }

              if (isRemoteSync) {
                this.state.feedback = {
                  type: "info",
                  title: "Concurso Atualizado",
                  message:
                    "Este concurso foi atualizado em outra aba. Os dados exibidos foram recarregados.",
                };
              }
            }
          }
        }
      }
    } catch (storageErr: any) {
      if (sequenceId === this.state.syncSequence) {
        this.state.storageBlocked = true;
        const classified = classifyOperationalError(
          storageErr,
          "STORAGE_UNAVAILABLE"
        );
        this.state.storageError = classified.userMessage;
        this.state.feedback = {
          type: "error",
          title: "Falha de Acesso ao Armazenamento",
          message: classified.userMessage,
        };
      }
    } finally {
      this.notifyListeners();
    }
  }

  /**
   * Consulta externa explícita da CAIXA para status geral (One-Call).
   */
  async refreshExternalSync(): Promise<ContestSyncState | null> {
    if (!actionLockController.acquire("CAIXA_QUERY")) {
      return null;
    }
    const sequenceId = ++this.state.syncSequence;
    this.state.isSyncing = true;
    this.state.isFetchingLatest = true;
    this.state.feedback = null;
    this.notifyListeners();

    try {
      const provider = this.providerGetter();
      const nextSync = await buildContestSyncState(provider, this.repository);

      if (sequenceId === this.state.syncSequence) {
        this.state.syncState = nextSync;
        if (nextSync.latestOfficialContest && nextSync.nextSuggestedContest) {
          this.state.latestContestInfo = {
            lastContest: nextSync.latestOfficialContest,
            drawDate: nextSync.latestDrawDate || "",
            suggestedNext: nextSync.nextSuggestedContest,
          };
        }
        return nextSync;
      }
      return null;
    } catch (err: any) {
      if (sequenceId === this.state.syncSequence) {
        const classified = classifyOperationalError(
          err,
          "CAIXA_TEMPORARY_ERROR"
        );
        this.state.feedback = {
          type: "warning",
          title: "Consulta Externa Indisponível",
          message: classified.userMessage,
        };
      }
      return null;
    } finally {
      actionLockController.release("CAIXA_QUERY");
      if (sequenceId === this.state.syncSequence) {
        this.state.isSyncing = false;
        this.state.isFetchingLatest = false;
      }
      this.notifyListeners();
    }
  }

  /**
   * Consulta o resultado oficial da CAIXA para conferência do concurso FROZEN aberto.
   *
   * ANTI-RACE & STALE RESPONSE PROTECTION:
   * Se enquanto a consulta da CAIXA estiver em voo (pending), chegar um evento remoto
   * de SCORE (ou qualquer evento que avance o syncSequence ou altere o activeRecord),
   * quando a resposta resolver ela será DESCARTADA.
   */
  async fetchOfficialResultPreview(targetContestNumber?: number): Promise<void> {
    const contestNumber =
      targetContestNumber ?? this.state.activeRecord?.contestNumber;

    if (!contestNumber) {
      return;
    }

    const currentSequenceId = ++this.state.syncSequence;
    this.state.isFetchingPreview = true;
    this.notifyListeners();

    try {
      const provider = this.providerGetter();
      // Exatamente 1 chamada ao provider
      const response = await provider.getContest(contestNumber);

      // Verificação rigorosa contra race conditions e eventos remotos intervenientes:
      if (
        currentSequenceId !== this.state.syncSequence ||
        !this.state.activeRecord ||
        this.state.activeRecord.contestNumber !== contestNumber ||
        this.state.activeRecord.status !== "FROZEN"
      ) {
        // Resposta obsoleta em voo: descartada silenciosamente!
        return;
      }

      if (response.contestNumber !== contestNumber) {
        this.state.previewState = officialResultPreviewReducer(
          this.state.previewState,
          {
            type: "FETCH_FAILURE",
            error: `O resultado consultado pertence ao concurso ${response.contestNumber}, não ao concurso ${contestNumber}.`,
          }
        );
        return;
      }

      // Validação das 15 dezenas
      const validatedNumbers = validateOfficialResult(response.numbers);

      const incomingPreview = createOfficialResultPreview({
        contestNumber: response.contestNumber,
        numbers: validatedNumbers,
        drawDate: response.drawDate,
        fetchedAt: response.fetchedAt,
        source: response.source,
      });

      const nextAction = evaluateIncomingPreviewAction(
        this.state.previewState,
        incomingPreview
      );
      this.state.previewState = officialResultPreviewReducer(
        this.state.previewState,
        nextAction
      );
    } catch (err: any) {
      if (
        currentSequenceId !== this.state.syncSequence ||
        !this.state.activeRecord ||
        this.state.activeRecord.contestNumber !== contestNumber ||
        this.state.activeRecord.status !== "FROZEN"
      ) {
        return;
      }

      let errorMessage =
        "Não foi possível consultar a fonte oficial agora. Falha de rede ou conectividade.";
      if (err instanceof LotteryFetchError) {
        if (err.code === "NOT_FOUND") {
          errorMessage = `Resultado do concurso ${contestNumber} ainda não disponível na fonte oficial CAIXA.`;
        } else if (err.code === "TIMEOUT") {
          errorMessage =
            "Tempo limite da consulta excedido (10s). Verifique sua conexão e tente novamente.";
        } else if (
          err.code === "INVALID_PAYLOAD" ||
          err.code === "CONTEST_MISMATCH"
        ) {
          errorMessage = `A fonte respondeu, mas os dados são inválidos: ${err.message}. Nenhum resultado foi registrado.`;
        } else {
          errorMessage = `Não foi possível consultar o resultado: ${err.message}`;
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }

      this.state.previewState = officialResultPreviewReducer(
        this.state.previewState,
        { type: "FETCH_FAILURE", error: errorMessage }
      );
    } finally {
      if (currentSequenceId === this.state.syncSequence) {
        this.state.isFetchingPreview = false;
      }
      this.notifyListeners();
    }
  }

  /**
   * Avalia se a ação de pontuar está atualmente disponível e acionável.
   */
  canScore(): boolean {
    if (this.state.storageBlocked) return false;
    if (!this.state.activeRecord || this.state.activeRecord.status !== "FROZEN") {
      return false;
    }
    return canScoreOfficialPreview(this.state.previewState);
  }

  /**
   * Executa a pontuação do concurso ativo com o resultado oficial aceito.
   */
  async scoreActiveContest(manualResult?: number[]): Promise<ContestRecord> {
    if (!this.state.activeRecord || this.state.activeRecord.status !== "FROZEN") {
      throw new Error("Não há concurso congelado aberto para pontuação.");
    }
    if (this.state.storageBlocked) {
      throw new Error("Armazenamento local bloqueado. Pontuação impedida.");
    }

    const numbersToScore =
      manualResult ?? this.state.previewState.acceptedPreview?.numbers;

    if (!numbersToScore || numbersToScore.length !== 15) {
      throw new Error("Resultado oficial de 15 dezenas não disponível.");
    }

    if (!actionLockController.acquire("SCORE")) {
      throw new Error("Operação de pontuação bloqueada por lock concorrente.");
    }

    try {
      const num = this.state.activeRecord.contestNumber;
      await this.repository.scoreStoredContest(num, [...numbersToScore]);

      const verification = await this.repository.verifyStoredContest(num);
      if (!verification.valid) {
        throw new Error(
          `Falha de auditoria pós-score: ${verification.errors.join("; ")}`
        );
      }

      const scored = await this.repository.getContestRecord(num);
      if (!scored) {
        throw new Error("Falha ao reler registro pontuado.");
      }

      this.state.activeRecord = scored;
      this.clearPreview();
      this.state.feedback = {
        type: "success",
        title: "Resultado Registrado e Pontuado",
        message: `O concurso ${num} foi conferido com sucesso. Melhor resultado: ${scored.score?.maxHits} acertos.`,
      };
      await this.refreshLocalState();
      return scored;
    } finally {
      actionLockController.release("SCORE");
      this.notifyListeners();
    }
  }

  /**
   * Confirma o registro/pagamento dos 5 jogos do concurso ativo (FROZEN ou SCORED).
   */
  async confirmBet(): Promise<ContestRecord> {
    if (!this.state.activeRecord) {
      throw new Error("Não há concurso selecionado para confirmar aposta.");
    }
    if (this.state.activeRecord.status === "DRAFT") {
      throw new Error("Concursos em rascunho (DRAFT) não podem ter aposta confirmada.");
    }
    if (this.state.storageBlocked) {
      throw new Error("Armazenamento local bloqueado. Operação impedida.");
    }

    if (!actionLockController.acquire("CONFIRM_BET")) {
      throw new Error("Operação de confirmação de aposta bloqueada por lock concorrente.");
    }

    try {
      const num = this.state.activeRecord.contestNumber;
      const confirmed = await this.repository.confirmBetPlaced(num);
      this.state.activeRecord = confirmed;
      this.state.feedback = {
        type: "success",
        title: "Aposta Confirmada",
        message: `Os 5 jogos do concurso ${num} foram confirmados e registrados no histórico financeiro.`,
      };
      await this.refreshLocalState();
      return confirmed;
    } finally {
      actionLockController.release("CONFIRM_BET");
      this.notifyListeners();
    }
  }
}

/**
 * Controlador Operacional do Histórico Prospectivo (v1.6.0)
 * Re-lê dados do IndexedDB quando mutações remotas ocorrem, com zero chamadas à CAIXA.
 */
export interface HistoryOperationalState {
  records: ContestRecord[];
  summary: any | null;
  isLoading: boolean;
  storageError: string | null;
}

export class HistoryOperationalController {
  private repository: ContestRepository;
  private coordinator: RefreshCoordinator;
  private coordinatorUnsub: (() => void) | null = null;
  private listeners: Set<(state: HistoryOperationalState) => void> = new Set();

  private state: HistoryOperationalState = {
    records: [],
    summary: null,
    isLoading: false,
    storageError: null,
  };

  constructor(
    repository: ContestRepository = defaultRepository,
    coordinator: RefreshCoordinator = defaultRefreshCoordinator,
    autoAttach = true
  ) {
    this.repository = repository;
    this.coordinator = coordinator;

    if (autoAttach) {
      this.attachCoordinator(this.coordinator);
    }
  }

  getState(): HistoryOperationalState {
    return { ...this.state };
  }

  subscribe(listener: (state: HistoryOperationalState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getState();
    for (const l of Array.from(this.listeners)) {
      l(snap);
    }
  }

  attachCoordinator(coordinator: RefreshCoordinator): void {
    if (this.coordinatorUnsub) this.coordinatorUnsub();
    this.coordinator = coordinator;
    this.coordinatorUnsub = this.coordinator.subscribe(() => {
      // Releitura local automática via IndexedDB ao receber invalidação remota
      this.loadHistoryData();
    });
  }

  destroy(): void {
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
      this.coordinatorUnsub = null;
    }
    this.listeners.clear();
  }

  async loadHistoryData(): Promise<void> {
    this.state.isLoading = true;
    this.notify();

    try {
      const [allRecords, sum] = await Promise.all([
        this.repository.getAllContestRecords(),
        this.repository.getHistorySummary(),
      ]);
      this.state.records = allRecords;
      this.state.summary = sum;
      this.state.storageError = null;
    } catch (err: any) {
      const classified = classifyOperationalError(err, "STORAGE_UNAVAILABLE");
      this.state.storageError = classified.userMessage;
      this.state.records = [];
      this.state.summary = null;
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }
}

/**
 * Controlador Operacional da Auditoria Global (v1.6.0)
 * Re-audita a base a partir do IndexedDB sem loops e com zero chamadas à CAIXA.
 */
export interface AuditOperationalState {
  auditResult: any | null;
  isAuditing: boolean;
  error: string | null;
}

export class AuditOperationalController {
  private repository: ContestRepository;
  private coordinator: RefreshCoordinator;
  private coordinatorUnsub: (() => void) | null = null;
  private listeners: Set<(state: AuditOperationalState) => void> = new Set();

  private state: AuditOperationalState = {
    auditResult: null,
    isAuditing: false,
    error: null,
  };

  constructor(
    repository: ContestRepository = defaultRepository,
    coordinator: RefreshCoordinator = defaultRefreshCoordinator,
    autoAttach = true
  ) {
    this.repository = repository;
    this.coordinator = coordinator;

    if (autoAttach) {
      this.attachCoordinator(this.coordinator);
    }
  }

  getState(): AuditOperationalState {
    return { ...this.state };
  }

  subscribe(listener: (state: AuditOperationalState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getState();
    for (const l of Array.from(this.listeners)) {
      l(snap);
    }
  }

  attachCoordinator(coordinator: RefreshCoordinator): void {
    if (this.coordinatorUnsub) this.coordinatorUnsub();
    this.coordinator = coordinator;
    this.coordinatorUnsub = this.coordinator.subscribe(() => {
      this.runAudit();
    });
  }

  destroy(): void {
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
      this.coordinatorUnsub = null;
    }
    this.listeners.clear();
  }

  async runAudit(): Promise<void> {
    if (this.state.isAuditing) return;
    this.state.isAuditing = true;
    this.state.error = null;
    this.notify();

    try {
      const res = await this.repository.auditEntireHistory();
      this.state.auditResult = res;
    } catch (err: any) {
      this.state.error = String(err?.message || "Falha na auditoria");
    } finally {
      this.state.isAuditing = false;
      this.notify();
    }
  }
}

/**
 * Controlador Operacional do Resumo / Contador do App (v1.6.0)
 * Atualiza o badge de concursos a partir do IndexedDB sem transportar métricas no evento.
 */
export interface AppSummaryState {
  historyCount: number;
}

export class AppSummaryController {
  private repository: ContestRepository;
  private coordinator: RefreshCoordinator;
  private coordinatorUnsub: (() => void) | null = null;
  private listeners: Set<(state: AppSummaryState) => void> = new Set();

  private state: AppSummaryState = {
    historyCount: 0,
  };

  constructor(
    repository: ContestRepository = defaultRepository,
    coordinator: RefreshCoordinator = defaultRefreshCoordinator,
    autoAttach = true
  ) {
    this.repository = repository;
    this.coordinator = coordinator;

    if (autoAttach) {
      this.attachCoordinator(this.coordinator);
    }
  }

  getState(): AppSummaryState {
    return { ...this.state };
  }

  subscribe(listener: (state: AppSummaryState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getState();
    for (const l of Array.from(this.listeners)) {
      l(snap);
    }
  }

  attachCoordinator(coordinator: RefreshCoordinator): void {
    if (this.coordinatorUnsub) this.coordinatorUnsub();
    this.coordinator = coordinator;
    this.coordinatorUnsub = this.coordinator.subscribe(() => {
      this.refreshCount();
    });
  }

  destroy(): void {
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
      this.coordinatorUnsub = null;
    }
    this.listeners.clear();
  }

  async refreshCount(): Promise<void> {
    try {
      const records = await this.repository.getAllContestRecords();
      this.state.historyCount = records.length;
    } catch {
      // Ignora erro
    } finally {
      this.notify();
    }
  }
}
