import { Draft, FrozenMemoryPayload, MemoryHistory } from "./types";
import { syncSha256 } from "./sha256";
import { selectBestCandidateMaxLeximin } from "./pool";
import { formatGameCanonical } from "./history";

/**
 * Deriva a seed mestre determinística para o concurso alvo e o estado de memória H
 */
export function derivePoolMasterSeed(contestNumber: number, historyFingerprint: string): string {
  return syncSha256(`C5-POOL-MASTER:${contestNumber}:${historyFingerprint}`);
}

/**
 * Cria um Draft oficial do C5-Memory-2.0.0
 */
export function generateC5Draft(
  contestNumber: number,
  history: MemoryHistory
): Draft {
  const poolMasterSeed = derivePoolMasterSeed(contestNumber, history.fingerprint);
  const selection = selectBestCandidateMaxLeximin(poolMasterSeed, history.games);

  return {
    contestNumber,
    games: selection.games,
    poolIndex: selection.poolIndex,
    poolMasterSeed,
    historyFingerprint: history.fingerprint,
    historyRevision: history.revision,
    leximinProfile: selection.leximinProfile,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Congela criptograficamente um Draft em FrozenMemoryPayload
 */
export function freezeDraft(draft: Draft): FrozenMemoryPayload {
  const gamesSerial = draft.games.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${draft.contestNumber}:${draft.poolIndex}:${draft.poolMasterSeed}:${draft.historyFingerprint}:${draft.historyRevision}:${gamesSerial}`;
  const sha256Hash = syncSha256(payloadToHash);

  return {
    contestNumber: draft.contestNumber,
    games: draft.games,
    poolIndex: draft.poolIndex,
    poolMasterSeed: draft.poolMasterSeed,
    historyFingerprint: draft.historyFingerprint,
    historyRevision: draft.historyRevision,
    sha256: sha256Hash,
    frozenAt: new Date().toISOString(),
  };
}
