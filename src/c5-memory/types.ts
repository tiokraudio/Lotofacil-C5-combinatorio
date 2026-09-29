/**
 * Tipos canônicos para o núcleo matemático de C5-Memory-2.0.0.
 *
 * Módulo puro de domínio sem efeitos colaterais.
 */

/**
 * Jogo canônico da Lotofácil contendo exatamente 15 dezenas no intervalo [1..25].
 */
export type Game15 = readonly number[];

/**
 * Candidato C5 composto por 5 jogos de 15 dezenas.
 */
export type C5Candidate = readonly [Game15, Game15, Game15, Game15, Game15];

/**
 * Jogo histórico (H) de 15 dezenas.
 */
export type HistoryGame = readonly number[];

/**
 * Histograma completo de distâncias de Johnson (n0..n10).
 * n_d representa a contagem de pares (jogo_candidato, jogo_historico) com d_J = d.
 * A soma total sum_{d=0}^{10} n_d é estritamente igual a 5 * |H|.
 */
export type JohnsonHistogram = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

/**
 * Candidato posicionado no pool avaliado pelo seletor.
 * Carrega seu poolIndex ordinal canônico (atribuído externamente).
 */
export interface PoolCandidate {
  readonly poolIndex: number;
  readonly games: C5Candidate;
}

/**
 * Resultado da seleção MAX-LEXIMIN de um pool de candidatos contra o histórico H.
 */
export interface SelectionResult {
  /**
   * Índice posicional no array do pool fornecido (0 <= winnerIndex < pool.length).
   */
  readonly winnerIndex: number;

  /**
   * O poolIndex canônico do candidato vencedor (imutável e originário do pool).
   */
  readonly winnerPoolIndex: number;

  /**
   * O histograma de distâncias de Johnson (n0..n10) do candidato vencedor contra H.
   */
  readonly winnerHistogram: JohnsonHistogram;
}
