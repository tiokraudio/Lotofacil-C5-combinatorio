/**
 * Script de Reconstrução Forense do Contrato de Geração C5
 * Ordem Executiva IC2-R1
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { DeterministicPRNG } from "../prng";

console.log("=== INICIANDO RECONSTRUÇÃO FORENSE IC2-R1 ===");

// 1. POPCOUNT TABLE
const popTable = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) {
  let cnt = 0, n = i;
  while (n) { cnt += n & 1; n >>>= 1; }
  popTable[i] = cnt;
}
function fastPopcount(v: number): number {
  return popTable[v & 0xFFFF] + popTable[v >>> 16];
}

function evaluateCoverage(c5Games: readonly (readonly number[])[]) {
  const masks = c5Games.map(g => g.reduce((acc, num) => acc | (1 << (num - 1)), 0));
  const m0 = masks[0], m1 = masks[1], m2 = masks[2], m3 = masks[3], m4 = masks[4];

  let c15 = 0, c14p = 0, c13p = 0, c12p = 0, c11p = 0;
  let comb = (1 << 15) - 1;
  const limit = 1 << 25;

  while (comb < limit) {
    const h0 = fastPopcount(comb & m0);
    const h1 = fastPopcount(comb & m1);
    const h2 = fastPopcount(comb & m2);
    const h3 = fastPopcount(comb & m3);
    const h4 = fastPopcount(comb & m4);

    let maxH = h0;
    if (h1 > maxH) maxH = h1;
    if (h2 > maxH) maxH = h2;
    if (h3 > maxH) maxH = h3;
    if (h4 > maxH) maxH = h4;

    if (maxH === 15) c15++;
    if (maxH >= 14) c14p++;
    if (maxH >= 13) c13p++;
    if (maxH >= 12) c12p++;
    if (maxH >= 11) c11p++;

    const a = comb & -comb;
    const b = comb + a;
    comb = (((comb ^ b) >>> 2) / a) | b;
  }
  return { c15, c14p, c13p, c12p, c11p };
}

console.log("Canonical C5 expected: c15=5, c14+=755, c13+=24380, c12+=297380, c11+=1626630");

const prng = new DeterministicPRNG("SAMPLE-AUDIT-SEED-2026");
const N = 10;
console.log(`\nEvaluating N=${N} random-5 baseline candidates:`);

const results: any[] = [];
for (let i = 0; i < N; i++) {
  const cand = prng.generateCandidate5();
  const cov = evaluateCoverage(cand);
  results.push(cov);
  console.log(`Candidate #${i}: 15=${cov.c15}, 14+=${cov.c14p}, 13+=${cov.c13p}, 12+=${cov.c12p}, 11+=${cov.c11p}`);
}

const avg14 = results.reduce((acc, r) => acc + r.c14p, 0) / N;
const avg13 = results.reduce((acc, r) => acc + r.c13p, 0) / N;
const avg12 = results.reduce((acc, r) => acc + r.c12p, 0) / N;
const avg11 = results.reduce((acc, r) => acc + r.c11p, 0) / N;

console.log("\nComparativo Médio (N=10):");
console.log(`14+: Structural C5 = 755 | Random-5 Baseline = ${avg14.toFixed(1)}`);
console.log(`13+: Structural C5 = 24,380 | Random-5 Baseline = ${avg13.toFixed(1)}`);
console.log(`12+: Structural C5 = 297,380 | Random-5 Baseline = ${avg12.toFixed(1)}`);
console.log(`11+: Structural C5 = 1,626,630 | Random-5 Baseline = ${avg11.toFixed(1)}`);
