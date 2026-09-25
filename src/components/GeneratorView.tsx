import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Lock,
  CheckCircle2,
  AlertCircle,
  Award,
  Layers,
  Sparkles,
  Globe,
  Copy,
  Printer,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  DollarSign,
} from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import { createContestDraft } from "../c5/index.ts";
import { repository, formatLocalDate } from "../storage/service.ts";
import { GamesDisplay } from "./GamesDisplay.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { HashViewerModal } from "./HashViewerModal.tsx";
import { PrizeRecordModal } from "./PrizeRecordModal.tsx";
import { formatBRLFromCents } from "../utils/money.ts";
import { getLotteryProvider } from "../lottery/index.ts";
import type { ContestSyncState } from "../sync/index.ts";
import { SyncStatusPanel } from "./SyncStatusPanel.tsx";
import { PrimaryActionBar } from "./PrimaryActionBar.tsx";
import { computePrimaryAction, type PrimaryAction } from "../sync/primaryAction.ts";
import { copyGamesToClipboard } from "../utils/clipboard.ts";
import { PrintSheet } from "./PrintSheet.tsx";
import { actionLockController, type ActionLockState } from "../system/actionLock.ts";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";
import { classifyOperationalError } from "../system/operationalErrors.ts";
import {
  GeneratorOperationalController,
  type GeneratorOperationalState,
} from "../system/generatorOperationalController.ts";

interface GeneratorViewProps {
  onRecordUpdated?: () => void;
}

export const GeneratorView: React.FC<GeneratorViewProps> = ({ onRecordUpdated }) => {
  const [contestInput, setContestInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);

  // Instancia e gerencia o ciclo operacional via GeneratorOperationalController de produção
  const controllerRef = useRef<GeneratorOperationalController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new GeneratorOperationalController(
      repository,
      refreshCoordinator,
      getLotteryProvider
    );
  }
  const controller = controllerRef.current;
  const [opState, setOpState] = useState<GeneratorOperationalState>(controller.getState());

  const [localFeedback, setLocalFeedback] = useState<{
    type: "success" | "error" | "warning" | "info";
    title?: string;
    message: string;
  } | null>(null);

  // Modais de confirmação
  const [showBetConfirmModal, setShowBetConfirmModal] = useState<boolean>(false);
  const [showHashModal, setShowHashModal] = useState<boolean>(false);
  const [showPrizeModal, setShowPrizeModal] = useState<boolean>(false);

  const [lockState, setLockState] = useState<ActionLockState>({
    isLocked: actionLockController.isLocked(),
    currentOperation: actionLockController.getCurrentOperation(),
  });

  const clearFeedback = () => {
    setLocalFeedback(null);
    controller.clearFeedback();
  };

  const setFeedback = (
    fb: {
      type: "success" | "error" | "warning" | "info";
      title?: string;
      message: string;
    } | null
  ) => {
    setLocalFeedback(fb);
  };

  // Feedback combinado (controller ou local)
  const feedback = localFeedback || opState.feedback;

  // Inscrição no controlador de locks para feedback e bloqueio de cliques concorrentes
  useEffect(() => {
    const unsub = actionLockController.subscribe(setLockState);
    return unsub;
  }, []);

  // Inscrição no GeneratorOperationalController de produção
  useEffect(() => {
    const unsub = controller.subscribe((nextState) => {
      setOpState(nextState);
    });
    // Carregamento puramente local no boot (ZERO chamadas de rede)
    controller.refreshLocalState(false);

    return () => {
      unsub();
      controller.destroy();
    };
  }, [controller]);

  // Estados operacionais sincronizados do controller de produção
  const activeRecord = opState.activeRecord;
  const localRecords = opState.localRecords;
  const storageBlocked = opState.storageBlocked;
  const syncState = opState.syncState;
  const latestContestInfo = opState.latestContestInfo;
  const isSyncing = opState.isSyncing;
  const isFetchingLatest = opState.isFetchingLatest;

  const setActiveRecord = useCallback(
    (record: ContestRecord | null) => {
      controller.setActiveRecord(record);
    },
    [controller]
  );

  const refreshLocalState = useCallback(
    async (isRemoteSync = false) => {
      await controller.refreshLocalState(isRemoteSync);
    },
    [controller]
  );

  const refreshExternalSync = useCallback(async (): Promise<ContestSyncState | null> => {
    clearFeedback();
    return await controller.refreshExternalSync();
  }, [controller]);

  // Derivação pura e determinística da Ação Principal
  const primaryAction = computePrimaryAction(syncState, localRecords);

  // Execução da Ação Principal
  const handleExecutePrimaryAction = async (action: PrimaryAction) => {
    clearFeedback();
    if (action.actionType === "PREPARE_CONTEST") {
      if (action.contestNumber) {
        setContestInput(String(action.contestNumber));
        const formInput = document.getElementById("contest-number-input");
        if (formInput) {
          formInput.scrollIntoView({ behavior: "smooth", block: "center" });
          formInput.focus();
        }
      } else {
        await handleFetchLatestContest();
      }
    } else if (action.actionType === "OPEN_DRAFT" && action.contestNumber) {
      await handleOpenDraftFromPanel(action.contestNumber);
      const panel = document.getElementById("active-contest-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action.actionType === "CHECK_RESULT" && action.contestNumber) {
      await handleCheckResultFromPanel(action.contestNumber);
      const panel = document.getElementById("active-contest-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action.actionType === "VIEW_CONTEST" && action.contestNumber) {
      await handleOpenContest(action.contestNumber);
      const panel = document.getElementById("active-contest-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Copiar Jogos Formatados
  const handleCopyActiveGames = async () => {
    if (!activeRecord) return;
    const res = await copyGamesToClipboard(activeRecord.generation.games);
    setFeedback({
      type: res.success ? "info" : "warning",
      title: res.success ? "Jogos Copiados" : "Atenção ao Copiar",
      message: res.message,
    });
  };

  // Impressão Limpa
  const handlePrintActiveGames = () => {
    if (!activeRecord) return;
    window.print();
  };

  // Abertura de concurso para visualização
  const handleOpenContest = async (contestNumber: number) => {
    setIsLoading(true);
    clearFeedback();
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record) {
        setContestInput(String(contestNumber));
        setActiveRecord(record);
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Erro ao Abrir Concurso",
        message: err?.message || "Não foi possível carregar o concurso.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Consulta manual do último concurso no topo do formulário
  const handleFetchLatestContest = async () => {
    const nextSync = await refreshExternalSync();
    if (nextSync && nextSync.latestOfficialContest) {
      setFeedback({
        type: "info",
        title: "Consulta CAIXA Realizada",
        message: `Último concurso oficial: ${nextSync.latestOfficialContest} (${nextSync.latestDrawDate || ""}). Próximo sugerido: ${nextSync.nextSuggestedContest || nextSync.latestOfficialContest + 1}.`,
      });
    }
  };

  const handlePrepareContestFromPanel = (contestNumber: number) => {
    setContestInput(String(contestNumber));
    clearFeedback();
  };

  const handleOpenDraftFromPanel = async (contestNumber: number) => {
    setIsLoading(true);
    clearFeedback();
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record) {
        setContestInput(String(contestNumber));
        setActiveRecord(record);
        setFeedback({
          type: "info",
          title: `Concurso ${contestNumber} Aberto`,
          message: `Rascunho carregado no gerador.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Erro ao Abrir Rascunho",
        message: err?.message || "Não foi possível carregar o rascunho.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckResultFromPanel = async (contestNumber: number) => {
    setIsLoading(true);
    clearFeedback();
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record) {
        setContestInput(String(contestNumber));
        setActiveRecord(record);
        setFeedback({
          type: "info",
          title: `Concurso ${contestNumber} Selecionado`,
          message: `Concurso carregado no gerador.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Erro ao Carregar Concurso",
        message: err?.message || "Não foi possível carregar o concurso.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplySuggestedContest = () => {
    if (latestContestInfo) {
      setContestInput(String(latestContestInfo.suggestedNext));
    }
  };

  // 1. Gerar ou Carregar Concurso (REGEN01-REGEN04: Se já existir, NUNCA gera novamente)
  const handleGenerateOrLoad = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    clearFeedback();

    if (storageBlocked) {
      setFeedback({
        type: "error",
        title: "Acesso Bloqueado",
        message: "Não foi possível acessar o histórico local. A geração oficial foi bloqueada para evitar perda de rastreabilidade.",
      });
      return;
    }

    const contestNum = parseInt(contestInput.trim(), 10);
    if (isNaN(contestNum) || contestNum <= 0) {
      setFeedback({
        type: "error",
        title: "Número Inválido",
        message: "Informe um número inteiro positivo para o concurso (ex: 3350).",
      });
      return;
    }

    if (!actionLockController.acquire("GENERATE")) {
      return;
    }

    setIsLoading(true);
    try {
      // 1.1 Verificar no IndexedDB se o concurso já existe (DRAFT, FROZEN, SCORED)
      const existing = await repository.getContestRecord(contestNum);

      if (existing) {
        // NÃO gerar outro! Carregar o existente sem consumir RNG e sem alterar dados
        setActiveRecord(existing);
        setFeedback({
          type: "info",
          title: `Concurso ${contestNum} Carregado`,
          message: `Este concurso já possui registro oficial no histórico com status ${existing.status}. Registro carregado.`,
        });
        if (onRecordUpdated) onRecordUpdated();
        await refreshLocalState();
      } else {
        // 1.2 Criar DRAFT e salvar
        const draft = createContestDraft(contestNum);
        await repository.saveDraft(draft);
        const storedDraft = await repository.getContestRecord(contestNum);
        setActiveRecord(storedDraft);
        setFeedback({
          type: "success",
          title: `Concurso ${contestNum} Gerado`,
          message: "5 jogos combinatórios C₅ gerados como RASCUNHO. Confirme a aposta para selar oficialmente.",
        });
        if (onRecordUpdated) onRecordUpdated();
        await refreshLocalState();
      }
    } catch (err: any) {
      try {
        const recheck = await repository.getContestRecord(contestNum);
        if (recheck) {
          setActiveRecord(recheck);
          setFeedback({
            type: "info",
            title: `Concurso ${contestNum} Carregado`,
            message: `O registro está salvo no armazenamento local como ${recheck.status}.`,
          });
          return;
        }
      } catch {
        // ignore
      }

      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro na Operação",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("GENERATE");
      setIsLoading(false);
    }
  };

  // 2. Confirmação Atômica de Aposta Realizada (R$ 17,50)
  // DRAFT -> FROZEN + betPlacedAt + integrityHash (operação atômica V1.13)
  const handleConfirmBet = async () => {
    if (!activeRecord) return;
    setIsLoading(true);
    clearFeedback();

    try {
      const confirmed = await controller.confirmBet();
      setActiveRecord(confirmed);
      setShowBetConfirmModal(false);
      setFeedback({
        type: "success",
        title: "Aposta Confirmada",
        message: `Os 5 jogos do concurso ${confirmed.contestNumber} foram congelados e confirmados como aposta oficial realizada (R$ 17,50).`,
      });
      if (onRecordUpdated) onRecordUpdated();
      await refreshLocalState();
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Confirmar Aposta",
        message: classified.userMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Alerta se IndexedDB estiver bloqueado */}
      {storageBlocked && (
        <div
          id="storage-blocked-banner"
          className="p-4 rounded-xl bg-red-950/50 border border-red-500/50 text-red-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
          <div>
            <strong className="block font-semibold">Acesso ao Histórico Local Indisponível</strong>
            <p>
              Não foi possível acessar o histórico local. A geração oficial foi bloqueada para evitar perda de rastreabilidade.
            </p>
          </div>
        </div>
      )}

      {/* Barra de Ação Principal */}
      <PrimaryActionBar
        primaryAction={primaryAction}
        onExecuteAction={handleExecutePrimaryAction}
        activeContestStatus={activeRecord?.status}
      />

      {/* Dashboard de Sincronização */}
      <SyncStatusPanel
        syncState={syncState}
        isLoading={isSyncing}
        onRefresh={refreshExternalSync}
        onPrepareContest={handlePrepareContestFromPanel}
        onOpenDraft={handleOpenDraftFromPanel}
        onCheckResult={handleCheckResultFromPanel}
      />

      {/* Topo do Gerador */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
              Gerador Oficial C₅
            </span>
            <h2 className="text-2xl font-bold text-zinc-100 mt-1 font-mono">
              5 jogos simples • 15 dezenas por jogo
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Geração combinatória com cobertura garantida de 25 dezenas em 5 apostas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Arquitetura:</span>
              <span className="text-zinc-200 font-mono font-semibold">C5-1.0.0</span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Custo por concurso:</span>
              <span className="text-emerald-400 font-mono font-semibold">R$ 17,50</span>
            </div>
          </div>
        </div>

        {/* Formulário de Seleção/Geração de Concurso */}
        <form onSubmit={handleGenerateOrLoad} className="mt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 max-w-2xl">
            <div className="grow">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="contest-number-input"
                  className="text-xs font-semibold text-zinc-300"
                >
                  Número do Concurso (somente inteiro positivo):
                </label>
                <button
                  type="button"
                  id="btn-fetch-latest-contest"
                  onClick={handleFetchLatestContest}
                  disabled={isLoading || isFetchingLatest || lockState.isLocked}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                  title="Consultar último concurso apurado na CAIXA"
                >
                  {isFetchingLatest || lockState.currentOperation === "CAIXA_QUERY" ? (
                    <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                  ) : (
                    <Globe className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {lockState.currentOperation === "CAIXA_QUERY" ? "CONSULTANDO..." : "ATUALIZAR CONCURSO"}
                  </span>
                </button>
              </div>
              <input
                id="contest-number-input"
                type="number"
                min="1"
                step="1"
                placeholder="Ex: 3350"
                value={contestInput}
                onChange={(e) => setContestInput(e.target.value)}
                disabled={isLoading || lockState.isLocked}
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-700 focus:border-emerald-500 rounded-xl text-zinc-100 placeholder-zinc-500 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 transition-all disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              id="btn-generate-contest"
              disabled={isLoading || lockState.isLocked || !contestInput.trim()}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm tracking-wide transition-all shadow-md hover:shadow-emerald-950/40 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:ring-2 focus:ring-emerald-400"
            >
              {isLoading && lockState.currentOperation === "GENERATE" ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>
                {lockState.currentOperation === "GENERATE" ? "PROCESSANDO..." : "GERAR 5 JOGOS"}
              </span>
            </button>
          </div>

          {/* Sugestão de Concurso */}
          {latestContestInfo && (
            <div
              id="suggested-contest-banner"
              className="mt-3 p-3 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 max-w-2xl"
            >
              <div>
                <span>Último concurso na CAIXA: <strong>{latestContestInfo.lastContest}</strong> ({latestContestInfo.drawDate}).</span>
                <span className="block sm:inline sm:ml-2 text-zinc-300">
                  Próximo sugerido: <strong className="text-emerald-400 font-mono text-sm">{latestContestInfo.suggestedNext}</strong>
                </span>
              </div>
              <button
                type="button"
                id="btn-apply-suggested-contest"
                onClick={handleApplySuggestedContest}
                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0"
              >
                USAR CONCURSO {latestContestInfo.suggestedNext}
              </button>
            </div>
          )}
        </form>

        {/* Feedback visual */}
        {feedback && (
          <div
            id="generator-feedback-banner"
            role={feedback.type === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`mt-6 p-4 rounded-xl border flex items-start gap-3 text-xs sm:text-sm ${
              feedback.type === "error"
                ? "bg-red-950/30 border-red-500/40 text-red-200"
                : feedback.type === "warning"
                ? "bg-amber-950/30 border-amber-500/40 text-amber-200"
                : feedback.type === "info"
                ? "bg-blue-950/30 border-blue-500/40 text-blue-200"
                : "bg-emerald-950/30 border-emerald-500/40 text-emerald-200"
            }`}
          >
            {feedback.type === "error" ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
            ) : feedback.type === "warning" ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            )}
            <div className="grow">
              {feedback.title && <strong className="block font-semibold">{feedback.title}</strong>}
              <p>{feedback.message}</p>
            </div>
            <button
              type="button"
              onClick={clearFeedback}
              aria-label="Fechar notificação"
              className="text-xs opacity-70 hover:opacity-100 transition-opacity p-1 rounded-md"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Painel do Concurso Ativo */}
      {activeRecord && (
        <div id="active-contest-panel" className="space-y-6">
          {/* Header de Status do Concurso Ativo */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-bold font-mono text-zinc-100">
                    CONCURSO {activeRecord.contestNumber}
                  </h3>

                  {activeRecord.status === "DRAFT" && (
                    <span
                      id="status-badge-draft"
                      className="px-3 py-1 rounded-full bg-amber-950/60 border border-amber-500/50 text-amber-300 font-mono text-xs font-semibold"
                    >
                      RASCUNHO
                    </span>
                  )}
                  {activeRecord.status === "FROZEN" && (
                    <div className="flex items-center gap-2">
                      <span
                        id="status-badge-frozen"
                        className="px-3 py-1 rounded-full bg-blue-950/60 border border-blue-500/50 text-blue-300 font-mono text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>CONGELADO</span>
                      </span>
                      <span
                        id="integrity-badge-frozen"
                        className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-medium flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Integridade: verificada</span>
                      </span>
                    </div>
                  )}
                  {activeRecord.status === "SCORED" && (
                    <div className="flex items-center gap-2">
                      <span
                        id="status-badge-scored"
                        className="px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>CONFERIDO</span>
                      </span>
                      <span
                        id="integrity-badge-scored"
                        className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-medium flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Integridade: verificada</span>
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-zinc-400">
                  <span>Gerado: <span className="text-zinc-300">{formatLocalDate(activeRecord.generatedAt)}</span></span>
                  {activeRecord.frozenAt && (
                    <span>Congelado: <span className="text-zinc-300">{formatLocalDate(activeRecord.frozenAt)}</span></span>
                  )}
                  {activeRecord.betPlacedAt && (
                    <span>Aposta Confirmada: <span className="text-emerald-400 font-medium">{formatLocalDate(activeRecord.betPlacedAt)}</span></span>
                  )}
                  {activeRecord.scoredAt && (
                    <span>Conferido: <span className="text-zinc-300">{formatLocalDate(activeRecord.scoredAt)}</span></span>
                  )}
                </div>
              </div>

              {/* Barra de Ações Rápidas (Copiar, Imprimir, Confirmar Aposta) */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Botão Copiar Jogos */}
                <button
                  type="button"
                  id="btn-copy-games"
                  onClick={handleCopyActiveGames}
                  className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  title="Copiar os 5 jogos formatados para a área de transferência"
                >
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>COPIAR JOGOS</span>
                </button>

                {/* Botão Imprimir */}
                <button
                  type="button"
                  id="btn-print-games"
                  onClick={handlePrintActiveGames}
                  className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  title="Imprimir bilhete dos jogos em formato padrão da Lotofácil"
                >
                  <Printer className="w-3.5 h-3.5 text-zinc-400" />
                  <span>IMPRIMIR</span>
                </button>

                {/* Ação principal em DRAFT: CONFIRMAR APOSTA — R$ 17,50 (Seção 9) */}
                {activeRecord.status === "DRAFT" && (
                  <button
                    type="button"
                    id="btn-confirm-bet-draft"
                    onClick={() => setShowBetConfirmModal(true)}
                    disabled={isLoading || lockState.isLocked}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer focus:ring-2 focus:ring-emerald-400"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>CONFIRMAR APOSTA — R$ 17,50</span>
                  </button>
                )}

                {/* Ações para Concurso FROZEN ou SCORED */}
                {(activeRecord.status === "FROZEN" || activeRecord.status === "SCORED") && (
                  <>
                    {activeRecord.betPlacedAt ? (
                      <>
                        <div
                          id="badge-bet-confirmed"
                          className="px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold inline-flex items-center gap-1.5"
                          title={`Aposta oficial registrada em ${formatLocalDate(activeRecord.betPlacedAt)}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>APOSTA REGISTRADA (R$ 17,50)</span>
                        </div>

                        {activeRecord.status === "SCORED" && (
                          activeRecord.prize === undefined ? (
                            <button
                              type="button"
                              id="btn-open-record-prize"
                              onClick={() => setShowPrizeModal(true)}
                              className="px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-950/40 hover:bg-emerald-600/80 border border-emerald-500/50 rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Award className="w-3.5 h-3.5" />
                              <span>REGISTRAR PRÊMIO</span>
                            </button>
                          ) : (
                            <div
                              id="badge-prize-recorded"
                              title="Registrado manualmente via formulário de encerramento financeiro (MANUAL)"
                              className="px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold inline-flex items-center gap-1.5"
                            >
                              <Award className="w-3.5 h-3.5 text-emerald-400" />
                              <span>PRÊMIO: {formatBRLFromCents(activeRecord.prize.amountCents)}</span>
                            </div>
                          )
                        )}
                      </>
                    ) : activeRecord.status === "FROZEN" ? (
                      <button
                        type="button"
                        id="btn-confirm-bet"
                        onClick={() => setShowBetConfirmModal(true)}
                        disabled={isLoading || lockState.isLocked}
                        className="px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-950/40 hover:bg-emerald-600/80 border border-emerald-500/50 rounded-xl transition-all inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        title="Registrar que os 5 jogos foram apostados e pagos na lotérica (R$ 17,50)"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>CONFIRMAR APOSTA (R$ 17,50)</span>
                      </button>
                    ) : (
                      <div
                        id="badge-bet-not-confirmed"
                        className="px-3 py-2 rounded-xl bg-zinc-950/40 border border-zinc-800 text-zinc-400 font-mono text-xs font-medium inline-flex items-center gap-1.5"
                        title="Concurso conferido sem registro prévio de aposta na lotérica"
                      >
                        <span>NÃO APOSTADO</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Aviso explicativo em FROZEN */}
            {activeRecord.status === "FROZEN" && (
              <div className="mt-4 p-3 rounded-xl bg-blue-950/20 border border-blue-500/30 text-xs text-blue-200">
                <p>
                  🔒 <strong>Aposta Registrada e Congelada:</strong> Os 5 jogos estão oficialmente registrados com hash SHA-256. Para conferir com a apuração da CAIXA, acesse a aba <strong>Conferência</strong>.
                </p>
              </div>
            )}

            {/* Detalhes Técnicos Expansíveis */}
            <div className="mt-4 pt-3 border-t border-zinc-800/80">
              <button
                type="button"
                id="btn-toggle-tech-details"
                onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {isDetailsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span className="font-mono uppercase font-semibold text-[11px] tracking-wider">
                  {isDetailsOpen ? "Ocultar Detalhes Técnicos" : "DETALHES TÉCNICOS (ID, algoritmo e hash)"}
                </span>
              </button>

              {isDetailsOpen && (
                <div
                  id="tech-details-content"
                  className="mt-3 p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2 text-xs font-mono text-zinc-400 animate-in fade-in"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="text-zinc-400 font-sans">Generation ID:</span>
                    <span className="text-zinc-200 break-all">{activeRecord.generationId}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="text-zinc-400 font-sans">Algoritmo / Esquema:</span>
                    <span className="text-zinc-200">{activeRecord.algorithmVersion} • Formato Canônico C₅</span>
                  </div>
                  {activeRecord.integrityHash && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1 border-t border-zinc-800/60">
                      <span className="text-zinc-400 font-sans">Hash SHA-256 Completo:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 break-all text-[11px]">{activeRecord.integrityHash}</span>
                        <button
                          type="button"
                          onClick={() => setShowHashModal(true)}
                          className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 hover:text-white cursor-pointer"
                        >
                          Auditar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Destaque Essencial quando for SCORED (FLOW04: sem painéis operacionais de conferência no Gerador) */}
          {activeRecord.status === "SCORED" && (
            <div id="generator-scored-card" className="p-5 rounded-2xl bg-zinc-900 border border-emerald-500/40 shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
                    Concurso {activeRecord.contestNumber} • Conferido
                  </span>
                  <p className="text-sm text-zinc-300 mt-1">
                    Este concurso já foi apurado e pontuado.
                    {activeRecord.score && (
                      <span className="ml-1 font-semibold text-emerald-400">
                        Melhor resultado: {activeRecord.score.maxHits} acertos.
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Para visualizar o resultado detalhado, auditoria oficial e reconciliação financeira, acesse a aba <strong>Conferência</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Exibição das 5 Apostas Oficiais C5 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-sm font-semibold tracking-wider text-zinc-300 uppercase font-mono">
                {activeRecord.status === "SCORED" ? "Apostas e Conferência de Acertos" : "5 Apostas Oficiais C₅"}
              </h4>
              <span className="text-xs text-zinc-400">
                15 dezenas por jogo em ordem crescente
              </span>
            </div>
            <GamesDisplay record={activeRecord} />
          </div>
        </div>
      )}

      {/* Seções Informativas Obrigatórias */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-800/80">
        {/* Arquitetura C5 */}
        <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold uppercase tracking-wider font-mono">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>ARQUITETURA C₅</span>
          </div>
          <ul className="space-y-1 text-zinc-400 list-disc list-inside">
            <li>5 jogos simples</li>
            <li>15 dezenas por jogo</li>
            <li>25 dezenas utilizadas</li>
            <li>Cada dezena aparece em 3 jogos</li>
            <li>Interseções: 5×7 + 5×8</li>
          </ul>
        </div>

        {/* Cobertura Combinatória C5 */}
        <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold uppercase tracking-wider font-mono">
            <Award className="w-4 h-4 text-emerald-400" />
            <span>COBERTURA COMBINATÓRIA C₅</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-zinc-300 font-mono">
            <div>≥11 acertos: <strong className="text-emerald-400">49,7629%</strong></div>
            <div>≥12 acertos: <strong className="text-emerald-400">9,0976%</strong></div>
            <div>≥13 acertos: <strong className="text-emerald-400">0,7459%</strong></div>
            <div>≥14 acertos: <strong className="text-emerald-400">0,02310%</strong></div>
            <div className="col-span-2">15 acertos: <strong className="text-emerald-400">1 em 653.752</strong></div>
          </div>
          <p className="text-[11px] text-zinc-400 pt-1 italic">
            Valores combinatórios da arquitetura C₅ sob sorteio uniforme. Não representam previsão do próximo concurso.
          </p>
        </div>
      </div>

      {/* Modal de Confirmação de Aposta Realizada */}
      <ConfirmDialog
        isOpen={showBetConfirmModal}
        title="Confirmar Aposta Realizada"
        description={`Confirmar que os 5 jogos do concurso ${activeRecord?.contestNumber} foram registrados e pagos na lotérica (Custo: R$ 17,50)?\n\nEssa confirmação congelará os jogos com hash SHA-256 e registrará a despesa no histórico financeiro.`}
        confirmLabel={lockState.currentOperation === "CONFIRM_BET" ? "CONFIRMANDO..." : "CONFIRMAR APOSTA"}
        cancelLabel="VOLTAR"
        variant="primary"
        isLoading={isLoading && lockState.currentOperation === "CONFIRM_BET"}
        onConfirm={handleConfirmBet}
        onCancel={() => setShowBetConfirmModal(false)}
      />

      {/* Modal de Visualização de Hash */}
      <HashViewerModal
        isOpen={showHashModal}
        record={activeRecord}
        onClose={() => setShowHashModal(false)}
      />

      {/* Modal de Registro de Prêmio */}
      <PrizeRecordModal
        isOpen={showPrizeModal}
        record={activeRecord}
        isLoading={isLoading}
        onClose={() => setShowPrizeModal(false)}
        onRecordPrize={async (amountCents: number) => {
          setIsLoading(true);
          try {
            await controller.recordPrize(amountCents);
            setShowPrizeModal(false);
          } finally {
            setIsLoading(false);
          }
        }}
      />

      {/* Folha de Impressão Oficial Limpa (visível exclusivamente em @media print) */}
      <PrintSheet record={activeRecord} />
    </div>
  );
};
