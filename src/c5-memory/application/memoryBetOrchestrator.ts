/**
 * C5-Memory-2.0.0 — Application Layer / Orquestrador de Apostas (UI-1A)
 *
 * Responsável por:
 * 1. Mediar todas as operações entre os componentes de UI e o núcleo C5-Memory certificado;
 * 2. Aplicar a regra operacional estrita de NÃO REPETIÇÃO DE JOGOS CONFIRMADOS;
 * 3. Orquestrar a criação de Draft sem mutar o motor MAX-LEXIMIN certificado;
 * 4. Encaminhar confirmações elegíveis para a transação atômica certificada (confirmMemoryBetAtomic);
 * 5. Manter rigorosamente DRAFT fora do histórico H (DRAFT ∉ H).
 */

import { repository as defaultRepository, ContestRepository } from "../../storage/contestRepository.ts";
import { getMemoryHistoryState, confirmMemoryBetAtomic } from "../../storage/memoryTransaction.ts";
import { createDraft, type C5MemoryDraft, StaleRevisionRejectedError } from "../draft.ts";
import { canonicalizeGame } from "../history.ts";
import { gameToBitmask } from "../math.ts";
import { refreshCoordinator } from "../../system/refreshCoordinator.ts";
import { localSyncCoordinator, generateCryptoUUID } from "../../system/localSyncCoordinator.ts";
import type { ContestRecord } from "../../c5/types.ts";
import type { StorageOptions } from "../../storage/types.ts";
import type {
  MemoryOperationalState,
  GenerateMemoryDraftResult,
  ConflictingGameDetail,
  MemoryAuditDetails,
} from "./types.ts";

/**
 * Detecta se algum jogo do candidato (5 jogos de 15 dezenas) coincide matematicamente
 * com qualquer jogo existente no histórico multiconjunto H.
 *
 * A equivalência é pura sobre a combinação das 15 dezenas, independente da ordem interna.
 *
 * @param candidateGames 5 jogos do candidato
 * @param history Jogos elegíveis confirmados em H
 * @returns Diagnóstico de colisões com detalhes canônicos
 */
export function detectDuplicateGames(
  candidateGames: readonly (readonly number[])[],
  history: readonly (readonly number[])[]
): {
  hasDuplicates: boolean;
  duplicateCount: number;
  conflictingGames: ConflictingGameDetail[];
} {
  if (!history || history.length === 0 || !candidateGames || candidateGames.length === 0) {
    return {
      hasDuplicates: false,
      duplicateCount: 0,
      conflictingGames: [],
    };
  }

  // Mapear máscaras binárias dos jogos de H (bitmask de 32 bits representa unicamente a combinação de 15 dezenas)
  const historyMasks = new Set<number>();
  for (const hGame of history) {
    historyMasks.add(gameToBitmask(hGame));
  }

  const conflictingGames: ConflictingGameDetail[] = [];

  for (let i = 0; i < candidateGames.length; i++) {
    const game = candidateGames[i];
    const mask = gameToBitmask(game);
    if (historyMasks.has(mask)) {
      const canonical = canonicalizeGame(game);
      const sortedNums = [...game].sort((a, b) => a - b);
      conflictingGames.push({
        gameIndex: i,
        canonicalGame: canonical,
        numbers: sortedNums,
      });
    }
  }

  return {
    hasDuplicates: conflictingGames.length > 0,
    duplicateCount: conflictingGames.length,
    conflictingGames,
  };
}

/**
 * Consulta o estado operacional do concurso para determinar se C5-Memory pode ser executado.
 */
export async function getMemoryOperationalState(
  contestNumber: number,
  options?: StorageOptions,
  repo: ContestRepository = defaultRepository
): Promise<MemoryOperationalState> {
  if (typeof contestNumber !== "number" || contestNumber <= 0 || !Number.isInteger(contestNumber)) {
    throw new Error(`Número de concurso inválido: ${contestNumber}`);
  }

  const [existingRecord, historyState] = await Promise.all([
    repo.getContestRecord(contestNumber),
    getMemoryHistoryState(options),
  ]);

  const hasRecord = existingRecord !== null;
  const existingRecordStatus = existingRecord?.status;
  const existingRecordAlgorithm = existingRecord?.algorithmVersion;

  let canGenerateMemoryBet = true;
  let reasonIfNotEligible: string | undefined;

  if (existingRecord) {
    if (existingRecord.status === "FROZEN" || existingRecord.status === "SCORED") {
      canGenerateMemoryBet = false;
      reasonIfNotEligible = `Concurso ${contestNumber} já possui aposta confirmada (${existingRecord.status}) com algoritmo ${existingRecord.algorithmVersion}.`;
    }
  }

  return {
    contestNumber,
    hasRecord,
    existingRecordStatus,
    existingRecordAlgorithm,
    canGenerateMemoryBet,
    reasonIfNotEligible,
    historyRevision: historyState.historyRevision,
    historyFingerprint: historyState.historyFingerprint,
    eligibleGamesCountInH: historyState.H.length,
    confirmedContestsCount: historyState.eligibleCount,
  };
}

/**
 * Gera um Draft C5-Memory determinístico para um concurso e aplica a verificação
 * operacional de não repetição contra o histórico H corrente.
 *
 * Se houver repetição de jogo:
 * O Draft é emitido no estado bloqueante EXACT_HISTORY_DUPLICATE_BLOCKED,
 * preservando a seleção matemática sem substituir candidatos e sem auto-regeneração silenciosa.
 */
export async function generateMemoryDraft(
  contestNumber: number,
  seed?: number | string,
  options?: StorageOptions,
  repo: ContestRepository = defaultRepository
): Promise<GenerateMemoryDraftResult> {
  if (typeof contestNumber !== "number" || contestNumber <= 0 || !Number.isInteger(contestNumber)) {
    return {
      status: "CONTEST_NOT_ELIGIBLE",
      contestNumber,
      reason: `Número de concurso inválido: ${contestNumber}`,
    };
  }

  // 1. Verificar idempotência do concurso
  const existing = await repo.getContestRecord(contestNumber);
  if (existing && (existing.status === "FROZEN" || existing.status === "SCORED")) {
    return {
      status: "CONTEST_ALREADY_CONFIRMED",
      contestNumber,
      existingRecordStatus: existing.status,
      existingRecordAlgorithm: existing.algorithmVersion,
      message: `Concurso ${contestNumber} já possui aposta confirmada no histórico. Não é permitido sobrescrever aposta oficial.`,
    };
  }

  // 2. Ler histórico corrente canônico H
  const historyState = await getMemoryHistoryState(options);

  // 3. Definir semente determinística
  const poolMasterSeed = seed ?? (contestNumber >>> 0);

  // 4. Executar núcleo matemático certificado sem qualquer alteração
  const draft = createDraft({
    H: historyState.H,
    historyRevision: historyState.historyRevision,
    historyFingerprint: historyState.historyFingerprint,
    poolMasterSeed,
    poolSize: 500,
  });

  // 5. Verificação Operacional Adicional: Hard Block de Repetição Exata
  const dupCheck = detectDuplicateGames(draft.selectedC5, historyState.H);

  if (dupCheck.hasDuplicates) {
    return {
      status: "EXACT_HISTORY_DUPLICATE_BLOCKED",
      contestNumber,
      draft,
      exactDuplicateCount: dupCheck.duplicateCount,
      conflictingGames: dupCheck.conflictingGames,
      poolMasterSeed: draft.poolMasterSeed,
      poolIndex: draft.poolIndex,
      historyRevision: draft.expectedHistoryRevision,
      historyFingerprint: draft.expectedHistoryFingerprint,
    };
  }

  return {
    status: "READY",
    contestNumber,
    draft,
    exactDuplicateCount: 0,
  };
}

/**
 * Confirma oficialmente a aposta C5-Memory via transação atômica certificada.
 *
 * Defesa em profundidade:
 * 1. Verifica se o concurso já possui aposta confirmada;
 * 2. Revalida que o Draft não possui jogos repetidos contra o histórico lido;
 * 3. Invoca confirmMemoryBetAtomic, que valida OCC (revision + fingerprint) e grava o registro;
 * 4. Emite os eventos de sincronização multiaba e refresh local.
 */
export async function confirmMemoryDraft(
  contestNumber: number,
  draft: C5MemoryDraft,
  options?: StorageOptions,
  repo: ContestRepository = defaultRepository
): Promise<ContestRecord> {
  if (typeof contestNumber !== "number" || contestNumber <= 0 || !Number.isInteger(contestNumber)) {
    throw new Error(`Número de concurso inválido: ${contestNumber}`);
  }
  if (!draft || draft.algorithmVersion !== "C5-Memory-2.0.0") {
    throw new Error("Draft inválido para confirmação C5-Memory.");
  }

  // 1. Checagem prévia de colisão
  const existing = await repo.getContestRecord(contestNumber);
  if (existing && (existing.status === "FROZEN" || existing.status === "SCORED")) {
    throw new Error(
      `Colisão: Concurso ${contestNumber} já possui registro em estado '${existing.status}'. Confirmação duplicada rejeitada.`
    );
  }

  // 2. Barreira defensiva da Application Layer contra repetição de jogos
  const currentState = await getMemoryHistoryState(options);
  const dupCheck = detectDuplicateGames(draft.selectedC5, currentState.H);
  if (dupCheck.hasDuplicates) {
    throw new Error(
      `EXACT_HISTORY_DUPLICATE_BLOCKED: Aposta não pode ser confirmada porque ${dupCheck.duplicateCount} jogo(s) já pertencem ao histórico de apostas confirmadas.`
    );
  }

  // 3. Execução da transação atômica certificada (validação de freshness OCC + gravação readwrite)
  const result = await confirmMemoryBetAtomic({
    contestNumber,
    draft,
    options,
  });

  // 4. Publicação no mecanismo de sincronização multiaba
  try {
    localSyncCoordinator.broadcast("BET_CONFIRMED", contestNumber);
  } catch {
    // Falha em broadcast não anula a persistência definitiva
  }

  // 5. Invalidação do cache reativo local
  try {
    refreshCoordinator.notifyMutationCommitted("BET_CONFIRMED", contestNumber);
  } catch {
    // Falha em notificação local não anula a persistência definitiva
  }

  return result.record;
}

/**
 * Extrai detalhes de auditoria de um registro de concurso que possua memória.
 */
export function getMemoryAuditDetails(record: ContestRecord): MemoryAuditDetails | null {
  if (!record || !record.memoryPayload || record.memoryPayload.algorithmVersion !== "C5-Memory-2.0.0") {
    return null;
  }
  const mp = record.memoryPayload;
  return {
    algorithmVersion: mp.algorithmVersion,
    poolMasterSeed: mp.poolMasterSeed,
    poolIndex: mp.poolIndex,
    historyRevision: mp.historyRevision,
    historyFingerprint: mp.historyFingerprint,
    confirmedRevision: mp.confirmedRevision,
    confirmedAt: mp.confirmedAt,
    winnerHistogram: [...mp.winnerHistogram],
  };
}
