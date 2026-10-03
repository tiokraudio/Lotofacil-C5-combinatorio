/**
 * Camada Pura de Analytics do C5-Memory (UI-1D)
 * 
 * Regra Arquitetural Absoluta:
 * - Apenas LEITURA + AGREGAÇÃO + APRESENTAÇÃO.
 * - Desempenho observado NUNCA retroalimenta o algoritmo ou as seeds futuras.
 * - Funções 100% puras (sem React, sem IndexedDB, sem mutações de estado).
 */

import { ContestRecord } from "../types";
import { calculateHits } from "../math";
import {
  ContestPerformanceDTO,
  DashboardDTO,
  GamePerformanceDetail,
  HitDistributionMap,
  HitTierMetric,
  MonthlyContestRow,
  MonthlyReportDTO,
  EvolutionPoint,
} from "./types";

// Probabilidades Teóricas Hipergeométricas da Lotofácil (C(25,15) = 3.268.760)
export const THEORETICAL_PROBABILITIES: Readonly<{ [tier: number]: number }> = {
  11: 286650 / 3268760, // ~8.76935%
  12: 54600 / 3268760,  // ~1.67036%
  13: 4725 / 3268760,   // ~0.14455%
  14: 150 / 3268760,    // ~0.00459%
  15: 1 / 3268760,      // ~0.00003%
};

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

/**
 * Cria mapa vazio para distribuição de acertos 0 a 15
 */
export function createEmptyDistribution(): { [hits: number]: number } {
  const map: { [hits: number]: number } = {};
  for (let i = 0; i <= 15; i++) {
    map[i] = 0;
  }
  return map;
}

/**
 * Avalia o desempenho individual de um ContestRecord
 */
export function buildC5ContestPerformance(record: ContestRecord): ContestPerformanceDTO {
  const gameDetails: GamePerformanceDetail[] = [];
  const hitsArray: number[] = [];

  const hasResult = Array.isArray(record.officialResult) && record.officialResult.length === 15;

  for (let i = 0; i < record.games.length; i++) {
    const game = record.games[i];
    let hits = 0;
    if (hasResult) {
      hits = calculateHits(game, record.officialResult!);
    } else if (record.gameHits && typeof record.gameHits[i] === "number") {
      hits = record.gameHits[i];
    }
    hitsArray.push(hits);
    gameDetails.push({
      gameIndex: i + 1,
      game,
      hits,
    });
  }

  const bestHits = hitsArray.length > 0 ? Math.max(...hitsArray) : 0;
  const bestHitsCount = hitsArray.filter(h => h === bestHits).length;

  return {
    contestNumber: record.contestNumber,
    contestDate: record.contestDate,
    status: record.status,
    games: record.games,
    officialResult: record.officialResult,
    gameDetails,
    bestHits,
    bestHitsCount,
  };
}

/**
 * Constrói as métricas para uma faixa de acerto específica
 */
function createTierMetric(tier: number, count: number, totalScoredGames: number): HitTierMetric {
  const percentage = totalScoredGames > 0 ? (count / totalScoredGames) * 100 : 0;
  const theoretical = THEORETICAL_PROBABILITIES[tier] || 0;
  return {
    tier,
    count,
    total: totalScoredGames,
    percentage,
    theoreticalProbability: theoretical * 100,
  };
}

/**
 * Filtra exclusivamente registros canônicos C5-Memory-2.0.0
 */
export function filterC5MemoryRecords(records: readonly ContestRecord[]): ContestRecord[] {
  return records.filter(r => r.algorithmVersion === "C5-Memory-2.0.0");
}

/**
 * Constrói o DTO principal para o Painel C5 (UI-1D)
 */
export function buildC5Dashboard(
  records: readonly ContestRecord[],
  currentContestNumber: number
): DashboardDTO {
  const c5Records = filterC5MemoryRecords(records);

  // Ordena por concurso crescente
  const sorted = [...c5Records].sort((a, b) => a.contestNumber - b.contestNumber);

  // Localiza registro do concurso atual se houver
  const currentRecord = sorted.find(r => r.contestNumber === currentContestNumber);
  const currentStatus = currentRecord ? currentRecord.status : "AVAILABLE";

  // Identifica concursos confirmados (FROZEN ou COMPLETED)
  const confirmed = sorted.filter(r => r.status === "FROZEN" || r.status === "COMPLETED");
  const confirmedContests = confirmed.length;
  const confirmedGames = confirmedContests * 5;

  // Identifica concursos apurados (COMPLETED com resultado oficial)
  const completed = sorted.filter(
    r => r.status === "COMPLETED" && Array.isArray(r.officialResult) && r.officialResult.length === 15
  );
  const scoredContests = completed.length;
  const scoredGames = scoredContests * 5;

  // Último resultado apurado mais recente
  let lastCompletedPerformance: ContestPerformanceDTO | undefined = undefined;
  if (completed.length > 0) {
    const lastRecord = completed[completed.length - 1];
    lastCompletedPerformance = buildC5ContestPerformance(lastRecord);
  }

  // Distribuição completa 0 a 15
  const distribution = createEmptyDistribution();
  const evolutionSeries: EvolutionPoint[] = [];

  let overallBestHits = 0;
  let overallBestHitsCount = 0;

  for (const rec of completed) {
    const perf = buildC5ContestPerformance(rec);
    evolutionSeries.push({
      contestNumber: rec.contestNumber,
      contestDate: rec.contestDate,
      bestHits: perf.bestHits,
      bestHitsCount: perf.bestHitsCount,
    });

    if (perf.bestHits > overallBestHits) {
      overallBestHits = perf.bestHits;
      overallBestHitsCount = perf.bestHitsCount;
    } else if (perf.bestHits === overallBestHits && overallBestHits > 0) {
      overallBestHitsCount += perf.bestHitsCount;
    }

    for (const detail of perf.gameDetails) {
      distribution[detail.hits] = (distribution[detail.hits] || 0) + 1;
    }
  }

  // Verificação matemática estrita: soma da distribuição === total de jogos apurados
  let totalDistributionSum = 0;
  for (let h = 0; h <= 15; h++) {
    totalDistributionSum += distribution[h] || 0;
  }

  const tiers = {
    tier11: createTierMetric(11, distribution[11] || 0, scoredGames),
    tier12: createTierMetric(12, distribution[12] || 0, scoredGames),
    tier13: createTierMetric(13, distribution[13] || 0, scoredGames),
    tier14: createTierMetric(14, distribution[14] || 0, scoredGames),
    tier15: createTierMetric(15, distribution[15] || 0, scoredGames),
  };

  return {
    currentContestNumber,
    currentStatus,
    currentRecord,
    lastCompletedPerformance,
    confirmedContests,
    scoredContests,
    confirmedGames,
    scoredGames,
    overallBestHits,
    overallBestHitsCount,
    hitDistribution: distribution as HitDistributionMap,
    totalDistributionSum,
    tiers,
    evolutionSeries,
  };
}

/**
 * Constrói o Relatório Mensal para o período informado (ano e mês 1..12)
 * Respeita a cardinalidade REAL dos dados (sem hardcodar 24 concursos).
 */
export function buildC5MonthlyReport(
  records: readonly ContestRecord[],
  year: number,
  month: number
): MonthlyReportDTO {
  const c5Records = filterC5MemoryRecords(records);
  const monthStr = month.toString().padStart(2, "0");
  const prefix = `${year}-${monthStr}`;

  // Filtra concursos que pertencem ao mês especificado pela data YYYY-MM
  const monthRecords = c5Records.filter(r => r.contestDate && r.contestDate.startsWith(prefix));
  monthRecords.sort((a, b) => a.contestNumber - b.contestNumber);

  const totalContestsInMonth = monthRecords.length;
  const confirmed = monthRecords.filter(r => r.status === "FROZEN" || r.status === "COMPLETED");
  const confirmedContests = confirmed.length;
  const confirmedGames = confirmedContests * 5;

  const completed = monthRecords.filter(
    r => r.status === "COMPLETED" && Array.isArray(r.officialResult) && r.officialResult.length === 15
  );
  const scoredContests = completed.length;
  const scoredGames = scoredContests * 5;

  const distribution = createEmptyDistribution();
  const contestRows: MonthlyContestRow[] = [];
  const bestHitsContestsSet = new Set<number>();

  let bestHitsOfMonth = 0;
  let bestHitsOccurrences = 0;

  for (const rec of completed) {
    const perf = buildC5ContestPerformance(rec);

    const j1 = perf.gameDetails[0]?.hits ?? 0;
    const j2 = perf.gameDetails[1]?.hits ?? 0;
    const j3 = perf.gameDetails[2]?.hits ?? 0;
    const j4 = perf.gameDetails[3]?.hits ?? 0;
    const j5 = perf.gameDetails[4]?.hits ?? 0;

    contestRows.push({
      contestNumber: rec.contestNumber,
      contestDate: rec.contestDate,
      j1Hits: j1,
      j2Hits: j2,
      j3Hits: j3,
      j4Hits: j4,
      j5Hits: j5,
      bestHits: perf.bestHits,
      bestHitsCount: perf.bestHitsCount,
    });

    if (perf.bestHits > bestHitsOfMonth) {
      bestHitsOfMonth = perf.bestHits;
      bestHitsContestsSet.clear();
      bestHitsContestsSet.add(rec.contestNumber);
      bestHitsOccurrences = perf.bestHitsCount;
    } else if (perf.bestHits === bestHitsOfMonth && bestHitsOfMonth > 0) {
      bestHitsContestsSet.add(rec.contestNumber);
      bestHitsOccurrences += perf.bestHitsCount;
    }

    for (const detail of perf.gameDetails) {
      distribution[detail.hits] = (distribution[detail.hits] || 0) + 1;
    }
  }

  const tiers = {
    tier11: createTierMetric(11, distribution[11] || 0, scoredGames),
    tier12: createTierMetric(12, distribution[12] || 0, scoredGames),
    tier13: createTierMetric(13, distribution[13] || 0, scoredGames),
    tier14: createTierMetric(14, distribution[14] || 0, scoredGames),
    tier15: createTierMetric(15, distribution[15] || 0, scoredGames),
  };

  const monthLabel = `${MONTH_NAMES[month - 1] || "Mês"} de ${year}`;

  return {
    year,
    month,
    monthLabel,
    totalContestsInMonth,
    confirmedContests,
    scoredContests,
    confirmedGames,
    scoredGames,
    bestHitsOfMonth,
    bestHitsContests: Array.from(bestHitsContestsSet),
    bestHitsOccurrences,
    hitDistribution: distribution as HitDistributionMap,
    tiers,
    contestRows,
  };
}
