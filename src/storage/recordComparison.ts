/**
 * Módulo neutro e canônico para comparação semântica e estrita de ContestRecord.
 * Utilizado por ContestRepository, Import, e suítes de teste para evitar TOCTOU e divergências.
 */
import type { ContestRecord } from "../c5/types.ts";
import { C5_SLOTS } from "../c5/constants.ts";

/**
 * Compara dois registros de concurso de forma semântica e estrita em todos os campos.
 *
 * Cobertura integral:
 * - contestNumber, status, generationId, algorithmVersion
 * - generatedAt, frozenAt, integrityHash, officialResult, scoredAt
 * - generation (permutation, slotAssignments, games)
 * - score (result, games, maxHits, bestGameIndexes, prizeCounts, flags)
 */
export function areContestRecordsIdentical(r1: ContestRecord, r2: ContestRecord): boolean {
  if (r1.contestNumber !== r2.contestNumber) return false;
  if (r1.status !== r2.status) return false;
  if (r1.generationId !== r2.generationId) return false;
  if (r1.algorithmVersion !== r2.algorithmVersion) return false;
  if (r1.generatedAt !== r2.generatedAt) return false;
  if (r1.frozenAt !== r2.frozenAt) return false;
  if (r1.integrityHash !== r2.integrityHash) return false;
  if (r1.scoredAt !== r2.scoredAt) return false;

  // Comparação de officialResult
  if (Boolean(r1.officialResult) !== Boolean(r2.officialResult)) return false;
  if (r1.officialResult && r2.officialResult) {
    if (r1.officialResult.length !== r2.officialResult.length) return false;
    for (let i = 0; i < r1.officialResult.length; i++) {
      if (r1.officialResult[i] !== r2.officialResult[i]) return false;
    }
  }

  // Comparação de score
  if (Boolean(r1.score) !== Boolean(r2.score)) return false;
  if (r1.score && r2.score) {
    // 1. score.result
    if (!r1.score.result || !r2.score.result) return false;
    if (r1.score.result.length !== r2.score.result.length) return false;
    for (let i = 0; i < r1.score.result.length; i++) {
      if (r1.score.result[i] !== r2.score.result[i]) return false;
    }

    // 2. score.maxHits
    if (r1.score.maxHits !== r2.score.maxHits) return false;

    // 3. score.bestGameIndexes
    if (!r1.score.bestGameIndexes || !r2.score.bestGameIndexes) return false;
    if (r1.score.bestGameIndexes.length !== r2.score.bestGameIndexes.length) return false;
    for (let i = 0; i < r1.score.bestGameIndexes.length; i++) {
      if (r1.score.bestGameIndexes[i] !== r2.score.bestGameIndexes[i]) return false;
    }

    // 4. score.prizeCounts
    if (Boolean(r1.score.prizeCounts) !== Boolean(r2.score.prizeCounts)) return false;
    if (r1.score.prizeCounts && r2.score.prizeCounts) {
      if (
        r1.score.prizeCounts.hits11 !== r2.score.prizeCounts.hits11 ||
        r1.score.prizeCounts.hits12 !== r2.score.prizeCounts.hits12 ||
        r1.score.prizeCounts.hits13 !== r2.score.prizeCounts.hits13 ||
        r1.score.prizeCounts.hits14 !== r2.score.prizeCounts.hits14 ||
        r1.score.prizeCounts.hits15 !== r2.score.prizeCounts.hits15
      ) {
        return false;
      }
    }

    // 5. flags
    if (r1.score.has11Plus !== r2.score.has11Plus) return false;
    if (r1.score.has12Plus !== r2.score.has12Plus) return false;
    if (r1.score.has13Plus !== r2.score.has13Plus) return false;
    if (r1.score.has14Plus !== r2.score.has14Plus) return false;
    if (r1.score.has15 !== r2.score.has15) return false;

    // 6. score.games (gameIndex, hits, matchedNumbers, missedNumbers)
    if (!r1.score.games || !r2.score.games || r1.score.games.length !== 5 || r2.score.games.length !== 5) {
      return false;
    }
    for (let i = 0; i < 5; i++) {
      const g1 = r1.score.games[i];
      const g2 = r2.score.games[i];
      if (g1.gameIndex !== g2.gameIndex) return false;
      if (g1.hits !== g2.hits) return false;
      if (g1.matchedNumbers.length !== g2.matchedNumbers.length) return false;
      for (let m = 0; m < g1.matchedNumbers.length; m++) {
        if (g1.matchedNumbers[m] !== g2.matchedNumbers[m]) return false;
      }
      if (g1.missedNumbers.length !== g2.missedNumbers.length) return false;
      for (let m = 0; m < g1.missedNumbers.length; m++) {
        if (g1.missedNumbers[m] !== g2.missedNumbers[m]) return false;
      }
    }
  }

  // Comparação da geração
  if (r1.generation.permutation.length !== r2.generation.permutation.length) return false;
  for (let i = 0; i < 25; i++) {
    if (r1.generation.permutation[i] !== r2.generation.permutation[i]) return false;
  }
  for (const slot of C5_SLOTS) {
    if (r1.generation.slotAssignments[slot] !== r2.generation.slotAssignments[slot]) return false;
  }
  for (let g = 0; g < 5; g++) {
    for (let d = 0; d < 15; d++) {
      if (r1.generation.games[g][d] !== r2.generation.games[g][d]) return false;
    }
  }

  return true;
}
