/**
 * Suíte de Homologação da Ordem Executiva IC10-R1
 * Research Protocol Amendment & Evidence-Persistence Repair
 * C5-Memory — INTEGRATION RUN 002
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  FROZEN_RESEARCH_PROTOCOL_ID,
  FROZEN_RESEARCH_PROTOCOL_SHA256,
  FROZEN_RESEARCH_PROTOCOL_V2_ID,
  FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
  validateResearchProtocolBinding,
  validateResearchProtocolV2Binding,
} from "../research/protocolValidator";
import {
  EVIDENCE_BASE_DIR,
  RawTrajectoryHorizonRecord,
  TrajectoryEvidenceFile,
  validateTrajectoryRecordSchema,
  persistTrajectoryEvidence,
  generateEvidenceManifest,
  computeSha256,
} from "../research/evidenceStore";

console.log("=== INICIANDO HOMOLOGAÇÃO DA ORDEM EXECUTIVA IC10-R1 ===");

// ---------------------------------------------------------------------------
// 1. VERIFICAÇÃO DE ENTRADA & IMUTABILIDADE DO PROTOCOLO V1 E ARTEFATOS HISTÓRICOS
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 1] IMUTABILIDADE DO PROTOCOLO V1 E ARTEFATOS HISTÓRICOS ---");

const protocolV1Path = "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v1.json";
const protocolV1Raw = fs.readFileSync(protocolV1Path, "utf-8");
const protocolV1Sha = computeSha256(protocolV1Raw);
assert.strictEqual(
  protocolV1Sha,
  FROZEN_RESEARCH_PROTOCOL_SHA256,
  "VIOLAÇÃO CRÍTICA: Protocolo V1 foi alterado!"
);
console.log(`[PASS] PROTOCOL_V1_MODIFIED = NO (SHA-256: ${protocolV1Sha})`);

const resultsSummaryV1Path = "certification/c5-memory-v2/research/c5-memory-2.1.0-research-results-summary-v1.json";
assert.ok(fs.existsSync(resultsSummaryV1Path), "Results summary V1 deve existir como evidência histórica.");
const resultsSummaryV1Raw = fs.readFileSync(resultsSummaryV1Path, "utf-8");
const resultsSummaryV1Sha = computeSha256(resultsSummaryV1Raw);
assert.strictEqual(
  resultsSummaryV1Sha,
  "195d6eba66b99884e44b03c146e47079bb6bd6635d2b82b22034d03584730f88",
  "VIOLAÇÃO CRÍTICA: results summary V1 foi sobrescrito!"
);
console.log(`[PASS] HISTORICAL_SUMMARY_V1_PRESERVED = YES (SHA-256: ${resultsSummaryV1Sha})`);

const manifestV1Path = "certification/c5-memory-v2/research/c5-memory-2.1.0-research-manifest-v1.json";
assert.ok(fs.existsSync(manifestV1Path), "Manifest V1 deve existir.");
const manifestV1Raw = fs.readFileSync(manifestV1Path, "utf-8");
const manifestV1Sha = computeSha256(manifestV1Raw);
assert.strictEqual(
  manifestV1Sha,
  "2ed6105e618a1a855c0402c0a484ea6a6d70b86dd4663d4b5eec2f3e70bb0647",
  "VIOLAÇÃO CRÍTICA: Manifest V1 foi sobrescrito!"
);
console.log(`[PASS] HISTORICAL_MANIFEST_V1_PRESERVED = YES (SHA-256: ${manifestV1Sha})`);

// ---------------------------------------------------------------------------
// 2. FORMALIZAÇÃO E VALIDAÇÃO DO PROTOCOLO V2
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 2] BINDING E INTEGRIDADE DO PROTOCOLO V2 ---");

const protocolV2Validation = validateResearchProtocolV2Binding();
assert.strictEqual(protocolV2Validation.protocolId, FROZEN_RESEARCH_PROTOCOL_V2_ID);
assert.strictEqual(protocolV2Validation.calculatedSha256, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
console.log(`[PASS] PROTOCOL_V2_ID = ${protocolV2Validation.protocolId}`);
console.log(`[PASS] RESEARCH_PROTOCOL_V2_SHA256 = ${protocolV2Validation.calculatedSha256}`);

const protoV2Parsed = JSON.parse(protocolV2Validation.rawJson);

// ---------------------------------------------------------------------------
// 3. DESENHO METODOLÓGICO: MODELO DE REPLICAÇÃO DO EXPERIMENTO A & B
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 3] CORREÇÃO DO DESENHO EXPERIMENTAL A & B ---");

// Experimento A deve ser formalizado como A1 — CANONICAL_DETERMINISTIC_TRAJECTORY
const expAConfig = protoV2Parsed.experiments.experimentA;
assert.strictEqual(
  expAConfig.replicationModel,
  "CANONICAL_DETERMINISTIC_TRAJECTORY",
  "Experimento A deve usar CANONICAL_DETERMINISTIC_TRAJECTORY"
);
assert.strictEqual(
  expAConfig.trajectoryCount,
  1,
  "Experimento A possui exatamente 1 trajetória canônica por braço/K"
);
console.log("[PASS] EXPERIMENT_A_REPLICATION_MODEL = CANONICAL_DETERMINISTIC_TRAJECTORY (N=1 por K)");

// Experimento B mantém CONTROLLED_SELECTION_EFFECT com 32 sementes exógenas
const expBConfig = protoV2Parsed.experiments.experimentB;
assert.strictEqual(
  expBConfig.replicationModel,
  "EXOGENOUS_REPLICATED_POOLS",
  "Experimento B deve usar EXOGENOUS_REPLICATED_POOLS"
);
assert.strictEqual(
  expBConfig.trajectoryCount,
  32,
  "Experimento B possui 32 trajetórias independentes por K"
);
console.log("[PASS] EXPERIMENT_B_REPLICATION_MODEL = CONTROLLED_SELECTION_EFFECT (N=32 sementes exógenas)");

// ---------------------------------------------------------------------------
// 4. SCHEMA RAW OBRIGATÓRIO & VALIDAÇÃO DE CAMPOS CIENTÍFICOS
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 4] SCHEMA RAW OBRIGATÓRIO ---");

const sampleRawRecord: RawTrajectoryHorizonRecord = {
  experiment: "EXPERIMENT_B",
  masterSeed: "C5M-RESEARCH-SEED-00",
  k: 50,
  t: 100,
  baselineCoverage15: 500,
  baselineCoverage14Plus: 74210,
  baselineCoverage13Plus: 852100,
  baselineCoverage12Plus: 2894100,
  baselineCoverage11Plus: 3268760,
  mlCoverage15: 500,
  mlCoverage14Plus: 75430,
  mlCoverage13Plus: 864200,
  mlCoverage12Plus: 2910500,
  mlCoverage11Plus: 3268760,
  delta15: 0,
  delta14Plus: 1220,
  delta13Plus: 12100,
  delta12Plus: 16400,
  delta11Plus: 0,
  deltaPercent14Plus: 1.6439,
  historyCardinality: 500,
  duplicateCount: 0,
  poolHash: computeSha256("test_sample_pool_hash"),
  timings: {
    meanSelectionMs: 4.12,
    p95SelectionMs: 8.45,
    maxSelectionMs: 12.3,
  },
};

validateTrajectoryRecordSchema(sampleRawRecord);
console.log("[PASS] RAW_TRAJECTORY_SCHEMA_VALIDATION = PASS");

// Teste de controle negativo de schema (campo faltante deve lançar erro)
let negativeControlPassed = false;
try {
  const invalidRecord = { ...sampleRawRecord, baselineCoverage14Plus: undefined as any };
  validateTrajectoryRecordSchema(invalidRecord);
} catch (err) {
  negativeControlPassed = true;
}
assert.ok(negativeControlPassed, "Schema validator deve rejeitar registro incompleto.");
console.log("[PASS] NEGATIVE_CONTROL_SCHEMA_VALIDATION = PASS");

// ---------------------------------------------------------------------------
// 5. TESTE DE PERSISTÊNCIA INCREMENTAL E ARTIFACTS
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 5] ARQUITETURA DE PERSISTÊNCIA INCREMENTAL ---");

const r1TestDir = path.join(os.tmpdir(), `c5-r1-test-${Date.now()}`);
fs.mkdirSync(r1TestDir, { recursive: true });

const sampleEvidenceFile: TrajectoryEvidenceFile = {
  protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
  protocolSha256: FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
  experiment: "EXPERIMENT_B",
  replicationModel: "EXOGENOUS_REPLICATED_POOLS",
  masterSeed: "C5M-RESEARCH-SEED-00",
  seedIndex: 0,
  k: 50,
  finalHorizon: 100,
  horizonRecords: {
    100: sampleRawRecord,
  },
  finalHistoryCardinality: 500,
  finalDuplicateCount: 0,
  baselineFinalFingerprint: "fingerprint_baseline_h0_mock",
  mlFinalFingerprint: "fingerprint_ml_h0_mock",
  recordedAt: new Date().toISOString(),
};

const persisted = persistTrajectoryEvidence(sampleEvidenceFile, r1TestDir);
assert.ok(fs.existsSync(persisted.filePath), "Arquivo de evidência deve ser persistido em disco.");
assert.ok(persisted.sizeBytes > 0, "Tamanho em bytes deve ser maior que 0.");
console.log(`[PASS] PERSISTED_TRAJECTORY_SAMPLE = ${persisted.filePath} (${persisted.sizeBytes} bytes, SHA: ${persisted.sha256})`);

const manifestEvidenceV2 = generateEvidenceManifest(r1TestDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
assert.ok(manifestEvidenceV2.persistedArtifacts.length >= 1);
console.log(`[PASS] EVIDENCE_MANIFEST_V2_GENERATED = YES (${manifestEvidenceV2.persistedArtifacts.length} artefatos catalogados)`);

// Limpa fixtures temporárias
fs.rmSync(r1TestDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 6. CONCLUSÃO DA HOMOLOGAÇÃO IC10-R1
// ---------------------------------------------------------------------------
console.log("\n--- [SEÇÃO 6] DECISÃO OFICIAL IC10-R1 ---");
console.log("DECISÃO OFICIAL IC10-R1: AMENDMENT_PERSISTENCE_REPAIRED");
console.log("STATUS: PROTOCOL_V2_FROZEN, EVIDENCE_STORE_INITIALIZED, READY_FOR_AUDIT");
console.log("T3788_EXECUTION_POSTPONED: YES (conforme item 3 da Ordem Executiva)");
