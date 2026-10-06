/**
 * Tipos e Interfaces do Motor de Pesquisa Longitudinal C5-Memory-2.1.0
 * Ordem Executiva IC9 — Research Engine Implementation & Validation
 */

import { C5Game } from "../types";

export type ExperimentId = "EXPERIMENT_A" | "EXPERIMENT_B";

export interface ResearchMetrics {
  readonly step: number;
  readonly uniqueGames: number;
  readonly duplicateGames: number;
  readonly distinct15: number;
  readonly distinct14Plus: number;
  readonly selectionDurationMs: number;
  readonly timingPoolGenerationMs: number;
  readonly timingQComputationMs: number;
  readonly timingSelectionMs: number;
  readonly timingCoverageUpdateMs: number;
  readonly leximinMinDistance?: number;
}

export interface ArmStepResult {
  readonly step: number;
  readonly contestNumber: number;
  readonly selectedPoolIndex: number;
  readonly poolMasterSeed: string;
  readonly games: readonly C5Game[];
  readonly leximinProfile?: readonly number[];
  readonly metrics: ResearchMetrics;
}

export interface ArmExecutionState {
  readonly armId: "BASELINE" | "MAX_LEXIMIN";
  readonly experimentId: ExperimentId;
  readonly masterSeed: string;
  readonly k: number;
  readonly currentStep: number;
  readonly history: readonly C5Game[];
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly bitsetBase64: string;
  readonly bitsetSha256: string;
  readonly stepResults: readonly ArmStepResult[];
  readonly stateSha256: string;
  readonly scientificResultHash: string;
}

export interface ResearchCheckpoint {
  readonly protocolId: string;
  readonly protocolSha256: string;
  readonly experimentId: ExperimentId;
  readonly masterSeed: string;
  readonly k: number;
  readonly step: number;
  readonly totalStepsTarget: number;
  readonly arms: {
    readonly baseline: ArmExecutionState;
    readonly maxLeximin: ArmExecutionState;
  };
  readonly checkpointSha256: string;
  readonly createdAt: string;
}

export interface ResearchSimulationManifest {
  readonly manifestVersion: "1.0.0";
  readonly protocolId: string;
  readonly protocolSha256: string;
  readonly experimentId: ExperimentId;
  readonly masterSeedsTested: readonly string[];
  readonly kGridTested: readonly number[];
  readonly horizonStepsTested: readonly number[];
  readonly executionMode: "SERIAL" | "PARALLEL";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly finalStatus: "SUCCESS" | "FAILURE";
  readonly checkpointsSha256: readonly string[];
  readonly manifestSha256: string;
}
