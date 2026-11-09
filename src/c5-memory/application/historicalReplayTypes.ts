/**
 * Tipos, Contratos e Estados Canônicos da Reconstrução Histórica Completa C5-Memory 3.0
 */

import { C5Game } from "../types";
import { C5BackupPackage } from "../../storage/backupManager";

export type ReplayState =
  | "NOT_STARTED"
  | "PREPARED"
  | "RESET_CONFIRMED"
  | "RUNNING"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED";

export const REQUIRED_CONFIRMATION_TEXT = "REINICIAR C5 E REPROCESSAR HISTÓRICO" as const;

export interface DatabaseInspectionReport {
  readonly isClean: boolean;
  readonly storesFound: readonly string[];
  readonly contestsCount: number;
  readonly operationalContestsCount: number;
  readonly replayContestsCount: number;
  readonly officialDrawsCount: number;
  readonly firstOfficialContest: number | null;
  readonly lastOfficialContest: number | null;
  readonly isOfficialContiguous: boolean;
  readonly hasPendingBetsOrPreviews: boolean;
  readonly auditEventsCount: number;
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly backupStatus: "NONE" | "EXPORTED_AND_VERIFIED" | "CORRUPTED";
  readonly backupSha256?: string;
  readonly replayState: ReplayState;
  readonly lastCompletedReplayContest: number;
}

export interface PreResetBackupReport {
  readonly backupPackage: C5BackupPackage;
  readonly backupSha256: string;
  readonly contestsCount: number;
  readonly totalGamesCount: number;
  readonly verifiedRestorable: boolean;
  readonly preservationNotice: string;
  readonly erasureNotice: string;
  readonly exportedAt: string;
}

export interface OfficialBaseValidationResult {
  readonly valid: boolean;
  readonly totalDraws: number;
  readonly firstContest: number;
  readonly lastContest: number;
  readonly isContiguous: boolean;
  readonly areDezenasValid: boolean;
  readonly areDatesValid: boolean;
  readonly areDuplicatesFree: boolean;
  readonly isCryptographicallyVerified: boolean;
  readonly declaredSha256: string;
  readonly computedSha256: string;
  readonly errorReason?: string;
}

export interface ReplayCheckpoint {
  readonly id: "historical_replay_checkpoint";
  readonly executionId: string;
  readonly state: ReplayState;
  readonly lastCompletedContest: number;
  readonly targetLastContest: number;
  readonly totalSimulatedBets: number;
  readonly totalConferences: number;
  readonly currentRevision: number;
  readonly currentFingerprint: string;
  readonly hitDistribution: Record<number, number>; // 0..15
  readonly bestHitsPerContest: Record<number, number>;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly elapsedTimeMs: number;
  readonly backupSha256?: string;
  readonly manifestSha256?: string;
  readonly failureReason?: string;
}

export interface ReplayProgressUpdate {
  readonly executionId: string;
  readonly state: ReplayState;
  readonly currentContest: number;
  readonly targetLastContest: number;
  readonly percentage: number;
  readonly elapsedTimeMs: number;
  readonly estimatedRemainingTimeMs: number;
  readonly speedContestsPerSecond: number;
  readonly totalSimulatedBets: number;
  readonly totalConferences: number;
  readonly hitDistribution: Record<number, number>;
  readonly latestBestHits: number;
  readonly latestGames: readonly C5Game[];
  readonly latestOfficialResult: readonly number[];
}

export interface HistoricalReplayIntegrityChecks {
  readonly contestsMatchCount: boolean;
  readonly gamesCardinalityStrict: boolean;
  readonly noDuplicatesGenerated: boolean;
  readonly noC5StructuralViolation: boolean;
  readonly revisionStrictN: boolean;
  readonly gamesCountStrict5N: boolean;
  readonly reproducibleFingerprint: boolean;
  readonly allSha256Valid: boolean;
  readonly allConferencesConducted: boolean;
  readonly zeroFinancialImpact: boolean;
  readonly crossVersionConsistent: boolean;
}

export interface HistoricalReplayFinalReport {
  readonly executionId: string;
  readonly initialContest: number;
  readonly finalContest: number;
  readonly totalContestsProcessed: number;
  readonly totalGamesGenerated: number;
  readonly totalDistinctGames: number;
  readonly totalConferences: number;
  readonly hitDistribution: Record<number, number>;
  readonly bestHitsPerContest: Record<number, number>;
  readonly finalHistoryFingerprint: string;
  readonly manifestSha256: string;
  readonly totalMeasuredTimeMs: number;
  readonly integrityStatus: "INTEGRITY_VERIFIED" | "CORRUPTED";
  readonly integrityChecks: HistoricalReplayIntegrityChecks;
  readonly completedAt: string;
}
