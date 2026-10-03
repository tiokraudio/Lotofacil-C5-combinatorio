/**
 * C5-Memory-2.0.0 — Tipos Oficiais e Estruturas Canônicas
 */

export type LotofacilNumber = number; // 1 a 25
export type C5Game = readonly number[]; // 15 dezenas estritamente crescentes [1..25]

export interface PoolCandidate {
  readonly index: number;
  readonly games: readonly C5Game[];
  readonly leximinScore?: readonly number[];
}

export interface MemoryHistory {
  readonly games: readonly C5Game[];
  readonly revision: number;
  readonly fingerprint: string;
}

export interface Draft {
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly leximinProfile: readonly number[];
  readonly generatedAt: string;
}

export interface FrozenMemoryPayload {
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly sha256: string;
  readonly frozenAt: string;
}

export type ContestStatus = "AVAILABLE" | "PREVIEW" | "FROZEN" | "COMPLETED";
export type AlgorithmVersion = "C5-Memory-2.0.0" | "C5-1.0.0";

export interface ContestRecord {
  readonly id?: string;
  readonly contestNumber: number;
  readonly contestDate: string; // YYYY-MM-DD
  readonly status: ContestStatus;
  readonly algorithmVersion: AlgorithmVersion;
  readonly games: readonly C5Game[];
  readonly draft?: Draft;
  readonly frozenPayload?: FrozenMemoryPayload;
  readonly officialResult?: readonly number[];
  readonly gameHits?: readonly number[];
  readonly bestHits?: number;
  readonly bestHitsCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
