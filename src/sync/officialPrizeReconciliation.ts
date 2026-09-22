/**
 * V1.9 — Referência Oficial de Premiação e Reconciliação Financeira.
 *
 * Módulo puro de domínio para derivação de premiação esperada segundo
 * a referência oficial da CAIXA e reconciliação entre o valor esperado
 * e o valor manual registrado pelo usuário (PrizeRecord).
 *
 * REGRAS CANÔNICAS:
 * 1. 100% puro e determinístico: ZERO rede, ZERO persistência, ZERO mutação.
 * 2. Somente inteiros em centavos (Number.isSafeInteger).
 * 3. Total separação entre C5Score, PrizeRecord e OfficialPrizeReference.
 * 4. R$ 0,00 na referência NUNCA cria PrizeRecord automaticamente.
 * 5. MISMATCH significa somente divergência de valores (sem rotular como erro do usuário).
 */

import type { C5Score, PrizeRecord } from "../c5/types.ts";
import type {
  PrizeHits,
  OfficialPrizeTier,
  OfficialPrizeReference,
} from "../lottery/types.ts";

export type { PrizeHits, OfficialPrizeTier, OfficialPrizeReference };

/**
 * Detalhamento da premiação calculada para uma faixa específica (11 a 15 acertos).
 */
export interface ExpectedPrizeBreakdown {
  hits: PrizeHits;
  winningTickets: number;
  awardedGamesCount: number;
  prizePerWinnerCents: number;
  subtotalCents: number;
}

/**
 * Premiação total esperada calculada para os 5 jogos C5 com base na referência oficial da CAIXA.
 */
export interface ExpectedPrize {
  totalCents: number;
  breakdown: readonly ExpectedPrizeBreakdown[];
}

/**
 * Status de reconciliação financeira entre referência oficial CAIXA e registro manual.
 */
export type FinancialReconciliationStatus =
  | "REFERENCE_UNAVAILABLE"
  | "PENDING_MANUAL_RECORD"
  | "MATCH"
  | "MISMATCH";

/**
 * Resultado da reconciliação financeira entre referência CAIXA e PrizeRecord manual.
 */
export interface OfficialFinancialReconciliation {
  status: FinancialReconciliationStatus;
  expectedPrizeCents?: number | null;
  recordedPrizeCents?: number | null;
  differenceCents?: number | null;
  breakdown?: readonly ExpectedPrizeBreakdown[];
}

const HITS_CANONICAL_ORDER: readonly PrizeHits[] = [11, 12, 13, 14, 15] as const;

/**
 * Deriva a premiação esperada para os 5 jogos do C5Score com base na referência oficial da CAIXA.
 *
 * subtotal = quantidade de jogos C5 naquela faixa × prêmio CAIXA por ganhador
 * total = subtotal(11) + subtotal(12) + subtotal(13) + subtotal(14) + subtotal(15)
 *
 * Todas as operações usam exclusivamente centavos inteiros seguros.
 */
export function deriveExpectedPrize(
  score: C5Score,
  reference: OfficialPrizeReference
): ExpectedPrize {
  const tiersByHit = new Map<PrizeHits, OfficialPrizeTier>();
  for (const tier of reference.tiers) {
    tiersByHit.set(tier.hits, tier);
  }

  const breakdown: ExpectedPrizeBreakdown[] = [];
  let totalCents = 0;

  for (const hits of HITS_CANONICAL_ORDER) {
    let winningTickets = 0;
    if (score.prizeCounts) {
      if (hits === 11) winningTickets = score.prizeCounts.hits11 ?? 0;
      else if (hits === 12) winningTickets = score.prizeCounts.hits12 ?? 0;
      else if (hits === 13) winningTickets = score.prizeCounts.hits13 ?? 0;
      else if (hits === 14) winningTickets = score.prizeCounts.hits14 ?? 0;
      else if (hits === 15) winningTickets = score.prizeCounts.hits15 ?? 0;
    }

    const tier = tiersByHit.get(hits);
    const prizePerWinnerCents = tier ? tier.prizePerWinnerCents : 0;
    const subtotalCents = winningTickets * prizePerWinnerCents;

    if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
      throw new Error(
        `Aritmética inválida no cálculo de premiação para a faixa de ${hits} acertos.`
      );
    }

    totalCents += subtotalCents;
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
      throw new Error("Aritmética inválida no somatório total da premiação esperada.");
    }

    breakdown.push({
      hits,
      winningTickets,
      awardedGamesCount: winningTickets,
      prizePerWinnerCents,
      subtotalCents,
    });
  }

  return {
    totalCents,
    breakdown,
  };
}

/**
 * Compara a premiação calculada via referência oficial CAIXA com o registro manual do usuário.
 *
 * Regras:
 * - Sem referência -> REFERENCE_UNAVAILABLE
 * - Referência presente + PrizeRecord ausente -> PENDING_MANUAL_RECORD
 * - Referência presente + PrizeRecord presente + valores iguais -> MATCH
 * - Referência presente + PrizeRecord presente + valores diferentes -> MISMATCH
 *
 * differenceCents = recordedPrizeCents - expectedPrizeCents
 * (positivo = manual maior; negativo = manual menor; zero = MATCH)
 */
export function deriveFinancialReconciliation(
  score: C5Score,
  prize: PrizeRecord | undefined,
  reference: OfficialPrizeReference | undefined
): OfficialFinancialReconciliation {
  if (!reference) {
    return {
      status: "REFERENCE_UNAVAILABLE",
      expectedPrizeCents: null,
      recordedPrizeCents: prize?.amountCents ?? null,
      differenceCents: null,
    };
  }

  const expected = deriveExpectedPrize(score, reference);

  if (!prize) {
    return {
      status: "PENDING_MANUAL_RECORD",
      expectedPrizeCents: expected.totalCents,
      recordedPrizeCents: null,
      differenceCents: null,
      breakdown: expected.breakdown,
    };
  }

  const recordedPrizeCents = prize.amountCents;
  const differenceCents = recordedPrizeCents - expected.totalCents;

  if (differenceCents === 0) {
    return {
      status: "MATCH",
      expectedPrizeCents: expected.totalCents,
      recordedPrizeCents,
      differenceCents: 0,
      breakdown: expected.breakdown,
    };
  }

  return {
    status: "MISMATCH",
    expectedPrizeCents: expected.totalCents,
    recordedPrizeCents,
    differenceCents,
    breakdown: expected.breakdown,
  };
}
