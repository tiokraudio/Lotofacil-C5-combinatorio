/**
 * Regras Oficiais de Premiação e Custos da Lotofácil (CAIXA Econômica Federal)
 * Fonte Oficial Homologada: https://loterias.caixa.gov.br/Paginas/Lotofacil.aspx
 * 
 * Regras Históricas (até 08/07/2025 / concurso 3.438 / ano 2024 e anteriores):
 * - Aposta simples de 15 números: R$ 3,00.
 * - Custo C5 (5 apostas): R$ 15,00.
 * - Prêmios fixos: 11 acertos = R$ 6,00; 12 acertos = R$ 12,00; 13 acertos = R$ 30,00.
 * 
 * Regras Vigentes Atuais (a partir de 09/07/2025 / concurso 3.439 / anos 2025 e 2026):
 * - Aposta simples de 15 números: R$ 3,50.
 * - Custo C5 (5 apostas): R$ 17,50.
 * - Prêmios fixos: 11 acertos = R$ 7,00; 12 acertos = R$ 14,00; 13 acertos = R$ 35,00.
 * 
 * Faixas de 14 e 15 acertos:
 * - Prêmios VARIÁVEIS decorrentes de rateio oficial da arrecadação líquida da Caixa por concurso.
 * - Proibido o uso de valores arbitrários ou presumidos.
 * - Sem comprovação documental oficial ou entrada manual com notas do operador,
 *   permanecem estritamente em "Rateio Pendente" e são excluídos dos totais confirmados.
 */

export interface LotofacilRuleSet {
  readonly costPerGame: number;
  readonly costPerContest: number; // 5 * costPerGame
  readonly fixedPrizes: Readonly<Record<11 | 12 | 13, number>>;
  readonly variableTiers: readonly [14, 15];
}

export const HISTORICAL_RULES_2024: LotofacilRuleSet = Object.freeze({
  costPerGame: 3.00,
  costPerContest: 15.00,
  fixedPrizes: Object.freeze({
    11: 6.00,
    12: 12.00,
    13: 30.00,
  }),
  variableTiers: [14, 15] as const,
});

export const CURRENT_RULES_2025_2026: LotofacilRuleSet = Object.freeze({
  costPerGame: 3.50,
  costPerContest: 17.50,
  fixedPrizes: Object.freeze({
    11: 7.00,
    12: 14.00,
    13: 35.00,
  }),
  variableTiers: [14, 15] as const,
});

/**
 * Determina o conjunto de regras aplicável a um concurso com base na data ou número do concurso.
 * Concursos até 3438 ou até 08/07/2025 (incluindo todo o ano de 2024) utilizam as regras históricas.
 */
export function getLotofacilRuleSet(
  contestNumber?: number,
  contestDate?: string
): LotofacilRuleSet {
  if (contestDate && contestDate.trim().length >= 4) {
    const cleanDate = contestDate.trim();
    const year = parseInt(cleanDate.slice(0, 4), 10);
    if (!Number.isNaN(year)) {
      if (year <= 2024) {
        return HISTORICAL_RULES_2024;
      }
      if (cleanDate < "2025-07-09") {
        return HISTORICAL_RULES_2024;
      }
      return CURRENT_RULES_2025_2026;
    }
  }
  if (contestNumber !== undefined && Number.isInteger(contestNumber) && contestNumber > 0) {
    if (contestNumber <= 3438) {
      return HISTORICAL_RULES_2024;
    }
    return CURRENT_RULES_2025_2026;
  }
  return CURRENT_RULES_2025_2026;
}

export const LOTOFACIL_RULES = Object.freeze({
  ...CURRENT_RULES_2025_2026,
  COST_PER_GAME: CURRENT_RULES_2025_2026.costPerGame,
  GAMES_PER_CONTEST: 5,
  COST_PER_CONTEST: CURRENT_RULES_2025_2026.costPerContest,
  FIXED_PRIZES: CURRENT_RULES_2025_2026.fixedPrizes,
  VARIABLE_TIERS: CURRENT_RULES_2025_2026.variableTiers,
});
export const COST_PER_GAME = CURRENT_RULES_2025_2026.costPerGame;
export const GAMES_PER_CONTEST = 5;
export const COST_PER_CONTEST = CURRENT_RULES_2025_2026.costPerContest;
export const FIXED_PRIZES: Record<number, number> = CURRENT_RULES_2025_2026.fixedPrizes;

/**
 * Retorna o prêmio fixo oficial aplicável (11, 12, 13 acertos), respeitando
 * as regras vigentes na data/concurso informado.
 */
export function getFixedLotofacilPrize(
  hits: number,
  contestNumber?: number,
  contestDate?: string
): number | undefined {
  if (hits !== 11 && hits !== 12 && hits !== 13) return undefined;
  const ruleSet = getLotofacilRuleSet(contestNumber, contestDate);
  return ruleSet.fixedPrizes[hits as 11 | 12 | 13];
}

/**
 * Retorna o custo padrão de um concurso C5 (5 apostas), respeitando
 * as regras vigentes na data/concurso informado.
 */
export function getContestStandardCost(
  contestNumber?: number,
  contestDate?: string
): number {
  return getLotofacilRuleSet(contestNumber, contestDate).costPerContest;
}

/**
 * Indica se a faixa de premiação é variável (14 ou 15 acertos)
 */
export function isVariablePrizeTier(hits: number): boolean {
  return hits === 14 || hits === 15;
}

