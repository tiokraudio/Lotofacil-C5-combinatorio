/**
 * Serviço de sincronização operacional da Lotofácil (Prompt 08).
 * 
 * Regra central:
 * Sincronização é: LER, COMPARAR, INFORMAR.
 * NUNCA: LER, ALTERAR AUTOMATICAMENTE.
 * 
 * Nenhuma consulta externa altera o IndexedDB, cria DRAFT, congela,
 * pontua, exclui ou recalcula hash automaticamente.
 */

import type { ContestRepository } from "../storage/contestRepository.ts";
import type { LotteryResultProvider, OfficialContestResult } from "../lottery/types.ts";
import type {
  ContestSyncState,
  SyncNotice,
  SyncRecommendedAction,
} from "./types.ts";

export interface SyncOptions {
  signal?: AbortSignal;
  now?: () => string;
  isOnline?: boolean;
}

/**
 * Constrói o estado sincronizado declarativo comparando o banco local IndexedDB
 * com a consulta pública mais recente da CAIXA.
 * 
 * - Executa no máximo 1 única chamada externa (`getLatestContest`).
 * - Zero chamadas a `getContest()` para registros SCORED ou FROZEN.
 * - Zero operações de escrita (read-only em ambas as fontes).
 */
export async function buildContestSyncState(
  provider: LotteryResultProvider,
  repository: ContestRepository,
  options?: SyncOptions
): Promise<ContestSyncState> {
  const getNow = options?.now ?? (() => new Date().toISOString());
  const fetchedAt = getNow();

  // 1. LER registros locais (IndexedDB)
  const localRecords = await repository.getAllContestRecords();

  const drafts: number[] = [];
  const pendingFrozenContests: number[] = [];
  const scoredContests: number[] = [];

  for (const record of localRecords) {
    if (record.status === "DRAFT") {
      drafts.push(record.contestNumber);
    } else if (record.status === "FROZEN") {
      pendingFrozenContests.push(record.contestNumber);
    } else if (record.status === "SCORED") {
      scoredContests.push(record.contestNumber);
    }
  }

  // Ordenação ascendente para fácil inspeção
  drafts.sort((a, b) => a - b);
  pendingFrozenContests.sort((a, b) => a - b);
  scoredContests.sort((a, b) => a - b);

  const localLatestContest =
    localRecords.length > 0
      ? Math.max(...localRecords.map((r) => r.contestNumber))
      : null;

  // 2. LER CAIXA (Chamada mínima: estritamente 1 getLatestContest)
  let status: "ONLINE" | "OFFLINE" | "ERROR" = "ONLINE";
  let errorMessage: string | undefined;
  let latestOfficialResult: OfficialContestResult | null = null;

  const isBrowserOffline =
    options?.isOnline === false ||
    (typeof navigator !== "undefined" && navigator.onLine === false);

  if (isBrowserOffline) {
    status = "OFFLINE";
    errorMessage = "Modo offline detectado no navegador. Dados locais permanecem totalmente acessíveis.";
  } else {
    try {
      latestOfficialResult = await provider.getLatestContest(options?.signal);
    } catch (err: any) {
      if (err?.code === "ABORTED" || options?.signal?.aborted) {
        throw err;
      }
      status = "ERROR";
      errorMessage =
        err?.message ||
        "Não foi possível atualizar a situação da Lotofácil junto à CAIXA. Os dados locais continuam disponíveis.";
    }
  }

  const latestOfficialContest = latestOfficialResult?.contestNumber ?? null;
  const latestDrawDate = latestOfficialResult?.drawDate ?? null;

  const nextSuggestedContest = latestOfficialResult
    ? typeof latestOfficialResult.nextContestNumber === "number" &&
      latestOfficialResult.nextContestNumber > 0
      ? latestOfficialResult.nextContestNumber
      : latestOfficialResult.contestNumber + 1
    : null;

  // 3. COMPARAR (Classificações operacionais puras)
  const availableResultContests: number[] = [];
  const waitingResultContests: number[] = [];
  const staleDrafts: number[] = [];
  const aheadContests: number[] = [];

  if (latestOfficialContest !== null && nextSuggestedContest !== null) {
    // Classificação de concursos congelados (FROZEN)
    for (const contestNum of pendingFrozenContests) {
      if (contestNum <= latestOfficialContest) {
        availableResultContests.push(contestNum);
      } else {
        waitingResultContests.push(contestNum);
      }
    }

    // Classificação de rascunhos antigos (STALE_DRAFT)
    for (const draftNum of drafts) {
      if (draftNum < latestOfficialContest) {
        staleDrafts.push(draftNum);
      }
    }

    // Classificação de concursos à frente da numeração informada pela CAIXA (LOCAL_AHEAD)
    for (const record of localRecords) {
      if (record.contestNumber > nextSuggestedContest) {
        if (!aheadContests.includes(record.contestNumber)) {
          aheadContests.push(record.contestNumber);
        }
      }
    }
    aheadContests.sort((a, b) => a - b);
  } else {
    // Se offline ou com erro, os FROZEN são tratados preventivamente como aguardando
    waitingResultContests.push(...pendingFrozenContests);
  }

  // 4. INFORMAR (Notices estruturados)
  const notices: SyncNotice[] = [];
  const recommendedActions: SyncRecommendedAction[] = [];

  // A — Sistema Vazio
  if (localRecords.length === 0) {
    notices.push({
      type: "EMPTY_SYSTEM",
      title: "Sistema Sem Concursos Gravados",
      message: nextSuggestedContest
        ? `Nenhum concurso registrado no banco local. Próximo concurso sugerido pela CAIXA: ${nextSuggestedContest}.`
        : "Nenhum concurso registrado no banco local.",
      level: "info",
    });

    if (nextSuggestedContest !== null) {
      recommendedActions.push({
        id: `prepare-${nextSuggestedContest}`,
        type: "PREPARE_CONTEST",
        contestNumber: nextSuggestedContest,
        label: `PREPARAR CONCURSO ${nextSuggestedContest}`,
        description: `Preencher o número ${nextSuggestedContest} no gerador (sem geração automática).`,
        urgency: "MEDIUM",
      });
    }
  }

  // G — Rascunhos antigos (STALE_DRAFT)
  for (const draftNum of staleDrafts) {
    notices.push({
      type: "STALE_DRAFT",
      contestNumber: draftNum,
      title: `Rascunho Antigo Detectado — Concurso ${draftNum}`,
      message: `A CAIXA já apurou o concurso ${latestOfficialContest}. O concurso ${draftNum} já foi encerrado.`,
      level: "warning",
    });

    recommendedActions.push({
      id: `open-stale-${draftNum}`,
      type: "OPEN_DRAFT",
      contestNumber: draftNum,
      label: `ABRIR RASCUNHO ${draftNum}`,
      description: `Inspecionar jogos do rascunho ${draftNum}.`,
      urgency: "LOW",
    });

    recommendedActions.push({
      id: `discard-stale-${draftNum}`,
      type: "DISCARD_DRAFT",
      contestNumber: draftNum,
      label: `DESCARTAR RASCUNHO ${draftNum}`,
      description: `Excluir o rascunho obsoleto do concurso ${draftNum} (requer confirmação).`,
      urgency: "LOW",
    });
  }

  // H — Concurso local à frente (LOCAL_AHEAD)
  for (const aheadNum of aheadContests) {
    notices.push({
      type: "LOCAL_AHEAD",
      contestNumber: aheadNum,
      title: `Concurso ${aheadNum} à Frente da CAIXA`,
      message: `Este concurso está à frente da numeração atualmente informada pela CAIXA (próximo sugerido: ${nextSuggestedContest}).`,
      level: "warning",
    });
  }

  // D & F — Concursos FROZEN com resultado disponível
  for (const contestNum of availableResultContests) {
    notices.push({
      type: "RESULT_AVAILABLE",
      contestNumber: contestNum,
      title: `Resultado Disponível para o Concurso ${contestNum}`,
      message: `O concurso ${contestNum} já foi apurado oficialmente pela CAIXA e aguarda conferência segura.`,
      level: "success",
    });

    recommendedActions.push({
      id: `check-${contestNum}`,
      type: "CHECK_RESULT",
      contestNumber: contestNum,
      label: `CONFERIR CONCURSO ${contestNum}`,
      description: `Consultar e pontuar as apostas do concurso ${contestNum} com confirmação prévia.`,
      urgency: "HIGH",
    });
  }

  // C — Concursos FROZEN aguardando resultado
  for (const contestNum of waitingResultContests) {
    notices.push({
      type: "WAITING_RESULT",
      contestNumber: contestNum,
      title: `Concurso ${contestNum} Aguardando Resultado`,
      message: `Apostas congeladas e auditadas. Aguardando realização da apuração oficial pela CAIXA.`,
      level: "info",
    });
  }

  // B — Rascunhos normais vigentes (não antigos)
  const currentDrafts = drafts.filter((d) => !staleDrafts.includes(d));
  for (const draftNum of currentDrafts) {
    notices.push({
      type: "DRAFT_PENDING",
      contestNumber: draftNum,
      title: `Rascunho Pendente — Concurso ${draftNum}`,
      message: `O concurso ${draftNum} possui jogos gerados em rascunho ainda não congelados.`,
      level: "info",
    });

    recommendedActions.push({
      id: `open-draft-${draftNum}`,
      type: "OPEN_DRAFT",
      contestNumber: draftNum,
      label: `ABRIR RASCUNHO ${draftNum}`,
      description: `Continuar edição ou congelar apostas do concurso ${draftNum}.`,
      urgency: "MEDIUM",
    });
  }

  // Se o próximo concurso sugerido pela CAIXA ainda não possui nenhum registro local
  if (
    nextSuggestedContest !== null &&
    !drafts.includes(nextSuggestedContest) &&
    !pendingFrozenContests.includes(nextSuggestedContest) &&
    !scoredContests.includes(nextSuggestedContest) &&
    localRecords.length > 0
  ) {
    recommendedActions.push({
      id: `prepare-${nextSuggestedContest}`,
      type: "PREPARE_CONTEST",
      contestNumber: nextSuggestedContest,
      label: `PREPARAR CONCURSO ${nextSuggestedContest}`,
      description: `Preencher número do próximo concurso sugerido no gerador.`,
      urgency: "LOW",
    });
  }

  // E — Todos SCORED
  if (
    localRecords.length > 0 &&
    drafts.length === 0 &&
    pendingFrozenContests.length === 0
  ) {
    notices.push({
      type: "ALL_SCORED",
      title: "Todos os Concursos Conferidos",
      message: "Todos os concursos registrados localmente já possuem resultados oficiais apurados.",
      level: "info",
    });
  }

  return {
    fetchedAt,
    status,
    providerName: provider.providerName,
    errorMessage,
    latestOfficialContest,
    latestDrawDate,
    nextSuggestedContest,
    localLatestContest,
    pendingFrozenContests,
    availableResultContests,
    waitingResultContests,
    scoredContests,
    drafts,
    staleDrafts,
    aheadContests,
    notices,
    recommendedActions,
  };
}

/**
 * Controlador de sincronização resiliente com proteção contra concorrência (race condition).
 * Garante que uma requisição mais antiga e lenta nunca sobrescreva um estado mais recente.
 */
export class ContestSyncController {
  private currentSequence = 0;
  private activeAbortController: AbortController | null = null;

  constructor(
    private readonly provider: LotteryResultProvider,
    private readonly repository: ContestRepository
  ) {}

  /**
   * Dispara uma sincronização atômica sequencial.
   * Cancela requisições pendentes anteriores se solicitado.
   */
  async sync(options?: { cancelPrevious?: boolean }): Promise<{
    state: ContestSyncState | null;
    isLatest: boolean;
    sequenceId: number;
  }> {
    if (options?.cancelPrevious && this.activeAbortController) {
      this.activeAbortController.abort();
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;
    const sequenceId = ++this.currentSequence;

    try {
      const state = await buildContestSyncState(this.provider, this.repository, {
        signal: abortController.signal,
      });

      const isLatest = sequenceId === this.currentSequence;
      return { state, isLatest, sequenceId };
    } catch (err: any) {
      if (err?.code === "ABORTED" || abortController.signal.aborted) {
        return { state: null, isLatest: false, sequenceId };
      }
      throw err;
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  getCurrentSequence(): number {
    return this.currentSequence;
  }
}
