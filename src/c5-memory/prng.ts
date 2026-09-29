/**
 * Canonical Mulberry32 PRNG Implementation for C5-Memory-2.0.0
 *
 * Conforms strictly to C5M-CANONICAL-POOL-PRNG-CONTRACT-V1:
 * - Algorithm: MULBERRY32
 * - Version: 1.0.0
 * - State width: 32 bits (uint32)
 * - Seed width: 32 bits (uint32)
 * - State transition: s = (s + 0x6d2b79f5) >>> 0
 * - Word mixing: Math.imul with (s ^ (s >>> 15)), (t ^ (t >>> 7)), and shifts
 * - Normalized float output: word / 4294967296 in [0, 1)
 *
 * Deterministic across all ECMAScript runtimes (V8, JavaScriptCore, SpiderMonkey).
 * Zero external dependencies.
 */

export const PRNG_ALGORITHM_ID = "MULBERRY32";
export const PRNG_VERSION = "1.0.0";
export const SEED_MAX_UINT32 = 4294967295;

/**
 * Normalizes any seed input (number or string representation) into a canonical uint32.
 * Range: [0, 4294967295].
 */
export function normalizePoolMasterSeed(seed: number | string): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed) || Number.isNaN(seed)) {
      throw new Error(`Invalid numeric seed: ${seed}`);
    }
    return seed >>> 0;
  }
  if (typeof seed === "string") {
    const trimmed = seed.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (num >= 0 && num <= SEED_MAX_UINT32) {
        return num >>> 0;
      }
    }
    // Deterministic FNV-1a 32-bit hash for arbitrary string seeds
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
  throw new Error(`Unsupported seed type: ${typeof seed}`);
}

/**
 * State and interface of a Mulberry32 PRNG instance.
 */
export interface Mulberry32Instance {
  /** Produces the next uniform float in [0, 1) */
  (): number;
  /** Produces the next 32-bit unsigned integer word */
  nextWord(): number;
  /** Returns the current internal 32-bit state */
  getState(): number;
  /** Returns the total number of words consumed so far */
  getWordsConsumed(): number;
}

/**
 * Creates an instance of the canonical Mulberry32 PRNG.
 * Pure function: initial state is strictly derived from the seed, with zero shared globals.
 *
 * @param seed Semente inicial (uint32 ou string normalizável)
 * @returns Instância pura do gerador Mulberry32
 */
export function createMulberry32(seed: number | string): Mulberry32Instance {
  let s = normalizePoolMasterSeed(seed);
  let wordsConsumed = 0;

  function nextWord(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    wordsConsumed++;
    return (t ^ (t >>> 14)) >>> 0;
  }

  function nextFloat(): number {
    return nextWord() / 4294967296;
  }

  nextFloat.nextWord = nextWord;
  nextFloat.getState = () => s;
  nextFloat.getWordsConsumed = () => wordsConsumed;

  return nextFloat as Mulberry32Instance;
}
