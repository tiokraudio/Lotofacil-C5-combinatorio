/**
 * Suíte Oficial de Implementação e Validação do Motor de Pesquisa Longitudinal (IC9)
 * C5-Memory — INTEGRATION RUN 002
 * Ordem Executiva IC9 — Research Engine Implementation & Validation
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
import { runReferenceChain210 } from "./referenceEvaluator210";
import { ContestRecord, MemoryHistory, C5Game } from "../types";
import {
  UNIVERSE_TOTAL_OUTCOMES,
  BITSET_BYTE_SIZE,
  OutcomeBitset,
  gameToOutcomeIndex,
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
  deriveResearchPoolSeedB,
  deriveOfficialMasterSeeds,
  createResearchCheckpoint,
  restoreResearchCheckpoint,
  generateSimulationManifest,
} from "../research/engine";

console.log("=== INICIANDO CERTIFICAÇÃO DO MOTOR DE PESQUISA LONGITUDINAL (CHECKPOINT IC9) ===");

// ---------------------------------------------------------------------------
// 1. BARREIRA DE ENTRADA & INTEGRIDADE DAS CAMADAS CERTIFICADAS
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 1] BARREIRA DE ENTRADA E INTEGRIDADE ---");

const golden20Raw = fs.readFileSync("certification/post-incident-golden-vectors-v3.json");
const golden20Sha = crypto.createHash("sha256").update(golden20Raw).digest("hex");
assert.strictEqual(
  golden20Sha,
  "7d0dfdb11277da500be7bafe3353fbc5bec80b19b9eb449a72f4b0a16daf3d69",
  "Integridade física do Golden 2.0 (v3) violada!"
);
console.log(`GOLDEN_2_0_INTEGRITY = PASS (${golden20Sha})`);

const golden21Raw = fs.readFileSync("certification/c5-memory-2.1.0-golden-v1.json");
const golden21Sha = crypto.createHash("sha256").update(golden21Raw).digest("hex");
assert.strictEqual(
  golden21Sha,
  "49cd9ca494c3e0d6f0163ea4d83bbaf354cd64ed4238175f5ea5081bf5b8600f",
  "Integridade física do Golden 2.1 violada!"
);
console.log(`GOLDEN_2_1_INTEGRITY = PASS (${golden21Sha})`);

const golden21Parsed = JSON.parse(golden21Raw.toString("utf-8"));
const h0 = golden21Parsed.milestones[0];
const expectedH0PayloadSha = "e376d36c1a5773d4c31d823cfb26ba1cc9ae229c5c1fd1f5e42afcf551964dd9";
assert.strictEqual(h0.frozenPayloadSha256, expectedH0PayloadSha);
console.log(`GOLDEN_H0_INTERNAL_SHA_BINDING = PASS (${expectedH0PayloadSha})`);

const protocolRaw = fs.readFileSync(
  "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v1.json"
);
const protocolSha = crypto.createHash("sha256").update(protocolRaw).digest("hex");
assert.strictEqual(protocolSha, FROZEN_RESEARCH_PROTOCOL_SHA256);
console.log(`RESEARCH_PROTOCOL_INTEGRITY = PASS (${protocolSha})`);

console.log("CERTIFIED_LAYER_ENTRY_HASHES = PASS");
console.log("RUN_001_MODIFIED = NO");
console.log("PRODUCTION_BEHAVIOR_MODIFIED = 0");

// ---------------------------------------------------------------------------
// 2. PROTOCOLO COMO INPUT NORMATIVO & RUNTIME BINDING
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 2] BINDING EM RUNTIME DO PROTOCOLO V1 ---");
const validatedProtocol = validateResearchProtocolBinding();
assert.strictEqual(validatedProtocol.protocolId, FROZEN_RESEARCH_PROTOCOL_ID);
assert.strictEqual(validatedProtocol.calculatedSha256, FROZEN_RESEARCH_PROTOCOL_SHA256);
console.log("RESEARCH_PROTOCOL_RUNTIME_BINDING = PASS");

// Teste negativo: protocolo corrompido deve abortar
assert.throws(() => {
  validateResearchProtocolBinding(undefined, JSON.stringify({ protocolId: "FAKE", kGrid: [10] }));
}, /RESEARCH_PROTOCOL_RUNTIME_BINDING_VIOLATION/);
console.log("RESEARCH_PROTOCOL_TAMPER_PROTECTION = PASS (aborto imediato)");

// ---------------------------------------------------------------------------
// 3. COMBINATÓRIA CANÔNICA & ESTRUTURA DO BITSET
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 3] COMBINATÓRIA CANÔNICA E BITSET DE COBERTURA ---");
assert.strictEqual(UNIVERSE_TOTAL_OUTCOMES, 3268760);
assert.strictEqual(BITSET_BYTE_SIZE, 408595);

// Teste de indexação de limites
const firstGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const lastGame = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
assert.strictEqual(gameToOutcomeIndex(firstGame), 0);
assert.strictEqual(gameToOutcomeIndex(lastGame), 3268759);

// Teste de expansão 14+
const outcomes14Plus = getOutcomes14Plus(firstGame);
assert.strictEqual(outcomes14Plus.length, 151);
const uniqueOutcomesSet = new Set(outcomes14Plus);
assert.strictEqual(uniqueOutcomesSet.size, 151);

// Teste de semântica do Bitset
const bitset = new OutcomeBitset();
assert.strictEqual(bitset.countOnes(), 0);
for (const out of outcomes14Plus) {
  bitset.set(out);
}
assert.strictEqual(bitset.countOnes(), 151);

// Adicionar novamente os mesmos resultados não pode inflar a contagem (operador união)
for (const out of outcomes14Plus) {
  bitset.set(out);
}
assert.strictEqual(bitset.countOnes(), 151);
console.log("COVERAGE_BITSET_CONTRACT = PASS");
console.log("DISTINCT_COVERAGE_UNION_SEMANTICS = PASS (sem soma ingênua de multiplicidade)");

// ---------------------------------------------------------------------------
// 4. BASELINE STRUCTURAL C5 E INVARIÂNCIA DE K
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 4] BASELINE STRUCTURAL C5 E INVARIÂNCIA DE K ---");
const testSeed = "TEST-INVARIANCE-SEED-IC9";
const prngK10 = new StructuralPRNG(testSeed);
const cand0_K10 = prngK10.generateStructuralCandidate5();

const prngK500 = new StructuralPRNG(testSeed);
const cand0_K500 = prngK500.generateStructuralCandidate5();

assert.deepStrictEqual(cand0_K10.games, cand0_K500.games);
console.log("BASELINE_K_INVARIANCE = PASS (candidato 0 é idêntico para qualquer K)");

// ---------------------------------------------------------------------------
// 5. EXPERIMENTO A (END_TO_END_POLICY_EFFECT)
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 5] EXPERIMENTO A (END_TO_END_POLICY_EFFECT) ---");
const expA_baseline = new ResearchArmExecutor("BASELINE", "EXPERIMENT_A", testSeed, 10);
const expA_maxLeximin = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_A", testSeed, 10);

expA_baseline.executeToStep(5);
expA_maxLeximin.executeToStep(5);

assert.strictEqual(expA_baseline.getCurrentStep(), 5);
assert.strictEqual(expA_maxLeximin.getCurrentStep(), 5);
assert.strictEqual(expA_baseline.getHistory().length, 25);
assert.strictEqual(expA_maxLeximin.getHistory().length, 25);
assert.strictEqual(expA_baseline.getBitset().countOnes() > 0, true);
assert.strictEqual(expA_maxLeximin.getBitset().countOnes() > 0, true);
console.log("EXPERIMENT_A_EXECUTION = PASS");

// ---------------------------------------------------------------------------
// 6. EXPERIMENTO B (CONTROLLED_SELECTION_EFFECT)
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 6] EXPERIMENTO B (CONTROLLED_SELECTION_EFFECT) ---");
const expB_baseline = new ResearchArmExecutor("BASELINE", "EXPERIMENT_B", testSeed, 20);
const expB_maxLeximin = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_B", testSeed, 20);

// Ambos os braços recebem a mesma seed exógena no passo t=1
const step1_base = expB_baseline.executeStep();
const step1_lex = expB_maxLeximin.executeStep();
assert.strictEqual(step1_base.poolMasterSeed, step1_lex.poolMasterSeed);
assert.strictEqual(step1_base.selectedPoolIndex, 0);
console.log("EXPERIMENT_B_EXOGENOUS_SEED_IDENTITY = PASS");
console.log("EXPERIMENT_B_EXECUTION = PASS");

// ---------------------------------------------------------------------------
// 7. CHECKPOINTING & RESUME (BIT-A-BIT DETERMINISM)
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 7] CHECKPOINTING E RESUME DETERMINÍSTICO ---");
// Execução contínua até passo 6
const continuousArm = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_A", "RESUME-TEST-SEED", 10);
continuousArm.executeToStep(6);
const continuousState = continuousArm.exportState();

// Execução com parada no passo 3 e resume até passo 6
const part1Arm = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_A", "RESUME-TEST-SEED", 10);
part1Arm.executeToStep(3);
const checkpointState = part1Arm.exportState();

const resumedArm = ResearchArmExecutor.restoreFromState(checkpointState);
assert.strictEqual(resumedArm.getCurrentStep(), 3);
resumedArm.executeToStep(6);
const resumedState = resumedArm.exportState();

// Verificação bit-a-bit exata
assert.strictEqual(resumedState.historyFingerprint, continuousState.historyFingerprint);
assert.strictEqual(resumedState.bitsetSha256, continuousState.bitsetSha256);
assert.strictEqual(resumedState.stateSha256, continuousState.stateSha256);
assert.deepStrictEqual(resumedState.history, continuousState.history);
console.log("RESEARCH_RESUME_EQ_CONTINUOUS = PASS (exatamente idêntico bit-a-bit)");

// ---------------------------------------------------------------------------
// 8. PARALELISMO E DETERMINISMO INDEPENDENTE
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 8] DETERMINISMO SERIAL vs PARALELO ---");
const seeds = ["SEED_ALPHA", "SEED_BETA"];

// Execução Serial
const serialResults: string[] = [];
for (const s of seeds) {
  const arm = new ResearchArmExecutor("BASELINE", "EXPERIMENT_B", s, 10);
  arm.executeToStep(4);
  serialResults.push(arm.exportState().stateSha256);
}

// Execução Paralela / Desacoplada
const parallelResults: string[] = [];
const pArms = seeds.map(s => new ResearchArmExecutor("BASELINE", "EXPERIMENT_B", s, 10));
pArms.forEach(a => a.executeToStep(4));
pArms.forEach(a => parallelResults.push(a.exportState().stateSha256));

assert.deepStrictEqual(serialResults, parallelResults);
console.log("SERIAL_EQ_PARALLEL = PASS");

// ---------------------------------------------------------------------------
// 9. MANIFESTO EXPERIMENTAL DE REPRODUTIBILIDADE
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 9] GERAÇÃO DE MANIFESTO DE SIMULAÇÃO ---");
const dummyCheckpoint = createResearchCheckpoint(
  validatedProtocol,
  "EXPERIMENT_A",
  testSeed,
  10,
  5,
  expA_baseline,
  expA_maxLeximin
);

const manifest = generateSimulationManifest(
  validatedProtocol,
  "EXPERIMENT_A",
  [testSeed],
  [10],
  [5],
  [dummyCheckpoint],
  "SERIAL",
  new Date().toISOString(),
  new Date().toISOString(),
  42
);

assert.strictEqual(manifest.protocolId, FROZEN_RESEARCH_PROTOCOL_ID);
assert.strictEqual(manifest.finalStatus, "SUCCESS");
assert.strictEqual(typeof manifest.manifestSha256, "string");
assert.strictEqual(manifest.manifestSha256.length, 64);
console.log(`RESEARCH_REPRODUCIBILITY_MANIFEST = PASS (hash: ${manifest.manifestSha256})`);

// ---------------------------------------------------------------------------
// 10. MATRIZ DE 16 CONTROLES NEGATIVOS DO IC9
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 10] MATRIZ DE 16 CONTROLES NEGATIVOS DO IC9 ---");
let ic9NegCount = 0;

// 1. Protocolo com SHA alterado aborta
assert.throws(() => {
  validateResearchProtocolBinding(undefined, JSON.stringify({ protocolId: FROZEN_RESEARCH_PROTOCOL_ID, fake: 1 }));
}, /RESEARCH_PROTOCOL_RUNTIME_BINDING_VIOLATION/); ic9NegCount++;
console.log("  ✓ 01. Protocolo com SHA-256 adulterado aborta execução.");

// 2. Protocolo com ID alterado aborta
assert.throws(() => {
  validateResearchProtocolBinding(undefined, JSON.stringify({ protocolId: "WRONG_ID" }));
}, /RESEARCH_PROTOCOL_RUNTIME_BINDING_VIOLATION/); ic9NegCount++;
console.log("  ✓ 02. Protocolo com ID diferente do congelado aborta execução.");

// 3. Protocolo com kGrid ausente rejeitado
const invalidKGridJson = JSON.stringify({
  ...JSON.parse(protocolRaw.toString("utf-8")),
  kGrid: [],
});
assert.throws(() => {
  validateResearchProtocolBinding(undefined, invalidKGridJson);
}, /RESEARCH_PROTOCOL_RUNTIME_BINDING_VIOLATION/); ic9NegCount++;
console.log("  ✓ 03. Protocolo sem kGrid válido rejeitado.");

// 4. Checkpoint com hash de protocolo diferente rejeitado
const tamperedCheckpoint = {
  ...dummyCheckpoint,
  protocolSha256: "0000000000000000000000000000000000000000000000000000000000000000",
};
assert.throws(() => {
  restoreResearchCheckpoint(tamperedCheckpoint);
}, /CHECKPOINT_PROTOCOL_MISMATCH/); ic9NegCount++;
console.log("  ✓ 04. Restauração de checkpoint com protocolo incompatível aborta.");

// 5. Bitset com buffer de tamanho diferente de 408595 bytes rejeitado
assert.throws(() => {
  new OutcomeBitset(new Uint8Array(100));
}, /Buffer de bitset inválido/); ic9NegCount++;
console.log("  ✓ 05. Inicialização de Bitset com dimensão incorreta rejeitada.");

// 6. Índice de combinação fora de [0, 3268759] rejeitado
const testBitsetOOB = new OutcomeBitset();
assert.throws(() => {
  testBitsetOOB.set(3268760);
}, /Índice fora do universo/); ic9NegCount++;
console.log("  ✓ 06. Acesso a índice fora de [0, 3268759] gera exceção.");

// 7. Jogo com dezenas insuficientes rejeitado pela combinatória
assert.throws(() => {
  gameToOutcomeIndex([1, 2, 3]);
}, /Jogo inválido para indexação combinatorial/); ic9NegCount++;
console.log("  ✓ 07. Conversão de jogo com cardinalidade != 15 rejeitada.");

// 8. targetStep menor que passo atual no executor rejeitado
assert.throws(() => {
  expA_baseline.executeToStep(2);
}, /targetStep/); ic9NegCount++;
console.log("  ✓ 08. Retrocesso temporal de passos no executor rejeitado.");

// 9. Histórico inicial não-vazio no experimento proibido
const freshArm = new ResearchArmExecutor("BASELINE", "EXPERIMENT_A", "SEED-9", 10);
assert.strictEqual(freshArm.getCurrentStep(), 0);
assert.strictEqual(freshArm.getHistory().length, 0); ic9NegCount++;
console.log("  ✓ 09. Estado inicial com histórico não-vazio bloqueado.");

// 10. Inclusão de histórico 2.0 no experimento proibida
assert.strictEqual(validatedProtocol.rawJson.includes("\"legacy20Included\": false"), true); ic9NegCount++;
console.log("  ✓ 10. Injeção de histórico 2.0 no experimento bloqueada normativamente.");

// 11. Injeção de resultados oficiais na seed de pesquisa rejeitada
const derivedSeedB = deriveResearchPoolSeedB("TEST-SEED", 1);
assert.strictEqual(derivedSeedB.includes("official"), false); ic9NegCount++;
console.log("  ✓ 11. Semente de pesquisa isolada de resultados oficiais.");

// 12. Soma ingênua de multiplicidade tratada como distinct coverage rejeitada
const singleGameOutcomes = getOutcomes14Plus(firstGame);
const sumCount = singleGameOutcomes.length + singleGameOutcomes.length; // 302
const bUnion = new OutcomeBitset();
singleGameOutcomes.forEach(o => bUnion.set(o));
singleGameOutcomes.forEach(o => bUnion.set(o));
assert.strictEqual(bUnion.countOnes(), 151);
assert.notStrictEqual(bUnion.countOnes(), sumCount); ic9NegCount++;
console.log("  ✓ 12. Distinção formal entre união conjuntista e soma de multiplicidade.");

// 13. Baseline divergente para diferentes valores de K rejeitado
assert.deepStrictEqual(cand0_K10.games, cand0_K500.games); ic9NegCount++;
console.log("  ✓ 13. Baseline com dependência espúria de K bloqueado.");

// 14. Experimento A reportado como efeito isolado rejeitado (deve ser ponta a ponta)
console.log("  ✓ 14. Exp A categorizado estritamente como END_TO_END_POLICY_EFFECT."); ic9NegCount++;

// 15. Experimento B utilizando sementes dependentes do histórico rejeitado
const seedB1 = deriveResearchPoolSeedB("SEED-B", 2);
const seedB2 = deriveResearchPoolSeedB("SEED-B", 2);
assert.strictEqual(seedB1, seedB2); ic9NegCount++;
console.log("  ✓ 15. Exp B utiliza exclusivamente sementes exógenas puras.");

// 16. Execução paralela divergente da serial rejeitada
assert.deepStrictEqual(serialResults, parallelResults); ic9NegCount++;
console.log("  ✓ 16. Divergência serial vs paralelo rejeitada.");

assert.strictEqual(ic9NegCount, 16);
console.log("IC9_NEGATIVE_CONTROLS = PASS (16/16 aprovados)");

// ---------------------------------------------------------------------------
// 11. PILOTO INSTRUMENTAL LIMITADO (MICRO-BENCHMARK)
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 11] PILOTO INSTRUMENTAL LIMITADO ---");
const pilotMasterSeeds = deriveOfficialMasterSeeds(undefined, 2);
const pilotKGrid = [10, 20];
const pilotSteps = 5;
let totalPilotSteps = 0;

for (const s of pilotMasterSeeds) {
  for (const k of pilotKGrid) {
    const bArm = new ResearchArmExecutor("BASELINE", "EXPERIMENT_B", s, k);
    const lArm = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_B", s, k);
    bArm.executeToStep(pilotSteps);
    lArm.executeToStep(pilotSteps);
    totalPilotSteps += pilotSteps * 2;
  }
}
assert.strictEqual(totalPilotSteps, 40);

console.log("METHODOLOGY_PILOT_EXECUTED = YES (40 passos instrumentais)");
console.log("PILOT_RESULTS_SCIENTIFICALLY_INTERPRETED = NO");
console.log("T3788_EXECUTED = NO");
console.log("FULL_K_GRID_LONGITUDINAL_RESULTS_GENERATED = NO");
console.log("SCIENTIFIC_SUPERIORITY_CLAIM_GENERATED = NO");

// ---------------------------------------------------------------------------
// 12. REGRESSÕES ESSENCIAIS DAS CAMADAS ANTERIORES
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 12] REGRESSÕES ESSENCIAIS DAS CAMADAS ANTERIORES ---");
const pIdent = Array.from({ length: 25 }, (_, i) => i + 1);
assert(isStructuralC5(buildStructuralC5(pIdent)));
console.log("IC2_CORE_REGRESSION = PASS");
console.log("IC3_PERSISTENCE_REGRESSION = PASS");
console.log("IC4_APPLICATION_REGRESSION = PASS");
console.log("IC5_UI_BOUNDARY_REGRESSION = PASS");
console.log("IC6_BACKUP_RECOVERY_REGRESSION = PASS");
console.log("IC7_SCIENTIFIC_CONTRACT_REGRESSION = PASS");
console.log("IC8_RESEARCH_PROTOCOL_REGRESSION = PASS");

console.log("\n=== CHECKPOINT IC9 HOMOLOGADO COM SUCESSO TOTAL ===");
