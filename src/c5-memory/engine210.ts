/**
 * C5-Memory-2.1.0 — Implementação Candidata Estrutural C5
 * Ordem Executiva IC2-R2
 * 
 * Status: EXPERIMENTAL_UNCERTIFIED
 * Algoritmo: STRUCTURAL_C5
 * Invariante: Cada candidato é um isomorfismo válido da geometria canônica C5.
 */

import { C5Game, MemoryHistory } from "./types";
import { DeterministicPRNG } from "./prng";
import { buildStructuralC5, isStructuralC5 } from "./structuralC5";
import { computeLeximinProfile, compareLeximin } from "./math";
import { syncSha256 } from "./sha256";
import { formatGameCanonical } from "./history";

export const ALGORITHM_VERSION_2_1_0 = "C5-Memory-2.1.0" as const;
export const DEFAULT_POOL_SIZE_K = 500;

export interface StructuralPoolCandidate {
  readonly index: number;
  readonly permutation: readonly number[];
  readonly games: readonly C5Game[];
  readonly leximinScore: readonly number[];
}

export interface StructuralPoolSelectionResult {
  readonly poolIndex: number;
  readonly games: readonly C5Game[];
  readonly leximinProfile: readonly number[];
  readonly totalEvaluated: number;
  readonly candidatePermutation: readonly number[];
}

export interface Draft210 {
  readonly algorithmVersion: typeof ALGORITHM_VERSION_2_1_0;
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly leximinProfile: readonly number[];
  readonly generatedAt: string;
}

export interface FrozenMemoryPayload210 {
  readonly algorithmVersion: typeof ALGORITHM_VERSION_2_1_0;
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly sha256: string;
  readonly frozenAt: string;
}

/**
 * PRNG com suporte à geração estrutural C5 para a versão 2.1.0.
 * Cada candidato consome exatamente 24 chamadas uint32 (Fisher-Yates das 25 dezenas).
 */
export class StructuralPRNG extends DeterministicPRNG {
  /**
   * Gera uma permutação determinística das 25 dezenas (1..25)
   * Consome exatamente 24 chamadas a nextFloat / nextUint32.
   */
  public generatePermutation25(): number[] {
    const balls = Array.from({ length: 25 }, (_, i) => i + 1);
    return this.shuffle(balls);
  }

  /**
   * Constrói um candidato C5 estrutural aplicando o mapeamento canônico à permutação
   */
  public generateStructuralCandidate5(): { permutation: number[]; games: C5Game[] } {
    const p = this.generatePermutation25();
    const games = buildStructuralC5(p);
    return { permutation: p, games };
  }
}

/**
 * Deriva a seed mestre determinística para 2.1.0
 * Vincula o concurso ao fingerprint do histórico (POOL_SEED_DEPENDS_ON_HISTORY_FINGERPRINT = YES)
 */
export function derivePoolMasterSeed210(contestNumber: number, historyFingerprint: string): string {
  return syncSha256(`C5-POOL-MASTER:${contestNumber}:${historyFingerprint}`);
}

/**
 * Gera K=500 candidatos C5 ESTRUTURAIS e seleciona o melhor pelo critério MAX-LEXIMIN
 * Invariante: O builder NÃO lê o histórico (CANDIDATE_BUILDER_READS_HISTORY = NO)
 * O histórico é utilizado unicamente na seleção a posteriori via MAX-LEXIMIN.
 */
export function selectBestStructuralCandidateMaxLeximin(
  poolMasterSeed: string,
  history: readonly C5Game[],
  poolSizeK: number = DEFAULT_POOL_SIZE_K
): StructuralPoolSelectionResult {
  const prng = new StructuralPRNG(poolMasterSeed);

  let bestCandidate: StructuralPoolCandidate | null = null;
  let bestProfile: readonly number[] | null = null;

  for (let k = 0; k < poolSizeK; k++) {
    const { permutation, games } = prng.generateStructuralCandidate5();

    // Validação de sanidade estrutural em runtime
    if (!isStructuralC5(games)) {
      throw new Error(`Invariante C5 violada no candidato ${k} do pool 2.1.0.`);
    }

    const profile = computeLeximinProfile(games, history);

    // Comparação Leximin: em caso de empate, mantém o menor índice (tie-break estrito)
    if (bestProfile === null || compareLeximin(profile, bestProfile) > 0) {
      bestCandidate = {
        index: k,
        permutation,
        games,
        leximinScore: profile,
      };
      bestProfile = profile;
    }
  }

  if (!bestCandidate || !bestProfile) {
    throw new Error("Falha ao selecionar candidato estrutural no pool C5-2.1.0.");
  }

  return {
    poolIndex: bestCandidate.index,
    games: bestCandidate.games,
    leximinProfile: bestProfile,
    totalEvaluated: poolSizeK,
    candidatePermutation: bestCandidate.permutation,
  };
}

/**
 * Gera um Draft oficial para C5-Memory-2.1.0
 */
export function generateC5Draft210(
  contestNumber: number,
  history: MemoryHistory
): Draft210 {
  const poolMasterSeed = derivePoolMasterSeed210(contestNumber, history.fingerprint);
  const selection = selectBestStructuralCandidateMaxLeximin(poolMasterSeed, history.games);

  return {
    algorithmVersion: ALGORITHM_VERSION_2_1_0,
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
 * Congela um Draft 2.1.0 com payload SHA-256 canônico
 */
export function freezeDraft210(draft: Draft210): FrozenMemoryPayload210 {
  const gamesSerial = draft.games.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${draft.contestNumber}:${draft.poolIndex}:${draft.poolMasterSeed}:${draft.historyFingerprint}:${draft.historyRevision}:${gamesSerial}`;
  const sha256Hash = syncSha256(payloadToHash);

  return {
    algorithmVersion: ALGORITHM_VERSION_2_1_0,
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
