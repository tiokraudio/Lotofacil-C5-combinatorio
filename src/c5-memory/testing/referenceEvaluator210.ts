/**
 * Avaliador de Referência Independente para C5-Memory-2.1.0
 * Ordem Executiva IC2-R3 (Seção 6)
 * 
 * PROIBIÇÃO DE DEPENDÊNCIAS:
 * Este avaliador NÃO importa:
 * - engine210.ts
 * - structuralC5.ts
 * - draft.ts
 * - pool.ts
 * - math.ts
 * Toda a cadeia (PRNG -> permutação -> C5 estrutural -> Johnson -> Q -> Leximin -> seleção)
 * é implementada de forma limpa e independente.
 */

import * as crypto from "node:crypto";

export function refSha256(str: string): string {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

export function refMulberry32(seedHex: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedHex.length; i++) {
    h ^= seedHex.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let s = h >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export function refShuffle25(nextUint32: () => number): number[] {
  const arr = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = 24; i > 0; i--) {
    const j = Math.floor((nextUint32() / 4294967296) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function refBuildStructuralC5(p: readonly number[]): number[][] {
  const s12 = [p[0], p[1], p[2]];
  const s23 = [p[3], p[4], p[5]];
  const s34 = [p[6], p[7], p[8]];
  const s45 = [p[9], p[10], p[11]];
  const s51 = [p[12], p[13], p[14]];

  const s13 = [p[15], p[16]];
  const s14 = [p[17], p[18]];
  const s24 = [p[19], p[20]];
  const s25 = [p[21], p[22]];
  const s35 = [p[23], p[24]];

  const j1 = [...s23, ...s34, ...s45, ...s24, ...s25, ...s35].sort((a, b) => a - b);
  const j2 = [...s34, ...s45, ...s51, ...s13, ...s14, ...s35].sort((a, b) => a - b);
  const j3 = [...s12, ...s45, ...s51, ...s14, ...s24, ...s25].sort((a, b) => a - b);
  const j4 = [...s12, ...s23, ...s51, ...s13, ...s25, ...s35].sort((a, b) => a - b);
  const j5 = [...s12, ...s23, ...s34, ...s13, ...s14, ...s24].sort((a, b) => a - b);

  return [j1, j2, j3, j4, j5];
}

export function refJohnson(a: readonly number[], b: readonly number[]): number {
  let count = 0, i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { count++; i++; j++; }
    else if (a[i] < b[j]) { i++; }
    else { j++; }
  }
  return 15 - count;
}

export function refMinDist(game: readonly number[], history: readonly (readonly number[])[]): number {
  if (history.length === 0) return 15;
  let min = 15;
  for (const h of history) {
    const d = refJohnson(game, h);
    if (d < min) {
      min = d;
      if (min === 0) break;
    }
  }
  return min;
}

export function refComputeProfile(candidate: readonly (readonly number[])[], history: readonly (readonly number[])[]): number[] {
  const p = candidate.map(g => refMinDist(g, history));
  return p.sort((a, b) => a - b);
}

export function refCompareLeximin(pA: readonly number[], pB: readonly number[]): number {
  for (let i = 0; i < Math.min(pA.length, pB.length); i++) {
    if (pA[i] !== pB[i]) return pA[i] - pB[i];
  }
  return 0;
}

export function refSelectBestStructuralCandidate(
  seedHex: string,
  history: readonly (readonly number[])[],
  poolSizeK: number = 500
): { poolIndex: number; games: number[][]; leximinProfile: number[] } {
  const nextUint32 = refMulberry32(seedHex);

  let bestIndex = -1;
  let bestGames: number[][] = [];
  let bestProfile: number[] | null = null;

  for (let k = 0; k < poolSizeK; k++) {
    const perm = refShuffle25(nextUint32);
    const cand = refBuildStructuralC5(perm);
    const prof = refComputeProfile(cand, history);

    if (bestProfile === null || refCompareLeximin(prof, bestProfile) > 0) {
      bestIndex = k;
      bestGames = cand;
      bestProfile = prof;
    }
  }

  return {
    poolIndex: bestIndex,
    games: bestGames,
    leximinProfile: bestProfile!,
  };
}

export function runReferenceChain210(startContest: number = 3500, count: number = 6) {
  const milestones: any[] = [];
  const accumulatedHistory: number[][] = [];
  let revision = 0;

  for (let c = startContest; c < startContest + count; c++) {
    let fp = "";
    if (accumulatedHistory.length === 0) {
      fp = refSha256("H0-REV0-EMPTY");
    } else {
      const serial = accumulatedHistory.map(g => g.map(n => n.toString().padStart(2, "0")).join("-")).join("|");
      fp = refSha256(`H-REV${revision}:${serial}`);
    }

    const masterSeed = refSha256(`C5-POOL-MASTER:${c}:${fp}`);
    const sel = refSelectBestStructuralCandidate(masterSeed, accumulatedHistory, 500);

    const gamesSerial = sel.games.map(g => g.map(n => n.toString().padStart(2, "0")).join("-")).join("|");
    const frozenSha = refSha256(`C5-FROZEN:${c}:${sel.poolIndex}:${masterSeed}:${fp}:${revision}:${gamesSerial}`);

    milestones.push({
      contestNumber: c,
      historyRevision: revision,
      historyFingerprint: fp,
      poolMasterSeed: masterSeed,
      selectedPoolIndex: sel.poolIndex,
      leximinProfile: sel.leximinProfile,
      selectedC5Games: sel.games,
      frozenPayloadSha256: frozenSha,
    });

    for (const g of sel.games) accumulatedHistory.push(g);
    revision++;
  }

  return milestones;
}
