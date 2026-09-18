import type {
  ContestRecord,
  ContestRecordStatus,
  IntegrityVerification,
  ScoreIntegrityVerification,
  Clock,
} from "../c5/types.ts";

/**
 * Constantes financeiras canônicas do sistema Lotofácil C₅.
 * Cada concurso possui 5 jogos simples a R$ 3,50 cada, totalizando R$ 17,50 (1750 centavos).
 */
export const BET_PRICE_CENTS = 350;
export const BET_PRICE = 3.5;
export const BETS_PER_CONTEST = 5;
export const COST_PER_CONTEST_CENTS = BET_PRICE_CENTS * BETS_PER_CONTEST; // 1750 centavos = R$ 17,50
export const COST_PER_CONTEST = COST_PER_CONTEST_CENTS / 100; // 17.50

export function calculateTotalCostCents(contestsCount: number): number {
  return Math.round(contestsCount * COST_PER_CONTEST_CENTS);
}

export function formatBRLFromCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

/**
 * Resumo estatístico do histórico prospectivo, derivado puramente dos registros SCORED.
 */
export interface HistorySummary {
  /**
   * Quantidade total de registros persistidos (DRAFT + FROZEN + SCORED).
   */
  totalRecords: number;

  /**
   * Quantidade de registros em estado DRAFT.
   */
  drafts: number;

  /**
   * Quantidade de registros em estado FROZEN.
   */
  frozen: number;

  /**
   * Quantidade de registros em estado SCORED.
   */
  scored: number;

  /**
   * Concursos efetivamente jogados e acompanhados (igual a scored nesta versão).
   */
  contestsPlayed: number;

  /**
   * Quantidade TOTAL de jogos individuais com 11 acertos em todos os concursos SCORED.
   */
  hits11: number;

  /**
   * Quantidade TOTAL de jogos individuais com 12 acertos em todos os concursos SCORED.
   */
  hits12: number;

  /**
   * Quantidade TOTAL de jogos individuais com 13 acertos em todos os concursos SCORED.
   */
  hits13: number;

  /**
   * Quantidade TOTAL de jogos individuais com 14 acertos em todos os concursos SCORED.
   */
  hits14: number;

  /**
   * Quantidade TOTAL de jogos individuais com 15 acertos em todos os concursos SCORED.
   */
  hits15: number;

  /**
   * Quantidade de concursos nos quais pelo menos um jogo atingiu >= 11 acertos (maxHits >= 11).
   */
  contestsWith11Plus: number;

  /**
   * Quantidade de concursos nos quais pelo menos um jogo atingiu >= 12 acertos (maxHits >= 12).
   */
  contestsWith12Plus: number;

  /**
   * Quantidade de concursos nos quais pelo menos um jogo atingiu >= 13 acertos (maxHits >= 13).
   */
  contestsWith13Plus: number;

  /**
   * Quantidade de concursos nos quais pelo menos um jogo atingiu >= 14 acertos (maxHits >= 14).
   */
  contestsWith14Plus: number;

  /**
   * Quantidade de concursos nos quais pelo menos um jogo atingiu os 15 acertos (maxHits === 15).
   */
  contestsWith15: number;

  /**
   * Maior pontuação máxima observada entre os concursos SCORED (null se nenhum).
   */
  bestMaxHits: number | null;

  /**
   * Média aritmética de maxHits entre os concursos SCORED (null se nenhum).
   */
  averageMaxHits: number | null;

  /**
   * Custo total correspondente (contestsPlayed * COST_PER_CONTEST).
   */
  totalSpent: number;
}

/**
 * Resultado da verificação e auditoria de um registro persistido específico.
 */
export interface StoredContestVerification {
  exists: boolean;
  contestNumber: number;
  status: ContestRecordStatus | null;
  generationIntegrity: IntegrityVerification | null;
  scoreIntegrity: ScoreIntegrityVerification | null;
  valid: boolean;
  errors: string[];
}

/**
 * Detalhe individual de um registro na auditoria global do histórico.
 */
export interface HistoryAuditRecordDetail {
  contestNumber: number;
  status: ContestRecordStatus;
  valid: boolean;
  errors: string[];
}

/**
 * Relatório consolidado da auditoria global do histórico.
 */
export interface HistoryAuditResult {
  valid: boolean;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  records: HistoryAuditRecordDetail[];
}

/**
 * Formato serializável para exportação de backup do histórico.
 */
export interface HistoryExportData {
  schemaVersion: number;
  exportedAt: string;
  algorithmVersions: string[];
  records: ContestRecord[];
}

/**
 * Opções de configuração para o IndexedDB e Repository (permite injeção de IDBFactory para testes).
 */
export interface StorageOptions {
  idbFactory?: IDBFactory;
  dbName?: string;
  clock?: Clock;
}
