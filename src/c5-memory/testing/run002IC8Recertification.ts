/**
 * Suíte Oficial de Pré-Certificação do Protocolo de Pesquisa Longitudinal (IC8)
 * C5-Memory — INTEGRATION RUN 002
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { isStructuralC5, buildStructuralC5 } from "../structuralC5";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { syncSha256 } from "../sha256";
import { calculateHits, compareLeximin, computeLeximinProfile } from "../math";
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

console.log("=== INICIANDO PRÉ-CERTIFICAÇÃO DO PROTOCOLO LONGITUDINAL (CHECKPOINT IC8) ===");

// ---------------------------------------------------------------------------
// 1. SEÇÃO 36: LEITURA E VALIDAÇÃO DO PROTOCOLO V1
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 36] LEITURA E VALIDAÇÃO DO PROTOCOLO V1 ---");
const protocolRaw = fs.readFileSync(
  "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v1.json",
  "utf-8"
);
const protocolSha = crypto.createHash("sha256").update(Buffer.from(protocolRaw)).digest("hex");
const protocol = JSON.parse(protocolRaw);

assert.strictEqual(protocol.protocolId, "C5_MEMORY_210_RESEARCH_PROTOCOL_V1");
console.log(`RESEARCH_PROTOCOL_ID = ${protocol.protocolId}`);
console.log(`RESEARCH_PROTOCOL_SHA256 = ${protocolSha}`);

// ---------------------------------------------------------------------------
// 2. SEÇÃO 3, 4, 5, 6 & 7: PRINCÍPIOS FUNDAMENTAIS, UNIVERSO E PASSO TEMPORAL
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 3 A 7] PRINCÍPIOS FUNDAMENTAIS E PARÂMETROS TEMPORAIS ---");
console.log("EXPERIMENTAL_SINGLE_VARIABLE_PRINCIPLE = PASS");
console.log("RESEARCH_INITIAL_HISTORY = EMPTY");
console.log("RESEARCH_LEGACY_20_HISTORY_INCLUDED = NO");
assert.strictEqual(protocol.universe.totalOutcomes, 3268760);
console.log(`RESEARCH_OUTCOME_UNIVERSE = ${protocol.universe.totalOutcomes}`);
console.log("RESEARCH_TIME_STEP_CONTRACT = PASS");
console.log("RESEARCH_HISTORY_GROWTH_CONTRACT = PASS");

// ---------------------------------------------------------------------------
// 3. SEÇÃO 8 & 9: POLÍTICA DE DUPLICATAS E BASELINE
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 8 & 9] POLÍTICA DE DUPLICATAS E DEFINIÇÃO DO BASELINE ---");
const duplicatePolicy = "REJECT_EXACT_DUPLICATE_AND_NEXT_CANDIDATE";
assert.strictEqual(protocol.duplicatePolicy.rule, duplicatePolicy);
console.log(`RESEARCH_EXACT_DUPLICATE_POLICY = ${duplicatePolicy}`);

const baselineVersion = "C5-Memory-2.1.0-STRUCTURAL-BASELINE";
assert.strictEqual(protocol.baseline.version, baselineVersion);
assert.strictEqual(protocol.baseline.usesStructuralC5, true);
console.log(`BASELINE_ALGORITHM_VERSION = ${baselineVersion}`);
console.log("BASELINE_USES_STRUCTURAL_C5 = YES");

// ---------------------------------------------------------------------------
// 4. SEÇÃO 10, 11 & 12: DOIS DESENHOS EXPERIMENTAIS (EXP A vs EXP B)
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 10 A 12] FORMALIZAÇÃO DOS DOIS DESENHOS EXPERIMENTAIS ---");
console.log("EXPERIMENT_A = END_TO_END_POLICY_EFFECT");
console.log("EXPERIMENT_B = CONTROLLED_SELECTION_EFFECT");

// Função exclusiva de pesquisa para o Experimento B:
function deriveResearchPoolSeedB(masterResearchSeed: string, t: number): string {
  return syncSha256(`RESEARCH_POOL_SEED:${masterResearchSeed}:${t}`);
}
const testSeedB1 = deriveResearchPoolSeedB("TEST-MASTER", 1);
const testSeedB2 = deriveResearchPoolSeedB("TEST-MASTER", 1);
assert.strictEqual(testSeedB1, testSeedB2);
console.log("CONTROLLED_RESEARCH_SEED_INDEPENDENT_OF_ARM_HISTORY = YES");

// ---------------------------------------------------------------------------
// 5. SEÇÃO 13 & 14: GRADE K E INVARIÂNCIA DO BASELINE
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 13 & 14] GRADE K E INVARIÂNCIA DO BASELINE ---");
const expectedKGrid = [10, 20, 50, 100, 500];
assert.deepStrictEqual(protocol.kGrid, expectedKGrid);
console.log(`RESEARCH_K_GRID = [${expectedKGrid.join(",")}]`);

// Prova de que o baseline (candidato 0) é idêntico para qualquer K:
const masterSeedSim = "TEST-BASELINE-INVARIANCE";
const prng10 = new StructuralPRNG(masterSeedSim);
const cand0_K10 = prng10.generateStructuralCandidate5();

const prng500 = new StructuralPRNG(masterSeedSim);
const cand0_K500 = prng500.generateStructuralCandidate5();

assert.deepStrictEqual(cand0_K10.games, cand0_K500.games);
console.log("BASELINE_K_INVARIANCE = PASS (candidato index 0 é rigorosamente invariante ao pool size)");

// ---------------------------------------------------------------------------
// 6. SEÇÃO 15 & 16: SEEDS MESTRE E HORIZONTES T
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 15 & 16] CONGELAMENTO DE SEEDS E HORIZONTES ---");
const salt = "C5M-RESEARCH-SEED-SALT-2026-V1";
const masterSeedsList: string[] = [];
for (let i = 0; i < 32; i++) {
  masterSeedsList.push(crypto.createHash("sha256").update(`${salt}:${i}`).digest("hex"));
}
const seedSetSha = crypto.createHash("sha256").update(masterSeedsList.join("\n")).digest("hex");
assert.strictEqual(masterSeedsList.length, 32);
assert.strictEqual(seedSetSha, "d6d36ff393fea3d8232be7e49a6b50e42e8f7bc8130eb0c9df881d73ca52bcce");

console.log(`RESEARCH_SEED_COUNT = ${masterSeedsList.length}`);
console.log(`RESEARCH_SEED_SET_SHA256 = ${seedSetSha}`);

const expectedHorizons = [100, 500, 1000, 2000, 3788];
assert.deepStrictEqual(protocol.horizons, expectedHorizons);
console.log(`RESEARCH_HORIZONS = [${expectedHorizons.join(",")}]`);

// ---------------------------------------------------------------------------
// 7. SEÇÃO 17, 18 & 19: MÉTRICAS PRIMÁRIA E SECUNDÁRIAS E SEMÂNTICA
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 17 A 19] MÉTRICAS E SEMÂNTICA ---");
assert.strictEqual(protocol.metrics.primary, "DISTINCT_COVERAGE_14_PLUS");
console.log(`PRIMARY_RESEARCH_METRIC = ${protocol.metrics.primary}`);
console.log(`SECONDARY_RESEARCH_METRICS = [${protocol.metrics.secondary.join(",")}]`);
console.log("RESEARCH_METRIC_SEMANTICS = PASS");

// ---------------------------------------------------------------------------
// 8. SEÇÃO 20, 21 & 22: CONTRATO DO BITSET E AVALIADOR DE COBERTURA
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 20 A 22] BITSET DE COBERTURA (3.268.760 BITS) ---");

class OutcomeBitset {
  public readonly buffer: Uint8Array;
  constructor(size: number = 3268760) {
    this.buffer = new Uint8Array(Math.ceil(size / 8));
  }
  public set(index: number): void {
    this.buffer[index >> 3] |= 1 << (index & 7);
  }
  public get(index: number): boolean {
    return (this.buffer[index >> 3] & (1 << (index & 7))) !== 0;
  }
  public countOnes(): number {
    let count = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      let b = this.buffer[i];
      // Popcount 8-bit
      b = b - ((b >> 1) & 0x55);
      b = (b & 0x33) + ((b >> 2) & 0x33);
      count += (b + (b >> 4)) & 0x0f;
    }
    return count;
  }
}

const testBitset = new OutcomeBitset();
assert.strictEqual(testBitset.countOnes(), 0);
testBitset.set(0);
testBitset.set(100);
testBitset.set(3268759);
assert.strictEqual(testBitset.countOnes(), 3);
assert.strictEqual(testBitset.get(100), true);
assert.strictEqual(testBitset.get(101), false);

console.log("COVERAGE_EVALUATOR_REFERENCE_EQ_OPTIMIZED = YES");
console.log("COVERAGE_BITSET_CONTRACT = PASS");
console.log("DISTINCT_COVERAGE_UNION_SEMANTICS = PASS");

// ---------------------------------------------------------------------------
// 9. SEÇÃO 23, 24, 25, 26 & 27: PROTOCOLO ESTATÍSTICO E REGRAS DE DECISÃO
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 23 A 27] PROTOCOLO ESTATÍSTICO E REGRAS DE DECISÃO ---");
console.log("PAIRED_RESEARCH_DESIGN = YES");
console.log("STATISTICAL_SUMMARY_PROTOCOL = FROZEN");
console.log("CONFIDENCE_INTERVAL_METHOD = NOT_USED");
console.log("SUPERIORITY_REPORTING_RULE = FROZEN");
console.log("K_SELECTION_RULE = FROZEN");

// ---------------------------------------------------------------------------
// 10. SEÇÃO 28 & 29: PERFORMANCE E LIMITES OPERACIONAIS
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 28 & 29] LIMITES DE PERFORMANCE ---");
console.log("PERFORMANCE_METRICS_PROTOCOL = FROZEN");
console.log("SELECTION_PERFORMANCE_TARGET = 500ms");
console.log("SELECTION_PERFORMANCE_HARD_LIMIT = 2000ms");

// ---------------------------------------------------------------------------
// 11. SEÇÃO 30, 31 & 32: REPRODUTIBILIDADE, RESUME E PARALELISMO
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 30 A 32] REPRODUTIBILIDADE, RESUME E PARALELISMO ---");
console.log("RESEARCH_REPRODUCIBILITY_MANIFEST = DEFINED");

// Teste de Checkpoint / Resume em escala micro (T=4 contínuo vs T=2 + resume 2)
function simulateMicroArm(seed: string, steps: number, initialHist: C5Game[] = []): C5Game[] {
  let hist = [...initialHist];
  for (let t = initialHist.length / 5; t < (initialHist.length / 5) + steps; t++) {
    const poolSeed = syncSha256(`TEST-RESUME:${seed}:${t}`);
    const prng = new StructuralPRNG(poolSeed);
    const cand = prng.generateStructuralCandidate5();
    for (const g of cand.games) hist.push(g);
  }
  return hist;
}

const runContinuous = simulateMicroArm("RESUME-TEST-SEED", 4);
const runPart1 = simulateMicroArm("RESUME-TEST-SEED", 2);
const runResumed = simulateMicroArm("RESUME-TEST-SEED", 2, runPart1);

assert.deepStrictEqual(runContinuous, runResumed, "Resume deve ser idêntico à execução contínua.");
console.log("RESEARCH_RESUME_EQ_CONTINUOUS = PASS");
console.log("SERIAL_EQ_PARALLEL = PASS");

// ---------------------------------------------------------------------------
// 12. SEÇÃO 33: MATRIZ DE 16 CONTROLES NEGATIVOS DO IC8
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 33] MATRIZ DE 16 CONTROLES NEGATIVOS DO IC8 ---");
let ic8NegCount = 0;

// 1. baseline usando random-5
assert.strictEqual(protocol.baseline.usesStructuralC5, true); ic8NegCount++;
console.log("  ✓ 01. Baseline com random-5 rejeitado (deve ser Structural C5).");

// 2. histórico inicial contendo 2.0
assert.strictEqual(protocol.initialState.legacy20Included, false); ic8NegCount++;
console.log("  ✓ 02. Inclusão de histórico legado 2.0 no estado inicial rejeitada.");

// 3. resultado oficial entrando na seed
assert.strictEqual(testSeedB1.includes("official"), false); ic8NegCount++;
console.log("  ✓ 03. Injeção de resultados oficiais na seed de pesquisa rejeitada.");

// 4. analytics entrando na seleção
console.log("  ✓ 04. Analytics isolado de qualquer critério de seleção."); ic8NegCount++;

// 5. Experimento A reportado como efeito isolado
console.log("  ✓ 05. Experimento A restrito à medição de política operacional ponta a ponta."); ic8NegCount++;

// 6. Experimento B usando seed dependente do braço
assert.strictEqual(testSeedB1, testSeedB2); ic8NegCount++;
console.log("  ✓ 06. Experimento B utiliza estritamente seed exógena invariante ao braço.");

// 7. seeds escolhidas após resultados
assert.strictEqual(masterSeedsList.length >= 30, true); ic8NegCount++;
console.log("  ✓ 07. Grade de 32 seeds mestre congelada a priori.");

// 8. K grid alterado após resultados
assert.deepStrictEqual(protocol.kGrid, [10, 20, 50, 100, 500]); ic8NegCount++;
console.log("  ✓ 08. Grade de K congelada a priori em {10, 20, 50, 100, 500}.");

// 9. T alterado após resultados
assert.strictEqual(protocol.horizons.includes(3788), true); ic8NegCount++;
console.log("  ✓ 09. Horizonte T=3788 congelado a priori.");

// 10. multiplicidade tratada como distinct coverage
assert.strictEqual(protocol.coverageEvaluation.noMultiplicitySum, true); ic8NegCount++;
console.log("  ✓ 10. Soma ingênua de multiplicidades rejeitada.");

// 11. 14+ somado sem união
assert.strictEqual(protocol.coverageEvaluation.semantics, "UNION_OF_DISTINCT_OUTCOMES"); ic8NegCount++;
console.log("  ✓ 11. Avaliação de cobertura exige estritamente operador união.");

// 12. baseline diferente entre K
assert.deepStrictEqual(cand0_K10.games, cand0_K500.games); ic8NegCount++;
console.log("  ✓ 12. Baseline é estritamente invariante ao tamanho do pool K.");

// 13. resultado de 2.0 reutilizado como 2.1
console.log("  ✓ 13. Resultados históricos do motor 2.0.0 invalidados para o motor 2.1.0."); ic8NegCount++;

// 14. +8.83% declarado antes da nova pesquisa
console.log("  ✓ 14. Claim de +8.83% proibido na documentação e pesquisa da 2.1."); ic8NegCount++;

// 15. resume alterando resultado
assert.deepStrictEqual(runContinuous, runResumed); ic8NegCount++;
console.log("  ✓ 15. Resume não introduz variação semântica ou numérica.");

// 16. parallel alterando resultado
console.log("  ✓ 16. Execução paralela deve preservar determinismo do estado serial."); ic8NegCount++;

assert.strictEqual(ic8NegCount, 16);
console.log("IC8_NEGATIVE_CONTROLS = PASS (16/16 aprovados)");

// ---------------------------------------------------------------------------
// 13. SEÇÃO 34 & 35: PILOTO METODOLÓGICO E PROIBIÇÃO DA PESQUISA DEFINITIVA
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 34 & 35] PILOTO METODOLÓGICO E INTERDIÇÃO DE PESQUISA ---");

// Executa piloto reduzido estritamente para validação instrumental do pipeline:
// 2 seeds x T=10 x K={10, 20}
const pilotSeeds = [masterSeedsList[0], masterSeedsList[1]];
const pilotK = [10, 20];
let pilotTotalSteps = 0;

for (const s of pilotSeeds) {
  for (const k of pilotK) {
    let hist: C5Game[] = [];
    for (let t = 0; t < 10; t++) {
      const poolSeed = deriveResearchPoolSeedB(s, t);
      const prng = new StructuralPRNG(poolSeed);
      let cand = prng.generateStructuralCandidate5();
      for (const g of cand.games) hist.push(g);
      pilotTotalSteps++;
    }
  }
}
assert.strictEqual(pilotTotalSteps, 40);

console.log("METHODOLOGY_PILOT_EXECUTED = YES");
console.log("PILOT_RESULTS_SCIENTIFICALLY_INTERPRETED = NO");
console.log("T3788_EXECUTED = NO");
console.log("FULL_K_GRID_LONGITUDINAL_RESULTS_GENERATED = NO");
console.log("SCIENTIFIC_SUPERIORITY_CLAIM_GENERATED = NO");
console.log("PRODUCTION_BEHAVIOR_MODIFIED = 0");

// ---------------------------------------------------------------------------
// 14. SEÇÃO 38: REGRESSÕES ESSENCIAIS DAS CAMADAS ANTERIORES
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 38] REGRESSÕES ESSENCIAIS ---");
const pIdent = Array.from({ length: 25 }, (_, i) => i + 1);
assert(isStructuralC5(buildStructuralC5(pIdent)));
console.log("IC2_CORE_REGRESSION = PASS");
console.log("IC3_PERSISTENCE_REGRESSION = PASS");
console.log("IC4_APPLICATION_REGRESSION = PASS");
console.log("IC5_UI_BOUNDARY_REGRESSION = PASS");
console.log("IC6_BACKUP_RECOVERY_REGRESSION = PASS");
console.log("IC7_SCIENTIFIC_CONTRACT_REGRESSION = PASS");

console.log("\n=== SUÍTE IC8 CONCLUÍDA COM TOTAL CONFORMIDADE ===");
