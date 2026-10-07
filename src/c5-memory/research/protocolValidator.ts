/**
 * Validador Normativo de Protocolo de Pesquisa
 * Ordem Executiva IC9 — C5-Memory-2.1.0
 */

import * as fs from "node:fs";
import * as crypto from "node:crypto";

export const FROZEN_RESEARCH_PROTOCOL_ID = "C5_MEMORY_210_RESEARCH_PROTOCOL_V1" as const;
export const FROZEN_RESEARCH_PROTOCOL_SHA256 =
  "e8841fee2b15243f035ef777cef2cc70789012cc9d8d3299bc66e96c88a98226" as const;
export const DEFAULT_PROTOCOL_PATH =
  "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v1.json" as const;

export const FROZEN_RESEARCH_PROTOCOL_V2_ID = "C5_MEMORY_210_RESEARCH_PROTOCOL_V2" as const;
export const FROZEN_RESEARCH_PROTOCOL_V2_SHA256 =
  "1ca46d2e84a55c79426b7fc08d01e1b981d12a12018fc04116975cb1468d8df1" as const;
export const DEFAULT_PROTOCOL_V2_PATH =
  "certification/c5-memory-v2/research/c5-memory-2.1.0-research-protocol-v2.json" as const;

export interface ValidatedProtocol {
  readonly protocolId: string;
  readonly version: string;
  readonly kGrid: readonly number[];
  readonly masterSeeds: {
    readonly count: number;
    readonly masterSalt: string;
  };
  readonly horizons: readonly number[];
  readonly rawJson: string;
  readonly calculatedSha256: string;
}

export interface ValidatedProtocolV2 extends ValidatedProtocol {
  readonly masterSeeds: {
    readonly count: number;
    readonly masterSalt: string;
    readonly generationAlgorithm: string;
  };
  readonly experiments: {
    readonly experimentA: {
      readonly id: "EXPERIMENT_A";
      readonly name: string;
      readonly replicationModel: "CANONICAL_DETERMINISTIC_TRAJECTORY";
      readonly trajectoryCount: number;
      readonly statisticalInference: string;
    };
    readonly experimentB: {
      readonly id: "EXPERIMENT_B";
      readonly name: string;
      readonly replicationModel: "EXOGENOUS_REPLICATED_POOLS";
      readonly trajectoryCount: number;
      readonly statisticalInference: string;
    };
  };
}

/**
 * Valida a integridade física e o binding de runtime do protocolo de pesquisa.
 * Lança erro fatal caso o arquivo esteja ausente, corrompido ou adulterado.
 */
export function validateResearchProtocolBinding(
  protocolPath: string = DEFAULT_PROTOCOL_PATH,
  injectedRawContent?: string
): ValidatedProtocol {
  const raw = injectedRawContent ?? fs.readFileSync(protocolPath, "utf-8");
  const calculatedSha256 = crypto
    .createHash("sha256")
    .update(Buffer.from(raw))
    .digest("hex");

  if (calculatedSha256 !== FROZEN_RESEARCH_PROTOCOL_SHA256) {
    throw new Error(
      `RESEARCH_PROTOCOL_RUNTIME_BINDING_VIOLATION: O hash do protocolo (${calculatedSha256}) ` +
      `diverge do hash congelado na Ordem Executiva (${FROZEN_RESEARCH_PROTOCOL_SHA256}). Execução abortada!`
    );
  }

  const parsed = JSON.parse(raw);

  if (parsed.protocolId !== FROZEN_RESEARCH_PROTOCOL_ID) {
    throw new Error(
      `RESEARCH_PROTOCOL_ID_MISMATCH: Esperado ${FROZEN_RESEARCH_PROTOCOL_ID}, recebido ${parsed.protocolId}`
    );
  }

  if (!Array.isArray(parsed.kGrid) || parsed.kGrid.length === 0) {
    throw new Error("RESEARCH_PROTOCOL_INVALID_K_GRID: kGrid ausente ou inválido no protocolo.");
  }

  return {
    protocolId: parsed.protocolId,
    version: parsed.version,
    kGrid: parsed.kGrid,
    masterSeeds: parsed.masterSeeds,
    horizons: parsed.horizons,
    rawJson: raw,
    calculatedSha256,
  };
}

/**
 * Valida a integridade física e o binding de runtime do Protocolo de Pesquisa V2 (IC10-R1).
 */
export function validateResearchProtocolV2Binding(
  protocolPath: string = DEFAULT_PROTOCOL_V2_PATH,
  injectedRawContent?: string
): ValidatedProtocolV2 {
  const raw = injectedRawContent ?? fs.readFileSync(protocolPath, "utf-8");
  const calculatedSha256 = crypto
    .createHash("sha256")
    .update(Buffer.from(raw))
    .digest("hex");

  if (calculatedSha256 !== FROZEN_RESEARCH_PROTOCOL_V2_SHA256) {
    throw new Error(
      `RESEARCH_PROTOCOL_V2_RUNTIME_BINDING_VIOLATION: O hash do protocolo (${calculatedSha256}) ` +
      `diverge do hash congelado na Ordem Executiva (${FROZEN_RESEARCH_PROTOCOL_V2_SHA256}). Execução abortada!`
    );
  }

  const parsed = JSON.parse(raw);

  if (parsed.protocolId !== FROZEN_RESEARCH_PROTOCOL_V2_ID) {
    throw new Error(
      `RESEARCH_PROTOCOL_V2_ID_MISMATCH: Esperado ${FROZEN_RESEARCH_PROTOCOL_V2_ID}, recebido ${parsed.protocolId}`
    );
  }

  if (!Array.isArray(parsed.kGrid) || parsed.kGrid.length === 0) {
    throw new Error("RESEARCH_PROTOCOL_V2_INVALID_K_GRID: kGrid ausente ou inválido no protocolo V2.");
  }

  if (!parsed.experiments || !parsed.experiments.experimentA || !parsed.experiments.experimentB) {
    throw new Error("RESEARCH_PROTOCOL_V2_INVALID_EXPERIMENTS: Bloco experiments ausente ou incompleto.");
  }

  return {
    protocolId: parsed.protocolId,
    version: parsed.version,
    kGrid: parsed.kGrid,
    masterSeeds: parsed.masterSeeds,
    horizons: parsed.horizons,
    experiments: parsed.experiments,
    rawJson: raw,
    calculatedSha256,
  };
}
