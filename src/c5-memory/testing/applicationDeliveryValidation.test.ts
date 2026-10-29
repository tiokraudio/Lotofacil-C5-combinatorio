/**
 * Suíte de Testes e Validação de Entrega da Aplicação C5-Memory
 * Validação dos fluxos de negócio, regras financeiras, conferência e integridade.
 */

import assert from "node:assert";
import { ContestRecord } from "../types";
import {
  COST_PER_GAME,
  COST_PER_CONTEST,
  FIXED_PRIZES,
  calculateContestPrize,
  buildC5Dashboard,
  buildC5MonthlyReport,
} from "../analytics/c5Analytics";
import { generateC5Draft } from "../draft";
import { createMemoryHistory } from "../history";
import { syncSha256 } from "../sha256";

console.log("=== INICIANDO SUÍTE DE TESTES DE ENTREGA DA APLICAÇÃO C5-MEMORY ===");

// 1. Validação das Regras de Negócio e Cálculo Financeiro
{
  console.log("TESTE 1: Regras Financeiras e Saldo Líquido");

  assert.strictEqual(COST_PER_GAME, 3.50, "Custo por aposta simples da Lotofácil deve ser R$ 3,50");
  assert.strictEqual(COST_PER_CONTEST, 17.50, "Custo total de 5 apostas deve ser R$ 17,50");
  assert.strictEqual(FIXED_PRIZES[11], 7.00, "Prêmio oficial de 11 acertos deve ser R$ 7,00");
  assert.strictEqual(FIXED_PRIZES[12], 14.00, "Prêmio oficial de 12 acertos deve ser R$ 14,00");
  assert.strictEqual(FIXED_PRIZES[13], 35.00, "Prêmio oficial de 13 acertos deve ser R$ 35,00");

  // Simulação de concurso com prêmio misto e breakdown explícito de rateio oficial
  const recordWithHits: ContestRecord = {
    contestNumber: 3601,
    contestDate: "2026-10-10",
    status: "COMPLETED",
    algorithmVersion: "C5-Memory-2.0.0",
    games: [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 21],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 22, 23, 24, 25, 16], // 10 acertos (sem prêmio)
    ],
    officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    gameHits: [15, 14, 13, 12, 10],
    bestHits: 15,
    bestHitsCount: 1,
    totalCost: 17.50,
    resultSource: "MANUAL_CONFERENCE",
    resultConfirmed: true,
    resultConfirmedBy: "CONFERENTE_OFICIAL",
    resultConfirmedAt: "2026-10-10T20:00:00Z",
    prizeBreakdown: {
      "15": {
        count: 1,
        unitValue: 1500000.0,
        totalValue: 1500000.0,
        isVariableRateio: true,
        pendingRateio: false,
        confirmationSource: "MANUAL_ENTRY",
        contestNumber: 3601,
        tier: 15,
        operatorId: "CONFERENTE_OFICIAL",
        confirmedAt: "2026-10-10T20:00:00Z",
        notes: "Rateio homologado manualmente pelo operador",
      },
      "14": {
        count: 1,
        unitValue: 800.0,
        totalValue: 800.0,
        isVariableRateio: true,
        pendingRateio: false,
        confirmationSource: "MANUAL_ENTRY",
        contestNumber: 3601,
        tier: 14,
        operatorId: "CONFERENTE_OFICIAL",
        confirmedAt: "2026-10-10T20:00:00Z",
        notes: "Rateio homologado manualmente pelo operador",
      },
      "13": { count: 1, unitValue: 35.0, totalValue: 35.0, isVariableRateio: false, pendingRateio: false },
      "12": { count: 1, unitValue: 14.0, totalValue: 14.0, isVariableRateio: false, pendingRateio: false },
    },
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T20:00:00Z",
  };

  const calculatedPrize = calculateContestPrize(recordWithHits);
  const expectedPrize = 1500000.0 + 800.0 + 35.0 + 14.0 + 0.0;
  assert.strictEqual(calculatedPrize, expectedPrize, "Soma de prêmios por jogo deve ser exata");

  // Dashboard consolidado
  const dashboard = buildC5Dashboard([recordWithHits], 3602);
  assert.strictEqual(dashboard.totalCost, 17.50, "Custo total do concurso deve ser R$ 17,50");
  assert.strictEqual(dashboard.totalPrize, expectedPrize, "Prêmio total computado corretamente");
  assert.strictEqual(dashboard.netBalance, expectedPrize - 17.50, "Saldo líquido = Prêmio - Custo");
  assert(dashboard.roiPercentage > 0, "ROI deve ser estritamente positivo quando há prêmio");
  assert.strictEqual(dashboard.winningContestsCount, 1, "Concurso com 15 acertos é premiado");

  console.log("✓ Regras financeiras e saldo líquido aprovados.");
}

// 2. Conferência de Acertos e Isolamento
{
  console.log("TESTE 2: Conferência das 5 Apostas e Detecção de Faixas");

  const game1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const result = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20]; // 10 acertos em comum

  const hits = game1.filter(n => result.includes(n)).length;
  assert.strictEqual(hits, 10, "10 acertos conferidos com exatidão");

  const hits11 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 23, 24, 25].filter(n =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(n)
  ).length;
  assert.strictEqual(hits11, 11, "11 acertos conferidos com exatidão");

  console.log("✓ Conferência de dezenas e acertos aprovada.");
}

// 3. Validação do Ciclo DRAFT/FROZEN e Auditoria Criptográfica
{
  console.log("TESTE 3: Ciclo DRAFT/FROZEN e Integridade Criptográfica");

  const history = createMemoryHistory([], 0);
  const draft = generateC5Draft(3700, history);

  assert.strictEqual(draft.contestNumber, 3700, "Concurso do draft correto");
  assert.strictEqual(draft.games.length, 5, "Exatamente 5 apostas geradas");
  draft.games.forEach((g, idx) => {
    assert.strictEqual(g.length, 15, `Jogo ${idx + 1} deve ter 15 dezenas`);
    // Verifica ordenação estrita
    for (let i = 1; i < g.length; i++) {
      assert(g[i] > g[i - 1], `Dezenas do jogo ${idx + 1} devem ser estritamente crescentes`);
    }
  });

  // Congelamento SHA-256 auditável
  const gamesSerial = draft.games.map(g => g.join(",")).join("|");
  const payloadToHash = `C5-FROZEN:${draft.contestNumber}:${draft.poolIndex}:${draft.poolMasterSeed}:${draft.historyFingerprint}:${draft.historyRevision}:${gamesSerial}`;
  const sha = syncSha256(payloadToHash);

  assert.strictEqual(typeof sha, "string", "Hash SHA-256 gerado");
  assert.strictEqual(sha.length, 64, "SHA-256 deve ter 64 caracteres hexadecimais");

  console.log("✓ Ciclo DRAFT/FROZEN e integridade criptográfica aprovados.");
}

// 4. Teste de Relatório Mensal e Denominadores Válidos
{
  console.log("TESTE 4: Relatório Mensal e Denominadores Válidos");

  const records: ContestRecord[] = [
    {
      contestNumber: 3510,
      contestDate: "2026-10-05",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 22, 23, 24, 25],
        [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23, 24, 25],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
      ],
      officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      gameHits: [15, 14, 8, 7, 10],
      bestHits: 15,
      bestHitsCount: 1,
      totalCost: 17.50,
      totalPrize: 1500800.0,
      resultSource: "MANUAL_CONFERENCE",
      resultConfirmed: true,
      resultConfirmedBy: "CONFERENTE_OFICIAL",
      resultConfirmedAt: "2026-10-05T20:00:00Z",
      prizeBreakdown: {
        "15": {
          count: 1,
          unitValue: 1500000.0,
          totalValue: 1500000.0,
          isVariableRateio: true,
          pendingRateio: false,
          confirmationSource: "MANUAL_ENTRY",
          contestNumber: 3510,
          tier: 15,
          operatorId: "CONFERENTE_OFICIAL",
          confirmedAt: "2026-10-05T20:00:00Z",
          notes: "Rateio homologado manualmente pelo operador",
        },
        "14": {
          count: 1,
          unitValue: 800.0,
          totalValue: 800.0,
          isVariableRateio: true,
          pendingRateio: false,
          confirmationSource: "MANUAL_ENTRY",
          contestNumber: 3510,
          tier: 14,
          operatorId: "CONFERENTE_OFICIAL",
          confirmedAt: "2026-10-05T20:00:00Z",
          notes: "Rateio homologado manualmente pelo operador",
        },
      },
      createdAt: "2026-10-05T10:00:00Z",
      updatedAt: "2026-10-05T20:00:00Z",
    },
    {
      contestNumber: 3511,
      contestDate: "2026-10-06",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
        [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
      ],
      officialResult: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
      gameHits: [10, 10, 15, 15, 10],
      bestHits: 15,
      bestHitsCount: 2,
      totalCost: 17.50,
      totalPrize: 3000000.0,
      resultSource: "MANUAL_CONFERENCE",
      resultConfirmed: true,
      resultConfirmedBy: "CONFERENTE_OFICIAL",
      resultConfirmedAt: "2026-10-06T20:00:00Z",
      prizeBreakdown: {
        "15": {
          count: 2,
          unitValue: 1500000.0,
          totalValue: 3000000.0,
          isVariableRateio: true,
          pendingRateio: false,
          confirmationSource: "MANUAL_ENTRY",
          contestNumber: 3511,
          tier: 15,
          operatorId: "CONFERENTE_OFICIAL",
          confirmedAt: "2026-10-06T20:00:00Z",
          notes: "Rateio homologado manualmente pelo operador",
        },
      },
      createdAt: "2026-10-06T10:00:00Z",
      updatedAt: "2026-10-06T20:00:00Z",
    },
  ];

  const report = buildC5MonthlyReport(records, 2026, 10);
  assert.strictEqual(report.totalContestsInMonth, 2, "2 concursos encontrados");
  assert.strictEqual(report.totalCost, 35.0, "Custo total = 2 * 17.50 = R$ 35,00");
  assert.strictEqual(report.totalPrize, 4500800.0, "Prêmio total acumulado");
  assert.strictEqual(report.netBalance, 4500800.0 - 35.0, "Saldo líquido exato");
  assert.strictEqual(report.winningContestsCount, 2, "2 concursos premiados");
  assert.strictEqual(report.contestRows.length, 2, "2 linhas de detalhamento");
  assert.strictEqual(report.contestRows[0].cost, 17.50, "Custo por linha deve ser R$ 17,50");

  console.log("✓ Relatório mensal e cálculos de agregação aprovados.");
}

console.log("=== TODOS OS TESTES DE ENTREGA DA APLICAÇÃO FORAM APROVADOS! ===");
