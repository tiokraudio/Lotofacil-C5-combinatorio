/**
 * Implementação Auxiliar de Referência (REF) para Derivação e Verificação de Golden Vectors.
 * 
 * Subordinada exclusivamente aos artefatos:
 * 1. Especificação Matemática C5-Memory / MAX-LEXIMIN Johnson v2.0
 * 2. Matriz Canônica de Certificação — 72 cenários
 * 3. Protocolo de Certificação C5M-CERT-1.0
 * 
 * Regras:
 * - Representar jogos explicitamente (15 dezenas em 1..25)
 * - Calcular interseção diretamente
 * - dJ(A,B) = 15 - |A ∩ B|
 * - Construir integralmente n0..n10
 * - Comparar n0 -> n9
 * - Desempatar pelo menor índice no pool
 */

export interface CandidateEvaluation {
  index: number;
  histogram: number[];
  games: number[][];
}

/**
 * Valida se um jogo é estritamente válido:
 * - Array de exatamente 15 inteiros
 * - Todos distintos
 * - Todos no intervalo [1..25]
 */
export function validateGameExplicit(game: number[]): boolean {
  if (!Array.isArray(game) || game.length !== 15) return false;
  const set = new Set(game);
  if (set.size !== 15) return false;
  for (const n of game) {
    if (!Number.isInteger(n) || n < 1 || n > 25) return false;
  }
  return true;
}

/**
 * Calcula a distância de Johnson dJ entre dois jogos de 15 dezenas:
 * dJ(A, B) = 15 - |A ∩ B|
 */
export function calculateJohnsonDistance(gameA: number[], gameB: number[]): number {
  const setB = new Set(gameB);
  let intersection = 0;
  for (const num of gameA) {
    if (setB.has(num)) {
      intersection++;
    }
  }
  return 15 - intersection;
}

/**
 * Constrói o histograma completo n0..n10 para um candidato C (5 jogos) contra o histórico H:
 * nd = sum_{g in C} sum_{h in H} 1(dJ(g, h) == d)
 */
export function computeCandidateHistogram(candidateGames: number[][], historicalGames: number[][]): number[] {
  const histogram = new Array(11).fill(0);
  for (const g of candidateGames) {
    for (const h of historicalGames) {
      const d = calculateJohnsonDistance(g, h);
      histogram[d]++;
    }
  }
  return histogram;
}

/**
 * Comparador canônico MAX-LEXIMIN (LEXMIN(n0,...,n9)):
 * Retorna:
 *  -1 se hA é estritamente preferido a hB (hA < hB lexicograficamente em n0..n9)
 *  +1 se hB é estritamente preferido a hA
 *   0 se hA e hB empatam em todas as coordenadas n0..n9
 */
export function compareHistogramsLeximin(
  hA: number[],
  hB: number[]
): { result: -1 | 0 | 1; decidingCoordinate: number } {
  for (let d = 0; d <= 9; d++) {
    if (hA[d] < hB[d]) {
      return { result: -1, decidingCoordinate: d };
    }
    if (hA[d] > hB[d]) {
      return { result: 1, decidingCoordinate: d };
    }
  }
  return { result: 0, decidingCoordinate: -1 };
}

/**
 * Seleciona o melhor candidato de um pool de candidatos segundo MAX-LEXIMIN Johnson v2.0:
 * - Avalia cada candidato contra o histórico H
 * - Ordena/seleciona via LEXMIN(n0..n9)
 * - Desempata pelo menor índice no pool
 */
export function selectBestCandidate(
  candidatesPool: number[][][],
  historicalGames: number[][]
): {
  winnerIndex: number;
  winnerHistogram: number[];
  allEvaluations: CandidateEvaluation[];
} {
  if (candidatesPool.length === 0) {
    throw new Error("Pool de candidatos vazio");
  }

  const evaluations: CandidateEvaluation[] = candidatesPool.map((games, index) => ({
    index,
    games,
    histogram: computeCandidateHistogram(games, historicalGames),
  }));

  let bestIndex = 0;
  for (let i = 1; i < evaluations.length; i++) {
    const comp = compareHistogramsLeximin(
      evaluations[i].histogram,
      evaluations[bestIndex].histogram
    );
    // Se o candidato i é estritamente melhor (< 0), ele substitui o atual melhor
    // Se empatar (0), mantemos bestIndex porque bestIndex < i (menor índice)
    if (comp.result < 0) {
      bestIndex = i;
    }
  }

  return {
    winnerIndex: bestIndex,
    winnerHistogram: evaluations[bestIndex].histogram,
    allEvaluations: evaluations,
  };
}
