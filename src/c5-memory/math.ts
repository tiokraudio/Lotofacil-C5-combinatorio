/**
 * Núcleo Matemático de Integração C5-Memory-2.0.0.
 *
 * Implementa a matemática pura de cálculo de distância de Johnson,
 * construção de histogramas (n0..n10), comparação LEXMIN(n0..n9)
 * e seleção de candidatos com desempate por menor poolIndex.
 *
 * Módulo puro, sem efeitos colaterais e com garantia de imutabilidade.
 */
import type {
  Game15,
  C5Candidate,
  HistoryGame,
  JohnsonHistogram,
  PoolCandidate,
  SelectionResult,
} from "./types.ts";

export const C5_MEMORY_ALGORITHM_VERSION = "C5-Memory-2.0.0";

/**
 * Valida se um jogo é estritamente válido segundo as regras da Lotofácil:
 * - Array de exatamente 15 inteiros
 * - Todos os inteiros distintos
 * - Todos no intervalo [1..25]
 */
export function validateGame(game: readonly number[]): boolean {
  if (!Array.isArray(game) || game.length !== 15) return false;
  let mask = 0;
  for (let i = 0; i < 15; i++) {
    const num = game[i];
    if (typeof num !== "number" || !Number.isInteger(num) || num < 1 || num > 25) {
      return false;
    }
    const bit = 1 << num;
    if ((mask & bit) !== 0) {
      return false; // Dezena duplicada
    }
    mask |= bit;
  }
  return true;
}

/**
 * Algoritmo SWAR de 32 bits para cálculo de Hamming weight (popcount).
 * Executa em O(1) sem alocação de memória no heap.
 */
export function popcount32(x: number): number {
  x = (x | 0) - (((x | 0) >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Converte um jogo de 15 dezenas (1..25) em uma máscara binária de 32 bits (bitset).
 * O bit k (1 <= k <= 25) ligado indica a presença da dezena k.
 */
export function gameToBitmask(game: readonly number[]): number {
  let mask = 0;
  for (let i = 0; i < game.length; i++) {
    mask |= 1 << game[i];
  }
  return mask;
}

/**
 * Calcula a distância de Johnson d_J entre dois jogos de 15 dezenas:
 * d_J(A, B) = 15 - |A ∩ B|
 *
 * Como |A| = |B| = 15 e o universo é {1..25}, a interseção varia entre 5 e 15,
 * e a distância d_J varia estritamente entre 0 e 10.
 */
export function johnsonDistance(gameA: readonly number[], gameB: readonly number[]): number {
  const maskA = gameToBitmask(gameA);
  const maskB = gameToBitmask(gameB);
  const intersection = popcount32(maskA & maskB);
  return 15 - intersection;
}

/**
 * Calcula a distância de Johnson a partir de duas máscaras binárias pré-calculadas.
 */
export function johnsonDistanceBitmasks(maskA: number, maskB: number): number {
  const intersection = popcount32(maskA & maskB);
  return 15 - intersection;
}

/**
 * Constrói o histograma completo de distâncias de Johnson (n0..n10) para um candidato C (5 jogos)
 * contra o histórico H de jogos:
 *
 * n_d = sum_{g in C} sum_{h in H} 1(d_J(g, h) == d)
 *
 * Invariante: sum_{d=0}^{10} n_d === 5 * |H|
 * Para histórico vazio (H = ∅), retorna [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].
 */
export function computeCandidateHistogram(
  candidateGames: C5Candidate,
  history: readonly HistoryGame[]
): JohnsonHistogram {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  if (!history || history.length === 0) {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  // Pré-computar máscaras dos 5 jogos do candidato
  const candMasks = [
    gameToBitmask(candidateGames[0]),
    gameToBitmask(candidateGames[1]),
    gameToBitmask(candidateGames[2]),
    gameToBitmask(candidateGames[3]),
    gameToBitmask(candidateGames[4]),
  ];

  // Iterar sobre cada jogo histórico preservando multiplicidade
  const hLen = history.length;
  for (let i = 0; i < hLen; i++) {
    const hMask = gameToBitmask(history[i]);
    for (let c = 0; c < 5; c++) {
      const d = 15 - popcount32(candMasks[c] & hMask);
      counts[d]++;
    }
  }

  return counts as unknown as JohnsonHistogram;
}

/**
 * Comparador canônico MAX-LEXIMIN sobre as coordenadas n0..n9:
 * Retorna:
 *  -1 se hA é estritamente preferido a hB (hA[d] < hB[d] no primeiro d em 0..9 divergente)
 *  +1 se hB é estritamente preferido a hA
 *   0 se hA e hB empatam em todas as coordenadas n0..n9
 *
 * IMPORTANTE: n10 é estritamente não-decisório e NUNCA participa da comparação.
 */
export function compareHistogramsLeximin(
  hA: JohnsonHistogram,
  hB: JohnsonHistogram
): -1 | 0 | 1 {
  for (let d = 0; d <= 9; d++) {
    if (hA[d] < hB[d]) return -1;
    if (hA[d] > hB[d]) return 1;
  }
  return 0;
}

/**
 * Seleciona o melhor candidato de um pool segundo o algoritmo MAX-LEXIMIN Johnson v2.0:
 * 1. Avalia cada candidato contra o histórico H, construindo seu histograma n0..n10.
 * 2. Ordena/seleciona via LEXMIN(n0..n9).
 * 3. Em caso de empate integral em n0..n9, desempata pelo menor poolIndex.
 *
 * @param pool Array de candidatos pré-materializados com seus respectivos poolIndex.
 * @param history Array de jogos históricos (multiconjunto).
 * @returns SelectionResult com vencedor, poolIndex do vencedor e seu histograma.
 */
export function selectBestCandidate(
  pool: readonly PoolCandidate[],
  history: readonly HistoryGame[]
): SelectionResult {
  if (!pool || pool.length === 0) {
    throw new Error("Pool de candidatos não pode ser vazio.");
  }

  // Se H for vazio, todos os histogramas são [0..0].
  // O vencedor é o candidato com o menor poolIndex.
  if (!history || history.length === 0) {
    let bestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].poolIndex < pool[bestIdx].poolIndex) {
        bestIdx = i;
      }
    }
    return {
      winnerIndex: bestIdx,
      winnerPoolIndex: pool[bestIdx].poolIndex,
      winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
  }

  // Pré-computar máscaras dos jogos do histórico
  const hMasks = new Int32Array(history.length);
  for (let i = 0; i < history.length; i++) {
    hMasks[i] = gameToBitmask(history[i]);
  }
  const hLen = history.length;

  let bestIndex = 0;
  let bestHistogram: JohnsonHistogram | null = null;

  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    const candMasks = [
      gameToBitmask(candidate.games[0]),
      gameToBitmask(candidate.games[1]),
      gameToBitmask(candidate.games[2]),
      gameToBitmask(candidate.games[3]),
      gameToBitmask(candidate.games[4]),
    ];

    const currentCounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let h = 0; h < hLen; h++) {
      const hMask = hMasks[h];
      for (let c = 0; c < 5; c++) {
        const d = 15 - popcount32(candMasks[c] & hMask);
        currentCounts[d]++;
      }
    }
    const currentHist = currentCounts as unknown as JohnsonHistogram;

    if (bestHistogram === null) {
      bestIndex = i;
      bestHistogram = currentHist;
      continue;
    }

    const comp = compareHistogramsLeximin(currentHist, bestHistogram);
    if (comp < 0) {
      // currentHist é estritamente melhor que bestHistogram
      bestIndex = i;
      bestHistogram = currentHist;
    } else if (comp === 0) {
      // Empate integral em n0..n9: menor poolIndex vence obrigatoriamente
      if (candidate.poolIndex < pool[bestIndex].poolIndex) {
        bestIndex = i;
        bestHistogram = currentHist;
      }
    }
  }

  return {
    winnerIndex: bestIndex,
    winnerPoolIndex: pool[bestIndex].poolIndex,
    winnerHistogram: bestHistogram!,
  };
}
