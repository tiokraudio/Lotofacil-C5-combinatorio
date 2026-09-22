/**
 * Tipos fundamentais para a arquitetura combinatória C₅ da Lotofácil.
 */

/**
 * Função geradora de números pseudo-aleatórios no intervalo uniforme [0, 1).
 */
export type RNG = () => number;

/**
 * Os 25 slots canônicos da arquitetura combinatória C₅.
 * O prefixo numérico de dois dígitos identifica o par de jogos (1..5)
 * nos quais a dezena atribuída a este slot está AUSENTE.
 * O sufixo ('a', 'b', 'c') distingue slots estruturalmente equivalentes.
 */
export const C5_SLOTS = [
  "12a", "12b", "12c",
  "23a", "23b", "23c",
  "34a", "34b", "34c",
  "45a", "45b", "45c",
  "51a", "51b", "51c",
  "13a", "13b",
  "14a", "14b",
  "24a", "24b",
  "25a", "25b",
  "35a", "35b",
] as const;

export type C5Slot = typeof C5_SLOTS[number];

/**
 * Saída de uma geração canônica C₅.
 */
export interface C5Generation {
  /**
   * Permutação uniforme gerada das 25 dezenas (1..25).
   */
  permutation: number[];

  /**
   * Mapeamento direto de cada um dos 25 slots canônicos para uma dezena.
   */
  slotAssignments: Record<string, number>;

  /**
   * Os 5 jogos produzidos (J1, J2, J3, J4, J5).
   * Cada jogo contém exatamente 15 dezenas em ordem crescente.
   */
  games: [number[], number[], number[], number[], number[]];
}

/**
 * Resultado da validação independente de uma geração C₅.
 */
export interface C5ValidationResult {
  /**
   * Indica se a geração cumpre rigorosamente todas as 9 invariantes A até I.
   */
  valid: boolean;

  /**
   * Lista detalhada de violações detectadas pelas invariantes.
   */
  errors: string[];

  /**
   * Frequência global observada de cada dezena (1..25) entre os 5 jogos.
   */
  frequencies: Record<number, number>;

  /**
   * Tamanho de interseção para cada um dos 10 pares de jogos.
   */
  intersections: {
    pair: string;
    size: number;
  }[];
}

/**
 * Contagem possível de acertos em um jogo da Lotofácil (0 a 15).
 */
export type HitCount =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;

/**
 * Pontuação individual de um dos cinco jogos C₅.
 */
export interface GameScore {
  /**
   * Identificador do jogo (1 a 5, correspondente a J1..J5).
   */
  gameIndex: 1 | 2 | 3 | 4 | 5;

  /**
   * Quantidade de acertos (interseção com o resultado).
   */
  hits: HitCount;

  /**
   * Dezenas do jogo presentes no resultado oficial, ordenadas numericamente.
   */
  matchedNumbers: number[];

  /**
   * Dezenas do jogo que NÃO aparecem no resultado oficial, ordenadas numericamente.
   */
  missedNumbers: number[];
}

/**
 * Contagem de jogos premiados por faixa de acertos (11 a 15).
 */
export interface PrizeCounts {
  hits11: number;
  hits12: number;
  hits13: number;
  hits14: number;
  hits15: number;
}

/**
 * Auditoria completa da pontuação de uma geração C₅ contra um resultado oficial.
 */
export interface C5Score {
  /**
   * Resultado oficial avaliado (15 dezenas ordenadas).
   */
  result: number[];

  /**
   * Pontuação detalhada de cada um dos 5 jogos (J1..J5).
   */
  games: [GameScore, GameScore, GameScore, GameScore, GameScore];

  /**
   * Maior pontuação obtida no portfólio (M_t = max(H1..H5)).
   */
  maxHits: HitCount;

  /**
   * Índices dos jogos (1..5) que atingiram a pontuação máxima (trata empates).
   */
  bestGameIndexes: Array<1 | 2 | 3 | 4 | 5>;

  /**
   * Contagem de jogos do portfólio premiados em cada faixa.
   */
  prizeCounts: PrizeCounts;

  /**
   * Indica se ao menos um jogo atingiu 11 ou mais acertos (maxHits >= 11).
   */
  has11Plus: boolean;

  /**
   * Indica se ao menos um jogo atingiu 12 ou mais acertos (maxHits >= 12).
   */
  has12Plus: boolean;

  /**
   * Indica se ao menos um jogo atingiu 13 ou mais acertos (maxHits >= 13).
   */
  has13Plus: boolean;

  /**
   * Indica se ao menos um jogo atingiu 14 ou mais acertos (maxHits >= 14).
   */
  has14Plus: boolean;

  /**
   * Indica se ao menos um jogo atingiu os 15 acertos (maxHits === 15).
   */
  has15: boolean;
}

/**
 * Estados do ciclo de vida de um registro de concurso C₅.
 */
export type ContestRecordStatus = "DRAFT" | "FROZEN" | "SCORED";

/**
 * Assinatura de relógio injetável para emissão de timestamps UTC previsíveis em testes.
 */
export type Clock = () => Date;

/**
 * Payload canônico congelado de uma geração C₅ para um concurso oficial.
 * Exclusivamente estes campos participam do cômputo do SHA-256 de integridade.
 */
export interface FrozenC5Payload {
  contestNumber: number;
  generationId: string;
  algorithmVersion: string;
  generatedAt: string;
  frozenAt: string;

  permutation: number[];
  slotAssignments: Record<string, number>;
  games: [number[], number[], number[], number[], number[]];
}

/**
 * Estrutura completa de um registro de concurso C₅, acompanhando seu ciclo de vida.
 */
export interface ContestRecord {
  status: ContestRecordStatus;

  contestNumber: number;

  generationId: string;
  algorithmVersion: string;

  generatedAt: string;
  frozenAt?: string;

  /**
   * Timestamp ISO 8601 da confirmação de registro/pagamento dos 5 jogos pelo usuário.
   * Não pode existir em DRAFT. Pode existir em FROZEN e é preservado em SCORED.
   */
  betPlacedAt?: string;

  generation: C5Generation;

  integrityHash?: string;

  officialResult?: number[];

  scoredAt?: string;

  score?: C5Score;

  /**
   * Registro manual e imutável do valor efetivamente recebido/informado pelo usuário.
   * Somente pode existir em SCORED com betPlacedAt previamente confirmado.
   */
  prize?: PrizeRecord;
}

/**
 * Registro manual e imutável do valor efetivamente recebido/informado pelo usuário.
 */
export interface PrizeRecord {
  /**
   * Valor total obtido em centavos (inteiro seguro >= 0).
   */
  amountCents: number;

  /**
   * Timestamp ISO 8601 do momento da gravação manual do prêmio.
   */
  recordedAt: string;

  /**
   * Origem da informação (sempre "MANUAL" na V1.8).
   */
  source: "MANUAL";
}

/**
 * Resultado da auditoria de integridade da geração congelada.
 */
export interface IntegrityVerification {
  valid: boolean;
  hashMatches: boolean;
  generationValid: boolean;
  storedHash: string;
  calculatedHash: string;
  errors: string[];
}

/**
 * Resultado da auditoria de integridade da pontuação de um concurso já pontuado.
 */
export interface ScoreIntegrityVerification {
  valid: boolean;
  scoreMatches: boolean;
  officialResultValid: boolean;
  errors: string[];
}


