/**
 * Tipos e DTOs para a camada de Analytics do C5-Memory (UI-1D).
 * Camada pura de LEITURA + AGREGAÇÃO + APRESENTAÇÃO.
 * Totalmente desacoplada da geração matemática, PRNG, IndexedDB e React.
 */

import { ContestRecord, ContestStatus } from "../types";

export interface GamePerformanceDetail {
  readonly gameIndex: number; // 1 a 5
  readonly game: readonly number[];
  readonly hits: number;
}

export interface ContestPerformanceDTO {
  readonly contestNumber: number;
  readonly contestDate: string;
  readonly status: ContestStatus;
  readonly games: readonly (readonly number[])[];
  readonly officialResult?: readonly number[];
  readonly gameDetails: readonly GamePerformanceDetail[];
  readonly bestHits: number;
  readonly bestHitsCount: number;
}

export interface HitTierMetric {
  readonly tier: number; // 11, 12, 13, 14, 15
  readonly count: number;
  readonly total: number; // denominador (scoredGames)
  readonly percentage: number; // 0..100
  readonly theoreticalProbability: number; // Hipergeométrica teórica
}

export interface HitDistributionMap {
  readonly [hits: number]: number; // 0 a 15
}

export interface EvolutionPoint {
  readonly contestNumber: number;
  readonly contestDate: string;
  readonly bestHits: number;
  readonly bestHitsCount: number;
}

export interface DashboardDTO {
  readonly currentContestNumber: number;
  readonly currentStatus: ContestStatus;
  readonly currentRecord?: ContestRecord;
  readonly lastCompletedPerformance?: ContestPerformanceDTO;
  // Métricas do período geral
  readonly confirmedContests: number;
  readonly scoredContests: number;
  readonly confirmedGames: number;
  readonly scoredGames: number;
  readonly overallBestHits: number;
  readonly overallBestHitsCount: number;
  readonly hitDistribution: HitDistributionMap;
  readonly totalDistributionSum: number; // Deve bater 100% com scoredGames
  readonly tiers: {
    readonly tier11: HitTierMetric;
    readonly tier12: HitTierMetric;
    readonly tier13: HitTierMetric;
    readonly tier14: HitTierMetric;
    readonly tier15: HitTierMetric;
  };
  readonly evolutionSeries: readonly EvolutionPoint[];
}

export interface MonthlyContestRow {
  readonly contestNumber: number;
  readonly contestDate: string;
  readonly j1Hits: number;
  readonly j2Hits: number;
  readonly j3Hits: number;
  readonly j4Hits: number;
  readonly j5Hits: number;
  readonly bestHits: number;
  readonly bestHitsCount: number;
}

export interface MonthlyReportDTO {
  readonly year: number;
  readonly month: number; // 1 a 12
  readonly monthLabel: string;
  readonly totalContestsInMonth: number; // Quantidade REAL encontrada no período
  readonly confirmedContests: number;
  readonly scoredContests: number;
  readonly confirmedGames: number;
  readonly scoredGames: number;
  readonly bestHitsOfMonth: number;
  readonly bestHitsContests: readonly number[];
  readonly bestHitsOccurrences: number;
  readonly hitDistribution: HitDistributionMap;
  readonly tiers: {
    readonly tier11: HitTierMetric;
    readonly tier12: HitTierMetric;
    readonly tier13: HitTierMetric;
    readonly tier14: HitTierMetric;
    readonly tier15: HitTierMetric;
  };
  readonly contestRows: readonly MonthlyContestRow[];
}
