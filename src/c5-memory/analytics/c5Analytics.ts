/**
 * Camada Pura de Analytics do C5-Memory (UI-1D)
 * 
 * Regra Arquitetural Absoluta:
 * - Apenas LEITURA + AGREGAÇÃO + APRESENTAÇÃO.
 * - Desempenho observado NUNCA retroalimenta o algoritmo ou as seeds futuras.
 * - Funções 100% puras (sem React, sem IndexedDB, sem mutações de estado).
 */

import { ContestRecord, isValidIso8601Timestamp } from "../types";
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

import {
  COST_PER_GAME,
  GAMES_PER_CONTEST,
  COST_PER_CONTEST,
  FIXED_PRIZES,
  getFixedLotofacilPrize,
  getContestStandardCost,
  isVariablePrizeTier,
} from "../lotofacilRules";
import {
  verifyOfficialCaixaProof,
  validateRateioConfirmation,
  isHumanConferenceValid,
  validateLotofacilBet,
  OfficialCaixaProof,
} from "../../storage/storageManager210";

export { isHumanConferenceValid, validateLotofacilBet };
export { COST_PER_GAME, GAMES_PER_CONTEST, COST_PER_CONTEST, FIXED_PRIZES };

export type AuthoritativeHitsValidation =
  | {
      readonly valid: true;
      readonly hits: number[];
    }
  | {
      readonly valid: false;
      readonly errorCode:
        | "MISSING_GAMES"
        | "INVALID_GAME_STRUCTURE"
        | "MISSING_OFFICIAL_RESULT"
        | "INVALID_OFFICIAL_RESULT_STRUCTURE"
        | "UNVERIFIED_PROVENANCE"
        | "UNCONFIRMED_THIRD_PARTY_RESULT"
        | "UNCONFIRMED_MANUAL_RESULT"
        | "UNCONFIRMED_RESULT";
      readonly errorMessage: string;
    };

/**
 * Validação estrita das 15 dezenas de uma aposta simples da Lotofácil:
 * - Deve ser array com exatamente 15 elementos;
 * - Cada elemento deve ser um número inteiro estrito (não aceita strings como "7", floats ou NaNs);
 * - Cada dezena deve estar no intervalo regulamentar [1, 25];
 * - Sem nenhuma duplicata.
 */
export function validateBetDezenas(game: unknown): game is number[] {
  try {
    validateLotofacilBet(game as readonly number[]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validação estrita do resultado oficial da Lotofácil (15 dezenas regulamentares).
 */
export function validateOfficialResultDezenas(result: unknown): result is number[] {
  if (!Array.isArray(result) || result.length !== 15) return false;
  const seen = new Set<number>();
  for (let i = 0; i < result.length; i++) {
    const d = result[i];
    if (typeof d !== "number" || !Number.isInteger(d) || Number.isNaN(d)) return false;
    if (d < 1 || d > 25) return false;
    if (seen.has(d)) return false;
    seen.add(d);
  }
  return true;
}

/**
 * Obtém os acertos canônicos e matematicamente autoritativos de um concurso.
 * 
 * Regras Estritas de Auditoria (P0-3):
 * 1. Valida cada aposta: exatamente 15 dezenas inteiras, únicas e entre 1 e 25.
 * 2. Valida o resultado oficial: exatamente 15 dezenas inteiras, únicas e entre 1 e 25.
 * 3. Valida a proveniência: não aceita resultado rotulado fraudulentamente como API_CAIXA sem comprovação.
 * 4. Dados inválidos ou ausentes NUNCA recorrem silenciosamente a record.gameHits ou totalPrize.
 *    Retorna explicitamente { valid: false, errorCode, errorMessage }.
 */
export function getAuthoritativeHits(record: ContestRecord): AuthoritativeHitsValidation {
  // 1. Validação da presença e integridade das apostas
  if (!Array.isArray(record.games) || record.games.length === 0) {
    return {
      valid: false,
      errorCode: "MISSING_GAMES",
      errorMessage: "Concurso não possui apostas válidas cadastradas.",
    };
  }

  for (let i = 0; i < record.games.length; i++) {
    if (!validateBetDezenas(record.games[i])) {
      return {
        valid: false,
        errorCode: "INVALID_GAME_STRUCTURE",
        errorMessage: `Aposta no índice ${i} não possui exatamente 15 dezenas inteiras, únicas e no intervalo [1, 25].`,
      };
    }
  }

  // 2. Validação da presença e integridade do resultado oficial
  if (!record.officialResult) {
    return {
      valid: false,
      errorCode: "MISSING_OFFICIAL_RESULT",
      errorMessage: "Resultado oficial não informado para o concurso.",
    };
  }

  if (!validateOfficialResultDezenas(record.officialResult)) {
    return {
      valid: false,
      errorCode: "INVALID_OFFICIAL_RESULT_STRUCTURE",
      errorMessage: "Resultado oficial não possui exatamente 15 dezenas inteiras, únicas e no intervalo [1, 25].",
    };
  }

  // 3. Validação de proveniência dos resultados:
  // 3a. Se alegar API_CAIXA sem comprovação documental oficial, rejeita proveniência
  if (record.resultSource === "API_CAIXA" && !record.resultProof) {
    return {
      valid: false,
      errorCode: "UNVERIFIED_PROVENANCE",
      errorMessage: "Origem do resultado declarada como API_CAIXA sem comprovação documental oficial.",
    };
  }

  // 3b. Se a fonte for API de terceiros (intermediária) ou API_LOTERIAS, exige conferência humana explícita
  if (record.resultSource === "API_TERCEIROS" || record.resultSource === "API_LOTERIAS") {
    if (!isHumanConferenceValid(record)) {
      return {
        valid: false,
        errorCode: "UNCONFIRMED_THIRD_PARTY_RESULT",
        errorMessage: "Resultado obtido de API de terceiros exige conferência humana explícita: resultConfirmed === true, identificador do operador (resultConfirmedBy) e data/hora válida (resultConfirmedAt).",
      };
    }
  } else if (record.resultSource === "MANUAL_CONFERENCE") {
    // P0-1 (Quinta Rodada): Para MANUAL_CONFERENCE, aplicar os mesmos critérios antes de considerar conferido
    if (record.resultConfirmed !== true || !isHumanConferenceValid(record)) {
      return {
        valid: false,
        errorCode: "UNCONFIRMED_MANUAL_RESULT",
        errorMessage: "Resultado de conferência manual não homologado: exige confirmação humana explícita (resultConfirmed === true), identificador do operador (resultConfirmedBy) e data/hora válida (resultConfirmedAt).",
      };
    }
  } else if (record.resultConfirmed !== undefined) {
    // Se resultConfirmed estiver assinalado em qualquer fonte (ex: true), exige que os metadados sejam íntegros
    if (record.resultConfirmed === true && !isHumanConferenceValid(record)) {
      return {
        valid: false,
        errorCode: "UNCONFIRMED_RESULT",
        errorMessage: "Conferência inválida: resultConfirmed === true exige resultConfirmedBy preenchido e resultConfirmedAt com data/hora válida.",
      };
    }
  }

  // Recalcula matematicamente os acertos por interseção
  const hits = record.games.map(g => calculateHits(g, record.officialResult!));
  return { valid: true, hits };
}

/**
 * Predicado canônico e unificado de identificação de fixtures de teste e demonstração.
 * 
 * Regra P0 (Oitava Rodada):
 * Avalia explicitamente todos os marcadores aceitos pelo modelo e opções de entrada:
 * - record.isDemo === true;
 * - record.isFixture === true;
 * - record.resultSource === "HISTORICAL_FIXTURE";
 * - record.draft.isDemo === true;
 * - record.draft.isFixture === true;
 * - options.isDemo === true;
 * - options.isFixture === true;
 * - options.resultSource === "HISTORICAL_FIXTURE";
 * - qualquer flag embutida de fixture em registros de teste.
 */
export function isRecordFixture(
  record?: Partial<ContestRecord> | null,
  options?: { isDemo?: boolean; isFixture?: boolean; resultSource?: string } | null
): boolean {
  if (!record && !options) return false;
  return Boolean(
    record?.isDemo === true ||
    (record as any)?.isFixture === true ||
    record?.resultSource === "HISTORICAL_FIXTURE" ||
    (record?.draft as any)?.isDemo === true ||
    (record?.draft as any)?.isFixture === true ||
    options?.isDemo === true ||
    options?.isFixture === true ||
    options?.resultSource === "HISTORICAL_FIXTURE"
  );
}

export function isRecordOrOperationFixture(
  record?: Partial<ContestRecord> | null,
  options?: { isDemo?: boolean; isFixture?: boolean; resultSource?: string } | null
): boolean {
  return isRecordFixture(record, options);
}

/**
 * P1.1 (Décima Primeira Rodada):
 * Resolução canônica autoritativa dos dados de confirmação de rateio variável (14 e 15).
 * 
 * Regras Estritas:
 * 1. Separação explícita entre dados que descrevem o prêmio (prizeBreakdown) e dados que comprovam a sua confirmação.
 * 2. Um objeto incompleto em prizeBreakdown (ex: { pendingRateio: true } ou { count: 1 }) NÃO pode ocultar
 *    uma confirmação válida existente em confirmedVariablePrizes.
 * 3. Um objeto puramente descritivo de prizeBreakdown (contendo apenas count, totalValue sem campos auditáveis)
 *    NÃO é considerado prova por si só.
 * 4. Prioriza o registro formal em confirmedVariablePrizes[tier]. Se ausente, avalia se prizeBreakdown[tier]
 *    possui campos de auditoria explícitos (confirmationSource: "OFFICIAL_CAIXA" ou "MANUAL_ENTRY", com operatorId/notes/documentProof).
 */
export function resolveRateioConfirmation(
  record: ContestRecord,
  tier: 14 | 15
): unknown {
  const explicit = record.confirmedVariablePrizes?.[tier];
  if (explicit && typeof explicit === "object") {
    return explicit;
  }

  const breakdownItem = record.prizeBreakdown?.[String(tier)] as any;
  if (breakdownItem && typeof breakdownItem === "object") {
    // Se estiver pendente sem fonte de confirmação nem metadados auditáveis, não há confirmação
    if (breakdownItem.pendingRateio === true && !breakdownItem.confirmationSource) {
      return null;
    }
    // Exige metadados explícitos de confirmação (não apenas campos monetários ou count)
    const hasAuditMetadata =
      breakdownItem.confirmationSource === "OFFICIAL_CAIXA" ||
      breakdownItem.confirmationSource === "MANUAL_ENTRY" ||
      breakdownItem.isOfficialCaixaProof === true ||
      breakdownItem.operatorId !== undefined ||
      breakdownItem.documentProof !== undefined;

    if (hasAuditMetadata) {
      return breakdownItem;
    }
  }

  return null;
}

function _calculateContestPrizeInternal(
  record: ContestRecord,
  options?: {
    officialOnly?: boolean;
  }
): number {
  if (record.status !== "COMPLETED") {
    return 0;
  }

  // P0 (Sétima Rodada): Bloqueio absoluto de fixtures de teste ou demonstração
  if (isRecordFixture(record)) {
    return 0;
  }

  // P1-1 (Sexta Rodada): Concurso com status financeiro PENDING_HOMOLOGATION não gera prêmios confirmados
  if (record.financialStatus === "PENDING_HOMOLOGATION") {
    return 0;
  }

  // P0-1: Não homologado financeiramente se não houver conferência humana válida
  if (record.resultConfirmed !== true || !isHumanConferenceValid(record)) {
    return 0;
  }

  // Obtém a validação estrita dos acertos autoritativos
  const authValidation = getAuthoritativeHits(record);

  // SE OS DADOS FOREM INVÁLIDOS, INSUFICIENTES OU NÃO CONFERIDOS:
  // Retorna estritamente 0! NUNCA recorre a record.gameHits ou totalPrize adulterados!
  if (!authValidation.valid) {
    return 0;
  }

  const authoritativeHits = authValidation.hits;

  // 1. Recalcula as quantidades REAIS de apostas premiadas a partir dos acertos autoritativos validados.
  // NUNCA confia isoladamente em record.prizeBreakdown.count, gameHits, bestHits ou totalPrize!
  const realCounts: Record<number, number> = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  for (const h of authoritativeHits) {
    if (h >= 11 && h <= 15) {
      realCounts[h]++;
    }
  }

  let totalCalculatedPrize = 0;

  // 2. Prêmios Fixos Oficiais (11, 12, 13 acertos):
  // Calculados com base nas regras vigentes na data/concurso (ex: 2024 = R$ 6, 12, 30; atual = R$ 7, 14, 35)
  for (const tier of [11, 12, 13] as const) {
    const count = realCounts[tier];
    if (count > 0) {
      const fixedUnit = getFixedLotofacilPrize(tier, record.contestNumber, record.contestDate);
      if (fixedUnit !== undefined) {
        // totalValue = count * unitValue rigorosamente
        totalCalculatedPrize += count * fixedUnit;
      }
    }
  }

  // 3. Faixas Variáveis (14 e 15 acertos):
  // Validador autoritativo único canônico (P0.1, P1.1 - Décima Primeira Rodada)
  for (const tier of [14, 15] as const) {
    const count = realCounts[tier];
    if (count === 0) continue; // Sem apostas reais premiadas nesta faixa

    const tierData = resolveRateioConfirmation(record, tier);
    if (!tierData) continue;

    const validation = validateRateioConfirmation(record.contestNumber, tier, tierData);

    if (validation.valid && validation.validatedUnitValue && validation.validatedUnitValue > 0) {
      // P0.1: Se solicitada apuração estritamente oficial, MANUAL_ENTRY não entra no cômputo
      if (options?.officialOnly && validation.confirmationSource !== "OFFICIAL_CAIXA") {
        continue;
      }
      // Invariante P0: totalValue recalculado estritamente a partir de count * unitValue!
      totalCalculatedPrize += count * validation.validatedUnitValue;
    }
  }

  return totalCalculatedPrize;
}

/**
 * P0.1, P0.2 (Décima Segunda e Décima Terceira Rodadas):
 * Função de produção para cálculo de prêmio do concurso.
 * Por design de segurança, NÃO aceita customRegistry.
 * Se options.officialOnly === true, retorna estritamente prêmio oficial da Caixa.
 * Por padrão, retorna o Prêmio Total Consolidado Auditado (oficial + manual confirmado).
 * Valores pendentes ou apenas informados NUNCA são computados.
 */
export function calculateContestPrize(
  record: ContestRecord,
  options?: {
    officialOnly?: boolean;
  }
): number {
  return _calculateContestPrizeInternal(record, { officialOnly: options?.officialOnly });
}

/**
 * Calcula estritamente o prêmio com comprovação oficial da Caixa Econômica Federal (excluindo entradas manuais).
 * Não aceita injeção de customRegistry em produção.
 */
export function calculateContestOfficialPrize(record: ContestRecord): number {
  return calculateContestPrize(record, { officialOnly: true });
}

export interface ContestFinancialBreakdown {
  readonly cost: number;
  readonly fixedPrize: number;
  readonly manualInformedPrize: number;
  readonly manualConfirmedPrize: number;
  readonly officialValidatedPrize: number;
  readonly officialTotalPrize: number;
  readonly totalAuditedPrize: number;
  readonly officialNetBalance: number;
  readonly officialRoiPercentage: number;
  readonly netBalance: number;
  readonly roiPercentage: number;
  readonly hasPendingVariableRateio: boolean;
  readonly hasPendingOfficialProof: boolean;
  readonly hasProvisionalVariableRateio: boolean;
}

/**
 * Separação explícita de todos os componentes financeiros de um concurso apurado:
 * - Prêmios fixos oficiais;
 * - Valores informados manualmente;
 * - Valores com confirmação manual auditada;
 * - Valores com prova oficial validada;
 * - Rateio oficial pendente;
 * - Apuração provisória.
 */
function _calculateContestFinancialBreakdownInternal(
  record: ContestRecord
): ContestFinancialBreakdown {
  const isFixture = isRecordFixture(record);
  const totalCost = isFixture
    ? 0
    : typeof record.totalCost === "number" && record.totalCost > 0
    ? record.totalCost
    : getContestStandardCost(record.contestNumber, record.contestDate);

  if (
    record.status !== "COMPLETED" ||
    isFixture ||
    record.financialStatus === "PENDING_HOMOLOGATION" ||
    record.resultConfirmed !== true ||
    !isHumanConferenceValid(record)
  ) {
    const hasProv = isContestPendingProvisionalRateio(record);
    let manualInformedPrize = 0;
    if (!isRecordFixture(record) && record.games && record.officialResult) {
      const auth = getAuthoritativeHits(record);
      const hits = auth.valid ? auth.hits : (record.gameHits ?? []);
      for (const tier of [14, 15] as const) {
        const count = hits.filter(h => h === tier).length;
        if (count > 0) {
          const tierData = resolveRateioConfirmation(record, tier);
          const rawUnit = (tierData as any)?.unitPrize ?? (tierData as any)?.unitValue ?? (record.prizeBreakdown?.[String(tier)] as any)?.unitPrize;
          if (typeof rawUnit === "number" && Number.isFinite(rawUnit) && rawUnit > 0) {
            manualInformedPrize += count * rawUnit;
          }
        }
      }
    }
    return {
      cost: totalCost,
      fixedPrize: 0,
      manualInformedPrize,
      manualConfirmedPrize: 0,
      officialValidatedPrize: 0,
      officialTotalPrize: 0,
      totalAuditedPrize: 0,
      officialNetBalance: isFixture ? 0 : -totalCost,
      officialRoiPercentage: totalCost > 0 ? (-totalCost / totalCost) * 100 : 0,
      netBalance: isFixture ? 0 : -totalCost,
      roiPercentage: totalCost > 0 ? (-totalCost / totalCost) * 100 : 0,
      hasPendingVariableRateio: false,
      hasPendingOfficialProof: false,
      hasProvisionalVariableRateio: hasProv,
    };
  }

  const authValidation = getAuthoritativeHits(record);
  if (!authValidation.valid) {
    return {
      cost: totalCost,
      fixedPrize: 0,
      manualInformedPrize: 0,
      manualConfirmedPrize: 0,
      officialValidatedPrize: 0,
      officialTotalPrize: 0,
      totalAuditedPrize: 0,
      officialNetBalance: -totalCost,
      officialRoiPercentage: totalCost > 0 ? (-totalCost / totalCost) * 100 : 0,
      netBalance: -totalCost,
      roiPercentage: totalCost > 0 ? (-totalCost / totalCost) * 100 : 0,
      hasPendingVariableRateio: false,
      hasPendingOfficialProof: false,
      hasProvisionalVariableRateio: false,
    };
  }

  const hits = authValidation.hits;
  const realCounts: Record<number, number> = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  for (const h of hits) {
    if (h >= 11 && h <= 15) realCounts[h]++;
  }

  let fixedPrize = 0;
  for (const tier of [11, 12, 13] as const) {
    const count = realCounts[tier];
    if (count > 0) {
      const fixedUnit = getFixedLotofacilPrize(tier, record.contestNumber, record.contestDate);
      if (fixedUnit !== undefined) {
        fixedPrize += count * fixedUnit;
      }
    }
  }

  let manualConfirmedPrize = 0;
  let manualInformedPrize = 0;
  let officialValidatedPrize = 0;
  let hasPendingVariableRateio = false;
  let hasPendingOfficialProof = false;

  for (const tier of [14, 15] as const) {
    const count = realCounts[tier];
    if (count === 0) continue;

    const confirmationData = resolveRateioConfirmation(record, tier);
    if (!confirmationData) {
      hasPendingVariableRateio = true;
      hasPendingOfficialProof = true;
      const rawUnit =
        (record.prizeBreakdown?.[String(tier)] as any)?.unitValue ??
        (record.prizeBreakdown?.[String(tier)] as any)?.unitPrize ??
        (record.prizeBreakdown?.[String(tier)] as any)?.totalValue;
      if (typeof rawUnit === "number" && Number.isFinite(rawUnit) && rawUnit > 0) {
        manualInformedPrize += count * rawUnit;
      }
      continue;
    }

    const validation = validateRateioConfirmation(record.contestNumber, tier, confirmationData);

    if (!validation.valid || !validation.validatedUnitValue || validation.validatedUnitValue <= 0) {
      hasPendingVariableRateio = true;
      hasPendingOfficialProof = true;
      const rawUnit =
        (confirmationData as any)?.unitValue ??
        (confirmationData as any)?.unitPrize ??
        (confirmationData as any)?.totalValue ??
        (record.prizeBreakdown?.[String(tier)] as any)?.unitValue ??
        (record.prizeBreakdown?.[String(tier)] as any)?.unitPrize ??
        (record.prizeBreakdown?.[String(tier)] as any)?.totalValue;
      if (typeof rawUnit === "number" && Number.isFinite(rawUnit) && rawUnit > 0) {
        manualInformedPrize += count * rawUnit;
      }
      continue;
    }

    const prize = count * validation.validatedUnitValue;
    if (validation.confirmationSource === "OFFICIAL_CAIXA") {
      officialValidatedPrize += prize;
      // Não adiciona a manualConfirmedPrize nem manualInformedPrize
    } else {
      manualConfirmedPrize += prize;
      hasPendingOfficialProof = true;
      // Não adiciona a officialValidatedPrize nem manualInformedPrize
    }
  }

  const officialTotalPrize = fixedPrize + officialValidatedPrize;
  const totalAuditedPrize = officialTotalPrize + manualConfirmedPrize;
  const officialNetBalance = isFixture ? 0 : (officialTotalPrize - totalCost === 0 ? 0 : officialTotalPrize - totalCost);
  const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;
  const netBalance = isFixture ? 0 : (totalAuditedPrize - totalCost === 0 ? 0 : totalAuditedPrize - totalCost);
  const roiPercentage = totalCost > 0 ? (netBalance / totalCost) * 100 : 0;

  return {
    cost: totalCost,
    fixedPrize,
    manualInformedPrize,
    manualConfirmedPrize,
    officialValidatedPrize,
    officialTotalPrize,
    totalAuditedPrize,
    officialNetBalance,
    officialRoiPercentage,
    netBalance,
    roiPercentage,
    hasPendingVariableRateio,
    hasPendingOfficialProof,
    hasProvisionalVariableRateio: false,
  };
}

/**
 * P0.1, P0.2, P0.4: Desdobramento financeiro de produção sem possibilidade de injeção de registro.
 */
export function calculateContestFinancialBreakdown(
  record: ContestRecord
): ContestFinancialBreakdown {
  return _calculateContestFinancialBreakdownInternal(record);
}

/**
 * Determina se um concurso homologado possui acertos nas faixas variáveis (14 ou 15) com rateio oficial pendente.
 */
function _isContestPendingVariableRateioInternal(
  record: ContestRecord,
  options?: {
    officialProofRequired?: boolean;
  }
): boolean {
  if (isRecordFixture(record)) {
    return false;
  }

  if (
    record.financialStatus === "PENDING_HOMOLOGATION" ||
    record.resultConfirmed !== true ||
    !isHumanConferenceValid(record) ||
    record.status !== "COMPLETED"
  ) {
    return false;
  }

  const authValidation = getAuthoritativeHits(record);
  if (!authValidation.valid) {
    return false;
  }

  const hits = authValidation.hits;
  const has14or15Hits = hits.some(h => h === 14 || h === 15);
  if (!has14or15Hits) {
    return false;
  }

  for (const h of [14, 15] as const) {
    const count = hits.filter(hit => hit === h).length;
    if (count > 0) {
      const tierData = resolveRateioConfirmation(record, h);
      if (!tierData) {
        return true;
      }
      const validation = validateRateioConfirmation(record.contestNumber, h, tierData);
      if (!validation.valid) {
        return true;
      }
      if (options?.officialProofRequired && validation.confirmationSource !== "OFFICIAL_CAIXA") {
        return true;
      }
    }
  }

  return false;
}

/**
 * P0.1 (Décima Segunda e Décima Terceira Rodadas):
 * Função de produção para verificação de rateio pendente.
 * Bloqueia injeção de customRegistry em produção.
 */
export function isContestPendingVariableRateio(
  record: ContestRecord,
  options?: {
    officialProofRequired?: boolean;
  } | unknown
): boolean {
  const opts = (typeof options === "object" && options !== null)
    ? (options as { officialProofRequired?: boolean })
    : undefined;
  return _isContestPendingVariableRateioInternal(record, {
    officialProofRequired: opts?.officialProofRequired,
  });
}

/**
 * Retorna true se houver acertos em 14 ou 15 acertos sem comprovação oficial independente da Caixa.
 */
export function isContestPendingOfficialProof(record: ContestRecord): boolean {
  return isContestPendingVariableRateio(record, {
    officialProofRequired: true,
  });
}

/**
 * Determina se um concurso possui acertos provisórios em faixas variáveis (14 ou 15)
 * aguardando conferência e homologação humana do sorteio.
 * 
 * Regra P1 (Nona Rodada):
 * - Exclui fixtures e demonstrações.
 * - Aplica-se exclusivamente a concursos provisórios (PENDING_HOMOLOGATION ou sem homologação formal).
 * - Resultados provisórios nunca são tratados como evidência oficial da Caixa nem alimentam saldo/ROI.
 */
export function isContestPendingProvisionalRateio(record: ContestRecord): boolean {
  if (isRecordFixture(record)) {
    return false;
  }
  // Se já for homologado com conferência humana válida, não é provisório
  if (
    record.financialStatus === "HOMOLOGATED" &&
    record.resultConfirmed === true &&
    isHumanConferenceValid(record)
  ) {
    return false;
  }
  // Se for provisório:
  if (
    record.financialStatus === "PENDING_HOMOLOGATION" ||
    record.resultConfirmed !== true ||
    !isHumanConferenceValid(record)
  ) {
    const provHits = getProvisionalHits(record);
    if (provHits && provHits.some(h => h === 14 || h === 15)) {
      return true;
    }
  }
  return false;
}


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
 * Computa os acertos provisórios de um concurso a partir das dezenas reais das apostas
 * e do resultado oficial informado, mesmo quando a homologação humana/documental ainda estiver pendente.
 */
export function getProvisionalHits(record: ContestRecord): number[] | null {
  if (
    validateOfficialResultDezenas(record.officialResult) &&
    Array.isArray(record.games) &&
    record.games.length > 0 &&
    record.games.every(validateBetDezenas)
  ) {
    return record.games.map(g => calculateHits(g, record.officialResult!));
  }
  return null;
}

/**
 * Avalia o desempenho individual de um ContestRecord
 */
export function buildC5ContestPerformance(record: ContestRecord): ContestPerformanceDTO {
  const gameDetails: GamePerformanceDetail[] = [];
  const hitsArray: number[] = [];

  const auth = getAuthoritativeHits(record);
  if (auth.valid) {
    for (let i = 0; i < record.games.length; i++) {
      const hits = auth.hits[i];
      hitsArray.push(hits);
      gameDetails.push({
        gameIndex: i + 1,
        game: record.games[i],
        hits,
      });
    }
  } else {
    // Dados inválidos ou ausentes: nunca herda cegamente gameHits sem validação
    const gamesCount = Array.isArray(record.games) ? record.games.length : 0;
    for (let i = 0; i < gamesCount; i++) {
      hitsArray.push(0);
      gameDetails.push({
        gameIndex: i + 1,
        game: record.games[i] || [],
        hits: 0,
      });
    }
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
 * Filtra exclusivamente registros canônicos C5-Memory (2.0.0 e 2.1.0),
 * isolando por padrão quaisquer dados de demonstração (isDemo === true).
 */
export function filterC5MemoryRecords(
  records: readonly ContestRecord[],
  includeDemo = false
): ContestRecord[] {
  return records.filter(r => {
    if (!includeDemo && isRecordFixture(r)) return false;
    return (
      (r.algorithmVersion as string) === "C5-Memory-2.0.0" ||
      (r.algorithmVersion as string) === "C5-Memory-2.1.0"
    );
  });
}

/**
 * Constrói o DTO principal para o Painel C5 (UI-1D)
 */
function _buildC5DashboardInternal(
  records: readonly ContestRecord[],
  currentContestNumber = 3511,
  includeDemo = false
): DashboardDTO {
  const c5Records = filterC5MemoryRecords(records, includeDemo);

  // Ordena por concurso crescente
  const sorted = [...c5Records].sort((a, b) => a.contestNumber - b.contestNumber);

  const resolvedContestNumber = typeof currentContestNumber === "number" && !Number.isNaN(currentContestNumber)
    ? currentContestNumber
    : (sorted.length > 0 ? sorted[sorted.length - 1].contestNumber : 3511);

  // Localiza registro do concurso atual se houver
  const currentRecord = sorted.find(r => r.contestNumber === resolvedContestNumber);
  const currentStatus = currentRecord ? currentRecord.status : "AVAILABLE";

  // Identifica concursos confirmados (FROZEN ou COMPLETED)
  const confirmed = sorted.filter(r => r.status === "FROZEN" || r.status === "COMPLETED");
  const confirmedContests = confirmed.length;
  const confirmedGames = confirmedContests * 5;

  // Identifica concursos apurados (COMPLETED com acertos autoritativos válidos)
  const completed = sorted.filter(
    r => r.status === "COMPLETED" && getAuthoritativeHits(r).valid
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

  // Cálculos Financeiros Auditáveis (preservação estrita de custos históricos e isolamento de fixtures)
  const productionConfirmed = confirmed.filter(r => !isRecordFixture(r));
  const productionCompleted = completed.filter(r => !isRecordFixture(r));

  const totalCost = productionConfirmed.reduce(
    (acc, r) => acc + (typeof r.totalCost === "number" && r.totalCost > 0 ? r.totalCost : getContestStandardCost(r.contestNumber, r.contestDate)),
    0
  );
  const totalPrize = productionCompleted.reduce(
    (acc, r) => acc + calculateContestPrize(r),
    0
  );
  const netBalance = totalPrize - totalCost;
  const roiPercentage = totalCost > 0 ? ((totalPrize - totalCost) / totalCost) * 100 : 0;

  // P0.1: Separação estrita dos valores oficiais da Caixa e entradas manuais
  const officialTotalPrize = productionCompleted.reduce(
    (acc, r) => acc + calculateContestOfficialPrize(r),
    0
  );
  const officialNetBalance = officialTotalPrize - totalCost;
  const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;

  let manualConfirmedPrize = 0;
  let manualInformedPrize = 0;
  let officialValidatedPrize = 0;
  for (const r of productionCompleted) {
    const fin = calculateContestFinancialBreakdown(r);
    manualConfirmedPrize += fin.manualConfirmedPrize;
    manualInformedPrize += fin.manualInformedPrize;
    officialValidatedPrize += fin.officialValidatedPrize;
  }
  
  // P1 (Oitava Rodada): Concursos PENDING_HOMOLOGATION NÃO são contados como vitórias confirmadas
  const winningContestsCount = productionCompleted.filter(r => {
    if (r.financialStatus === "PENDING_HOMOLOGATION") return false;
    if (r.financialStatus !== "HOMOLOGATED" && (r.resultConfirmed !== true || !isHumanConferenceValid(r))) return false;
    const best = typeof r.bestHits === "number" ? r.bestHits : buildC5ContestPerformance(r).bestHits;
    return best >= 11;
  }).length;

  // Indicador separado para acertos provisórios de concursos pendentes de homologação
  const provisionalWinningContestsCount = sorted
    .filter(r => !isRecordFixture(r) && r.financialStatus === "PENDING_HOMOLOGATION")
    .filter(r => {
      const provHits = getProvisionalHits(r);
      if (provHits) {
        return provHits.some(h => h >= 11);
      }
      return (r.bestHits ?? 0) >= 11;
    }).length;

  // Verificação de Rateio Oficial Pendente em faixas variáveis (14 e 15) em concursos homologados
  const pendingRateioContests = productionCompleted.filter(r => isContestPendingVariableRateio(r));
  const hasPendingVariableRateio = pendingRateioContests.length > 0;
  const pendingRateioContestsCount = pendingRateioContests.length;

  // Verificação de Rateio Provisório em faixas variáveis (14 e 15) em concursos pendentes de homologação
  const provisionalPendingRateioContests = sorted
    .filter(r => !isRecordFixture(r) && r.financialStatus === "PENDING_HOMOLOGATION")
    .filter(isContestPendingProvisionalRateio);
  const hasProvisionalVariableRateio = provisionalPendingRateioContests.length > 0;
  const provisionalPendingRateioContestsCount = provisionalPendingRateioContests.length;

  return {
    currentContestNumber: resolvedContestNumber,
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
    totalCost,
    totalPrize,
    officialTotalPrize,
    officialNetBalance,
    officialRoiPercentage,
    manualConfirmedPrize,
    manualInformedPrize,
    officialValidatedPrize,
    netBalance,
    roiPercentage,
    winningContestsCount,
    provisionalWinningContestsCount,
    hasPendingVariableRateio,
    pendingRateioContestsCount,
    hasProvisionalVariableRateio,
    provisionalPendingRateioContestsCount,
  };
}

/**
 * P0.1 (Décima Segunda Rodada):
 * Construtor de dashboard de produção.
 * Bloqueia estritamente qualquer injeção de registros de prova na interface e no runtime produtivo.
 */
export function buildC5Dashboard(
  records: readonly ContestRecord[],
  currentContestNumber?: number,
  includeDemo = false
): DashboardDTO {
  return _buildC5DashboardInternal(records, currentContestNumber, includeDemo);
}

/**
 * Constrói o Relatório Mensal para o período informado (ano e mês 1..12)
 * Respeita a cardinalidade REAL dos dados (sem hardcodar 24 concursos).
 */
function _buildC5MonthlyReportInternal(
  records: readonly ContestRecord[],
  year: number,
  month: number,
  includeDemo = false
): MonthlyReportDTO {
  const c5Records = filterC5MemoryRecords(records, includeDemo);
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
    r => r.status === "COMPLETED" && getAuthoritativeHits(r).valid
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

    const rowCost = typeof rec.totalCost === "number" && rec.totalCost > 0
      ? rec.totalCost
      : getContestStandardCost(rec.contestNumber, rec.contestDate);
    const rowPrize = calculateContestPrize(rec);
    const rowNetBalance = rowPrize - rowCost;
    const officialPrize = calculateContestOfficialPrize(rec);
    const rowOfficialNetBalance = officialPrize - rowCost;
    const fin = calculateContestFinancialBreakdown(rec);

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
      cost: rowCost,
      prize: rowPrize,
      officialPrize,
      manualPrize: fin.manualConfirmedPrize,
      netBalance: rowNetBalance,
      officialNetBalance: rowOfficialNetBalance,
      hasPendingVariableRateio: isContestPendingVariableRateio(rec),
      hasProvisionalVariableRateio: isContestPendingProvisionalRateio(rec),
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

  // Cálculos Financeiros Auditáveis (preservação estrita de custos históricos e isolamento de fixtures)
  const productionConfirmed = confirmed.filter(r => !isRecordFixture(r));
  const productionCompleted = completed.filter(r => !isRecordFixture(r));

  const totalCost = productionConfirmed.reduce(
    (acc, r) => acc + (typeof r.totalCost === "number" && r.totalCost > 0 ? r.totalCost : getContestStandardCost(r.contestNumber, r.contestDate)),
    0
  );

  const totalPrize = productionCompleted.reduce(
    (acc, r) => acc + calculateContestPrize(r),
    0
  );
  const netBalance = totalPrize - totalCost;
  const roiPercentage = totalCost > 0 ? ((totalPrize - totalCost) / totalCost) * 100 : 0;

  // P0.1: Separação estrita dos valores oficiais da Caixa e entradas manuais
  const officialTotalPrize = productionCompleted.reduce(
    (acc, r) => acc + calculateContestOfficialPrize(r),
    0
  );
  const officialNetBalance = officialTotalPrize - totalCost;
  const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;

  let manualConfirmedPrize = 0;
  let manualInformedPrize = 0;
  let officialValidatedPrize = 0;
  for (const r of productionCompleted) {
    const fin = calculateContestFinancialBreakdown(r);
    manualConfirmedPrize += fin.manualConfirmedPrize;
    manualInformedPrize += fin.manualInformedPrize;
    officialValidatedPrize += fin.officialValidatedPrize;
  }
  
  // P1 (Oitava Rodada): Concursos PENDING_HOMOLOGATION NÃO são contados como vitórias confirmadas
  const winningContestsCount = productionCompleted.filter(r => {
    if (r.financialStatus === "PENDING_HOMOLOGATION") return false;
    if (r.financialStatus !== "HOMOLOGATED" && (r.resultConfirmed !== true || !isHumanConferenceValid(r))) return false;
    const best = typeof r.bestHits === "number" ? r.bestHits : buildC5ContestPerformance(r).bestHits;
    return best >= 11;
  }).length;

  // Indicador separado para acertos provisórios no relatório mensal
  const provisionalWinningContestsCount = monthRecords
    .filter(r => !isRecordFixture(r) && r.financialStatus === "PENDING_HOMOLOGATION")
    .filter(r => {
      const provHits = getProvisionalHits(r);
      if (provHits) {
        return provHits.some(h => h >= 11);
      }
      return (r.bestHits ?? 0) >= 11;
    }).length;

  const pendingRateioContests = productionCompleted.filter(r => isContestPendingVariableRateio(r));
  const hasPendingVariableRateio = pendingRateioContests.length > 0;
  const pendingRateioContestsCount = pendingRateioContests.length;

  const provisionalPendingRateioContests = monthRecords
    .filter(r => !isRecordFixture(r) && r.financialStatus === "PENDING_HOMOLOGATION")
    .filter(isContestPendingProvisionalRateio);
  const hasProvisionalVariableRateio = provisionalPendingRateioContests.length > 0;
  const provisionalPendingRateioContestsCount = provisionalPendingRateioContests.length;

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
    totalCost,
    totalPrize,
    officialTotalPrize,
    officialNetBalance,
    officialRoiPercentage,
    manualConfirmedPrize,
    manualInformedPrize,
    officialValidatedPrize,
    netBalance,
    roiPercentage,
    winningContestsCount,
    provisionalWinningContestsCount,
    hasPendingVariableRateio,
    pendingRateioContestsCount,
    hasProvisionalVariableRateio,
    provisionalPendingRateioContestsCount,
  };
}

/**
 * P0.1 (Décima Segunda Rodada):
 * Construtor do Relatório Mensal de produção sem customRegistry.
 */
export function buildC5MonthlyReport(
  records: readonly ContestRecord[],
  year: number,
  month: number,
  includeDemo = false
): MonthlyReportDTO {
  return _buildC5MonthlyReportInternal(records, year, month, includeDemo);
}
