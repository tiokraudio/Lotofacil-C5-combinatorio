/**
 * Tipos da Camada de Aplicação C5-Memory (Application Boundary)
 */

import { ContestRecord, ContestStatus, Draft, FrozenMemoryPayload, C5Game } from "../types";

export interface OperationalStateDTO {
  readonly contestNumber: number;
  readonly status: ContestStatus;
  readonly games: readonly C5Game[];
  readonly draft?: Draft;
  readonly frozenPayload?: FrozenMemoryPayload;
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly officialResult?: readonly number[];
  readonly gameHits?: readonly number[];
  readonly bestHits?: number;
}

export interface AuditDetailsDTO {
  readonly contestNumber: number;
  readonly algorithmVersion: string;
  readonly status: ContestStatus;
  readonly poolIndex?: number;
  readonly poolMasterSeed?: string;
  readonly historyFingerprint?: string;
  readonly historyRevision?: number;
  readonly sha256?: string;
  readonly frozenAt?: string;
  readonly isCryptographicallyValid: boolean;
  readonly computedSha256?: string;
}
