/**
 * IC1 — Validação de Marcos H0..H5, Reprodução Sequencial e Materialização do Corpus
 * C5M-INTEGRATION-RUN-002 Checkpoint IC1
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateC5Draft, freezeDraft } from "../draft";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { syncSha256 } from "../sha256";
import { C5Game } from "../types";

console.log("=== INICIANDO IC1: VALIDAÇÃO DE MARCOS H0..H5 E REPRODUÇÃO SEQUENCIAL ===");

// 1. CARREGA GOLDEN V2 CONGELADO (Apenas como oráculo de comparação!)
const goldenFile = path.resolve("certification/post-incident-golden-vectors-v2.json");
assert(fs.existsSync(goldenFile), "Golden V2 deve existir");
const goldenRaw = fs.readFileSync(goldenFile, "utf-8");
const goldenSha = crypto.createHash("sha256").update(goldenRaw).digest("hex");
assert.strictEqual(
  goldenSha,
  "55521e2caa737a9d5c99878ce372f440187b5a0e1743deb953af76b83de1ccf3",
  "Golden V2 SHA-256 mismatch!"
);
const goldenData = JSON.parse(goldenRaw);
const goldenMilestones = goldenData.milestones;
assert.strictEqual(goldenMilestones.length, 6, "Golden V2 deve conter exatamente 6 marcos (H0..H5)");

// 2. REFERENCE EVALUATOR (Oráculo matemático independente)
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
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, 15).sort((a, b) => a - b);
}

function refGenCandidate5(nextUint32: () => number): number[][] {
  const games: number[][] = [];
  const set = new Set<string>();
  while (games.length < 5) {
    const g = refGenGame(nextUint32);
    const key = g.join(",");
    if (!set.has(key)) { set.add(key); games.push(g); }
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

function runReferenceEvaluator(): any[] {
  const results: any[] = [];
  const accumulatedGames: number[][] = [];
  let revision = 0;

  for (let c = 3500; c <= 3505; c++) {
    let fp = "";
    if (accumulatedGames.length === 0) {
      fp = syncSha256("H0-REV0-EMPTY");
    } else {
      const serial = accumulatedGames.map(g => g.map(n => n.toString().padStart(2, "0")).join("-")).join("|");
      fp = syncSha256(`H-REV${revision}:${serial}`);
    }

    const masterSeed = syncSha256(`C5-POOL-MASTER:${c}:${fp}`);
    const nextU = refMulberry32(masterSeed);

    let bestIdx = -1;
    let bestGames: number[][] = [];
    let bestProfile: number[] | null = null;

    for (let k = 0; k < 500; k++) {
      const cand = refGenCandidate5(nextU);
      const profile = cand.map(g => refMinDist(g, accumulatedGames)).sort((a, b) => a - b);
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

    const gamesSerial = bestGames.map(g => g.map(n => n.toString().padStart(2, "0")).join("-")).join("|");
    const frozenSha = syncSha256(`C5-FROZEN:${c}:${bestIdx}:${masterSeed}:${fp}:${revision}:${gamesSerial}`);

    results.push({
      contestNumber: c,
      historyRevision: revision,
      inputGamesCount: accumulatedGames.length,
      historyFingerprint: fp,
      poolMasterSeed: masterSeed,
      selectedPoolIndex: bestIdx,
      leximinProfile: bestProfile,
      selectedC5: bestGames,
      frozenPayloadSha256: frozenSha,
    });

    for (const g of bestGames) accumulatedGames.push(g);
    revision++;
  }
  return results;
}

// 3. CURRENT APPLICATION EVALUATOR
function runApplicationEvaluator(): any[] {
  const results: any[] = [];
  const accumulatedGames: C5Game[] = [];
  let revision = 0;

  for (let c = 3500; c <= 3505; c++) {
    const history = createMemoryHistory(accumulatedGames, revision);
    const draft = generateC5Draft(c, history);
    const frozen = freezeDraft(draft);

    results.push({
      contestNumber: c,
      historyRevision: revision,
      inputGamesCount: accumulatedGames.length,
      historyFingerprint: history.fingerprint,
      poolMasterSeed: draft.poolMasterSeed,
      selectedPoolIndex: draft.poolIndex,
      leximinProfile: [...draft.leximinProfile],
      selectedC5: draft.games,
      frozenPayloadSha256: frozen.sha256,
    });

    for (const g of draft.games) accumulatedGames.push(g);
    revision++;
  }
  return results;
}

// 4. DUPLA EXECUÇÃO INDEPENDENTE
console.log("Executando REFERENCE run A e run B...");
const refA = runReferenceEvaluator();
const refB = runReferenceEvaluator();
assert.deepStrictEqual(refA, refB, "REFERENCE run A deve ser idêntico a run B");

console.log("Executando APP run A e run B...");
const appA = runApplicationEvaluator();
const appB = runApplicationEvaluator();
assert.deepStrictEqual(appA, appB, "APP run A deve ser idêntico a run B");

console.log("Confrontando REFERENCE com APP...");
assert.deepStrictEqual(refA, appA, "REFERENCE deve ser 100% idêntico a APP");

console.log("Confrontando resultados calculados com Golden V2 (Oráculo de Entrada Congelada)...");
const milestoneComparisons: any[] = [];
let totalMismatches = 0;

for (let i = 0; i < 6; i++) {
  const calc = appA[i];
  const exp = goldenMilestones[i];

  const contestMatch = calc.contestNumber === exp.contestNumber;
  const revMatch = calc.historyRevision === exp.historyRevision;
  const fpMatch = calc.historyFingerprint === exp.historyFingerprint;
  const seedMatch = calc.poolMasterSeed === exp.poolMasterSeed;
  const poolIdxMatch = calc.selectedPoolIndex === exp.selectedPoolIndex;
  const profileMatch = JSON.stringify(calc.leximinProfile) === JSON.stringify(exp.leximinProfile);
  const gamesMatch = JSON.stringify(calc.selectedC5) === JSON.stringify(exp.selectedC5Games);
  const shaMatch = calc.frozenPayloadSha256 === exp.frozenPayloadSha256;

  const milestoneMatch = contestMatch && revMatch && fpMatch && seedMatch && poolIdxMatch && profileMatch && gamesMatch && shaMatch;
  if (!milestoneMatch) {
    totalMismatches++;
  }

  milestoneComparisons.push({
    milestone: `H${i} (Concurso ${calc.contestNumber})`,
    contestMatch,
    revMatch,
    fpMatch,
    seedMatch,
    poolIdxMatch,
    profileMatch,
    gamesMatch,
    shaMatch,
    firstDivergence: gamesMatch ? (shaMatch ? "NONE" : "frozenPayloadSha256") : "selectedC5Games",
    calcGames: calc.selectedC5,
    expGames: exp.selectedC5Games,
  });

  console.log(`  Marco H${i} (Concurso ${calc.contestNumber}): ${milestoneMatch ? "✓ MATCH TOTAL" : "✗ DIVERGÊNCIA DETECTADA"}`);
  if (!milestoneMatch) {
    console.log(`    Primeira variável divergente: ${gamesMatch ? "frozenPayloadSha256" : "selectedC5Games"}`);
  }
}

// 5. MATERIALIZAÇÃO DETERMINÍSTICA DO CORPUS DO IC1
function buildCanonicalCorpus(calculatedMilestones: any[]) {
  return {
    corpusVersion: "RUN002_IC1_CANONICAL_CORPUS_V2",
    runId: "C5M-INTEGRATION-RUN-002",
    checkpoint: "IC1",
    deterministicSpecification: "C5-Memory-2.0.0",
    poolSizeK: 500,
    gamesPerContest: 5,
    numbersPerGame: 15,
    milestones: calculatedMilestones.map((m, idx) => ({
      milestoneIndex: idx,
      contestNumber: m.contestNumber,
      historyRevision: m.historyRevision,
      inputGamesCount: m.inputGamesCount,
      historyFingerprint: m.historyFingerprint,
      poolMasterSeed: m.poolMasterSeed,
      selectedPoolIndex: m.selectedPoolIndex,
      leximinProfile: m.leximinProfile,
      selectedC5: m.selectedC5,
      frozenPayloadSha256: m.frozenPayloadSha256,
    })),
  };
}

const corpusDir = path.resolve("certification/c5-memory-v2/integration/run-002/corpus");
if (!fs.existsSync(corpusDir)) {
  fs.mkdirSync(corpusDir, { recursive: true });
}

// Materialização 1
const corpusObj1 = buildCanonicalCorpus(appA);
const corpusJson1 = JSON.stringify(corpusObj1, null, 2);
const corpusFile1 = path.join(corpusDir, "canonical-corpus-v2.json");
fs.writeFileSync(corpusFile1, corpusJson1, "utf-8");
const hash1 = crypto.createHash("sha256").update(fs.readFileSync(corpusFile1)).digest("hex");

// Materialização 2 independente
const corpusObj2 = buildCanonicalCorpus(refB);
const corpusJson2 = JSON.stringify(corpusObj2, null, 2);
const corpusFile2 = path.join(corpusDir, "canonical-corpus-v2-reproduced.json");
fs.writeFileSync(corpusFile2, corpusJson2, "utf-8");
const hash2 = crypto.createHash("sha256").update(fs.readFileSync(corpusFile2)).digest("hex");

assert.strictEqual(corpusJson1, corpusJson2, "Corpus deve ser byte-idêntico");
assert.strictEqual(hash1, hash2, "SHA-256 do Corpus deve ser 100% reproduzível");

// Remove o arquivo de teste de reprodução após validação
fs.unlinkSync(corpusFile2);

console.log(`Corpus Canônico materializado com sucesso em: ${corpusFile1}`);
console.log(`Corpus SHA-256: ${hash1}`);
console.log(`Corpus Bytes: ${Buffer.byteLength(corpusJson1, "utf-8")}`);
console.log(`Total de marcos divergentes em relação ao Golden V2: ${totalMismatches}`);
console.log("=== IC1: VALIDAÇÃO DE MARCOS E CORPUS CONCLUÍDOS ===");
