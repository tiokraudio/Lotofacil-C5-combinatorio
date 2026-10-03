import { C5Game, PoolCandidate } from "./types";
import { DeterministicPRNG } from "./prng";
import { computeLeximinProfile, compareLeximin } from "./math";

export const DEFAULT_POOL_SIZE_K = 500;

export interface PoolSelectionResult {
  readonly poolIndex: number;
  readonly games: readonly C5Game[];
  readonly leximinProfile: readonly number[];
  readonly totalEvaluated: number;
}

/**
 * Gera K=500 candidatos e seleciona o melhor pelo critério MAX-LEXIMIN em relação a H.
 */
export function selectBestCandidateMaxLeximin(
  poolMasterSeed: string,
  history: readonly C5Game[],
  poolSizeK: number = DEFAULT_POOL_SIZE_K
): PoolSelectionResult {
  const prng = new DeterministicPRNG(poolMasterSeed);
  
  let bestCandidate: PoolCandidate | null = null;
  let bestProfile: readonly number[] | null = null;

  for (let k = 0; k < poolSizeK; k++) {
    const candidateGames = prng.generateCandidate5();
    const profile = computeLeximinProfile(candidateGames, history);

    if (bestProfile === null || compareLeximin(profile, bestProfile) > 0) {
      bestCandidate = {
        index: k,
        games: candidateGames,
        leximinScore: profile,
      };
      bestProfile = profile;
    }
  }

  if (!bestCandidate || !bestProfile) {
    throw new Error("Falha ao gerar e selecionar candidato no pool C5.");
  }

  return {
    poolIndex: bestCandidate.index,
    games: bestCandidate.games,
    leximinProfile: bestProfile,
    totalEvaluated: poolSizeK,
  };
}
