/**
 * Agregador Estatístico e Processador de Deltas Pareados da Pesquisa
 * Ordem Executiva IC9-R1 — C5-Memory-2.1.0
 */

export interface StatisticalSummary {
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly p95: number;
  readonly standardDeviation: number;
  readonly positiveCount: number;
  readonly zeroCount: number;
  readonly negativeCount: number;
  readonly sampleCount: number;
}

/**
 * Calcula percentil p (0 <= p <= 1) via método nearest-rank:
 *
 * sorted = values sorted ascending
 * rank   = ceil(p * N)
 * index  = rank - 1
 * result = sorted[index]
 *
 * Contrato normativo congelado: NÃO utiliza interpolação linear nem multiplicadores heurísticos.
 * Exemplo normativo: values = [10,20,30,40,50,60,70,80,90,100], N = 10, ceil(0.95 * 10) = 10 -> index 9 -> 100.
 */
export function calculateNearestRankPercentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  if (p <= 0) return Math.min(...values);

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = Math.min(n, Math.max(1, Math.ceil(p * n)));
  return sorted[rank - 1];
}

export const calculatePercentile = calculateNearestRankPercentile;

/**
 * Calcula os deltas pareados: delta_i = ML_i - baseline_i por semente pareada
 */
export function calculatePairedDeltas(
  maxLeximinValues: readonly number[],
  baselineValues: readonly number[]
): number[] {
  if (maxLeximinValues.length !== baselineValues.length) {
    throw new Error(
      `Tamanhos incompatíveis para deltas pareados: ML=${maxLeximinValues.length}, Base=${baselineValues.length}`
    );
  }
  const deltas: number[] = new Array(maxLeximinValues.length);
  for (let i = 0; i < maxLeximinValues.length; i++) {
    deltas[i] = maxLeximinValues[i] - baselineValues[i];
  }
  return deltas;
}

/**
 * Agregador descritivo congelado.
 * NÃO produz p-value, intervalos de confiança ou alegações inferenciais.
 */
export function calculateStatisticalSummary(values: readonly number[]): StatisticalSummary {
  if (values.length === 0) {
    throw new Error("Não é possível calcular estatísticas de um vetor vazio.");
  }

  const n = values.length;
  let sum = 0;
  let min = values[0];
  let max = values[0];
  let positiveCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;

  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > 0) positiveCount++;
    else if (v === 0) zeroCount++;
    else negativeCount++;
  }

  const mean = sum / n;

  // Variância amostral (ou populacional se n=1)
  let sumSqDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = values[i] - mean;
    sumSqDiff += diff * diff;
  }
  const variance = n > 1 ? sumSqDiff / (n - 1) : 0;
  const standardDeviation = Math.sqrt(variance);

  // Mediana e Percentil 95
  const sorted = [...values].sort((a, b) => a - b);
  let median = 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    median = sorted[mid];
  } else {
    median = (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const p95 = calculatePercentile(sorted, 0.95);

  return {
    mean,
    median,
    min,
    max,
    p95,
    standardDeviation,
    positiveCount,
    zeroCount,
    negativeCount,
    sampleCount: n,
  };
}
