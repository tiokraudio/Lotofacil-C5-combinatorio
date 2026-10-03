/**
 * Verificação de Independência dos Vetores Dourados (RECERT-0.1 Item 3)
 * 
 * Demonstra que POST_INCIDENT_GOLDEN_VECTORS_V1 para H0..H5 são 100%
 * reproduzidos pelo REFERENCE_EVALUATOR independente.
 */

import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { syncSha256 } from "../sha256";

console.log("=== INICIANDO VERIFICAÇÃO INDEPENDENTE DOS VETORES DOURADOS (H0..H5) ===");

// 1. Funções do REFERENCE_EVALUATOR (Totalmente independentes de src/c5-memory/)
function refMulberry32(seedStr: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
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

function refGenGame(nextUint32: () => number): number[] {
  const arr = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = 24; i > 0; i--) {
    const j = Math.floor((nextUint32() / 4294967296) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, 15).sort((a, b) => a - b);
}

function refGenCandidate5(nextUint32: () => number): number[][] {
  const games: number[][] = [];
  const set = new Set<string>();
  while (games.length < 5) {
    const g = refGenGame(nextUint32);
    const key = g.join(",");
    if (!set.has(key)) {
      set.add(key);
      games.push(g);
    }
  }
  return games;
}

function refDist(a: readonly number[], b: readonly number[]): number {
  let count = 0, i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { count++; i++; j++; }
    else if (a[i] < b[j]) { i++; }
    else { j++; }
  }
  return 15 - count;
}

function refMinDist(game: readonly number[], history: readonly (readonly number[])[]): number {
  if (history.length === 0) return 15;
  let min = 15;
  for (const h of history) {
    const d = refDist(game, h);
    if (d < min) { min = d; if (min === 0) break; }
  }
  return min;
}

function refEvaluatePool(seed: string, history: readonly (readonly number[])[]) {
  const nextUint32 = refMulberry32(seed);
  let bestIdx = -1;
  let bestGames: number[][] = [];
  let bestProfile: number[] | null = null;

  for (let k = 0; k < 500; k++) {
    const cand = refGenCandidate5(nextUint32);
    const profile = cand.map(g => refMinDist(g, history)).sort((a, b) => a - b);

    let isBetter = false;
    if (bestProfile === null) {
      isBetter = true;
    } else {
      for (let i = 0; i < 5; i++) {
        if (profile[i] !== bestProfile[i]) {
          isBetter = profile[i] > bestProfile[i];
          break;
        }
      }
    }

    if (isBetter) {
      bestIdx = k;
      bestGames = cand;
      bestProfile = profile;
    }
  }

  return { bestIndex: bestIdx, bestGames, bestProfile: bestProfile! };
}

// 2. Carrega Vetores Candidatos Gerados
const goldenFile = path.resolve("certification/post-incident-golden-vectors-v1.json");
assert(fs.existsSync(goldenFile), "Arquivo golden vectors deve existir");
const goldenEntries = JSON.parse(fs.readFileSync(goldenFile, "utf-8"));

console.log(`Carregados ${goldenEntries.length} marcos candidatos.`);

const refAccumulatedGames: number[][] = [];

for (let i = 0; i < goldenEntries.length; i++) {
  const entry = goldenEntries[i];
  console.log(`\nValidando Marco: ${entry.milestone}`);

  // A. Fingerprint Independente
  let refFingerprint = "";
  if (refAccumulatedGames.length === 0) {
    refFingerprint = syncSha256("H0-REV0-EMPTY");
  } else {
    const serial = refAccumulatedGames.map(g => g.map(n => n.toString().padStart(2, "0")).join("-")).join("|");
    refFingerprint = syncSha256(`H-REV${i}:${serial}`);
  }
  assert.strictEqual(refFingerprint, entry.historyFingerprint, "historyFingerprint deve coincidir");
  console.log(`  ✓ historyFingerprint reproduzido: ${refFingerprint.substring(0, 16)}...`);

  // B. Master Seed Independente
  const refMasterSeed = syncSha256(`C5-POOL-MASTER:${entry.contestNumber}:${refFingerprint}`);
  assert.strictEqual(refMasterSeed, entry.poolMasterSeed, "poolMasterSeed deve coincidir");
  console.log(`  ✓ poolMasterSeed reproduzida: ${refMasterSeed.substring(0, 16)}...`);

  // C. Avaliação do Pool K=500 pelo Reference Evaluator
  const refSelection = refEvaluatePool(refMasterSeed, refAccumulatedGames);
  assert.strictEqual(refSelection.bestIndex, entry.selectedPoolIndex, "poolIndex deve coincidir");
  assert.deepStrictEqual(refSelection.bestProfile, entry.leximinProfile, "leximinProfile deve coincidir");
  assert.deepStrictEqual(refSelection.bestGames, entry.selectedC5Games, "selectedC5Games deve coincidir");
  console.log(`  ✓ selectedPoolIndex reproduzido: #${refSelection.bestIndex}`);
  console.log(`  ✓ leximinProfile reproduzido: [${refSelection.bestProfile.join(", ")}]`);
  console.log(`  ✓ selectedC5Games (5 jogos) idênticos 100%`);

  // D. Frozen Payload SHA-256 Independente
  const gamesSerial = refSelection.bestGames.map(g => g.map(n => n.toString().padStart(2, "0")).join("-")).join("|");
  const payloadToHash = `C5-FROZEN:${entry.contestNumber}:${refSelection.bestIndex}:${refMasterSeed}:${refFingerprint}:${i}:${gamesSerial}`;
  const refSha256 = syncSha256(payloadToHash);
  assert.strictEqual(refSha256, entry.frozenPayloadSha256, "frozenPayloadSha256 deve coincidir");
  console.log(`  ✓ frozenPayloadSha256 reproduzido: ${refSha256.substring(0, 16)}...`);

  // Acumula os jogos para o próximo marco
  for (const g of refSelection.bestGames) {
    refAccumulatedGames.push(g);
  }
}

console.log("\n=======================================================================");
console.log("=== TODOS OS 6 MARCOS H0..H5 REPRODUZIDOS PELO REFERENCE_EVALUATOR ===");
console.log("=======================================================================");
