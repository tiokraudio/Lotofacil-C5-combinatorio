/**
 * Implementação Matemática Otimizada (OPT) — C5-Memory-2.0.0
 * 
 * Subordinada exclusivamente aos artefatos congelados:
 * 1. Especificação Matemática C5-Memory / MAX-LEXIMIN Johnson v2.0
 * 2. Matriz Canônica de Certificação — 72 cenários
 * 3. Protocolo de Certificação C5M-CERT-1.0
 * 
 * Otimizações implementadas:
 * - Representação de cada jogo por máscara binária de 32 bits (bitset)
 * - Contagem de interseção via algoritmo popcount SWAR sem alocação de memória
 * - Cálculo de distância Johnson vetorizado e direto: dJ = 15 - popcount(maskA & maskB)
 * - Histogramas compactos baseados em Int32Array com zero GC no hot-path
 * - Comparação lexicográfica direta e determinística com desempate pelo menor índice
 * 
 * Independência:
 * - Nenhuma função de distância, histograma, comparador ou seletor é compartilhada com reference-evaluator.ts
 */

export interface CandidateEvaluationOpt {
  index: number;
  histogram: number[];
  games: number[][];
}

export interface SelectionResultOpt {
  winnerIndex: number;
  winnerHistogram: number[];
  allEvaluations: CandidateEvaluationOpt[];
}

/**
 * Algoritmo SWAR de 32 bits para cálculo de Hamming weight (popcount) em hardware/JIT.
 * Executa em O(1) com zero alocação de memória.
 */
export function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Converte um jogo de 15 dezenas (1..25) em uma máscara binária de 32 bits.
 * Bit k ligado indica presença da dezena k.
 */
export function gameToBitmask(game: number[]): number {
  let mask = 0;
  for (let i = 0; i < game.length; i++) {
    mask |= (1 << game[i]);
  }
  return mask;
}

/**
 * Calcula a distância de Johnson dJ entre dois jogos via bitmasks:
 * dJ(A, B) = 15 - popcount(maskA & maskB)
 */
export function calculateJohnsonDistanceOpt(maskA: number, maskB: number): number {
  const intersection = popcount32(maskA & maskB);
  return 15 - intersection;
}

/**
 * Constrói o histograma compacto n0..n10 para um candidato C (5 jogos em bitmasks) contra o histórico H (bitmasks).
 */
export function computeCandidateHistogramOpt(
  candMasks: number[],
  historyMasks: number[],
  outHist?: Int32Array
): Int32Array {
  const hist = outHist || new Int32Array(11);
  hist.fill(0);

  const numH = historyMasks.length;
  // Loop unrolling nos 5 jogos do candidato C5
  const m0 = candMasks[0];
  const m1 = candMasks[1];
  const m2 = candMasks[2];
  const m3 = candMasks[3];
  const m4 = candMasks[4];

  for (let j = 0; j < numH; j++) {
    const h = historyMasks[j];
    hist[15 - popcount32(m0 & h)]++;
    hist[15 - popcount32(m1 & h)]++;
    hist[15 - popcount32(m2 & h)]++;
    hist[15 - popcount32(m3 & h)]++;
    hist[15 - popcount32(m4 & h)]++;
  }

  return hist;
}

/**
 * Comparador lexicográfico canônico MAX-LEXIMIN (LEXMIN(n0,...,n9)).
 * Retorna:
 *  -1 se hA é estritamente preferido a hB
 *  +1 se hB é estritamente preferido a hA
 *   0 se empatam nas coordenadas n0..n9
 */
export function compareHistogramsOpt(
  hA: ArrayLike<number>,
  hB: ArrayLike<number>
): { result: -1 | 0 | 1; decidingCoordinate: number } {
  for (let d = 0; d <= 9; d++) {
    const diff = hA[d] - hB[d];
    if (diff < 0) return { result: -1, decidingCoordinate: d };
    if (diff > 0) return { result: 1, decidingCoordinate: d };
  }
  return { result: 0, decidingCoordinate: -1 };
}

/**
 * Seleção do melhor candidato segundo C5-Memory-2.0.0 na implementação OPT:
 * - Pré-computa bitmasks do histórico
 * - Para cada candidato no pool, computa histograma e avalia via MAX-LEXIMIN
 * - Desempata estritamente pelo menor índice no pool
 */
export function selectBestCandidateOpt(
  candidatesPool: number[][][],
  historicalGames: number[][]
): SelectionResultOpt {
  const K = candidatesPool.length;
  if (K === 0) {
    throw new Error("Pool de candidatos vazio");
  }

  // Pré-computa bitmasks do histórico
  const numH = historicalGames.length;
  const historyMasks = new Array<number>(numH);
  for (let j = 0; j < numH; j++) {
    historyMasks[j] = gameToBitmask(historicalGames[j]);
  }

  // Pré-aloca estruturas de avaliação
  const allEvaluations: CandidateEvaluationOpt[] = new Array(K);
  const candMasks = [0, 0, 0, 0, 0];
  const histBuffer = new Int32Array(11);

  let bestIndex = 0;
  let bestHist = new Int32Array(11);

  for (let i = 0; i < K; i++) {
    const games = candidatesPool[i];
    candMasks[0] = gameToBitmask(games[0]);
    candMasks[1] = gameToBitmask(games[1]);
    candMasks[2] = gameToBitmask(games[2]);
    candMasks[3] = gameToBitmask(games[3]);
    candMasks[4] = gameToBitmask(games[4]);

    computeCandidateHistogramOpt(candMasks, historyMasks, histBuffer);
    const histCopy = Array.from(histBuffer);

    allEvaluations[i] = {
      index: i,
      games,
      histogram: histCopy,
    };

    if (i === 0) {
      bestIndex = 0;
      bestHist.set(histBuffer);
    } else {
      const comp = compareHistogramsOpt(histBuffer, bestHist);
      if (comp.result < 0) {
        bestIndex = i;
        bestHist.set(histBuffer);
      }
      // Se empatar (comp.result === 0) ou for pior (comp.result > 0),
      // mantém bestIndex porque bestIndex < i (desempate por menor índice)
    }
  }

  return {
    winnerIndex: bestIndex,
    winnerHistogram: Array.from(bestHist),
    allEvaluations,
  };
}
