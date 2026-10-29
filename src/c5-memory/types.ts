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
  readonly isDemo?: boolean;
  readonly isFixture?: boolean;
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
export type AlgorithmVersion = "C5-Memory-2.1.0" | "C5-Memory-2.0.0" | "C5-1.0.0";

export type RateioConfirmationSource =
  | "MANUAL_ENTRY"
  | "OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED"
  | "API_TERCEIROS"
  | "OFFICIAL_CAIXA"
  | "MANUAL_CONFERENCE";

export type ResultSource =
  | "API_CAIXA"
  | "API_TERCEIROS"
  | "API_LOTERIAS"
  | "MANUAL_CONFERENCE"
  | "HISTORICAL_FIXTURE";

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
  readonly totalCost?: number;
  readonly totalPrize?: number;
  readonly officialConfirmedPrize?: number;
  readonly manualConfirmedPrize?: number;
  readonly manualInformedPrize?: number;
  readonly officialValidatedPrize?: number;
  readonly officialNetBalance?: number;
  readonly officialRoiPercentage?: number;
  readonly isDemo?: boolean;
  readonly isFixture?: boolean;
  readonly hasPendingVariableRateio?: boolean;
  readonly hasProvisionalVariableRateio?: boolean;
  readonly prizeBreakdown?: {
    readonly [tier: string]: {
      readonly contestNumber?: number;
      readonly tier?: number;
      readonly count: number;
      readonly unitValue?: number;
      readonly totalValue?: number;
      readonly isVariableRateio?: boolean;
      readonly pendingRateio?: boolean;
      readonly confirmationSource?: RateioConfirmationSource;
      readonly isOfficialCaixaProof?: boolean;
      readonly confirmedAt?: string;
      readonly officialPublishedAt?: string;
      readonly proofRetrievedAt?: string;
      readonly notes?: string;
      readonly documentProof?: string;
      readonly officialProof?: any;
      readonly operatorId?: string;
      readonly manualInformedValue?: number;
      readonly manualConfirmedValue?: number;
      readonly officialValidatedValue?: number;
    };
  };
  readonly confirmedVariablePrizes?: Record<number, any>;
  readonly financialStatus?: ContestFinancialStatus;
  readonly resultSource?: ResultSource;
  readonly resultFetchedAt?: string;
  readonly resultConfirmed?: boolean;
  readonly resultConfirmedAt?: string;
  readonly resultConfirmedBy?: string;
  readonly resultProof?: string | any;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ContestFinancialStatus = "PENDING_HOMOLOGATION" | "HOMOLOGATED";

/**
 * Expressão regular estrita para validação de formato ISO 8601 com data e horário completos
 * Exige: YYYY-MM-DDTHH:mm:ss[.sss...](Z|[+-]HH:MM)
 * Rejeita: strings sem fuso, datas puras, espaços soltos ou formatos permissivos.
 */
export const ISO_8601_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/;

/**
 * Validação semântica e de calendário para timestamps ISO 8601:
 * - Valida sintaxe estrita (YYYY-MM-DDTHH:mm:ss[.sss](Z|[+-]HH:MM));
 * - Rejeita datas impossíveis (ex: 31 de fevereiro, 31 de abril, 29 de fevereiro em ano não bissexto);
 * - Rejeita horas (> 23), minutos (> 59), segundos (> 59);
 * - Rejeita offsets de fuso inválidos (> 23 horas ou > 59 minutos);
 * - Rejeita parsers permissivos do Date.parse().
 */
export function isValidIso8601Timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const match = trimmed.match(ISO_8601_TIMESTAMP_REGEX);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  // Mês regulamentar 1 a 12
  if (month < 1 || month > 12) return false;

  // Horas, minutos, segundos
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  // Validação de calendário e anos bissextos
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  let maxDaysInMonth = 31;
  if (month === 2) {
    maxDaysInMonth = isLeapYear ? 29 : 28;
  } else if (month === 4 || month === 6 || month === 9 || month === 11) {
    maxDaysInMonth = 30;
  }

  if (day < 1 || day > maxDaysInMonth) {
    return false;
  }

  // Se fuso horário for offset ([+-]HH:MM)
  if (match[8] !== "Z") {
    const offsetHour = parseInt(match[10], 10);
    const offsetMinute = parseInt(match[11], 10);
    if (offsetHour < 0 || offsetHour > 23) return false;
    if (offsetMinute < 0 || offsetMinute > 59) return false;
  }

  const parsed = Date.parse(trimmed);
  return !Number.isNaN(parsed);
}

export interface ContestAuditEvent {
  readonly id: string;
  readonly contestNumber: number;
  readonly operation: "SCORE_CONTEST";
  readonly financialStatus: ContestFinancialStatus;
  readonly resultConfirmed: boolean;
  readonly operatorId?: string;
  readonly timestamp: string;
  readonly resultSource: ResultSource;
  readonly financialSummary: {
    readonly totalCost: number;
    readonly totalPrize: number;
    readonly officialConfirmedPrize?: number;
    readonly manualConfirmedPrize?: number;
    readonly officialValidatedPrize?: number;
    readonly netBalance: number;
    readonly hasPendingVariableRateio: boolean;
    readonly hasProvisionalVariableRateio?: boolean;
    readonly winningGamesCount: number;
  };
  readonly createdAt: string;
}
