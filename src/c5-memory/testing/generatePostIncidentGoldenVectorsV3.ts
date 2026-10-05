/**
 * Gerador Determinístico Programático do Golden Vector V3 (POST_INCIDENT_GOLDEN_VECTORS_V3)
 * Ordem Executiva IC1-R2
 * 
 * PROIBIÇÃO DE CONSTANTES ESPERADAS:
 * Nenhum fingerprint, seed, poolIndex, profile, selectedC5 ou hash de saída é embutido.
 * Toda a cadeia H0..H5 emerge estritamente da execução sequencial determinística.
 */

import { generateC5Draft, freezeDraft } from "../draft";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { syncSha256 } from "../sha256";
import { C5Game } from "../types";

export interface GoldenV3Milestone {
  readonly milestoneIndex: number;
  readonly contestNumber: number;
  readonly historyRevision: number;
  readonly inputGamesCount: number;
  readonly historyFingerprintPreimage: string;
  readonly historyFingerprint: string;
  readonly poolMasterSeedPreimage: string;
  readonly poolMasterSeed: string;
  readonly candidatePoolSizeK: number;
  readonly selectedPoolIndex: number;
  readonly leximinProfile: readonly number[];
  readonly selectedC5Games: readonly (readonly number[])[];
  readonly frozenPayloadPreimage: string;
  readonly frozenPayloadSha256: string;
}

export interface GoldenVectorsV3Document {
  readonly version: "POST_INCIDENT_GOLDEN_VECTORS_V3";
  readonly specification: "C5-Memory-2.0.0";
  readonly executionMode: "SEQUENTIAL_DETERMINISTIC_CHAIN";
  readonly candidatePoolSizeK: 500;
  readonly gamesPerContest: 5;
  readonly numbersPerGame: 15;
  readonly milestonesCount: number;
  readonly milestones: readonly GoldenV3Milestone[];
}

export function generateGoldenVectorsV3(): GoldenVectorsV3Document {
  const milestones: GoldenV3Milestone[] = [];
  const accumulatedHistoryGames: C5Game[] = [];
  let revision = 0;

  for (let contestNumber = 3500; contestNumber <= 3505; contestNumber++) {
    const inputGamesCount = accumulatedHistoryGames.length;

    // 1. Preimage e Fingerprint de H
    let historyFingerprintPreimage = "";
    if (accumulatedHistoryGames.length === 0) {
      historyFingerprintPreimage = "H0-REV0-EMPTY";
    } else {
      const serialized = accumulatedHistoryGames.map(formatGameCanonical).join("|");
      historyFingerprintPreimage = `H-REV${revision}:${serialized}`;
    }
    const historyFingerprint = syncSha256(historyFingerprintPreimage);

    // 2. Preimage e Master Seed do Pool
    const poolMasterSeedPreimage = `C5-POOL-MASTER:${contestNumber}:${historyFingerprint}`;
    const poolMasterSeed = syncSha256(poolMasterSeedPreimage);

    // 3. Execução Normativa da Aplicação
    const memoryHistory = createMemoryHistory(accumulatedHistoryGames, revision);
    const draft = generateC5Draft(contestNumber, memoryHistory);
    const frozen = freezeDraft(draft);

    // 4. Preimage do Payload Congelado
    const gamesSerialized = draft.games.map(formatGameCanonical).join("|");
    const frozenPayloadPreimage = `C5-FROZEN:${contestNumber}:${draft.poolIndex}:${poolMasterSeed}:${historyFingerprint}:${revision}:${gamesSerialized}`;

    milestones.push({
      milestoneIndex: revision,
      contestNumber,
      historyRevision: revision,
      inputGamesCount,
      historyFingerprintPreimage,
      historyFingerprint,
      poolMasterSeedPreimage,
      poolMasterSeed,
      candidatePoolSizeK: 500,
      selectedPoolIndex: draft.poolIndex,
      leximinProfile: draft.leximinProfile,
      selectedC5Games: draft.games,
      frozenPayloadPreimage,
      frozenPayloadSha256: frozen.sha256,
    });

    // 5. Acumulação sequencial estrita dos 5 jogos confirmados no histórico H
    for (const game of draft.games) {
      accumulatedHistoryGames.push(game);
    }
    revision++;
  }

  return {
    version: "POST_INCIDENT_GOLDEN_VECTORS_V3",
    specification: "C5-Memory-2.0.0",
    executionMode: "SEQUENTIAL_DETERMINISTIC_CHAIN",
    candidatePoolSizeK: 500,
    gamesPerContest: 5,
    numbersPerGame: 15,
    milestonesCount: milestones.length,
    milestones,
  };
}
