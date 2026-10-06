/**
 * Agregador Estatístico e Processador de Deltas Pareados da Pesquisa
 * Ordem Executiva IC9-R1 — C5-Memory-2.1.0
 */

export interface StatisticalSummary {
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly standardDeviation: number;
  readonly positiveCount: number;
  readonly zeroCount: number;
  readonly negativeCount: number;
  readonly sampleCount: number;
}

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

  // Mediana
  const sorted = [...values].sort((a, b) => a - b);
  let median = 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    median = sorted[mid];
  } else {
    median = (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return {
    mean,
    median,
    min,
    max,
    standardDeviation,
    positiveCount,
    zeroCount,
    negativeCount,
    sampleCount: n,
  };
}
