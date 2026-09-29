/**
 * Canonical Candidate Pool Generator for C5-Memory-2.0.0
 *
 * Implements the operational contract for candidate pool generation:
 * - Deterministic derivation from poolMasterSeed via Mulberry32
 * - Fisher-Yates permutation of the 25 Lotofácil numbers (1..25)
 * - Exact consumption of 24 RNG words per candidate
 * - Exactly 500 candidates per pool (12.000 RNG words total)
 * - Canonical C5 mapping via buildC5FromPermutation
 * - Strict generation-ordinal poolIndex assignment (0..499)
 *
 * Zero external side effects, zero mutable globals.
 */

import { buildC5FromPermutation } from "../c5/canonicalBuilder.ts";
import { createMulberry32, normalizePoolMasterSeed } from "./prng.ts";
import type { PoolCandidate, C5Candidate } from "./types.ts";

export const WORDS_PER_CANDIDATE = 24;
export const DEFAULT_POOL_SIZE = 500;
export const TOTAL_WORDS_PER_POOL = 12000;

/**
 * Base canonical numbers for the Lotofácil game (1..25).
 */
const BASE_NUMBERS: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25
]);

/**
 * Generates a uniform permutation of 1..25 using Fisher-Yates shuffle.
 * Consumes strictly 24 RNG words (i from 24 down to 1).
 *
 * @param rng Uniform float generator [0, 1)
 * @returns Array with 25 distinct numbers in 1..25
 */
export function generateCandidatePermutation(rng: () => number): number[] {
  const perm = [...BASE_NUMBERS];
  for (let i = 24; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  return perm;
}

/**
 * Generates a full deterministic candidate pool for C5-Memory-2.0.0.
 *
 * @param poolMasterSeed Semente mestre de 32 bits (número ou string normalizável)
 * @param poolSize Tamanho do pool (padrão normativo K = 500)
 * @returns Array de PoolCandidate com poolIndex ordenado 0..(poolSize - 1)
 */
export function generatePool(
  poolMasterSeed: number | string,
  poolSize: number = DEFAULT_POOL_SIZE
): PoolCandidate[] {
  const seed = normalizePoolMasterSeed(poolMasterSeed);
  const rng = createMulberry32(seed);
  const pool: PoolCandidate[] = new Array(poolSize);

  for (let k = 0; k < poolSize; k++) {
    const perm = generateCandidatePermutation(rng);
    const c5 = buildC5FromPermutation(perm);
    pool[k] = {
      poolIndex: k,
      games: c5.games as unknown as C5Candidate,
    };
  }

  return pool;
}

/**
 * Pure deterministic replay of a candidate pool.
 * Identical to generatePool: same seed produces identical pool bitwise.
 *
 * @param poolMasterSeed Semente mestre original
 * @param poolSize Tamanho do pool (padrão K = 500)
 * @returns Pool reproduzido
 */
export function replayPool(
  poolMasterSeed: number | string,
  poolSize: number = DEFAULT_POOL_SIZE
): PoolCandidate[] {
  return generatePool(poolMasterSeed, poolSize);
}

/**
 * Serializes a candidate pool into a deterministic JSON string.
 */
export function serializePool(pool: readonly PoolCandidate[]): string {
  return JSON.stringify(pool);
}

/**
 * Deserializes a candidate pool from a JSON string.
 * Validates array structure.
 */
export function deserializePool(json: string): PoolCandidate[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("Serialized pool must be an array");
  }
  return parsed as PoolCandidate[];
}

/**
 * Produces a canonical string representation of a candidate pool for hashing/fingerprinting.
 * Format: "poolIndex:g1,g2,g3,g4,g5;..."
 */
export function canonicalizePoolString(pool: readonly PoolCandidate[]): string {
  const lines: string[] = [];
  for (const c of pool) {
    const gamesStr = c.games
      .map((g) => [...g].sort((a, b) => a - b).map((n) => String(n).padStart(2, "0")).join(","))
      .join(";");
    lines.push(`${c.poolIndex}:${gamesStr}`);
  }
  return lines.join("\n");
}
