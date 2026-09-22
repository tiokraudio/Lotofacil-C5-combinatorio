/**
 * ===============================================================================
 * SUÍTE DE TESTES DA V1.9: REFERÊNCIA OFICIAL DE PREMIAÇÃO E RECONCILIAÇÃO FINANCEIRA
 * Arquivo: src/tests/officialPrizeReconciliation.test.ts
 *
 * Cobertura Completa dos 32 Cenários Canônicos da V1.9:
 *  1. adapter extrai e normaliza corretamente as 5 faixas a partir de listaRateioPremio válida da CAIXA
 *  2. ordenação canônica decrescente (15, 14, 13, 12, 11) preservada pelo adapter
 *  3. conversão monetária BRL da CAIXA para centavos inteiros com precisão estrita (R$ 6,00 -> 600, R$ 12,00 -> 1200, decimais quebrados tratados com Math.round)
 *  4. listaRateioPremio ausente no payload resulta em prizeReference undefined (sem erro fatal)
 *  5. listaRateioPremio com quantidade de faixas diferente de 5 é rejeitada pelo validador
 *  6. listaRateioPremio com faixas repetidas ou fora de [11..15] é rejeitada pelo validador
 *  7. número de ganhadores negativo ou não-inteiro é rejeitado
 *  8. valor de prêmio negativo ou não-inteiro em centavos é rejeitado
 *  9. campo source diferente de "CAIXA" é rejeitado
 * 10. cálculo de expectedPrize com zero acertos premiados retorna 0 centavos e breakdown zerado
 * 11. cálculo de expectedPrize com múltiplos jogos premiados em faixas fixas (11, 12, 13) soma corretamente os valores
 * 12. cálculo de expectedPrize com premiação em faixa variável (14 acertos) utiliza a cota unitária da CAIXA multiplicada pela quantidade de jogos premiados
 * 13. cálculo de expectedPrize com prêmio acumulado na faixa 15 acertos (ganhadores = 0, valor = 0) reflete cota 0 para o usuário
 * 14. deriveFinancialReconciliation retorna PENDING_MANUAL_RECORD quando prizeRecord está ausente
 * 15. deriveFinancialReconciliation retorna MATCH quando expectedPrize == prizeRecord.amountCents
 * 16. deriveFinancialReconciliation retorna MISMATCH com diferença positiva quando prizeRecord > expectedPrize
 * 17. deriveFinancialReconciliation retorna MISMATCH com diferença negativa quando prizeRecord < expectedPrize
 * 18. deriveFinancialReconciliation com zero acertos e prizeRecord = 0 resulta em MATCH
 * 19. deriveFinancialReconciliation com zero acertos e prizeRecord > 0 resulta em MISMATCH
 * 20. provider armazena prizeReference no cache de sessão na primeira consulta
 * 21. segunda chamada a getContest retorna a referência em cache sem requisição de rede
 * 22. refreshContest ignora o cache de sessão, realiza nova requisição e atualiza o cache
 * 23. refreshContest concorrente: duas chamadas simultâneas, a mais recente iniciada vence na atualização do cache (latest-started-wins)
 * 24. falha de rede no refreshContest preserva o snapshot anterior no cache de sessão
 * 25. OfficialPrizeReference não é incluída no FrozenC5Payload (verificação de isolamento do hash SHA-256)
 * 26. OfficialPrizeReference não é persistida no ContestRecord do IndexedDB
 * 27. PrizeRecord permanece estritamente manual (source: "MANUAL", sem campo "CAIXA")
 * 28. UI exibe o badge "REFERÊNCIA CAIXA" quando a referência está carregada
 * 29. UI exibe as 5 faixas normalizadas com valores formatados em Real
 * 30. UI exibe a reconciliação (MATCH / MISMATCH / PENDING) sem botão de autocorreção
 * 31. UI: acionamento do botão Refresh chama refreshContest e atualiza a exibição
 * 32. UI: em caso de erro no Refresh, a UI exibe mensagem de falha mas mantém os dados da referência anterior visíveis
 * ===============================================================================
 */

import "./setupDom.ts";
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { adaptCaixaRawPayload, CaixaLotteryProvider } from "../lottery/caixaProvider.ts";
import {
  assertValidOfficialResult,
  validateAndNormalizeOfficialPrizeReference,
} from "../lottery/validator.ts";
import {
  deriveExpectedPrize,
  deriveFinancialReconciliation,
} from "../sync/officialPrizeReconciliation.ts";
import {
  OfficialContestResult,
  OfficialPrizeReference,
  OfficialPrizeTier,
} from "../lottery/types.ts";
import type { C5Score, ContestRecord, PrizeRecord, HitCount, GameScore } from "../c5/types.ts";
import {
  buildCanonicalPayload,
  serializeCanonicalPayload,
  computeSHA256,
  verifyContestIntegrity,
} from "../c5/integrity.ts";
import { createContestDraft, freezeContestRecord } from "../c5/record.ts";
import { ContestRepository } from "../storage/contestRepository.ts";
import { OfficialPrizeReconciliationPanel } from "../components/OfficialPrizeReconciliationPanel.tsx";
import { formatBRLFromCents } from "../utils/money.ts";

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string): void {
  total++;
  if (!condition) {
    console.error(`❌ FALHA [Cenário ${total}]: ${msg}`);
    throw new Error(`Falha no teste: ${msg}`);
  }
  passed++;
  console.log(`✅ OK [Cenário ${total}]: ${msg}`);
}

function createSampleRawCaixa(overrides: Partial<any> = {}): any {
  return {
    numero: 3100,
    dataApuracao: "20/05/2024",
    dezenasSorteadasOrdemSorteio: [
      "01", "02", "03", "04", "05",
      "06", "07", "08", "09", "10",
      "11", "12", "13", "14", "15",
    ],
    listaRateioPremio: [
      { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 2, valorPremio: 1500000.5 },
      { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 240, valorPremio: 1520.45 },
      { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 8500, valorPremio: 30.0 },
      { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 110000, valorPremio: 12.0 },
      { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 650000, valorPremio: 6.0 },
    ],
    ...overrides,
  };
}

function createSampleReference(contestNumber = 3100): OfficialPrizeReference {
  return {
    contestNumber,
    fetchedAt: "2024-05-20T21:00:00.000Z",
    source: "CAIXA",
    tiers: [
      { hits: 15, winners: 2, prizePerWinnerCents: 150000050 },
      { hits: 14, winners: 240, prizePerWinnerCents: 152045 },
      { hits: 13, winners: 8500, prizePerWinnerCents: 3000 },
      { hits: 12, winners: 110000, prizePerWinnerCents: 1200 },
      { hits: 11, winners: 650000, prizePerWinnerCents: 600 },
    ],
  };
}

function createSampleScore(hitsPerGame: [HitCount, HitCount, HitCount, HitCount, HitCount]): C5Score {
  const prizeCounts = {
    hits15: hitsPerGame.filter((h) => h === 15).length,
    hits14: hitsPerGame.filter((h) => h === 14).length,
    hits13: hitsPerGame.filter((h) => h === 13).length,
    hits12: hitsPerGame.filter((h) => h === 12).length,
    hits11: hitsPerGame.filter((h) => h === 11).length,
  };
  const maxHits = Math.max(...hitsPerGame) as HitCount;
  return {
    result: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    games: [
      { gameIndex: 1, hits: hitsPerGame[0], matchedNumbers: [], missedNumbers: [] },
      { gameIndex: 2, hits: hitsPerGame[1], matchedNumbers: [], missedNumbers: [] },
      { gameIndex: 3, hits: hitsPerGame[2], matchedNumbers: [], missedNumbers: [] },
      { gameIndex: 4, hits: hitsPerGame[3], matchedNumbers: [], missedNumbers: [] },
      { gameIndex: 5, hits: hitsPerGame[4], matchedNumbers: [], missedNumbers: [] },
    ],
    maxHits,
    bestGameIndexes: [1],
    prizeCounts,
    has11Plus: maxHits >= 11,
    has12Plus: maxHits >= 12,
    has13Plus: maxHits >= 13,
    has14Plus: maxHits >= 14,
    has15: maxHits === 15,
  };
}

async function runTests() {
  console.log("===============================================================================");
  console.log("INICIANDO SUÍTE V1.9: REFERÊNCIA OFICIAL DE PREMIAÇÃO E RECONCILIAÇÃO");
  console.log("===============================================================================");

  // ---------------------------------------------------------------------------
  // CENÁRIO 1: Adapter extrai e normaliza corretamente as 5 faixas
  // ---------------------------------------------------------------------------
  {
    const raw = createSampleRawCaixa();
    const adapted = adaptCaixaRawPayload(raw) as any;
    assert(
      adapted.prizeReference !== undefined &&
      adapted.prizeReference.contestNumber === 3100 &&
      adapted.prizeReference.source === "CAIXA" &&
      adapted.prizeReference.tiers.length === 5,
      "CENÁRIO 1: Adapter extrai e normaliza corretamente as 5 faixas a partir de listaRateioPremio válida"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 2: Ordenação canônica decrescente (15, 14, 13, 12, 11)
  // ---------------------------------------------------------------------------
  {
    // Embaralha as faixas no payload
    const shuffledRaw = createSampleRawCaixa({
      listaRateioPremio: [
        { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 110000, valorPremio: 12.0 },
        { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 2, valorPremio: 1500000.5 },
        { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 650000, valorPremio: 6.0 },
        { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 8500, valorPremio: 30.0 },
        { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 240, valorPremio: 1520.45 },
      ],
    });
    const adapted = adaptCaixaRawPayload(shuffledRaw) as any;
    const hitsOrder = adapted.prizeReference!.tiers.map((t: any) => t.hits);
    assert(
      JSON.stringify(hitsOrder) === JSON.stringify([15, 14, 13, 12, 11]),
      "CENÁRIO 2: Ordenação canônica decrescente (15, 14, 13, 12, 11) preservada pelo adapter"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 3: Conversão monetária BRL para centavos inteiros com precisão estrita
  // ---------------------------------------------------------------------------
  {
    const raw = createSampleRawCaixa({
      listaRateioPremio: [
        { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 1, valorPremio: 1234567.89 },
        { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 10, valorPremio: 1234.56 },
        { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 100, valorPremio: 30.0 },
        { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 1000, valorPremio: 12.0 },
        { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 10000, valorPremio: 6.0 },
      ],
    });
    const adapted = adaptCaixaRawPayload(raw) as any;
    const t15 = adapted.prizeReference!.tiers.find((t: any) => t.hits === 15)!;
    const t14 = adapted.prizeReference!.tiers.find((t: any) => t.hits === 14)!;
    const t13 = adapted.prizeReference!.tiers.find((t: any) => t.hits === 13)!;
    const t12 = adapted.prizeReference!.tiers.find((t: any) => t.hits === 12)!;
    const t11 = adapted.prizeReference!.tiers.find((t: any) => t.hits === 11)!;

    assert(
      t15.prizePerWinnerCents === 123456789 &&
      t14.prizePerWinnerCents === 123456 &&
      t13.prizePerWinnerCents === 3000 &&
      t12.prizePerWinnerCents === 1200 &&
      t11.prizePerWinnerCents === 600,
      "CENÁRIO 3: Conversão monetária BRL da CAIXA para centavos inteiros com precisão estrita"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 4: listaRateioPremio ausente no payload resulta em prizeReference undefined
  // ---------------------------------------------------------------------------
  {
    const raw = createSampleRawCaixa();
    delete raw.listaRateioPremio;
    const adapted = adaptCaixaRawPayload(raw) as any;
    assert(
      adapted.prizeReference === undefined,
      "CENÁRIO 4: listaRateioPremio ausente no payload resulta em prizeReference undefined (sem erro fatal)"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 5: Quantidade de faixas diferente de 5 é rejeitada pelo validador
  // ---------------------------------------------------------------------------
  {
    let caught = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 15, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
          ], // Somente 4 faixas
        },
        3100
      );
    } catch {
      caught = true;
    }
    assert(
      caught,
      "CENÁRIO 5: listaRateioPremio com quantidade de faixas diferente de 5 é rejeitada pelo validador"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 6: Faixas repetidas ou fora de [11..15] rejeitadas
  // ---------------------------------------------------------------------------
  {
    let caughtRepetition = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 15, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 15, winners: 1, prizePerWinnerCents: 1000 }, // duplicado
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtRepetition = true;
    }

    let caughtOutOfRange = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 16, winners: 1, prizePerWinnerCents: 1000 }, // fora
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtOutOfRange = true;
    }

    assert(
      caughtRepetition && caughtOutOfRange,
      "CENÁRIO 6: listaRateioPremio com faixas repetidas ou fora de [11..15] é rejeitada pelo validador"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 7: Ganhadores negativo ou não-inteiro rejeitado
  // ---------------------------------------------------------------------------
  {
    let caughtNegative = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 15, winners: -1, prizePerWinnerCents: 1000 },
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtNegative = true;
    }

    let caughtFloat = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 15, winners: 1.5, prizePerWinnerCents: 1000 },
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtFloat = true;
    }

    assert(
      caughtNegative && caughtFloat,
      "CENÁRIO 7: número de ganhadores negativo ou não-inteiro é rejeitado"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 8: Valor de prêmio negativo ou não-inteiro em centavos é rejeitado
  // ---------------------------------------------------------------------------
  {
    let caughtNegative = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 15, winners: 1, prizePerWinnerCents: -500 },
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtNegative = true;
    }

    let caughtFloat = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "CAIXA",
          tiers: [
            { hits: 15, winners: 1, prizePerWinnerCents: 500.25 },
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtFloat = true;
    }

    assert(
      caughtNegative && caughtFloat,
      "CENÁRIO 8: valor de prêmio negativo ou não-inteiro em centavos é rejeitado"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 9: Campo source diferente de "CAIXA" é rejeitado
  // ---------------------------------------------------------------------------
  {
    let caughtSource = false;
    try {
      validateAndNormalizeOfficialPrizeReference(
        {
          contestNumber: 3100,
          fetchedAt: new Date().toISOString(),
          source: "MANUAL" as any, // Deve ser exclusivamente "CAIXA"
          tiers: [
            { hits: 15, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 14, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 13, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 12, winners: 1, prizePerWinnerCents: 1000 },
            { hits: 11, winners: 1, prizePerWinnerCents: 1000 },
          ],
        },
        3100
      );
    } catch {
      caughtSource = true;
    }
    assert(
      caughtSource,
      "CENÁRIO 9: campo source diferente de 'CAIXA' é rejeitado"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 10: expectedPrize com zero acertos premiados retorna 0 centavos e breakdown zerado
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([9, 10, 8, 10, 7]);
    const expected = deriveExpectedPrize(score, ref);
    assert(
      expected.totalCents === 0 &&
      expected.breakdown.every((b) => b.awardedGamesCount === 0 && b.subtotalCents === 0),
      "CENÁRIO 10: cálculo de expectedPrize com zero acertos premiados retorna 0 centavos e breakdown zerado"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 11: Múltiplos jogos premiados em faixas fixas (11, 12, 13) soma corretamente
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    // 2 jogos de 11 (2 * 600 = 1200) + 1 jogo de 12 (1200) + 1 jogo de 13 (3000) + 1 jogo de 9 (0)
    // Total esperado: 1200 + 1200 + 3000 = 5400 centavos
    const score = createSampleScore([11, 11, 12, 13, 9]);
    const expected = deriveExpectedPrize(score, ref);
    assert(
      expected.totalCents === 5400,
      "CENÁRIO 11: cálculo de expectedPrize com múltiplos jogos premiados em faixas fixas (11, 12, 13) soma corretamente os valores"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 12: Premiação em faixa variável (14 acertos) utiliza cota unitária da CAIXA
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    // 1 jogo com 14 acertos (cota 152045) + 1 jogo com 11 (600) + 3 jogos sem prêmio
    // Total: 152045 + 600 = 152645 centavos
    const score = createSampleScore([14, 11, 9, 8, 10]);
    const expected = deriveExpectedPrize(score, ref);
    assert(
      expected.totalCents === 152645,
      "CENÁRIO 12: cálculo de expectedPrize com premiação em faixa variável (14 acertos) utiliza a cota unitária da CAIXA multiplicada pela quantidade de jogos premiados"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 13: Faixa 15 acertos acumulada (ganhadores = 0, valor = 0) reflete cota 0
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    // Modifica faixa 15 para acumulada (0 ganhadores, 0 valor por ganhador)
    const t15 = ref.tiers.find((t) => t.hits === 15)!;
    t15.winners = 0;
    t15.prizePerWinnerCents = 0;

    const score = createSampleScore([15, 9, 9, 9, 9]);
    const expected = deriveExpectedPrize(score, ref);
    assert(
      expected.totalCents === 0,
      "CENÁRIO 13: cálculo de expectedPrize com prêmio acumulado na faixa 15 acertos (ganhadores = 0, valor = 0) reflete cota 0 para o usuário"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 14: deriveFinancialReconciliation retorna PENDING_MANUAL_RECORD quando prizeRecord está ausente
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([11, 12, 9, 8, 10]);
    const rec = deriveFinancialReconciliation(score, undefined, ref);
    assert(
      rec.status === "PENDING_MANUAL_RECORD" &&
      rec.expectedPrizeCents === 1800 &&
      rec.recordedPrizeCents === null &&
      rec.differenceCents === null,
      "CENÁRIO 14: deriveFinancialReconciliation retorna PENDING_MANUAL_RECORD quando prizeRecord está ausente"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 15: deriveFinancialReconciliation retorna MATCH quando expectedPrize == prizeRecord.amountCents
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([11, 12, 9, 8, 10]); // 600 + 1200 = 1800 centavos
    const prize: PrizeRecord = {
      amountCents: 1800,
      recordedAt: new Date().toISOString(),
      source: "MANUAL",
    };
    const rec = deriveFinancialReconciliation(score, prize, ref);
    assert(
      rec.status === "MATCH" &&
      rec.expectedPrizeCents === 1800 &&
      rec.recordedPrizeCents === 1800 &&
      rec.differenceCents === 0,
      "CENÁRIO 15: deriveFinancialReconciliation retorna MATCH quando expectedPrize == prizeRecord.amountCents"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 16: deriveFinancialReconciliation retorna MISMATCH com diferença positiva quando prizeRecord > expectedPrize
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([11, 12, 9, 8, 10]); // expected: 1800 centavos
    const prize: PrizeRecord = {
      amountCents: 2000,
      recordedAt: new Date().toISOString(),
      source: "MANUAL",
    };
    const rec = deriveFinancialReconciliation(score, prize, ref);
    assert(
      rec.status === "MISMATCH" &&
      rec.differenceCents === 200, // 2000 - 1800 = +200
      "CENÁRIO 16: deriveFinancialReconciliation retorna MISMATCH com diferença positiva quando prizeRecord > expectedPrize"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 17: deriveFinancialReconciliation retorna MISMATCH com diferença negativa quando prizeRecord < expectedPrize
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([11, 12, 9, 8, 10]); // expected: 1800 centavos
    const prize: PrizeRecord = {
      amountCents: 1200,
      recordedAt: new Date().toISOString(),
      source: "MANUAL",
    };
    const rec = deriveFinancialReconciliation(score, prize, ref);
    assert(
      rec.status === "MISMATCH" &&
      rec.differenceCents === -600, // 1200 - 1800 = -600
      "CENÁRIO 17: deriveFinancialReconciliation retorna MISMATCH com diferença negativa quando prizeRecord < expectedPrize"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 18: deriveFinancialReconciliation com zero acertos e prizeRecord = 0 resulta em MATCH
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([8, 9, 10, 8, 7]); // expected: 0
    const prize: PrizeRecord = {
      amountCents: 0,
      recordedAt: new Date().toISOString(),
      source: "MANUAL",
    };
    const rec = deriveFinancialReconciliation(score, prize, ref);
    assert(
      rec.status === "MATCH" &&
      rec.expectedPrizeCents === 0 &&
      rec.recordedPrizeCents === 0 &&
      rec.differenceCents === 0,
      "CENÁRIO 18: deriveFinancialReconciliation com zero acertos e prizeRecord = 0 resulta em MATCH"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 19: deriveFinancialReconciliation com zero acertos e prizeRecord > 0 resulta em MISMATCH
  // ---------------------------------------------------------------------------
  {
    const ref = createSampleReference();
    const score = createSampleScore([8, 9, 10, 8, 7]); // expected: 0
    const prize: PrizeRecord = {
      amountCents: 500,
      recordedAt: new Date().toISOString(),
      source: "MANUAL",
    };
    const rec = deriveFinancialReconciliation(score, prize, ref);
    assert(
      rec.status === "MISMATCH" &&
      rec.expectedPrizeCents === 0 &&
      rec.recordedPrizeCents === 500 &&
      rec.differenceCents === 500,
      "CENÁRIO 19: deriveFinancialReconciliation com zero acertos e prizeRecord > 0 resulta em MISMATCH"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 20: Provider armazena prizeReference no cache de sessão na primeira consulta
  // ---------------------------------------------------------------------------
  {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => createSampleRawCaixa({ numero: 3100 }),
      } as any;
    };
    const provider = new CaixaLotteryProvider({ fetchFn: mockFetch });
    const res = await provider.getContest(3100);
    assert(
      fetchCount === 1 && res.prizeReference !== undefined,
      "CENÁRIO 20: Provider armazena prizeReference no cache de sessão na primeira consulta"
    );

    // ---------------------------------------------------------------------------
    // CENÁRIO 21: Segunda chamada a getContest retorna a referência em cache sem requisição de rede
    // ---------------------------------------------------------------------------
    const res2 = await provider.getContest(3100);
    assert(
      fetchCount === 1 && res2.prizeReference?.contestNumber === 3100,
      "CENÁRIO 21: Segunda chamada a getContest retorna a referência em cache sem requisição de rede"
    );

    // ---------------------------------------------------------------------------
    // CENÁRIO 22: refreshContest ignora o cache de sessão, realiza nova requisição e atualiza o cache
    // ---------------------------------------------------------------------------
    const res3 = await provider.refreshContest(3100);
    assert(
      fetchCount === 2 && res3.prizeReference?.contestNumber === 3100,
      "CENÁRIO 22: refreshContest ignora o cache de sessão, realiza nova requisição e atualiza o cache"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 23: refreshContest concorrente (latest-started-wins)
  // ---------------------------------------------------------------------------
  {
    // Criamos duas respostas com atrasos invertidos:
    // Req 1 (iniciada primeiro): atraso 50ms, retorna 1 ganhador na faixa 15
    // Req 2 (iniciada depois): atraso 10ms, retorna 5 ganhadores na faixa 15
    let reqIndex = 0;
    const mockFetch = async () => {
      reqIndex++;
      const currentReq = reqIndex;
      if (currentReq === 1) {
        await new Promise((r) => setTimeout(r, 60));
        return {
          ok: true,
          status: 200,
          json: async () =>
            createSampleRawCaixa({
              numero: 3101,
              listaRateioPremio: [
                { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
              ],
            }),
        } as any;
      } else {
        await new Promise((r) => setTimeout(r, 10));
        return {
          ok: true,
          status: 200,
          json: async () =>
            createSampleRawCaixa({
              numero: 3101,
              listaRateioPremio: [
                { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 5, valorPremio: 1000 },
                { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
                { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
              ],
            }),
        } as any;
      }
    };

    const provider = new CaixaLotteryProvider({ fetchFn: mockFetch });
    const p1 = provider.refreshContest(3101);
    const p2 = provider.refreshContest(3101);

    await Promise.all([p1, p2]);
    // Cache agora deve ter 5 ganhadores (Req 2 iniciada por último)
    const cached = await provider.getContest(3101);
    const winners15 = cached.prizeReference?.tiers.find((t) => t.hits === 15)?.winners;
    assert(
      winners15 === 5,
      "CENÁRIO 23: refreshContest concorrente: a mais recente iniciada vence na atualização do cache (latest-started-wins)"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 24: Falha de rede no refreshContest preserva snapshot anterior no cache
  // ---------------------------------------------------------------------------
  {
    let shouldFail = false;
    const mockFetch = async () => {
      if (shouldFail) {
        throw new Error("Erro de conexão simulado");
      }
      return {
        ok: true,
        status: 200,
        json: async () => createSampleRawCaixa({ numero: 3102 }),
      } as any;
    };

    const provider = new CaixaLotteryProvider({ fetchFn: mockFetch });
    // Consulta inicial com sucesso
    await provider.getContest(3102);

    // Próxima chamada (refresh) falha
    shouldFail = true;
    let refreshFailed = false;
    try {
      await provider.refreshContest(3102);
    } catch {
      refreshFailed = true;
    }

    // Consulta do cache deve manter o snapshot anterior íntegro
    shouldFail = false;
    const cached = await provider.getContest(3102);
    assert(
      refreshFailed && cached.prizeReference?.contestNumber === 3102,
      "CENÁRIO 24: falha de rede no refreshContest preserva o snapshot anterior no cache de sessão"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 25: OfficialPrizeReference não é incluída no FrozenC5Payload (SHA-256 intacto)
  // ---------------------------------------------------------------------------
  {
    const draft = createContestDraft(3100);
    const frozen = await freezeContestRecord(draft);
    const originalHash = frozen.integrityHash;

    // Concurso recebe score e prizeReference volátil
    const scoredRecord: ContestRecord = {
      ...frozen,
      status: "SCORED",
      officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      scoredAt: new Date().toISOString(),
      score: createSampleScore([11, 12, 9, 8, 10]),
    };

    // Recomputamos o FrozenC5Payload a partir do scoredRecord
    const audit = await verifyContestIntegrity(scoredRecord);
    const payload = buildCanonicalPayload(
      scoredRecord.contestNumber,
      scoredRecord.generationId,
      scoredRecord.algorithmVersion,
      scoredRecord.generatedAt,
      scoredRecord.frozenAt!,
      scoredRecord.generation
    );
    const canonicalStr = serializeCanonicalPayload(payload);
    const recomputedHash = await computeSHA256(canonicalStr);
    assert(
      audit.valid &&
      audit.hashMatches &&
      originalHash === recomputedHash &&
      !("prizeReference" in (payload as any)),
      "CENÁRIO 25: OfficialPrizeReference não é incluída no FrozenC5Payload (isolamento do hash SHA-256)"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 26: OfficialPrizeReference não é persistida no ContestRecord do IndexedDB
  // ---------------------------------------------------------------------------
  {
    const fakeIdb = new IDBFactory();
    const repo = new ContestRepository({
      dbName: `c5_test_v19_${Date.now()}`,
      idbFactory: fakeIdb,
    });
    const draft = createContestDraft(3100);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3100);
    await repo.confirmBetPlaced(3100);
    await repo.scoreStoredContest(
      3100,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );

    const reloaded = await repo.getContestRecord(3100);
    assert(
      reloaded !== null && !("prizeReference" in (reloaded as any)),
      "CENÁRIO 26: OfficialPrizeReference não é persistida no ContestRecord do IndexedDB"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 27: PrizeRecord permanece estritamente manual (source: "MANUAL", sem campo "CAIXA")
  // ---------------------------------------------------------------------------
  {
    const fakeIdb = new IDBFactory();
    const repo = new ContestRepository({
      dbName: `c5_test_v19_prize_${Date.now()}`,
      idbFactory: fakeIdb,
    });
    const draft = createContestDraft(3105);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3105);
    await repo.confirmBetPlaced(3105);
    await repo.scoreStoredContest(
      3105,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    const updated = await repo.recordPrize(3105, 1200);
    assert(
      updated.prize !== undefined &&
      updated.prize.source === "MANUAL" &&
      !("caixa" in (updated.prize as any)),
      "CENÁRIO 27: PrizeRecord permanece estritamente manual (source: 'MANUAL', sem campo 'CAIXA')"
    );
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 28: UI exibe o badge "REFERÊNCIA CAIXA" quando a referência está carregada
  // ---------------------------------------------------------------------------
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const ref = createSampleReference(3100);
    const score = createSampleScore([11, 12, 9, 8, 10]);

    await act(async () => {
      root.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3100,
          score,
          initialReference: ref,
        })
      );
    });

    const badge = container.querySelector("#badge-caixa-reference");
    assert(
      badge !== null && badge.textContent?.includes("REFERÊNCIA CAIXA") === true,
      "CENÁRIO 28: UI exibe o badge 'REFERÊNCIA CAIXA' quando a referência está carregada"
    );

    // ---------------------------------------------------------------------------
    // CENÁRIO 29: UI exibe as 5 faixas normalizadas com valores formatados em Real
    // ---------------------------------------------------------------------------
    const t15El = container.querySelector("#tier-hits-15");
    const t14El = container.querySelector("#tier-hits-14");
    const t13El = container.querySelector("#tier-hits-13");
    const t12El = container.querySelector("#tier-hits-12");
    const t11El = container.querySelector("#tier-hits-11");

    assert(
      t15El !== null &&
      t14El !== null &&
      t13El !== null &&
      t12El !== null &&
      t11El !== null &&
      (t11El.textContent?.replace(/\u00a0/g, " ").includes("R$ 6,00") ?? false) &&
      (t12El.textContent?.replace(/\u00a0/g, " ").includes("R$ 12,00") ?? false) &&
      (t13El.textContent?.replace(/\u00a0/g, " ").includes("R$ 30,00") ?? false),
      "CENÁRIO 29: UI exibe as 5 faixas normalizadas com valores formatados em Real"
    );

    // ---------------------------------------------------------------------------
    // CENÁRIO 30: UI exibe a reconciliação sem botão de autocorreção
    // ---------------------------------------------------------------------------
    // Caso A: PENDING_MANUAL
    const pendingMsg = container.querySelector("#status-pending-manual");
    assert(
      pendingMsg !== null &&
      pendingMsg.textContent?.includes("ainda não registrado") === true,
      "CENÁRIO 30.1: UI exibe estado pendente quando sem PrizeRecord"
    );

    // Caso B: MATCH e ausência de autocorreção
    await act(async () => {
      root.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3100,
          score,
          prize: { amountCents: 1800, recordedAt: new Date().toISOString(), source: "MANUAL" },
          initialReference: ref,
        })
      );
    });

    const matchEl = container.querySelector("#status-reconciliation-match");
    const autoFixBtnMatch = container.querySelector("button[data-autofix]");
    assert(
      matchEl !== null &&
      autoFixBtnMatch === null &&
      container.textContent?.includes("Correspondência") === true,
      "CENÁRIO 30.2: UI exibe MATCH sem qualquer botão de autocorreção"
    );

    // Caso C: MISMATCH e ausência de autocorreção
    await act(async () => {
      root.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3100,
          score,
          prize: { amountCents: 2000, recordedAt: new Date().toISOString(), source: "MANUAL" },
          initialReference: ref,
        })
      );
    });

    const mismatchEl = container.querySelector("#status-reconciliation-mismatch");
    const autoFixBtnMismatch = container.querySelector("button[data-autofix]");
    assert(
      mismatchEl !== null &&
      autoFixBtnMismatch === null &&
      container.textContent?.includes("Divergência") === true,
      "CENÁRIO 30.3: UI exibe MISMATCH sem botão de autocorreção"
    );

    root.unmount();
    container.remove();
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 31: UI: acionamento do botão Refresh chama refreshContest e atualiza a exibição
  // ---------------------------------------------------------------------------
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    let refreshCalled = false;
    const mockProvider = {
      providerName: "MockProvider",
      async getLatestContest() { throw new Error("not implemented"); },
      async getContest(n: number) { throw new Error("not implemented"); },
      async refreshContest(n: number) {
        refreshCalled = true;
        const res: OfficialContestResult = {
          contestNumber: n,
          drawDate: "2024-05-20",
          numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          source: "CAIXA",
          fetchedAt: new Date().toISOString(),
          prizeReference: {
            contestNumber: n,
            fetchedAt: new Date().toISOString(),
            source: "CAIXA",
            tiers: [
              { hits: 15, winners: 10, prizePerWinnerCents: 999900 },
              { hits: 14, winners: 100, prizePerWinnerCents: 150000 },
              { hits: 13, winners: 1000, prizePerWinnerCents: 3000 },
              { hits: 12, winners: 10000, prizePerWinnerCents: 1200 },
              { hits: 11, winners: 100000, prizePerWinnerCents: 600 },
            ],
          },
        };
        return res;
      },
    };

    const ref = createSampleReference(3100);
    await act(async () => {
      root.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3100,
          initialReference: ref,
          lotteryProvider: mockProvider as any,
        })
      );
    });

    const refreshBtn = container.querySelector("#btn-refresh-prize-reference") as HTMLButtonElement;
    assert(refreshBtn !== null, "Botão de refresh presente");

    await act(async () => {
      refreshBtn.click();
    });

    const t15Winners = container.querySelector("#tier-hits-15");
    assert(
      refreshCalled && t15Winners?.textContent?.includes("10 ganhador(es)") === true,
      "CENÁRIO 31: UI: acionamento do botão Refresh chama refreshContest e atualiza a exibição"
    );

    root.unmount();
    container.remove();
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 32: UI: em caso de erro no Refresh, exibe mensagem de falha mas mantém dados anteriores
  // ---------------------------------------------------------------------------
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const failingProvider = {
      providerName: "FailingProvider",
      async getLatestContest() { throw new Error("not implemented"); },
      async getContest(n: number) { throw new Error("not implemented"); },
      async refreshContest(n: number) {
        throw new Error("Erro de conectividade com a rede da CAIXA");
      },
    };

    const initialRef = createSampleReference(3100);
    await act(async () => {
      root.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3100,
          initialReference: initialRef,
          lotteryProvider: failingProvider as any,
        })
      );
    });

    const refreshBtn = container.querySelector("#btn-refresh-prize-reference") as HTMLButtonElement;
    await act(async () => {
      refreshBtn.click();
    });

    const errorMsg = container.querySelector("#msg-refresh-failure");
    const t15El = container.querySelector("#tier-hits-15");

    assert(
      errorMsg !== null &&
      errorMsg.textContent?.includes("Erro de conectividade com a rede da CAIXA") === true &&
      t15El !== null &&
      t15El.textContent?.includes("2 ganhador(es)") === true,
      "CENÁRIO 32: UI: em caso de erro no Refresh, a UI exibe mensagem de falha mas mantém os dados da referência anterior visíveis"
    );

    root.unmount();
    container.remove();
  }

  console.log("===============================================================================");
  console.log(`SUÍTE V1.9 CONCLUÍDA COM SUCESSO: ${passed}/${total} CENÁRIOS PASSARAM`);
  console.log("===============================================================================");
}

runTests().catch((err) => {
  console.error("ERRO FATAL NA EXECUÇÃO DOS TESTES V1.9:", err);
  process.exit(1);
});
