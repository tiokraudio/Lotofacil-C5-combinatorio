import assert from "node:assert";
import { ContestRecord } from "../../types";
import {
  buildC5Dashboard,
  buildC5MonthlyReport,
  buildC5ContestPerformance,
  filterC5MemoryRecords,
} from "../c5Analytics";
import { generateC5Draft } from "../../draft";
import { createMemoryHistory } from "../../history";

console.log("=== INICIANDO SUÍTE DE TESTES UI-1D (ANALYTICS E PAINEL C5) ===");

// 1. Teste de isolamento causal: Analytics -> zero influência -> Draft futuro
{
  console.log("TESTE 1: Isolamento Causal (Analytics não altera Draft futuro)");
  const history = createMemoryHistory([], 0);
  const draftBefore = generateC5Draft(3600, history);

  // Executa analytics várias vezes com registros simulados
  const mockRecords: ContestRecord[] = [
    {
      contestNumber: 3599,
      contestDate: "2026-10-01",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: draftBefore.games,
      officialResult: draftBefore.games[0], // Simulando 15 acertos!
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T20:00:00Z",
    },
  ];

  const dashboard = buildC5Dashboard(mockRecords, 3600);
  const monthly = buildC5MonthlyReport(mockRecords, 2026, 10);
  assert(dashboard !== null, "Dashboard gerado com sucesso");
  assert(monthly !== null, "Relatório mensal gerado com sucesso");

  // Gera o draft novamente com a mesma história
  const draftAfter = generateC5Draft(3600, history);

  assert.strictEqual(
    draftBefore.poolMasterSeed,
    draftAfter.poolMasterSeed,
    "Seed mestre inalterada após execução de Analytics"
  );
  assert.strictEqual(
    draftBefore.poolIndex,
    draftAfter.poolIndex,
    "Índice no pool inalterado após execução de Analytics"
  );
  assert.deepStrictEqual(
    draftBefore.games,
    draftAfter.games,
    "Jogos gerados exatamente idênticos (zero contaminação exógena)"
  );
  console.log("✓ Isolamento causal verificado com sucesso.");
}

// 2. Teste de verificação matemática da distribuição de acertos (soma === totalScoredGames)
{
  console.log("TESTE 2: Distribuição completa 0..15 e integridade dos denominadores");
  const records: ContestRecord[] = [
    {
      contestNumber: 3501,
      contestDate: "2026-10-01",
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
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T20:00:00Z",
    },
    {
      contestNumber: 3502,
      contestDate: "2026-10-02",
      status: "FROZEN", // Confirmado mas NÃO apurado
      algorithmVersion: "C5-Memory-2.0.0",
      games: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 22, 23, 24, 25],
        [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23, 24, 25],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
      ],
      createdAt: "2026-10-02T10:00:00Z",
      updatedAt: "2026-10-02T11:00:00Z",
    },
  ];

  const dashboard = buildC5Dashboard(records, 3503);

  // Distinção obrigatória entre confirmados e apurados
  assert.strictEqual(dashboard.confirmedContests, 2, "2 concursos confirmados");
  assert.strictEqual(dashboard.scoredContests, 1, "1 concurso apurado");
  assert.strictEqual(dashboard.confirmedGames, 10, "10 jogos confirmados");
  assert.strictEqual(dashboard.scoredGames, 5, "5 jogos apurados");

  // Verificação de que a soma da distribuição completa bate exatamente com scoredGames
  assert.strictEqual(
    dashboard.totalDistributionSum,
    dashboard.scoredGames,
    "Soma da distribuição (5) é exatamente igual a scoredGames (5)"
  );

  // O jogo 1 teve 15 acertos
  assert.strictEqual(dashboard.hitDistribution[15], 1, "Exatamente 1 jogo com 15 acertos");
  // O jogo 2 teve 14 acertos
  assert.strictEqual(dashboard.hitDistribution[14], 1, "Exatamente 1 jogo com 14 acertos");
  // O jogo 5 teve 10 acertos
  assert.strictEqual(dashboard.hitDistribution[10], 1, "Exatamente 1 jogo com 10 acertos");

  // Faixas com denominadores explícitos
  assert.strictEqual(dashboard.tiers.tier15.count, 1);
  assert.strictEqual(dashboard.tiers.tier15.total, 5);
  assert.strictEqual(dashboard.tiers.tier15.percentage, 20);

  console.log("✓ Integridade matemática e denominadores validados.");
}

// 3. Teste do Relatório Mensal com cardinalidade real
{
  console.log("TESTE 3: Relatório Mensal Dinâmico (sem constante arbitrária)");
  const records: ContestRecord[] = [
    {
      contestNumber: 3510,
      contestDate: "2026-10-10",
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
      createdAt: "2026-10-10T10:00:00Z",
      updatedAt: "2026-10-10T20:00:00Z",
    },
  ];

  const reportOct = buildC5MonthlyReport(records, 2026, 10);
  assert.strictEqual(reportOct.totalContestsInMonth, 1, "Identifica exatamente 1 concurso no mês");
  assert.strictEqual(reportOct.contestRows.length, 1);
  assert.strictEqual(reportOct.contestRows[0].bestHits, 15);

  const reportNov = buildC5MonthlyReport(records, 2026, 11);
  assert.strictEqual(reportNov.totalContestsInMonth, 0, "0 concursos em novembro");
  assert.strictEqual(reportNov.scoredContests, 0);

  console.log("✓ Relatório Mensal dinâmico aprovado.");
}

// 4. Teste de separação de registros legados C5-1.0.0
{
  console.log("TESTE 4: Isolamento de dados legados C5-1.0.0");
  const mixedRecords: ContestRecord[] = [
    {
      contestNumber: 1000,
      contestDate: "2025-01-01",
      status: "COMPLETED",
      algorithmVersion: "C5-1.0.0", // Legado
      games: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
      officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      createdAt: "2025-01-01T10:00:00Z",
      updatedAt: "2025-01-01T20:00:00Z",
    },
  ];

  const filtered = filterC5MemoryRecords(mixedRecords);
  assert.strictEqual(filtered.length, 0, "C5-1.0.0 não entra no cálculo de C5-Memory-2.0.0");

  const dashboard = buildC5Dashboard(mixedRecords, 3500);
  assert.strictEqual(dashboard.scoredContests, 0, "Dashboard desconsidera registros legados");

  console.log("✓ Isolamento de legados aprovado.");
}

console.log("=== TODOS OS TESTES UI-1D FORAM APROVADOS COM SUCESSO! ===");
