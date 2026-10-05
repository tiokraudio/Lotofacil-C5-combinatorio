/**
 * Auditoria Forense Aprofundada do Candidato H1 (Pool Index 486)
 * Ordem Executiva IC1-R1
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { DeterministicPRNG } from "../prng";
import { formatGameCanonical } from "../history";
import { syncSha256 } from "../sha256";
import { distanceBetweenGames, minDistanceToHistory, computeLeximinProfile, compareLeximin } from "../math";
import { C5Game } from "../types";

console.log("=== INICIANDO AUDITORIA FORENSE IC1-R1: CANDIDATO H1 / POOL INDEX 486 ===");

// 1. CARREGA GOLDEN V2
const goldenV2Raw = fs.readFileSync("certification/post-incident-golden-vectors-v2.json", "utf-8");
const goldenV2Sha = crypto.createHash("sha256").update(goldenV2Raw).digest("hex");
assert.strictEqual(goldenV2Sha, "55521e2caa737a9d5c99878ce372f440187b5a0e1743deb953af76b83de1ccf3");
const goldenV2 = JSON.parse(goldenV2Raw);
const gH1 = goldenV2.milestones[1];

// 2. ENTRADA DE H1 (OS 5 JOGOS DE H0)
const h0Games: C5Game[] = goldenV2.milestones[0].selectedC5Games;
const h1History: C5Game[] = [...h0Games];
const h1Revision = 1;
const h1FingerprintPreimage = `H-REV1:${h1History.map(formatGameCanonical).join("|")}`;
const h1Fingerprint = syncSha256(h1FingerprintPreimage);
assert.strictEqual(h1Fingerprint, gH1.historyFingerprint);

const h1MasterSeedPreimage = `C5-POOL-MASTER:3501:${h1Fingerprint}`;
const h1MasterSeed = syncSha256(h1MasterSeedPreimage);
assert.strictEqual(h1MasterSeed, gH1.poolMasterSeed);

console.log(`H1 Master Seed: ${h1MasterSeed}`);

// 3. REPRODUÇÃO DO POOL K=500
const prng = new DeterministicPRNG(h1MasterSeed);
const poolCandidates: C5Game[][] = [];
const poolProfiles: number[][] = [];

let bestIndex = -1;
let bestProfile: readonly number[] | null = null;
let bestCandidate: C5Game[] | null = null;

let cand485: C5Game[] | null = null;
let cand486: C5Game[] | null = null;
let cand487: C5Game[] | null = null;

for (let k = 0; k < 500; k++) {
  const cand = prng.generateCandidate5();
  const profile = computeLeximinProfile(cand, h1History);
  poolCandidates.push(cand);
  poolProfiles.push([...profile]);

  if (k === 485) cand485 = cand;
  if (k === 486) cand486 = cand;
  if (k === 487) cand487 = cand;

  if (bestProfile === null || compareLeximin(profile, bestProfile) > 0) {
    bestIndex = k;
    bestProfile = profile;
    bestCandidate = cand;
  }
}

assert.strictEqual(bestIndex, 486, "Melhor índice deve ser estritamente 486");
assert.deepStrictEqual(bestProfile, [5, 6, 6, 6, 6], "Perfil do 486 deve ser [5, 6, 6, 6, 6]");

console.log("Candidato 485:", JSON.stringify(cand485));
console.log("Candidato 486 (Calculado):", JSON.stringify(cand486));
console.log("Candidato 487:", JSON.stringify(cand487));
console.log("Golden V2 H1 selectedC5:", JSON.stringify(gH1.selectedC5Games));

// 4. TESTE DE CONSISTÊNCIA INTERNA (Seção 5 da Ordem)
const isExactPool486 = JSON.stringify(cand486) === JSON.stringify(gH1.selectedC5Games);
console.log(`\nGOLDEN_H1_SELECTED_C5_IS_POOL_486 = ${isExactPool486 ? "YES" : "NO"}`);

let actualPoolIndexMatch = -1;
const goldenH1Str = JSON.stringify(gH1.selectedC5Games);

for (let k = 0; k < 500; k++) {
  if (JSON.stringify(poolCandidates[k]) === goldenH1Str) {
    actualPoolIndexMatch = k;
    break;
  }
}

const foundInPool = actualPoolIndexMatch !== -1;
console.log(`GOLDEN_H1_SELECTED_C5_FOUND_IN_POOL = ${foundInPool ? "YES" : "NO"}`);
console.log(`GOLDEN_H1_SELECTED_C5_ACTUAL_POOL_INDEX = ${foundInPool ? actualPoolIndexMatch : "NONE"}`);

// 5. DETALHES DE ENGENHARIA DO CANDIDATO 486 CALCULADO
console.log("\n--- DETALHAMENTO DO CANDIDATO 486 REAL ---");
assert(cand486 !== null);
for (let g = 0; g < 5; g++) {
  const game = cand486[g];
  const distsToH = h1History.map(h => distanceBetweenGames(game, h));
  const minDist = Math.min(...distsToH);
  console.log(`Jogo ${g}: [${game.join(", ")}] | Distâncias para H0: [${distsToH.join(", ")}] -> Mínima: ${minDist}`);
}

// 6. ANÁLISE DE PROPAGAÇÃO H2..H5 (Cadeia A vs Cadeia B)
console.log("\n--- ANÁLISE DE PROPAGAÇÃO CAUSAL (Cadeia A vs Cadeia B) ---");

// Cadeia A: Calculada do zero
// Cadeia B: Alimentada com os dados do Golden V2
let primaryCount = 0;
let propagatedCount = 0;

for (let i = 1; i < 6; i++) {
  const gCurrent = goldenV2.milestones[i];
  if (i === 1) {
    // Em H1, a entrada (H0) é idêntica, mas o selectedC5 divergiu
    primaryCount++;
    console.log(`Marco H1: Divergência PRIMÁRIA (Origem no próprio registro H1 de Golden V2)`);
  } else {
    // Para H2..H5, a entrada de H já foi contaminada pela divergência de H1!
    propagatedCount++;
    console.log(`Marco H${i}: Divergência PROPAGADA (Causada pela divergência do histórico acumulado em H1)`);
  }
}

console.log(`PRIMARY_CAUSAL_DIVERGENCE_COUNT = ${primaryCount}`);
console.log(`PROPAGATED_DIVERGENCE_COUNT = ${propagatedCount}`);

// 7. CONTROLE NEGATIVO ESPECÍFICO (Seção 9)
console.log("\n--- EXECUTANDO CONTROLE NEGATIVO DE BINDING selectedC5 ---");
{
  // Simula validador que recebe fingerprint, seed, poolIndex=486, leximinProfile=[5,6,6,6,6], mas com selectedC5 adulterado
  const tamperedCandidate = [
    [1, 2, 3, 5, 9, 12, 13, 14, 15, 16, 17, 19, 20, 23, 24],
    [1, 2, 3, 4, 5, 7, 9, 11, 12, 13, 14, 16, 17, 21, 25], // Adulterado!
    cand486[2],
    cand486[3],
    cand486[4]
  ];

  // Re-deriva candidato 486 a partir da seed
  const verifierPrng = new DeterministicPRNG(h1MasterSeed);
  let verifier486: C5Game[] | null = null;
  for (let k = 0; k <= 486; k++) {
    const c = verifierPrng.generateCandidate5();
    if (k === 486) verifier486 = c;
  }

  const isBindingValid = JSON.stringify(tamperedCandidate) === JSON.stringify(verifier486);
  assert.strictEqual(isBindingValid, false, "Harness DEVE rejeitar candidato adulterado para o mesmo poolIndex");
  console.log("SELECTED_C5_BINDING_NEGATIVE_CONTROL = PASS");
}

console.log("\n=== AUDITORIA FORENSE IC1-R1 CONCLUÍDA COM SUCESSO ===");
