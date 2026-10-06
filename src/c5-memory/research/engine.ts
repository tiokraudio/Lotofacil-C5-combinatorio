/**
 * Motor de Pesquisa Longitudinal C5-Memory-2.1.0
 * Ordem Executiva IC9-R1 — Implementação e Validação Normativa do Research Engine
 */

import { syncSha256 } from "../sha256";
import { formatGameCanonical } from "../history";
import {
  StructuralPRNG,
  derivePoolMasterSeed210,
} from "../engine210";
import { computeLeximinProfile, compareLeximin } from "../math";
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

/**
 * Verifica se um candidato Structural C5 é admissível frente ao histórico H.
 * Um candidato é INADMISSÍVEL se qualquer um de seus 5 jogos colide exatamente com H.
 */
export function isCandidateAdmissible(
  candidateGames: readonly C5Game[],
  historyGameSet: ReadonlySet<string>
): boolean {
  for (let i = 0; i < candidateGames.length; i++) {
    const canonicalStr = formatGameCanonical(candidateGames[i]);
    if (historyGameSet.has(canonicalStr)) {
      return false;
    }
  }
  return true;
}

/**
 * Calcula o hash científico causal de um braço de pesquisa.
 * Isola rigorosamente dados causais de metadados temporais/de parede.
 */
export function calculateScientificResultHash(state: {
  readonly experimentId: ExperimentId;
  readonly masterSeed: string;
  readonly k: number;
  readonly currentStep: number;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly bitsetSha256: string;
}): string {
  const causalPayload = JSON.stringify({
    experimentId: state.experimentId,
    masterSeed: state.masterSeed,
    k: state.k,
    currentStep: state.currentStep,
    historyFingerprint: state.historyFingerprint,
    historyRevision: state.historyRevision,
    bitsetSha256: state.bitsetSha256,
  });
  return syncSha256(causalPayload);
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
   * Executa um único passo t do experimento com fronteiras de temporização separadas
   * e aplicação estrita da política normativa de duplicatas.
   */
  public executeStep(options?: SimulationStepOptions): ArmStepResult {
    const nextStep = this.currentStep + 1;
    const contestNumber = nextStep;

    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 1. Derivação da Semente do Pool
    let poolMasterSeed = "";
    if (this.experimentId === "EXPERIMENT_A") {
      poolMasterSeed = derivePoolMasterSeed210(contestNumber, this.historyFingerprint);
    } else {
      poolMasterSeed = deriveResearchPoolSeedB(this.masterSeed, nextStep);
    }

    // 2. Geração Determinística do Pool de Candidatos
    const prng = new StructuralPRNG(poolMasterSeed);
    const pool: Array<{ index: number; permutation: number[]; games: C5Game[] }> = new Array(this.k);
    for (let i = 0; i < this.k; i++) {
      const cand = prng.generateStructuralCandidate5();
      pool[i] = { index: i, permutation: cand.permutation, games: cand.games };
    }

    const tPoolGen = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 3. Avaliação de Admissibilidade e Seleção Normativa
    let selectedGames: readonly C5Game[] = [];
    let selectedPoolIndex = 0;
    let leximinProfile: readonly number[] | undefined = undefined;

    let tQStart = tPoolGen;
    let tQEnd = tPoolGen;

    if (this.armId === "BASELINE") {
      // Baseline Normativo: Seleciona o primeiro candidato admissível na ordem 0..K-1
      let found = false;
      for (let i = 0; i < this.k; i++) {
        if (isCandidateAdmissible(pool[i].games, this.uniqueGamesSet)) {
          selectedGames = pool[i].games;
          selectedPoolIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(
          `ALL_CANDIDATES_INADMISSIBLE: Todos os ${this.k} candidatos do pool colidem com H no concurso ${contestNumber}.`
        );
      }
      tQStart = tPoolGen;
      tQEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
    } else {
      // MAX-LEXIMIN Normativo:
      // a) Filtra estritamente candidatos admissíveis primeiro
      const admissible: Array<{ index: number; games: C5Game[]; profile: readonly number[] }> = [];
      tQStart = typeof performance !== "undefined" ? performance.now() : Date.now();
      for (let i = 0; i < this.k; i++) {
        if (isCandidateAdmissible(pool[i].games, this.uniqueGamesSet)) {
          const profile = computeLeximinProfile(pool[i].games, this.history);
          admissible.push({ index: i, games: pool[i].games, profile });
        }
      }
      tQEnd = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (admissible.length === 0) {
        throw new Error(
          `ALL_CANDIDATES_INADMISSIBLE: Todos os ${this.k} candidatos do pool colidem com H no concurso ${contestNumber}.`
        );
      }

      // b) Seleciona o melhor leximin dentre os admissíveis (tie-break estrito: menor poolIndex)
      let best = admissible[0];
      for (let i = 1; i < admissible.length; i++) {
        const comp = compareLeximin(admissible[i].profile, best.profile);
        if (comp > 0) {
          best = admissible[i];
        }
      }

      selectedGames = best.games;
      selectedPoolIndex = best.index;
      leximinProfile = best.profile;
    }

    const tSelect = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 4. Atualização de Histórico e Bitset
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

    const tCovUpdate = typeof performance !== "undefined" ? performance.now() : Date.now();

    this.currentStep = nextStep;

    const timingPoolGenerationMs = Math.max(0, tPoolGen - t0);
    const timingQComputationMs = Math.max(0, tQEnd - tQStart);
    const timingSelectionMs = Math.max(0, tSelect - t0);
    const timingCoverageUpdateMs = Math.max(0, tCovUpdate - tSelect);
    const selectionDurationMs = Math.max(0, tCovUpdate - t0);

    const metrics: ResearchMetrics = {
      step: nextStep,
      uniqueGames: this.uniqueGamesSet.size,
      duplicateGames: this.duplicateGameCount,
      distinct15: this.uniqueGamesSet.size,
      distinct14Plus: this.bitset.countOnes(),
      selectionDurationMs,
      timingPoolGenerationMs,
      timingQComputationMs,
      timingSelectionMs,
      timingCoverageUpdateMs,
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

    const scientificResultHash = calculateScientificResultHash({
      experimentId: this.experimentId,
      masterSeed: this.masterSeed,
      k: this.k,
      currentStep: this.currentStep,
      historyFingerprint: this.historyFingerprint,
      historyRevision: this.historyRevision,
      bitsetSha256: bitsetSha,
    });

    const statePayload = JSON.stringify({
      armId: this.armId,
      experimentId: this.experimentId,
      masterSeed: this.masterSeed,
      k: this.k,
      currentStep: this.currentStep,
      historyFingerprint: this.historyFingerprint,
      historyRevision: this.historyRevision,
      bitsetSha: bitsetSha,
      stepResultsCount: this.stepResults.length,
      scientificResultHash,
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
      scientificResultHash,
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
 * Validação profunda de integridade do checkpoint contra adulterações
 */
export function validateCheckpointIntegrity(checkpoint: ResearchCheckpoint): void {
  if (checkpoint.protocolSha256 !== FROZEN_RESEARCH_PROTOCOL_SHA256) {
    throw new Error(
      `CHECKPOINT_PROTOCOL_MISMATCH: Hash do protocolo no checkpoint (${checkpoint.protocolSha256}) difere do oficial.`
    );
  }

  if (checkpoint.step !== checkpoint.arms.baseline.currentStep || checkpoint.step !== checkpoint.arms.maxLeximin.currentStep) {
    throw new Error(
      `CHECKPOINT_STEP_MISMATCH: Passo do checkpoint (${checkpoint.step}) não coincide com o passo dos braços.`
    );
  }

  if (checkpoint.arms.baseline.history.length !== checkpoint.step * 5 || checkpoint.arms.maxLeximin.history.length !== checkpoint.step * 5) {
    throw new Error(
      `CHECKPOINT_HISTORY_CORRUPTION: Quantidade de jogos no histórico não satisfaz |H_t| = 5t.`
    );
  }

  if (checkpoint.k !== checkpoint.arms.baseline.k || checkpoint.k !== checkpoint.arms.maxLeximin.k) {
    throw new Error(`CHECKPOINT_K_CORRUPTION: Dimensão K adulterada.`);
  }

  if (checkpoint.masterSeed !== checkpoint.arms.baseline.masterSeed || checkpoint.masterSeed !== checkpoint.arms.maxLeximin.masterSeed) {
    throw new Error(`CHECKPOINT_SEED_CORRUPTION: Master seed adulterada.`);
  }

  const baseBitsetSha = syncSha256(checkpoint.arms.baseline.bitsetBase64);
  if (baseBitsetSha !== checkpoint.arms.baseline.bitsetSha256) {
    throw new Error(`CHECKPOINT_BITSET_CORRUPTION: Bitset do Baseline adulterado.`);
  }

  const mlBitsetSha = syncSha256(checkpoint.arms.maxLeximin.bitsetBase64);
  if (mlBitsetSha !== checkpoint.arms.maxLeximin.bitsetSha256) {
    throw new Error(`CHECKPOINT_BITSET_CORRUPTION: Bitset do MaxLeximin adulterado.`);
  }

  const checkpointRaw = JSON.stringify({
    protocolId: checkpoint.protocolId,
    protocolSha256: checkpoint.protocolSha256,
    experimentId: checkpoint.experimentId,
    masterSeed: checkpoint.masterSeed,
    k: checkpoint.k,
    step: checkpoint.step,
    totalStepsTarget: checkpoint.totalStepsTarget,
    baselineSha: checkpoint.arms.baseline.stateSha256,
    maxLeximinSha: checkpoint.arms.maxLeximin.stateSha256,
  });

  const expectedSha = syncSha256(checkpointRaw);
  if (expectedSha !== checkpoint.checkpointSha256) {
    throw new Error(`CHECKPOINT_SHA_CORRUPTION: Checkpoint SHA recalculado diverge do declarado.`);
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
 * Restaura e valida um Checkpoint de pesquisa com verificação rigorosa de adulteração
 */
export function restoreResearchCheckpoint(
  checkpoint: ResearchCheckpoint
): {
  baselineArm: ResearchArmExecutor;
  maxLeximinArm: ResearchArmExecutor;
} {
  validateCheckpointIntegrity(checkpoint);

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
