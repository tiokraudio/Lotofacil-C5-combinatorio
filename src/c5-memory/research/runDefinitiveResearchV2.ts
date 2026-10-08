/**
 * Runner Oficial da Pesquisa Longitudinal Definitiva V2 (IC10-R1 R3)
 * Protocolo: C5_MEMORY_210_RESEARCH_PROTOCOL_V2
 *
 * BARREIRA DE SEGURANÇA: Execução de T3788 estritamente desabilitada até autorização executiva.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  validateResearchProtocolV2Binding,
  ValidatedProtocolV2,
  FROZEN_RESEARCH_PROTOCOL_V2_ID,
  FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
} from "./protocolValidator";
import {
  OutcomeBitset,
  getOutcomes14Plus,
  getOutcomes15,
  evaluateHierarchicalCoverage,
} from "./combinatorics";
import {
  ResearchArmExecutor,
  deriveResearchPoolSeedB,
  deriveOfficialMasterSeeds,
  ExecutionMode,
} from "./engine";
import {
  atomicWriteFile,
  cleanOrphanedTmpFiles,
  computeSha256,
  persistTrajectoryEvidence,
  persistIncrementalStateCheckpoint,
  restoreResearchExecutionV2,
  generateEvidenceManifestV2,
  generateAggregatesAndReportsV2,
  validateEvidenceCompletenessV2,
  RawTrajectoryHorizonRecord,
  TrajectoryEvidenceFile,
  StateCheckpointFileV2,
  calculateStateCheckpointIntegrity,
  EVIDENCE_BASE_DIR,
} from "./evidenceStore";
import { calculatePercentile } from "./statistics";

export interface RunnerOptionsV2 {
  readonly protocolPath?: string;
  readonly baseDir?: string;
  readonly authorizedForT3788?: boolean;
  readonly targetHorizons?: readonly number[];
  readonly dryRun?: boolean;
  readonly resume?: boolean;
  readonly executionMode?: ExecutionMode;
}

export interface DefinitiveExecutionOutcomeV2 {
  readonly protocolId: string;
  readonly protocolSha256: string;
  readonly status: "PRE_RUN_REPAIRED" | "COMPLETED_AUTHORIZATION_REQUIRED" | "COMPLETED";
  readonly trajectoriesA: number;
  readonly trajectoriesB: number;
  readonly evidenceManifestSha256: string;
  readonly executedAt: string;
}

/**
 * Ponto de entrada oficial único para a execução longitudinal sob Protocolo V2.
 * Primeira ação mandatória: validação estrita de runtime binding do Protocol V2.
 */
export function runDefinitiveResearchV2(
  options: RunnerOptionsV2 = {}
): DefinitiveExecutionOutcomeV2 {
  // BARREIRA NORMATIVA MANDATÓRIA: PRIMEIRA AÇÃO CIENTÍFICA
  const validatedProtocol: ValidatedProtocolV2 = validateResearchProtocolV2Binding(
    options.protocolPath
  );

  // Derivação estrita do protocolo validado (zero duplicação silenciosa de constantes)
  const kGrid = [...validatedProtocol.kGrid];
  const masterSeedsCount = validatedProtocol.masterSeeds.count;
  const masterSalt = validatedProtocol.masterSeeds.masterSalt;
  const horizons = options.targetHorizons ?? [...validatedProtocol.horizons];
  const baseDir = options.baseDir ?? EVIDENCE_BASE_DIR;

  // TRAVA DE SEGURANÇA NORMATIVA: T3788 exige autorização expressa da auditoria
  if (horizons.includes(3788) && options.authorizedForT3788 !== true) {
    throw new Error(
      "T3788_EXECUTION_UNAUTHORIZED: Execução do horizonte 3788 bloqueada. Aguardando homologação da auditoria executiva."
    );
  }

  // Limpeza de .tmp órfãos antes de qualquer inicialização
  cleanOrphanedTmpFiles(baseDir);

  // Prepara estrutura física em evidence-v2
  fs.mkdirSync(path.join(baseDir, "raw", "experiment-a"), { recursive: true });
  fs.mkdirSync(path.join(baseDir, "raw", "experiment-b"), { recursive: true });
  fs.mkdirSync(path.join(baseDir, "checkpoints"), { recursive: true });
  fs.mkdirSync(path.join(baseDir, "aggregates"), { recursive: true });
  fs.mkdirSync(path.join(baseDir, "reports"), { recursive: true });

  if (options.dryRun) {
    const manifest = generateEvidenceManifestV2(baseDir, validatedProtocol.calculatedSha256);
    return {
      protocolId: validatedProtocol.protocolId,
      protocolSha256: validatedProtocol.calculatedSha256,
      status: "PRE_RUN_REPAIRED",
      trajectoriesA: 0,
      trajectoriesB: 0,
      evidenceManifestSha256: manifest.manifestSha256 ?? "",
      executedAt: new Date().toISOString(),
    };
  }

  // Deriva sementes oficiais do protocolo validado
  const officialSeeds = deriveOfficialMasterSeeds(masterSalt, masterSeedsCount);

  let trajACount = 0;
  let trajBCount = 0;

  // Execução do Experimento A: 5 Trajetórias Canônicas
  for (const k of kGrid) {
    runSingleTrajectoryV2({
      protocol: validatedProtocol,
      experiment: "EXPERIMENT_A",
      k,
      masterSeed: "CANONICAL_OPERATIONAL",
      targetHorizons: horizons,
      baseDir,
      resume: options.resume,
      executionMode: options.executionMode,
    });
    trajACount++;
  }

  // Execução do Experimento B: 160 Trajetórias Exógenas (5 K * 32 sementes)
  for (const k of kGrid) {
    for (let s = 0; s < masterSeedsCount; s++) {
      runSingleTrajectoryV2({
        protocol: validatedProtocol,
        experiment: "EXPERIMENT_B",
        k,
        masterSeed: officialSeeds[s],
        seedIndex: s,
        targetHorizons: horizons,
        baseDir,
        resume: options.resume,
        executionMode: options.executionMode,
      });
      trajBCount++;
    }
  }

  // Agregações, diagnósticos e relatório executivo com rastreabilidade total (F10)
  generateAggregatesAndReportsV2(baseDir, validatedProtocol.calculatedSha256);

  // Geração do manifesto definitivo (F04)
  const manifest = generateEvidenceManifestV2(baseDir, validatedProtocol.calculatedSha256);

  // Gate formal de completude e cardinalidade
  validateEvidenceCompletenessV2(baseDir, validatedProtocol.calculatedSha256, {
    requireFullRun: horizons.includes(3788),
  });

  return {
    protocolId: validatedProtocol.protocolId,
    protocolSha256: validatedProtocol.calculatedSha256,
    status: "COMPLETED",
    trajectoriesA: trajACount,
    trajectoriesB: trajBCount,
    evidenceManifestSha256: manifest.manifestSha256 ?? "",
    executedAt: new Date().toISOString(),
  };
}

/**
 * Executa uma única trajetória controlada com checkpointing atômico e persistência de RAW (V2).
 * Suporta retomada transparente a partir do último checkpoint (F03).
 */
export function runSingleTrajectoryV2(params: {
  readonly protocol: ValidatedProtocolV2;
  readonly experiment: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly k: number;
  readonly masterSeed: string;
  readonly seedIndex?: number;
  readonly targetHorizons: readonly number[];
  readonly baseDir: string;
  readonly resume?: boolean;
  readonly executionMode?: ExecutionMode;
}): TrajectoryEvidenceFile {
  const { protocol, experiment, k, masterSeed, seedIndex, targetHorizons, baseDir, resume = true, executionMode = "OPTIMIZED" } = params;
  const maxT = targetHorizons[targetHorizons.length - 1];

  const subDir =
    experiment === "EXPERIMENT_A"
      ? path.join(baseDir, "raw", "experiment-a")
      : path.join(baseDir, "raw", "experiment-b");

  const fileName =
    experiment === "EXPERIMENT_A"
      ? `canonical_k${k}.json`
      : `k${k}_seed${seedIndex ?? 0}.json`;

  const targetRawPath = path.join(subDir, fileName);

  // Se já existe e está completo, reutiliza (resumabilidade transparente)
  if (resume && fs.existsSync(targetRawPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(targetRawPath, "utf-8")) as TrajectoryEvidenceFile;
      const hasAllHorizons = targetHorizons.every(h => existing.horizonRecords && existing.horizonRecords[h]);
      if (hasAllHorizons && existing.finalHorizon >= maxT) {
        return existing;
      }
    } catch {
      // Reexecuta se estiver corrompido
    }
  }

  let baselineArm: ResearchArmExecutor;
  let maxLeximinArm: ResearchArmExecutor;
  let startT = 1;
  const horizonRecords: Record<number, RawTrajectoryHorizonRecord> = {};

  // Verifica se existe checkpoint prévio para retomar
  if (resume) {
    const chkDir = path.join(baseDir, "checkpoints");
    const seedTag = seedIndex !== undefined ? `_s${seedIndex}` : "_canonical";
    let latestHorizon = 0;
    let latestChkFile: string | null = null;

    if (fs.existsSync(chkDir)) {
      for (const h of targetHorizons) {
        const chkFile = path.join(
          chkDir,
          `state_${experiment.toLowerCase()}_k${k}${seedTag}_t${h}.json`
        );
        if (fs.existsSync(chkFile) && h < maxT) {
          latestHorizon = h;
          latestChkFile = chkFile;
        }
      }
    }

    if (latestChkFile && latestHorizon > 0) {
      try {
        const restored = restoreResearchExecutionV2(latestChkFile, protocol.calculatedSha256, executionMode);
        baselineArm = restored.baselineArm;
        maxLeximinArm = restored.maxLeximinArm;
        startT = latestHorizon + 1;

        // Recupera registros de horizonte dos checkpoints anteriores
        for (const h of targetHorizons) {
          if (h <= latestHorizon) {
            const hFile = path.join(
              chkDir,
              `state_${experiment.toLowerCase()}_k${k}${seedTag}_t${h}.json`
            );
            if (fs.existsSync(hFile)) {
              const chk = JSON.parse(fs.readFileSync(hFile, "utf-8")) as StateCheckpointFileV2;
              horizonRecords[h] = chk.horizonRecord;
            }
          }
        }
      } catch {
        baselineArm = new ResearchArmExecutor("BASELINE", experiment, masterSeed, k, undefined, executionMode);
        maxLeximinArm = new ResearchArmExecutor("MAX_LEXIMIN", experiment, masterSeed, k, undefined, executionMode);
        startT = 1;
      }
    } else {
      baselineArm = new ResearchArmExecutor("BASELINE", experiment, masterSeed, k, undefined, executionMode);
      maxLeximinArm = new ResearchArmExecutor("MAX_LEXIMIN", experiment, masterSeed, k, undefined, executionMode);
    }
  } else {
    baselineArm = new ResearchArmExecutor("BASELINE", experiment, masterSeed, k, undefined, executionMode);
    maxLeximinArm = new ResearchArmExecutor("MAX_LEXIMIN", experiment, masterSeed, k, undefined, executionMode);
  }

  const stepTimings: number[] = [];

  for (let t = startT; t <= maxT; t++) {
    const bRes = baselineArm.executeStep();
    const mRes = maxLeximinArm.executeStep();
    stepTimings.push(mRes.metrics.selectionDurationMs);

    if (targetHorizons.includes(t)) {
      const bMetrics = bRes.metrics;
      const mMetrics = mRes.metrics;

      // Avaliação cientificamente rigorosa da hierarquia de coberturas (F08)
      const baseCov = evaluateHierarchicalCoverage(
        baselineArm.getHistory(),
        baselineArm.getBitset(),
        bMetrics.uniqueGames
      );
      const mlCov = evaluateHierarchicalCoverage(
        maxLeximinArm.getHistory(),
        maxLeximinArm.getBitset(),
        mMetrics.uniqueGames
      );

      const delta15 = mlCov.coverage15 - baseCov.coverage15;
      const delta14Plus = mlCov.coverage14Plus - baseCov.coverage14Plus;
      const delta13Plus = mlCov.coverage13Plus - baseCov.coverage13Plus;
      const delta12Plus = mlCov.coverage12Plus - baseCov.coverage12Plus;
      const delta11Plus = mlCov.coverage11Plus - baseCov.coverage11Plus;
      const deltaPercent14Plus =
        baseCov.coverage14Plus > 0
          ? (delta14Plus / baseCov.coverage14Plus) * 100
          : 0;

      // Cria poolHash real SHA-256 do passo
      const poolHash = computeSha256(
        `POOL:${experiment}:${masterSeed}:${k}:${t}:${bRes.poolMasterSeed}`
      );

      const meanSelectionMs =
        stepTimings.length > 0
          ? stepTimings.reduce((acc, v) => acc + v, 0) / stepTimings.length
          : mMetrics.selectionDurationMs;
      const p95SelectionMs =
        stepTimings.length > 0
          ? calculatePercentile(stepTimings, 0.95)
          : mMetrics.selectionDurationMs;
      const maxSelectionMs =
        stepTimings.length > 0
          ? Math.max(...stepTimings)
          : mMetrics.selectionDurationMs;

      const record: RawTrajectoryHorizonRecord = {
        experiment,
        masterSeed,
        k,
        t,
        baselineCoverage15: baseCov.coverage15,
        baselineCoverage14Plus: baseCov.coverage14Plus,
        baselineCoverage13Plus: baseCov.coverage13Plus,
        baselineCoverage12Plus: baseCov.coverage12Plus,
        baselineCoverage11Plus: baseCov.coverage11Plus,
        mlCoverage15: mlCov.coverage15,
        mlCoverage14Plus: mlCov.coverage14Plus,
        mlCoverage13Plus: mlCov.coverage13Plus,
        mlCoverage12Plus: mlCov.coverage12Plus,
        mlCoverage11Plus: mlCov.coverage11Plus,
        delta15,
        delta14Plus,
        delta13Plus,
        delta12Plus,
        delta11Plus,
        deltaPercent14Plus,
        historyCardinality: t * 5,
        duplicateCount: mMetrics.duplicateGames,
        poolHash,
        timings: {
          meanSelectionMs,
          p95SelectionMs,
          maxSelectionMs,
        },
      };

      horizonRecords[t] = record;

      // Persistência de Checkpoint de Estado Atômico
      const baseState = baselineArm.exportState();
      const mlState = maxLeximinArm.exportState();
      const integritySha256 = calculateStateCheckpointIntegrity({
        protocolId: protocol.protocolId,
        protocolSha256: protocol.calculatedSha256,
        experiment,
        k,
        masterSeed,
        currentStep: t,
        baselineStateSha: baseState.stateSha256,
        maxLeximinStateSha: mlState.stateSha256,
      });

      const stateCheckpoint: StateCheckpointFileV2 = {
        protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
        protocolSha256: protocol.calculatedSha256,
        experiment,
        replicationModel:
          experiment === "EXPERIMENT_A"
            ? "CANONICAL_DETERMINISTIC_TRAJECTORY"
            : "EXOGENOUS_REPLICATED_POOLS",
        k,
        masterSeed,
        seedIndex,
        currentStep: t,
        checkpointHorizon: t,
        arms: {
          baseline: baseState,
          maxLeximin: mlState,
        },
        horizonRecord: record,
        integritySha256,
        createdAt: new Date().toISOString(),
      };

      persistIncrementalStateCheckpoint(stateCheckpoint, baseDir);
    }
  }

  const evidenceFile: TrajectoryEvidenceFile = {
    protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
    protocolSha256: protocol.calculatedSha256,
    experiment,
    replicationModel:
      experiment === "EXPERIMENT_A"
        ? "CANONICAL_DETERMINISTIC_TRAJECTORY"
        : "EXOGENOUS_REPLICATED_POOLS",
    masterSeed,
    seedIndex,
    k,
    finalHorizon: maxT,
    horizonRecords,
    finalHistoryCardinality: maxT * 5,
    finalDuplicateCount: 0,
    baselineFinalFingerprint: baselineArm.exportState().historyFingerprint,
    mlFinalFingerprint: maxLeximinArm.exportState().historyFingerprint,
    recordedAt: new Date().toISOString(),
  };

  persistTrajectoryEvidence(evidenceFile, baseDir);
  return evidenceFile;
}
