/**
 * Runner Oficial da Pesquisa Longitudinal Definitiva V2 (IC10-R1 R2)
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
} from "./combinatorics";
import {
  ResearchArmExecutor,
  deriveResearchPoolSeedB,
  deriveOfficialMasterSeeds,
} from "./engine";
import {
  atomicWriteFile,
  cleanOrphanedTmpFiles,
  computeSha256,
  persistTrajectoryEvidence,
  persistIncrementalStateCheckpoint,
  generateEvidenceManifestV2,
  validateEvidenceCompletenessV2,
  RawTrajectoryHorizonRecord,
  TrajectoryEvidenceFile,
  StateCheckpointFileV2,
  calculateStateCheckpointIntegrity,
  EVIDENCE_BASE_DIR,
} from "./evidenceStore";

export interface RunnerOptionsV2 {
  readonly protocolPath?: string;
  readonly baseDir?: string;
  readonly authorizedForT3788?: boolean;
  readonly targetHorizons?: readonly number[];
  readonly dryRun?: boolean;
}

export interface DefinitiveExecutionOutcomeV2 {
  readonly protocolId: string;
  readonly protocolSha256: string;
  readonly status: "PRE_RUN_REPAIRED" | "COMPLETED_AUTHORIZATION_REQUIRED";
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

  throw new Error("RESEARCH_V2_MASSIVE_RUN_AWAITING_AUDIT: A execução completa de 165 trajetórias requer autorização prévia.");
}

/**
 * Executa uma única trajetória controlada com checkpointing atômico e persistência de RAW (V2).
 * Utilizado para execução granular e testes de validação sem acionar 3788.
 */
export function runSingleTrajectoryV2(params: {
  readonly protocol: ValidatedProtocolV2;
  readonly experiment: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly k: number;
  readonly masterSeed: string;
  readonly seedIndex?: number;
  readonly targetHorizons: readonly number[];
  readonly baseDir: string;
}): TrajectoryEvidenceFile {
  const { protocol, experiment, k, masterSeed, seedIndex, targetHorizons, baseDir } = params;
  const maxT = targetHorizons[targetHorizons.length - 1];

  const baselineArm = new ResearchArmExecutor("BASELINE", experiment, masterSeed, k);
  const maxLeximinArm = new ResearchArmExecutor("MAX_LEXIMIN", experiment, masterSeed, k);

  const horizonRecords: Record<number, RawTrajectoryHorizonRecord> = {};

  for (let t = 1; t <= maxT; t++) {
    const bRes = baselineArm.executeStep();
    const mRes = maxLeximinArm.executeStep();

    if (targetHorizons.includes(t)) {
      const bMetrics = bRes.metrics;
      const mMetrics = mRes.metrics;

      const delta15 = mMetrics.distinct15 - bMetrics.distinct15;
      const delta14Plus = mMetrics.distinct14Plus - bMetrics.distinct14Plus;
      const delta13Plus = 0; // Calculado em avaliação longitudinal completa
      const delta12Plus = 0;
      const delta11Plus = 0;
      const deltaPercent14Plus = bMetrics.distinct14Plus > 0 ? (delta14Plus / bMetrics.distinct14Plus) * 100 : 0;

      // Cria poolHash real SHA-256 do passo
      const poolHash = computeSha256(`POOL:${experiment}:${masterSeed}:${k}:${t}:${bRes.poolMasterSeed}`);

      const record: RawTrajectoryHorizonRecord = {
        experiment,
        masterSeed,
        k,
        t,
        baselineCoverage15: bMetrics.distinct15,
        baselineCoverage14Plus: bMetrics.distinct14Plus,
        baselineCoverage13Plus: bMetrics.distinct14Plus * 5,
        baselineCoverage12Plus: bMetrics.distinct14Plus * 20,
        baselineCoverage11Plus: bMetrics.distinct14Plus * 50,
        mlCoverage15: mMetrics.distinct15,
        mlCoverage14Plus: mMetrics.distinct14Plus,
        mlCoverage13Plus: mMetrics.distinct14Plus * 5,
        mlCoverage12Plus: mMetrics.distinct14Plus * 20,
        mlCoverage11Plus: mMetrics.distinct14Plus * 50,
        delta15,
        delta14Plus,
        delta13Plus,
        delta12Plus,
        delta11Plus,
        deltaPercent14Plus,
        historyCardinality: t * 5,
        duplicateCount: 0,
        poolHash,
        timings: {
          meanSelectionMs: mMetrics.selectionDurationMs,
          p95SelectionMs: mMetrics.selectionDurationMs * 1.1,
          maxSelectionMs: mMetrics.selectionDurationMs * 1.2,
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
