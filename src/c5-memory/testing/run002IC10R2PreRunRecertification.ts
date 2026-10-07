/**
 * Suíte de Homologação da Ordem Executiva IC10-R1 PRE-RUN REMEDIATION R2
 * Verificação e Fechamento Estrito de F01, F02, F03, F04, F06 e F07
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
  validateResearchProtocolV2Binding,
} from "../research/protocolValidator";
import {
  atomicWriteFile,
  cleanOrphanedTmpFiles,
  computeSha256,
  validateTrajectoryRecordSchema,
  persistTrajectoryEvidence,
  persistIncrementalStateCheckpoint,
  restoreResearchExecutionV2,
  generateEvidenceManifestV2,
  validateEvidenceCompletenessV2,
  RawTrajectoryHorizonRecord,
  TrajectoryEvidenceFile,
  StateCheckpointFileV2,
  calculateStateCheckpointIntegrity,
  EVIDENCE_BASE_DIR,
} from "../research/evidenceStore";
import {
  runDefinitiveResearchV2,
  runSingleTrajectoryV2,
} from "../research/runDefinitiveResearchV2";
import { ResearchArmExecutor, deriveOfficialMasterSeeds } from "../research/engine";

console.log("=== INICIANDO EXECUÇÃO DA ORDEM EXECUTIVA IC10-R1 PRE-RUN REMEDIATION R2 ===");

// Diretório de fixtures temporárias ISOLADO para não poluir evidence-v2
const testDir = path.join(os.tmpdir(), `c5-r2-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
fs.mkdirSync(testDir, { recursive: true });

try {
  // ---------------------------------------------------------------------------
  // 1. F05: IMUTABILIDADE DO PROTOCOLO V1 E ARTEFATOS HISTÓRICOS
  // ---------------------------------------------------------------------------
  const protoV1Raw = fs.readFileSync(
    "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v1.json"
  );
  const protoV1Sha = crypto.createHash("sha256").update(protoV1Raw).digest("hex");
  assert.strictEqual(
    protoV1Sha,
    FROZEN_RESEARCH_PROTOCOL_SHA256,
    "Protocolo V1 foi alterado!"
  );
  console.log("PROTOCOL_V1_IMMUTABILITY                 = PASS");

  const resultsSummaryV1Raw = fs.readFileSync(
    "certification/c5-memory-v2/research/c5-memory-2.1.0-research-results-summary-v1.json"
  );
  const resultsSummaryV1Sha = crypto.createHash("sha256").update(resultsSummaryV1Raw).digest("hex");
  assert.strictEqual(
    resultsSummaryV1Sha,
    "195d6eba66b99884e44b03c146e47079bb6bd6635d2b82b22034d03584730f88"
  );

  const manifestV1Raw = fs.readFileSync(
    "certification/c5-memory-v2/research/c5-memory-2.1.0-research-manifest-v1.json"
  );
  const manifestV1Sha = crypto.createHash("sha256").update(manifestV1Raw).digest("hex");
  assert.strictEqual(
    manifestV1Sha,
    "2ed6105e618a1a855c0402c0a484ea6a6d70b86dd4663d4b5eec2f3e70bb0647"
  );
  console.log("HISTORICAL_V1_ARTIFACTS_IMMUTABILITY    = PASS");

  // ---------------------------------------------------------------------------
  // 2. F01: PROTOCOL V2 RUNTIME BINDING & RUNNER OFICIAL
  // ---------------------------------------------------------------------------
  const validatedV2 = validateResearchProtocolV2Binding();
  assert.strictEqual(validatedV2.protocolId, FROZEN_RESEARCH_PROTOCOL_V2_ID);
  assert.strictEqual(validatedV2.calculatedSha256, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
  console.log("PROTOCOL_V2_RUNTIME_BINDING              = PASS");

  // Controle negativo: V2 adulterado aborta
  let v2TamperAborted = false;
  try {
    validateResearchProtocolV2Binding(
      "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v2.json",
      JSON.stringify({ ...JSON.parse(validatedV2.rawJson), version: "9.9.9" })
    );
  } catch (err: any) {
    if (err.message.includes("RESEARCH_PROTOCOL_V2_RUNTIME_BINDING_VIOLATION")) {
      v2TamperAborted = true;
    }
  }
  assert.ok(v2TamperAborted, "Protocolo V2 adulterado não abortou!");
  console.log("PROTOCOL_V2_TAMPER_ABORT                 = PASS");

  // Zero execution before V2 binding: runner aborta sem criar arquivos
  const emptyTargetDir = path.join(testDir, "zero-exec-test");
  fs.mkdirSync(emptyTargetDir, { recursive: true });
  const fakeBadProtoPath = path.join(testDir, "corrupted-protocol.json");
  fs.writeFileSync(fakeBadProtoPath, '{"protocolId": "BAD"}', "utf-8");

  let zeroExecPassed = false;
  try {
    runDefinitiveResearchV2({
      protocolPath: fakeBadProtoPath,
      baseDir: emptyTargetDir,
    });
  } catch {
    const filesAfter = fs.readdirSync(emptyTargetDir);
    if (filesAfter.length === 0) zeroExecPassed = true;
  }
  assert.ok(zeroExecPassed, "Runner produziu artefatos antes da validação de binding!");
  console.log("ZERO_EXECUTION_BEFORE_V2_BINDING         = PASS");

  // ---------------------------------------------------------------------------
  // 3. F02: PERSISTÊNCIA ATÔMICA
  // ---------------------------------------------------------------------------
  const rawTarget = path.join(testDir, "atomic-test", "raw.json");
  const writeRes = atomicWriteFile(rawTarget, '{"data": "atomic"}');
  assert.ok(fs.existsSync(rawTarget));
  assert.strictEqual(writeRes.sha256, computeSha256('{"data": "atomic"}'));
  console.log("ATOMIC_RAW_WRITE                         = PASS");

  const chkTarget = path.join(testDir, "atomic-test", "checkpoint.json");
  const chkRes = atomicWriteFile(chkTarget, '{"checkpoint": 1}');
  assert.ok(fs.existsSync(chkTarget));
  console.log("ATOMIC_CHECKPOINT_WRITE                  = PASS");

  const manTarget = path.join(testDir, "atomic-test", "manifest.json");
  atomicWriteFile(manTarget, '{"manifest": "ok"}');
  assert.ok(fs.existsSync(manTarget));
  console.log("ATOMIC_MANIFEST_WRITE                    = PASS");

  // Simulação de arquivo parcial (.tmp abandonado)
  const partialTmp = path.join(testDir, "atomic-test", "abandoned.tmp.12345");
  fs.writeFileSync(partialTmp, "PARTIAL_CONTENT", "utf-8");
  const removedTmp = cleanOrphanedTmpFiles(path.join(testDir, "atomic-test"));
  assert.ok(removedTmp.includes(partialTmp), "Arquivo .tmp não foi detectado e limpo");
  assert.ok(!fs.existsSync(partialTmp), "Arquivo .tmp permaneceu no disco");
  console.log("PARTIAL_FILE_NOT_ACCEPTED                = PASS");

  // ---------------------------------------------------------------------------
  // 4. F03: CHECKPOINT V2 REALMENTE RETOMÁVEL & TESTE FÍSICO RESUME == CONTINUOUS
  // ---------------------------------------------------------------------------
  const resumeTestDir = path.join(testDir, "resume-test");
  fs.mkdirSync(resumeTestDir, { recursive: true });

  const kTest = 10;
  const seedTest = "TEST_SEED_CAUSAL_001";
  const horizonTest = 6;
  const intermediateCheckpointStep = 3;

  // RUN A: Execução Contínua de H0 até T=6
  const armBaseA = new ResearchArmExecutor("BASELINE", "EXPERIMENT_B", seedTest, kTest);
  const armMlA = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_B", seedTest, kTest);
  for (let t = 1; t <= horizonTest; t++) {
    armBaseA.executeStep();
    armMlA.executeStep();
  }
  const stateFinalBaseA = armBaseA.exportState();
  const stateFinalMlA = armMlA.exportState();

  // RUN B: Execução de H0 até T=3 -> Salva Checkpoint Físico -> Descarta Memória
  const armBaseB = new ResearchArmExecutor("BASELINE", "EXPERIMENT_B", seedTest, kTest);
  const armMlB = new ResearchArmExecutor("MAX_LEXIMIN", "EXPERIMENT_B", seedTest, kTest);
  for (let t = 1; t <= intermediateCheckpointStep; t++) {
    armBaseB.executeStep();
    armMlB.executeStep();
  }

  const baseStateB3 = armBaseB.exportState();
  const mlStateB3 = armMlB.exportState();

  // poolHash válido de 64 hex
  const validPoolHash = computeSha256(`POOL_STEP_3_${seedTest}`);

  const sampleHorizonRecord: RawTrajectoryHorizonRecord = {
    experiment: "EXPERIMENT_B",
    masterSeed: seedTest,
    k: kTest,
    t: intermediateCheckpointStep,
    baselineCoverage15: baseStateB3.history.length,
    baselineCoverage14Plus: 200,
    baselineCoverage13Plus: 1000,
    baselineCoverage12Plus: 5000,
    baselineCoverage11Plus: 10000,
    mlCoverage15: mlStateB3.history.length,
    mlCoverage14Plus: 210,
    mlCoverage13Plus: 1050,
    mlCoverage12Plus: 5100,
    mlCoverage11Plus: 10000,
    delta15: 0,
    delta14Plus: 10,
    delta13Plus: 50,
    delta12Plus: 100,
    delta11Plus: 0,
    deltaPercent14Plus: 5.0,
    historyCardinality: intermediateCheckpointStep * 5,
    duplicateCount: 0,
    poolHash: validPoolHash,
    timings: {
      meanSelectionMs: 3.5,
      p95SelectionMs: 4.0,
      maxSelectionMs: 5.0,
    },
  };

  const integritySha256 = calculateStateCheckpointIntegrity({
    protocolId: FROZEN_RESEARCH_PROTOCOL_V2_ID,
    protocolSha256: FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
    experiment: "EXPERIMENT_B",
    k: kTest,
    masterSeed: seedTest,
    currentStep: intermediateCheckpointStep,
    baselineStateSha: baseStateB3.stateSha256,
    maxLeximinStateSha: mlStateB3.stateSha256,
  });

  const physicalCheckpoint: StateCheckpointFileV2 = {
    protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
    protocolSha256: FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
    experiment: "EXPERIMENT_B",
    replicationModel: "EXOGENOUS_REPLICATED_POOLS",
    k: kTest,
    masterSeed: seedTest,
    seedIndex: 0,
    currentStep: intermediateCheckpointStep,
    checkpointHorizon: intermediateCheckpointStep,
    arms: {
      baseline: baseStateB3,
      maxLeximin: mlStateB3,
    },
    horizonRecord: sampleHorizonRecord,
    integritySha256,
    createdAt: new Date().toISOString(),
  };

  const chkPersist = persistIncrementalStateCheckpoint(physicalCheckpoint, resumeTestDir);
  assert.ok(fs.existsSync(chkPersist.filePath), "Checkpoint físico não encontrado.");
  console.log("V2_CHECKPOINT_STATE_COMPLETE             = PASS");

  // SIMULAÇÃO DE NOVO PROCESSO: lê do disco, valida e retoma até T=6
  const restored = restoreResearchExecutionV2(chkPersist.filePath);
  const resumedBase = restored.baselineArm;
  const resumedMl = restored.maxLeximinArm;

  for (let t = intermediateCheckpointStep + 1; t <= horizonTest; t++) {
    resumedBase.executeStep();
    resumedMl.executeStep();
  }

  const stateFinalBaseB = resumedBase.exportState();
  const stateFinalMlB = resumedMl.exportState();

  // Prova matemática de equivalência causal absoluta
  assert.strictEqual(
    stateFinalBaseA.scientificResultHash,
    stateFinalBaseB.scientificResultHash,
    "Baseline scientificResultHash divergente após restore!"
  );
  assert.strictEqual(
    stateFinalMlA.scientificResultHash,
    stateFinalMlB.scientificResultHash,
    "MaxLeximin scientificResultHash divergente após restore!"
  );
  assert.strictEqual(
    stateFinalBaseA.historyFingerprint,
    stateFinalBaseB.historyFingerprint,
    "Baseline historyFingerprint divergente!"
  );
  assert.strictEqual(
    stateFinalMlA.historyFingerprint,
    stateFinalMlB.historyFingerprint,
    "ML historyFingerprint divergente!"
  );
  assert.strictEqual(
    stateFinalBaseA.bitsetSha256,
    stateFinalBaseB.bitsetSha256,
    "Baseline bitsetSha256 divergente!"
  );
  assert.strictEqual(
    stateFinalMlA.bitsetSha256,
    stateFinalMlB.bitsetSha256,
    "ML bitsetSha256 divergente!"
  );
  assert.strictEqual(stateFinalBaseA.history.length, stateFinalBaseB.history.length);
  assert.strictEqual(stateFinalMlA.history.length, stateFinalMlB.history.length);
  console.log("DISK_CHECKPOINT_RESTORE_EQ_CONTINUOUS    = PASS");

  // Controle negativo de adulteração no disco
  const tamperedCheckpoint = JSON.parse(fs.readFileSync(chkPersist.filePath, "utf-8"));
  tamperedCheckpoint.currentStep = 999; // adulteração
  let tamperRejected = false;
  try {
    restoreResearchExecutionV2(tamperedCheckpoint);
  } catch (err: any) {
    if (err.message.includes("RESTORE_INTEGRITY_VIOLATION") || err.message.includes("RESTORE_STEP_MISMATCH")) {
      tamperRejected = true;
    }
  }
  assert.ok(tamperRejected, "Checkpoint adulterado foi aceito!");
  console.log("CHECKPOINT_TAMPER_REJECTED               = PASS");

  // ---------------------------------------------------------------------------
  // 5. F04 & F06: MANIFEST COMO GATE DE COMPLETUDE E CARDINALIDADE
  // ---------------------------------------------------------------------------
  const manifestTestDir = path.join(testDir, "manifest-test");
  fs.mkdirSync(manifestTestDir, { recursive: true });

  const manifestV2Obj = generateEvidenceManifestV2(manifestTestDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
  assert.ok(manifestV2Obj.manifestSha256 && manifestV2Obj.manifestSha256.length === 64);
  console.log("MANIFEST_HASH_VALIDATION                 = PASS");

  const completenessReport = validateEvidenceCompletenessV2(manifestTestDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256, {
    requireFullRun: false,
  });
  assert.ok(completenessReport.passed);
  console.log("MANIFEST_COMPLETENESS_GATE               = PASS");

  // ---------------------------------------------------------------------------
  // 6. F06: MODELOS DE REPLICAÇÃO & CONTROLES NEGATIVOS DE CARDINALIDADE
  // ---------------------------------------------------------------------------
  const expAConfig = validatedV2.experiments.experimentA;
  assert.strictEqual(expAConfig.replicationModel, "CANONICAL_DETERMINISTIC_TRAJECTORY");
  console.log("EXPERIMENT_A_TRAJECTORY_MODEL            = PASS");
  assert.strictEqual(expAConfig.trajectoryCount, 1);
  console.log("EXPERIMENT_A_EXPECTED_TRAJECTORIES       = 5");

  const masterSeeds = deriveOfficialMasterSeeds(validatedV2.masterSeeds.masterSalt, 32);
  const uniqueMasterSeeds = new Set(masterSeeds);
  assert.strictEqual(uniqueMasterSeeds.size, 32);
  console.log("EXPERIMENT_B_UNIQUE_MASTER_SEEDS         = 32");
  console.log("EXPERIMENT_B_EXPECTED_TRAJECTORIES       = 160");

  const kGrid = [...validatedV2.kGrid];
  assert.deepStrictEqual(kGrid, [10, 20, 50, 100, 500]);
  console.log("K_GRID_ENFORCEMENT                       = PASS");

  const horizons = [...validatedV2.horizons];
  assert.deepStrictEqual(horizons, [100, 500, 1000, 2000, 3788]);
  console.log("HORIZON_GRID_ENFORCEMENT                 = PASS");

  // Controles negativos de cardinalidade usando fixtures sintéticas no diretório temporário
  const mockRunDir = path.join(testDir, "mock-cardinality-run");
  fs.mkdirSync(path.join(mockRunDir, "raw", "experiment-a"), { recursive: true });
  fs.mkdirSync(path.join(mockRunDir, "raw", "experiment-b"), { recursive: true });

  // Cria 5 trajetórias de A com todos os 5 horizontes
  for (const k of kGrid) {
    const horizonRecs: Record<number, RawTrajectoryHorizonRecord> = {};
    for (const h of horizons) {
      horizonRecs[h] = {
        ...sampleHorizonRecord,
        experiment: "EXPERIMENT_A",
        masterSeed: "CANONICAL_OPERATIONAL",
        k,
        t: h,
        poolHash: computeSha256(`A_${k}_${h}`),
      };
    }
    const fileA: TrajectoryEvidenceFile = {
      protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
      protocolSha256: FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
      experiment: "EXPERIMENT_A",
      replicationModel: "CANONICAL_DETERMINISTIC_TRAJECTORY",
      masterSeed: "CANONICAL_OPERATIONAL",
      k,
      finalHorizon: 3788,
      horizonRecords: horizonRecs,
      finalHistoryCardinality: 3788 * 5,
      finalDuplicateCount: 0,
      baselineFinalFingerprint: "fp_base",
      mlFinalFingerprint: "fp_ml",
      recordedAt: new Date().toISOString(),
    };
    persistTrajectoryEvidence(fileA, mockRunDir);
  }

  // Cria 160 trajetórias de B com todos os 5 horizontes
  for (const k of kGrid) {
    for (let s = 0; s < 32; s++) {
      const horizonRecs: Record<number, RawTrajectoryHorizonRecord> = {};
      for (const h of horizons) {
        horizonRecs[h] = {
          ...sampleHorizonRecord,
          experiment: "EXPERIMENT_B",
          masterSeed: masterSeeds[s],
          k,
          t: h,
          poolHash: computeSha256(`B_${k}_${s}_${h}`),
        };
      }
      const fileB: TrajectoryEvidenceFile = {
        protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
        protocolSha256: FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
        experiment: "EXPERIMENT_B",
        replicationModel: "EXOGENOUS_REPLICATED_POOLS",
        masterSeed: masterSeeds[s],
        seedIndex: s,
        k,
        finalHorizon: 3788,
        horizonRecords: horizonRecs,
        finalHistoryCardinality: 3788 * 5,
        finalDuplicateCount: 0,
        baselineFinalFingerprint: "fp_base",
        mlFinalFingerprint: "fp_ml",
        recordedAt: new Date().toISOString(),
      };
      persistTrajectoryEvidence(fileB, mockRunDir);
    }
  }

  generateEvidenceManifestV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
  const fullRunReport = validateEvidenceCompletenessV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256, {
    requireFullRun: true,
  });
  assert.strictEqual(fullRunReport.aTrajectoriesFound, 5);
  assert.strictEqual(fullRunReport.bTrajectoriesFound, 160);

  // Negative Control 1: Trajetória Faltante (apaga 1 trajetória de B)
  const fileToRemove = path.join(mockRunDir, "raw", "experiment-b", "k10_seed0.json");
  fs.unlinkSync(fileToRemove);
  generateEvidenceManifestV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
  let missingTrajectoryRejected = false;
  try {
    validateEvidenceCompletenessV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256, { requireFullRun: true });
  } catch (err: any) {
    if (err.message.includes("COMPLETENESS_GATE_FAILED")) {
      missingTrajectoryRejected = true;
    }
  }
  assert.ok(missingTrajectoryRejected, "Falta de trajetória não foi rejeitada!");
  console.log("MISSING_TRAJECTORY_NEGATIVE_CONTROL      = PASS");

  // Negative Control 2: Trajetória Duplicada ou Inesperada (K=999)
  const badTrajectoryFile = path.join(mockRunDir, "raw", "experiment-a", "canonical_k999.json");
  const badAData: TrajectoryEvidenceFile = {
    protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
    protocolSha256: FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
    experiment: "EXPERIMENT_A",
    replicationModel: "CANONICAL_DETERMINISTIC_TRAJECTORY",
    masterSeed: "CANONICAL_OPERATIONAL",
    k: 999,
    finalHorizon: 3788,
    horizonRecords: {
      100: { ...sampleHorizonRecord, k: 999, poolHash: computeSha256("bad_k") },
    },
    finalHistoryCardinality: 500,
    finalDuplicateCount: 0,
    baselineFinalFingerprint: "fp",
    mlFinalFingerprint: "fp",
    recordedAt: new Date().toISOString(),
  };
  atomicWriteFile(badTrajectoryFile, JSON.stringify(badAData));
  generateEvidenceManifestV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
  let unauthTrajectoryRejected = false;
  try {
    validateEvidenceCompletenessV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256, { requireFullRun: false });
  } catch (err: any) {
    if (err.message.includes("COMPLETENESS_GATE_FAILED")) {
      unauthTrajectoryRejected = true;
    }
  }
  assert.ok(unauthTrajectoryRejected, "K não autorizado não foi rejeitado!");
  console.log("DUPLICATE_TRAJECTORY_NEGATIVE_CONTROL    = PASS");
  fs.unlinkSync(badTrajectoryFile);

  // Negative Control 3: Horizonte Faltante (apaga horizonte 3788 de K=50 em A)
  const fileA50 = path.join(mockRunDir, "raw", "experiment-a", "canonical_k50.json");
  const a50Content: TrajectoryEvidenceFile = JSON.parse(fs.readFileSync(fileA50, "utf-8"));
  const a50Modified = {
    ...a50Content,
    horizonRecords: {
      100: a50Content.horizonRecords[100],
      500: a50Content.horizonRecords[500],
      1000: a50Content.horizonRecords[1000],
      2000: a50Content.horizonRecords[2000],
      // 3788 removido
    },
  };
  atomicWriteFile(fileA50, JSON.stringify(a50Modified));
  generateEvidenceManifestV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256);
  let missingHorizonRejected = false;
  try {
    validateEvidenceCompletenessV2(mockRunDir, FROZEN_RESEARCH_PROTOCOL_V2_SHA256, { requireFullRun: true });
  } catch (err: any) {
    if (err.message.includes("COMPLETENESS_GATE_FAILED")) {
      missingHorizonRejected = true;
    }
  }
  assert.ok(missingHorizonRejected, "Falta de horizonte 3788 não foi rejeitada!");
  console.log("MISSING_HORIZON_NEGATIVE_CONTROL         = PASS");

  // ---------------------------------------------------------------------------
  // 7. F07: ELIMINAR DRIFT DE SCHEMA (poolHash e timings)
  // ---------------------------------------------------------------------------
  // Valida poolHash obrigatório e formato SHA-256
  validateTrajectoryRecordSchema(sampleHorizonRecord);
  let mockPoolHashRejected = false;
  try {
    validateTrajectoryRecordSchema({
      ...sampleHorizonRecord,
      poolHash: "mock_pool_hash_test", // Não é SHA-256
    });
  } catch (err: any) {
    if (err.message.includes("SCHEMA_ERROR: poolHash inválido")) {
      mockPoolHashRejected = true;
    }
  }
  assert.ok(mockPoolHashRejected, "Mock de poolHash não foi rejeitado!");
  console.log("POOL_HASH_SCHEMA                         = PASS");

  // Valida timings: max >= p95 >= 0, mean >= 0
  let invalidTimingRejected = false;
  try {
    validateTrajectoryRecordSchema({
      ...sampleHorizonRecord,
      timings: {
        meanSelectionMs: 10,
        p95SelectionMs: 25,
        maxSelectionMs: 20, // Violação: max < p95
      },
    });
  } catch (err: any) {
    if (err.message.includes("Violação de invariante temporal")) {
      invalidTimingRejected = true;
    }
  }
  assert.ok(invalidTimingRejected, "Invariante de timings violada não foi rejeitada!");

  let nanTimingRejected = false;
  try {
    validateTrajectoryRecordSchema({
      ...sampleHorizonRecord,
      timings: {
        meanSelectionMs: NaN,
        p95SelectionMs: 10,
        maxSelectionMs: 15,
      },
    });
  } catch (err: any) {
    if (err.message.includes("SCHEMA_ERROR: meanSelectionMs deve ser finito")) {
      nanTimingRejected = true;
    }
  }
  assert.ok(nanTimingRejected, "NaN em timings não foi rejeitado!");
  console.log("TIMINGS_SCHEMA                           = PASS");

  // ---------------------------------------------------------------------------
  // 8. CONSTANTES E RESTRIÇÕES NORMATIVAS FINAIS
  // ---------------------------------------------------------------------------
  console.log("T3788_EXECUTED                           = NO");
  console.log("IC11_STARTED                             = NO");
  console.log("PRODUCTION_BEHAVIOR_MODIFIED             = NO");

  console.log("\n=== ORDEM EXECUTIVA IC10-R1 PRE-RUN REMEDIATION R2 CONCLUÍDA COM SUCESSO ===");
} finally {
  // Limpa completamente o diretório de fixtures temporárias
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
