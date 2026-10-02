/**
 * C5-Memory-2.0.0 — Application Layer Types (UI-1A)
 *
 * Contratos de tipos para a camada de aplicação e orquestração funcional,
 * isolando a interface de usuário do núcleo matemático certificado.
 */

import type { C5MemoryDraft } from "../draft.ts";
import type { ContestRecord } from "../../c5/types.ts";

/**
 * Detalhe de um jogo de 15 dezenas com colisão exata contra o histórico.
 */
export interface ConflictingGameDetail {
  /**
   * Índice do jogo no candidato (0 a 4 correspondendo a J1..J5).
   */
  readonly gameIndex: number;

  /**
   * Representação canônica das 15 dezenas ordenadas com 2 dígitos (44 chars).
   * Exemplo: "01,02,03,04,05,06,07,08,09,10,11,12,13,14,15"
   */
  readonly canonicalGame: string;

  /**
   * Dezenas numéricas ordenadas em ordem crescente.
   */
  readonly numbers: readonly number[];
}

/**
 * Estado operacional e de elegibilidade para geração C5-Memory de um concurso.
 */
export interface MemoryOperationalState {
  readonly contestNumber: number;
  readonly hasRecord: boolean;
  readonly existingRecordStatus?: "DRAFT" | "FROZEN" | "SCORED";
  readonly existingRecordAlgorithm?: string;
  readonly canGenerateMemoryBet: boolean;
  readonly reasonIfNotEligible?: string;
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly eligibleGamesCountInH: number;
  readonly confirmedContestsCount: number;
}

/**
 * Resultado discriminado da geração de um Draft C5-Memory.
 */
export type GenerateMemoryDraftResult =
  | {
      readonly status: "READY";
      readonly contestNumber: number;
      readonly draft: C5MemoryDraft;
      readonly exactDuplicateCount: 0;
    }
  | {
      readonly status: "EXACT_HISTORY_DUPLICATE_BLOCKED";
      readonly contestNumber: number;
      readonly draft: C5MemoryDraft;
      readonly exactDuplicateCount: number;
      readonly conflictingGames: readonly ConflictingGameDetail[];
      readonly poolMasterSeed: number | string;
      readonly poolIndex: number;
      readonly historyRevision: number;
      readonly historyFingerprint: string;
    }
  | {
      readonly status: "CONTEST_ALREADY_CONFIRMED";
      readonly contestNumber: number;
      readonly existingRecordStatus: "FROZEN" | "SCORED";
      readonly existingRecordAlgorithm: string;
      readonly message: string;
    }
  | {
      readonly status: "CONTEST_NOT_ELIGIBLE";
      readonly contestNumber: number;
      readonly reason: string;
    };

/**
 * Resumo dos metadados de memória para auditoria e inspeção.
 */
export interface MemoryAuditDetails {
  readonly algorithmVersion: "C5-Memory-2.0.0";
  readonly poolMasterSeed: number | string;
  readonly poolIndex: number;
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly confirmedRevision?: number;
  readonly confirmedAt?: string;
  readonly winnerHistogram: readonly number[];
}
