/**
 * Motor de Pesquisa Longitudinal C5-Memory-2.1.0
 * Ordem Executiva IC9 — Implementação e Validação do Research Engine
 */

import { syncSha256 } from "../sha256";
import { formatGameCanonical, createMemoryHistory } from "../history";
import {
  StructuralPRNG,
  derivePoolMasterSeed210,
  selectBestStructuralCandidateMaxLeximin,
} from "../engine210";
import { C5Game } from "../types";
import { OutcomeBitset, getOutcomes14Plus } from "./combinatorics";
import {
  ArmExecutionState,
  ArmStepResult,
  ExperimentId,
  ResearchCheckpoint,
  ResearchMetrics,
  ResearchSimulationManifest,
} from "./types";
import {
  ValidatedProtocol,
  validateResearchProtocolBinding,
  FROZEN_RESEARCH_PROTOCOL_ID,
  FROZEN_RESEARCH_PROTOCOL_SHA256,
} from "./protocolValidator";

/**
 * Deriva a seed exógena para o Experimento B
 * Formula: syncSha256("RESEARCH_POOL_SEED:" + masterResearchSeed + ":" + t)
 */
export function deriveResearchPoolSeedB(masterResearchSeed: string, t: number): string {
  return syncSha256(`RESEARCH_POOL_SEED:${masterResearchSeed}:${t}`);
}

/**
 * Deriva a grade determinística de 32 seeds a partir do salt oficial
 */
export function deriveOfficialMasterSeeds(
  salt: string = "C5M-RESEARCH-SEED-SALT-2026-V1",
  count: number = 32
): string[] {
  const seeds: string[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(syncSha256(`${salt}:${i}`));
  }
  return seeds;
}

export interface SimulationStepOptions {
  readonly recordDetailedMetrics?: boolean;
}

export class ResearchArmExecutor {
  public readonly armId: "BASELINE" | "MAX_LEXIMIN";
  public readonly experimentId: ExperimentId;
  public readonly masterSeed: string;
  public readonly k: number;

  private currentStep: number = 0;
  private history: C5Game[] = [];
  private historyFingerprint: string = "";
  private historyRevision: number = 0;
  private bitset: OutcomeBitset;
  private stepResults: ArmStepResult[] = [];
  private uniqueGamesSet: Set<string> = new Set();
  private duplicateGameCount: number = 0;

  constructor(
    armId: "BASELINE" | "MAX_LEXIMIN",
    experimentId: ExperimentId,
    masterSeed: string,
    k: number,
    initialBitset?: OutcomeBitset
  ) {
    this.armId = armId;
    this.experimentId = experimentId;
    this.masterSeed = masterSeed;
    this.k = k;
    this.bitset = initialBitset ? initialBitset.clone() : new OutcomeBitset();
    this.historyFingerprint = syncSha256("EMPTY_HISTORY_ROOT");
  }

  /**
   * Executa um único passo t do experimento
   */
  public executeStep(options?: SimulationStepOptions): ArmStepResult {
    const nextStep = this.currentStep + 1;
    const contestNumber = nextStep;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    let poolMasterSeed = "";
    let selectedGames: readonly C5Game[] = [];
    let selectedPoolIndex = 0;
    let leximinProfile: readonly number[] | undefined = undefined;

    if (this.experimentId === "EXPERIMENT_A") {
      poolMasterSeed = derivePoolMasterSeed210(contestNumber, this.historyFingerprint);
      if (this.armId === "BASELINE") {
        const prng = new StructuralPRNG(poolMasterSeed);
        const cand0 = prng.generateStructuralCandidate5();
        selectedGames = cand0.games;
        selectedPoolIndex = 0;
      } else {
        const sel = selectBestStructuralCandidateMaxLeximin(
          poolMasterSeed,
          this.history,
          this.k
        );
        selectedGames = sel.games;
        selectedPoolIndex = sel.poolIndex;
        leximinProfile = sel.leximinProfile;
      }
    } else {
      // EXPERIMENT_B: pool exógeno controlado invariante ao histórico de cada braço
      poolMasterSeed = deriveResearchPoolSeedB(this.masterSeed, nextStep);
      if (this.armId === "BASELINE") {
        const prng = new StructuralPRNG(poolMasterSeed);
        const cand0 = prng.generateStructuralCandidate5();
        selectedGames = cand0.games;
        selectedPoolIndex = 0;
      } else {
        const sel = selectBestStructuralCandidateMaxLeximin(
          poolMasterSeed,
          this.history,
          this.k
        );
        selectedGames = sel.games;
        selectedPoolIndex = sel.poolIndex;
        leximinProfile = sel.leximinProfile;
      }
    }

    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const durationMs = t1 - t0;

    // Atualização de Histórico e Bitset
    for (const game of selectedGames) {
      const canonicalStr = formatGameCanonical(game);
      if (this.uniqueGamesSet.has(canonicalStr)) {
        this.duplicateGameCount++;
      } else {
        this.uniqueGamesSet.add(canonicalStr);
      }

      this.history.push(game);
      this.historyRevision++;
      this.historyFingerprint = syncSha256(
        `${this.historyFingerprint}:${canonicalStr}`
      );

      // Expande e marca os 151 resultados cobertos com 14+ acertos
      const outcomes14Plus = getOutcomes14Plus(game);
      for (let i = 0; i < outcomes14Plus.length; i++) {
        this.bitset.set(outcomes14Plus[i]);
      }
    }

    this.currentStep = nextStep;

    const metrics: ResearchMetrics = {
      step: nextStep,
      uniqueGames: this.uniqueGamesSet.size,
      duplicateGames: this.duplicateGameCount,
      distinct15: this.uniqueGamesSet.size,
      distinct14Plus: this.bitset.countOnes(),
      selectionDurationMs: durationMs,
      leximinMinDistance: leximinProfile ? leximinProfile[0] : undefined,
    };

    const stepResult: ArmStepResult = {
      step: nextStep,
      contestNumber,
      selectedPoolIndex,
      poolMasterSeed,
      games: selectedGames,
      leximinProfile,
      metrics,
    };

    this.stepResults.push(stepResult);
    return stepResult;
  }

  /**
   * Executa até atingir targetStep passos
   */
  public executeToStep(targetStep: number): void {
    if (targetStep < this.currentStep) {
      throw new Error(
        `targetStep (${targetStep}) não pode ser inferior ao passo atual (${this.currentStep})`
      );
    }
    while (this.currentStep < targetStep) {
      this.executeStep();
    }
  }

  /**
   * Extrai o estado serializado e auditável do braço
   */
  public exportState(): ArmExecutionState {
    const bitsetB64 = this.bitset.toBase64();
    const bitsetSha = syncSha256(bitsetB64);

    const statePayload = JSON.stringify({
      armId: this.armId,
      experimentId: this.experimentId,
      masterSeed: this.masterSeed,
      k: this.k,
      currentStep: this.currentStep,
      historyFingerprint: this.historyFingerprint,
      historyRevision: this.historyRevision,
      bitsetSha,
      stepResultsCount: this.stepResults.length,
    });

    const stateSha256 = syncSha256(statePayload);

    return {
      armId: this.armId,
      experimentId: this.experimentId,
      masterSeed: this.masterSeed,
      k: this.k,
      currentStep: this.currentStep,
      history: [...this.history],
      historyFingerprint: this.historyFingerprint,
      historyRevision: this.historyRevision,
      bitsetBase64: bitsetB64,
      bitsetSha256: bitsetSha,
      stepResults: [...this.stepResults],
      stateSha256,
    };
  }

  /**
   * Restaura o executor a partir de um estado exportado
   */
  public static restoreFromState(state: ArmExecutionState): ResearchArmExecutor {
    const bitset = OutcomeBitset.fromBase64(state.bitsetBase64);
    const executor = new ResearchArmExecutor(
      state.armId,
      state.experimentId,
      state.masterSeed,
      state.k,
      bitset
    );

    executor.currentStep = state.currentStep;
    executor.history = [...state.history];
    executor.historyFingerprint = state.historyFingerprint;
    executor.historyRevision = state.historyRevision;
    executor.stepResults = [...state.stepResults];

    executor.uniqueGamesSet = new Set();
    executor.duplicateGameCount = 0;
    for (const g of state.history) {
      const cStr = formatGameCanonical(g);
      if (executor.uniqueGamesSet.has(cStr)) {
        executor.duplicateGameCount++;
      } else {
        executor.uniqueGamesSet.add(cStr);
      }
    }

    return executor;
  }

  public getHistory(): readonly C5Game[] {
    return this.history;
  }

  public getBitset(): OutcomeBitset {
    return this.bitset;
  }

  public getStepResults(): readonly ArmStepResult[] {
    return this.stepResults;
  }

  public getCurrentStep(): number {
    return this.currentStep;
  }
}

/**
 * Cria um Checkpoint formal de comparação entre Baseline e MaxLeximin
 */
export function createResearchCheckpoint(
  protocol: ValidatedProtocol,
  experimentId: ExperimentId,
  masterSeed: string,
  k: number,
  totalStepsTarget: number,
  baselineArm: ResearchArmExecutor,
  maxLeximinArm: ResearchArmExecutor
): ResearchCheckpoint {
  const baselineState = baselineArm.exportState();
  const maxLeximinState = maxLeximinArm.exportState();

  const checkpointRaw = JSON.stringify({
    protocolId: protocol.protocolId,
    protocolSha256: protocol.calculatedSha256,
    experimentId,
    masterSeed,
    k,
    step: baselineArm.getCurrentStep(),
    totalStepsTarget,
    baselineSha: baselineState.stateSha256,
    maxLeximinSha: maxLeximinState.stateSha256,
  });

  const checkpointSha256 = syncSha256(checkpointRaw);

  return {
    protocolId: protocol.protocolId,
    protocolSha256: protocol.calculatedSha256,
    experimentId,
    masterSeed,
    k,
    step: baselineArm.getCurrentStep(),
    totalStepsTarget,
    arms: {
      baseline: baselineState,
      maxLeximin: maxLeximinState,
    },
    checkpointSha256,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Restaura e valida um Checkpoint de pesquisa
 */
export function restoreResearchCheckpoint(
  checkpoint: ResearchCheckpoint
): {
  baselineArm: ResearchArmExecutor;
  maxLeximinArm: ResearchArmExecutor;
} {
  if (checkpoint.protocolSha256 !== FROZEN_RESEARCH_PROTOCOL_SHA256) {
    throw new Error(
      `CHECKPOINT_PROTOCOL_MISMATCH: O checkpoint foi gerado sob um protocolo divergente.`
    );
  }

  const baselineArm = ResearchArmExecutor.restoreFromState(checkpoint.arms.baseline);
  const maxLeximinArm = ResearchArmExecutor.restoreFromState(checkpoint.arms.maxLeximin);

  return { baselineArm, maxLeximinArm };
}

/**
 * Emite manifesto final de reprodutibilidade para uma rodada de simulações
 */
export function generateSimulationManifest(
  protocol: ValidatedProtocol,
  experimentId: ExperimentId,
  masterSeedsTested: readonly string[],
  kGridTested: readonly number[],
  horizonStepsTested: readonly number[],
  checkpoints: readonly ResearchCheckpoint[],
  executionMode: "SERIAL" | "PARALLEL",
  startedAt: string,
  completedAt: string,
  durationMs: number
): ResearchSimulationManifest {
  const checkpointsSha256 = checkpoints.map(c => c.checkpointSha256);
  const payloadToHash = JSON.stringify({
    protocolId: protocol.protocolId,
    protocolSha256: protocol.calculatedSha256,
    experimentId,
    masterSeedsTested,
    kGridTested,
    horizonStepsTested,
    executionMode,
    checkpointsSha256,
  });

  const manifestSha256 = syncSha256(payloadToHash);

  return {
    manifestVersion: "1.0.0",
    protocolId: protocol.protocolId,
    protocolSha256: protocol.calculatedSha256,
    experimentId,
    masterSeedsTested,
    kGridTested,
    horizonStepsTested,
    executionMode,
    startedAt,
    completedAt,
    durationMs,
    finalStatus: "SUCCESS",
    checkpointsSha256,
    manifestSha256,
  };
}
