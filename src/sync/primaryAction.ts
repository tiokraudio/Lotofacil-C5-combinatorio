/**
 * Motor central determinístico de derivação da Próxima Ação da versão 1.0 (Prompt 09).
 * 
 * Regra:
 * Derivado EXCLUSIVAMENTE de ContestSyncState + registros do IndexedDB.
 * Ordem determinística de prioridade:
 * 1. RESULT_AVAILABLE (se houver múltiplos, prioriza o mais antigo primeiro)
 * 2. STALE_DRAFT
 * 3. DRAFT do próximo concurso / ativo
 * 4. FROZEN aguardando resultado oficial
 * 5. Próximo concurso sem registro / Sistema vazio
 * 6. Histórico atualizado / Nenhuma ação pendente
 */

import type { ContestRecord } from "../c5/types.ts";
import type { ContestSyncState } from "./types.ts";

export type PrimaryActionCategory =
  | "RESULT_AVAILABLE"
  | "STALE_DRAFT"
  | "DRAFT_PENDING"
  | "FROZEN_WAITING"
  | "PREPARE_NEXT"
  | "EMPTY_SYSTEM"
  | "ALL_SCORED";

export interface PrimaryAction {
  id: string;
  category: PrimaryActionCategory;
  contestNumber: number | null;
  title: string;
  subtitle: string;
  badge: string;
  actionLabel: string;
  actionType: "CHECK_RESULT" | "OPEN_DRAFT" | "VIEW_CONTEST" | "PREPARE_CONTEST";
  pendingCount?: number;
  allPendingContests?: number[];
  progressStage: "NONE" | "GENERATED" | "FROZEN" | "WAITING_RESULT" | "SCORED";
}

/**
 * Deriva a Ação Principal de forma pura e determinística.
 */
export function computePrimaryAction(
  syncState: ContestSyncState | null,
  localRecords: ContestRecord[] = []
): PrimaryAction {
  // 1. Prioridade 1: Concursos FROZEN com resultado disponível (RESULT_AVAILABLE)
  const availableResults = syncState?.availableResultContests ?? [];
  if (availableResults.length > 0) {
    // Abre o mais antigo pendente primeiro
    const oldestPending = Math.min(...availableResults);
    const count = availableResults.length;

    return {
      id: `action-check-${oldestPending}`,
      category: "RESULT_AVAILABLE",
      contestNumber: oldestPending,
      title: count > 1 ? `${count} RESULTADOS PENDENTES` : `RESULTADO DISPONÍVEL`,
      subtitle:
        count > 1
          ? `Concursos ${availableResults.join(", ")}. O concurso ${oldestPending} é o mais antigo aguardando conferência.`
          : `Concurso ${oldestPending}. Seus 5 jogos estão aguardando conferência com a apuração da CAIXA.`,
      badge: count > 1 ? `${count} PENDENTES` : "APURADO",
      actionLabel: count > 1 ? `CONFERIR CONCURSO ${oldestPending}` : `CONFERIR RESULTADO (${oldestPending})`,
      actionType: "CHECK_RESULT",
      pendingCount: count,
      allPendingContests: availableResults,
      progressStage: "WAITING_RESULT",
    };
  }

  // 2. Prioridade 2: Rascunhos antigos / obsoletos (STALE_DRAFT)
  const staleDrafts = syncState?.staleDrafts ?? [];
  if (staleDrafts.length > 0) {
    const oldestStale = Math.min(...staleDrafts);
    return {
      id: `action-stale-${oldestStale}`,
      category: "STALE_DRAFT",
      contestNumber: oldestStale,
      title: `RASCUNHO ANTIGO — CONCURSO ${oldestStale}`,
      subtitle: `A CAIXA já apurou o concurso ${syncState?.latestOfficialContest}. Este rascunho refere-se a um concurso passado.`,
      badge: "OBSOLETO",
      actionLabel: `REVISAR RASCUNHO ${oldestStale}`,
      actionType: "OPEN_DRAFT",
      progressStage: "GENERATED",
    };
  }

  // 3. Prioridade 3: DRAFT vigente (não obsoleto)
  const allDrafts = (
    localRecords && localRecords.length > 0
      ? localRecords.filter((r) => r.status === "DRAFT").map((r) => r.contestNumber)
      : syncState?.drafts ?? []
  ).sort((a, b) => a - b);
  const activeDrafts = allDrafts.filter((d) => !staleDrafts.includes(d));

  if (activeDrafts.length > 0) {
    const targetDraft = activeDrafts[0];
    return {
      id: `action-draft-${targetDraft}`,
      category: "DRAFT_PENDING",
      contestNumber: targetDraft,
      title: `CONCURSO ${targetDraft}`,
      subtitle: `RASCUNHO • 5 jogos gerados • Ainda não congelados`,
      badge: "RASCUNHO",
      actionLabel: "REVISAR E CONGELAR",
      actionType: "OPEN_DRAFT",
      progressStage: "GENERATED",
    };
  }

  // 4. Prioridade 4: FROZEN aguardando sorteio
  const waitingContests = syncState?.waitingResultContests ?? [];
  if (waitingContests.length > 0) {
    const targetFrozen = Math.min(...waitingContests);
    return {
      id: `action-frozen-${targetFrozen}`,
      category: "FROZEN_WAITING",
      contestNumber: targetFrozen,
      title: `CONCURSO ${targetFrozen}`,
      subtitle: `JOGOS CONFIRMADOS • Aguardando resultado oficial da CAIXA.`,
      badge: "CONGELADO",
      actionLabel: "VER JOGOS",
      actionType: "VIEW_CONTEST",
      progressStage: "FROZEN",
    };
  }

  // 5. Prioridade 5 & 6: Sistema vazio ou todos conferidos (preparar próximo)
  const nextContest =
    syncState?.nextSuggestedContest ??
    (localRecords.length > 0
      ? Math.max(...localRecords.map((r) => r.contestNumber)) + 1
      : null);

  const hasLocalData =
    localRecords.length > 0 ||
    (syncState?.localLatestContest !== null && syncState?.localLatestContest !== undefined) ||
    (syncState?.scoredContests.length ?? 0) > 0 ||
    (syncState?.pendingFrozenContests.length ?? 0) > 0;

  if (!hasLocalData) {
    return {
      id: "action-empty",
      category: "EMPTY_SYSTEM",
      contestNumber: nextContest,
      title: "C₅ LOTOFÁCIL",
      subtitle: nextContest
        ? `Nenhum concurso registrado. Consulte a situação atual e prepare seu primeiro concurso (sugerido: ${nextContest}).`
        : "Nenhum concurso registrado. Consulte a situação atual e prepare seu primeiro concurso.",
      badge: "INÍCIO",
      actionLabel: nextContest ? `PREPARAR CONCURSO ${nextContest}` : "CONSULTAR CONCURSO ATUAL",
      actionType: "PREPARE_CONTEST",
      progressStage: "NONE",
    };
  }

  // Se há registros e todos os concursos pendentes estão apurados
  const latestLocal =
    localRecords.length > 0
      ? Math.max(...localRecords.map((r) => r.contestNumber))
      : syncState?.localLatestContest ?? null;

  return {
    id: "action-all-scored",
    category: "ALL_SCORED",
    contestNumber: nextContest,
    title: latestLocal ? `CONCURSO ${latestLocal} CONFERIDO` : "HISTÓRICO ATUALIZADO",
    subtitle: latestLocal
      ? `Concurso ${latestLocal} conferido. Próximo concurso: ${nextContest}. O concurso ${nextContest} ainda não possui jogos.`
      : "Todos os concursos registrados possuem resultados oficiais apurados e conferidos.",
    badge: "CONFERIDO",
    actionLabel: nextContest ? `PREPARAR CONCURSO ${nextContest}` : "NOVO CONCURSO",
    actionType: "PREPARE_CONTEST",
    progressStage: "SCORED",
  };
}
