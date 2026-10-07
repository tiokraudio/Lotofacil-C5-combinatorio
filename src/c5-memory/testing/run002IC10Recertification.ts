/**
 * Suíte Oficial de Certificação da Pesquisa Longitudinal Definitiva (IC10)
 * C5-Memory — INTEGRATION RUN 002
 * Ordem Executiva IC10 — Definitive Longitudinal Research
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { isStructuralC5, buildStructuralC5 } from "../structuralC5";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { syncSha256 } from "../sha256";
import {
  generateC5Draft210,
  freezeDraft210,
  ALGORITHM_VERSION_2_1_0,
  derivePoolMasterSeed210,
  StructuralPRNG,
  DEFAULT_POOL_SIZE_K,
} from "../engine210";
import { computeLeximinProfile, compareLeximin } from "../math";
import { C5Game } from "../types";
import {
  UNIVERSE_TOTAL_OUTCOMES,
  BITSET_BYTE_SIZE,
  OutcomeBitset,
  gameToOutcomeIndex,
  outcomeIndexToGame,
  getOutcomes14Plus,
} from "../research/combinatorics";
import {
  ValidatedProtocol,
  validateResearchProtocolBinding,
  FROZEN_RESEARCH_PROTOCOL_ID,
  FROZEN_RESEARCH_PROTOCOL_SHA256,
} from "../research/protocolValidator";
import {
  ResearchArmExecutor,
  isCandidateAdmissible,
  deriveResearchPoolSeedB,
  deriveOfficialMasterSeeds,
} from "../research/engine";
import {
  calculatePairedDeltas,
  calculateStatisticalSummary,
  StatisticalSummary,
} from "../research/statistics";
import {
  runTrajectory,
  runOrLoadDefinitiveResearch,
  RESULTS_SUMMARY_PATH,
  MANIFEST_PATH,
  DefinitiveResearchResults,
} from "../research/runIC10DefinitiveResearch";

console.log("=== INICIANDO EXECUÇÃO DA ORDEM EXECUTIVA IC10 ===");

// ---------------------------------------------------------------------------
// 1. BARREIRA DE ENTRADA & INTEGRIDADE DAS CAMADAS CERTIFICADAS
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 1] BARREIRA DE ENTRADA E CONSTANTES NORMATIVAS ---");
const expectedProtocolId = "C5_MEMORY_210_RESEARCH_PROTOCOL_V1";
const expectedProtocolSha = "e8841fee2b15243f035ef777cef2cc70789012cc9d8d3299bc66e96c88a98226";
const expectedEngineSha = "3021054c6c7673eec301ab6ee3b99d9ac89c2feade1afc2129417aeda5fba3e1";
const entryCommitIC10 = "d653383ccce5961ad058da0073a9df10ea6629e1";

// 1.1 Binding do Protocolo Físico
const protocolRaw = fs.readFileSync(
  "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v1.json"
);
const protocolSha = crypto.createHash("sha256").update(protocolRaw).digest("hex");
assert.strictEqual(protocolSha, expectedProtocolSha, "Protocol SHA256 mismatch");
console.log(`[PASS] Protocolo SHA-256 verificado: ${protocolSha}`);

// 1.2 Binding do Research Engine
const engineRaw = fs.readFileSync("src/c5-memory/research/engine.ts");
const engineSha = crypto.createHash("sha256").update(engineRaw).digest("hex");
assert.strictEqual(engineSha, expectedEngineSha, "Engine SHA256 mismatch");
console.log(`[PASS] Research Engine SHA-256 verificado: ${engineSha}`);

// 1.3 Verificação de Binding Normativo
const validatedProto = validateResearchProtocolBinding();
assert.strictEqual(validatedProto.protocolId, expectedProtocolId);
assert.strictEqual(validatedProto.calculatedSha256, expectedProtocolSha);
console.log(`[PASS] RESEARCH_PROTOCOL_RUNTIME_BINDING = PASS`);

// 1.4 Verificação de Integridade das Camadas Anteriores
const golden21Raw = fs.readFileSync("certification/c5-memory-2.1.0-golden-v1.json");
const golden21Sha = crypto.createHash("sha256").update(golden21Raw).digest("hex");
assert.strictEqual(
  golden21Sha,
  "49cd9ca494c3e0d6f0163ea4d83bbaf354cd64ed4238175f5ea5081bf5b8600f",
  "GOLDEN_2_1 mismatch"
);
console.log(`[PASS] GOLDEN_2_1_INTEGRITY = PASS (${golden21Sha})`);

// ---------------------------------------------------------------------------
// 2. MATRIZ DEFINITIVA & ESTADO INICIAL
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 2] MATRIZ DEFINITIVA E ESTADO INICIAL H0 ---");
const masterSeeds = deriveOfficialMasterSeeds();
assert.strictEqual(masterSeeds.length, 32, "Devem ser exatamente 32 master seeds");
console.log(`[PASS] RESEARCH_SEED_SET_RUNTIME_BINDING = PASS (32 seeds derivadas)`);

const expectedKGrid = [10, 20, 50, 100, 500];
assert.deepStrictEqual(validatedProto.kGrid, expectedKGrid);
console.log(`[PASS] RESEARCH_K_GRID_RUNTIME_BINDING = PASS (${expectedKGrid.join(", ")})`);

const expectedHorizons = [100, 500, 1000, 2000, 3788];
assert.deepStrictEqual(validatedProto.horizons, expectedHorizons);
console.log(`[PASS] HORIZONS_RUNTIME_BINDING = PASS (${expectedHorizons.join(", ")})`);

// ---------------------------------------------------------------------------
// 3. EXECUÇÃO E CARGA DOS RESULTADOS DA PESQUISA DEFINITIVA
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 3] RESULTADOS DEFINITIVOS CONSOLIDADOS ---");
const researchResults: DefinitiveResearchResults = runOrLoadDefinitiveResearch();
assert.ok(researchResults, "Resultados da pesquisa devem existir");
assert.strictEqual(researchResults.protocolId, expectedProtocolId);
assert.strictEqual(researchResults.protocolSha256, expectedProtocolSha);
assert.strictEqual(researchResults.engineSha256, expectedEngineSha);
assert.strictEqual(researchResults.totalMasterSeeds, 32);
assert.strictEqual(researchResults.causalIntegrityVerified, true);
console.log(`[PASS] RESEARCH_RESULTS_BINDING = PASS`);

// ---------------------------------------------------------------------------
// 4. EXPERIMENTO A: END-TO-END POLICY EFFECT
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 4] EXPERIMENTO A (END-TO-END POLICY EFFECT) ---");
const expA = researchResults.experimentASummaries;
assert.ok(expA, "Exp A summaries devem existir");

// Valida todos os checkpoints de K e T no Exp A
for (const k of expectedKGrid) {
  for (const h of expectedHorizons) {
    const key = `K${k}_T${h}`;
    const rec = expA[key];
    assert.ok(rec, `Registro ${key} ausente no Exp A`);
    assert.strictEqual(rec.experimentId, "EXPERIMENT_A");
    assert.strictEqual(rec.k, k);
    assert.strictEqual(rec.horizon, h);
    assert.strictEqual(rec.duplicateCountBaseline, 0);
    assert.strictEqual(rec.duplicateCountMaxLeximin, 0);

    // MAX-LEXIMIN deve superar estritamente o Baseline em todos os horizontes
    assert.ok(
      rec.maxLeximinMeanCoverage > rec.baselineMeanCoverage,
      `MAX-LEXIMIN deve ter cobertura superior no ${key}`
    );
    assert.ok(rec.deltaSummary.mean > 0, `Delta médio deve ser positivo no ${key}`);
    assert.strictEqual(rec.deltaSummary.positiveCount, 32);
    assert.strictEqual(rec.deltaSummary.negativeCount, 0);
  }
}

// Verifica ganho monótono de K no horizonte final T=3788 para Exp A
const gainA_K10 = expA["K10_T3788"].deltaSummary.mean;
const gainA_K20 = expA["K20_T3788"].deltaSummary.mean;
const gainA_K50 = expA["K50_T3788"].deltaSummary.mean;
const gainA_K100 = expA["K100_T3788"].deltaSummary.mean;
const gainA_K500 = expA["K500_T3788"].deltaSummary.mean;

assert.ok(gainA_K10 > 60000, "Ganho K=10 deve ser > 60k");
assert.ok(gainA_K20 > gainA_K10, "Ganho K=20 deve ser > K=10");
assert.ok(gainA_K50 > gainA_K20, "Ganho K=50 deve ser > K=20");
assert.ok(gainA_K100 > gainA_K50, "Ganho K=100 deve ser > K=50");
assert.ok(gainA_K500 > gainA_K100, "Ganho K=500 deve ser > K=100");

console.log(`[PASS] EXPERIMENT_A_VERIFICATION = PASS:`);
console.log(`       Base(3788)=${expA["K10_T3788"].baselineMeanCoverage}`);
console.log(`       K=10 Delta=+${gainA_K10}`);
console.log(`       K=20 Delta=+${gainA_K20}`);
console.log(`       K=50 Delta=+${gainA_K50}`);
console.log(`       K=100 Delta=+${gainA_K100}`);
console.log(`       K=500 Delta=+${gainA_K500}`);

// ---------------------------------------------------------------------------
// 5. EXPERIMENTO B: CONTROLLED SELECTION EFFECT
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 5] EXPERIMENTO B (CONTROLLED SELECTION EFFECT) ---");
const expB = researchResults.experimentBSummaries;
assert.ok(expB, "Exp B summaries devem existir");

for (const k of expectedKGrid) {
  for (const h of expectedHorizons) {
    const key = `K${k}_T${h}`;
    const rec = expB[key];
    assert.ok(rec, `Registro ${key} ausente no Exp B`);
    assert.strictEqual(rec.experimentId, "EXPERIMENT_B");
    assert.strictEqual(rec.k, k);
    assert.strictEqual(rec.horizon, h);

    // Delta estritamente positivo
    assert.ok(rec.deltaSummary.mean > 0, `Delta médio deve ser positivo no ${key}`);
    assert.strictEqual(rec.deltaSummary.positiveCount, 32);
    assert.strictEqual(rec.deltaSummary.negativeCount, 0);
  }
}

const gainB_K10 = expB["K10_T3788"].deltaSummary.mean;
const gainB_K20 = expB["K20_T3788"].deltaSummary.mean;
const gainB_K50 = expB["K50_T3788"].deltaSummary.mean;
const gainB_K100 = expB["K100_T3788"].deltaSummary.mean;
const gainB_K500 = expB["K500_T3788"].deltaSummary.mean;

assert.ok(gainB_K10 > 60000, "Exp B Ganho K=10 deve ser > 60k");
assert.ok(gainB_K20 > gainB_K10, "Exp B Ganho K=20 deve ser > K=10");
assert.ok(gainB_K50 > gainB_K20, "Exp B Ganho K=50 deve ser > K=20");
assert.ok(gainB_K100 > gainB_K50, "Exp B Ganho K=100 deve ser > K=50");
assert.ok(gainB_K500 > gainB_K100, "Exp B Ganho K=500 deve ser > K=100");

console.log(`[PASS] EXPERIMENT_B_VERIFICATION = PASS:`);
console.log(`       Base Mean(3788)=${expB["K10_T3788"].baselineMeanCoverage}`);
console.log(`       K=10 Delta Mean=+${gainB_K10}`);
console.log(`       K=20 Delta Mean=+${gainB_K20}`);
console.log(`       K=50 Delta Mean=+${gainB_K50}`);
console.log(`       K=100 Delta Mean=+${gainB_K100}`);
console.log(`       K=500 Delta Mean=+${gainB_K500}`);

// ---------------------------------------------------------------------------
// 6. METROLOGIA E SIGN TEST
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 6] METROLOGIA E SIGN TEST ---");
for (const k of expectedKGrid) {
  const sumA = expA[`K${k}_T3788`].deltaSummary;
  const sumB = expB[`K${k}_T3788`].deltaSummary;
  assert.strictEqual(sumA.positiveCount, 32);
  assert.strictEqual(sumA.zeroCount, 0);
  assert.strictEqual(sumA.negativeCount, 0);

  assert.strictEqual(sumB.positiveCount, 32);
  assert.strictEqual(sumB.zeroCount, 0);
  assert.strictEqual(sumB.negativeCount, 0);
}
console.log(`[PASS] SIGN_TEST_ALL_ARMS = 32/32 POSITIVE (p < 1e-9)`);

// ---------------------------------------------------------------------------
// 7. SATURAÇÃO DE K E RECOMENDAÇÃO CIENTÍFICA
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 7] ANÁLISE DE SATURAÇÃO E ESCOLHA DE K ---");
const kRec = researchResults.kRecommendation;
assert.strictEqual(kRec.selectedK, 50, "K selecionado deve ser 50");
assert.ok(kRec.rationale.length > 20, "Rationale deve ser detalhada");

// Eficiência marginal deve ser estritamente decrescente
const eff = kRec.saturationEfficiencyRatio;
console.log(`Relação de Eficiência Marginal por Candidato adicional:`);
console.log(`  K=10:  ${eff[10]} novas coberturas/candidato`);
console.log(`  K=20:  ${eff[20]} novas coberturas/candidato`);
console.log(`  K=50:  ${eff[50]} novas coberturas/candidato`);
console.log(`  K=100: ${eff[100]} novas coberturas/candidato`);
console.log(`  K=500: ${eff[500]} novas coberturas/candidato`);

assert.ok(eff[10] > eff[20]);
assert.ok(eff[20] > eff[50]);
assert.ok(eff[50] > eff[100]);
assert.ok(eff[100] > eff[500]);
console.log(`[PASS] SATURATION_CURVE_CONCAVE = PASS (retornos estritamente decrescentes)`);

// Temporizações no K recomendado (K=50)
const timingK50 = expB["K50_T3788"];
assert.ok(timingK50.meanSelectionTimeMs < 15, "Tempo médio K=50 deve ser < 15ms");
assert.ok(timingK50.p95SelectionTimeMs < 50, "P95 K=50 deve ser < 50ms");
assert.ok(timingK50.maxSelectionTimeMs < 500, "Max K=50 deve ser < 500ms");
console.log(`[PASS] K50_PRODUCTION_TIMING = PASS (Média: ${timingK50.meanSelectionTimeMs}ms, P95: ${timingK50.p95SelectionTimeMs}ms)`);

// ---------------------------------------------------------------------------
// 8. MANIFESTO E REPRODUCIBILIDADE
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 8] MANIFESTO DE REPRODUCIBILIDADE ---");
assert.ok(fs.existsSync(MANIFEST_PATH), "Manifesto de pesquisa deve existir");
const manifestRaw = fs.readFileSync(MANIFEST_PATH, "utf-8");
const manifest = JSON.parse(manifestRaw);
assert.strictEqual(manifest.manifestId, "C5M_RESEARCH_MANIFEST_210_V1");
assert.strictEqual(manifest.protocolSha256, expectedProtocolSha);
assert.strictEqual(manifest.engineSha256, expectedEngineSha);
assert.strictEqual(manifest.executedSeedsCount, 32);
assert.strictEqual(manifest.status, "CERTIFIED_DEFINITIVE");

const expectedResultsSha = crypto
  .createHash("sha256")
  .update(fs.readFileSync(RESULTS_SUMMARY_PATH))
  .digest("hex");
assert.strictEqual(manifest.resultsSummarySha256, expectedResultsSha);
console.log(`[PASS] RESEARCH_MANIFEST_INTEGRITY = PASS (${manifest.resultsSummarySha256})`);

console.log("\n=======================================================");
console.log("DECISÃO OFICIAL IC10: PASS");
console.log("RUN 002 STATUS: OPEN_IC10_PASS");
console.log("K SELECIONADO: K=50 (OPTIMAL K FOR C5-MEMORY-2.1.0)");
console.log("=======================================================");
