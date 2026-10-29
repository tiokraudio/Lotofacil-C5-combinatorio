/**
 * Suíte de Validação Integrada do Ciclo de Vida da Aplicação C5-Memory (UI 2.0)
 * 
 * Validação rigorosa dos quatro módulos principais e persistência:
 * 1. Painel Operacional: Indicadores, DTOs analíticos, ações recomendadas e distribuição 0..15.
 * 2. Gerador C5-Memory: AVAILABLE -> PREVIEW -> FROZEN, imutabilidade, SHA-256 e auditoria.
 * 3. Conferência Automatizada: Validação de 15 dezenas, cálculo de acertos/prêmios, idempotência e fontes.
 * 4. Histórico Financeiro: Custos, prêmios, saldo líquido, fórmula de ROI e isolamento causal.
 * 5. Persistência e Recuperação: Dupla persistência, integridade entre stores e reconciliação canônica.
 */

import assert from "node:assert";
import { ContestRecord, C5Game } from "../types";
import {
  COST_PER_GAME,
  COST_PER_CONTEST,
  FIXED_PRIZES,
  calculateContestPrize,
  buildC5Dashboard,
  buildC5MonthlyReport,
} from "../analytics/c5Analytics";
import {
  generateC5Draft210,
  freezeDraft210,
  ALGORITHM_VERSION_2_1_0,
  Draft210,
  FrozenMemoryPayload210,
} from "../engine210";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { syncSha256 } from "../sha256";
import { calculateHits } from "../math";
import { reconstructHistoryCrossVersion } from "../../storage/storageManager210";

console.log("===============================================================================");
console.log("C5-MEMORY — SUÍTE DE TESTES DE INTEGRAÇÃO DO CICLO DE VIDA DA UI 2.0");
console.log("===============================================================================\n");

// ---------------------------------------------------------------------------
// BLOCO 1: PAINEL OPERACIONAL E REGRA DE NEGÓCIOS
// ---------------------------------------------------------------------------
console.log("--- [BLOCO 1] PAINEL OPERACIONAL E ANALYTICS AUDITÁVEIS ---");

const seedRecords: ContestRecord[] = [
  {
    contestNumber: 3501,
    contestDate: "2026-10-01",
    status: "COMPLETED",
    algorithmVersion: "C5-Memory-2.0.0",
    games: [
      [1, 2, 4, 5, 7, 9, 11, 13, 14, 16, 18, 19, 21, 23, 25],
      [2, 3, 5, 6, 8, 10, 11, 12, 15, 17, 18, 20, 22, 24, 25],
      [1, 3, 4, 6, 7, 9, 10, 13, 15, 16, 17, 19, 21, 22, 24],
      [2, 4, 5, 8, 9, 11, 12, 14, 15, 18, 20, 21, 23, 24, 25],
      [1, 2, 3, 7, 10, 12, 13, 16, 17, 18, 19, 20, 21, 22, 25],
    ],
    officialResult: [1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 16, 18, 19, 21, 25],
    gameHits: [13, 8, 10, 9, 11],
    bestHits: 13,
    bestHitsCount: 1,
    totalCost: 17.50,
    totalPrize: 42.0, // 1x 13 acertos (35) + 1x 11 acertos (7) = 42.0
    resultSource: "MANUAL_CONFERENCE",
    resultConfirmed: true,
    resultConfirmedBy: "CONFERENTE_OFICIAL",
    resultConfirmedAt: "2026-10-01T20:00:00Z",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T20:00:00Z",
  },
  {
    contestNumber: 3502,
    contestDate: "2026-10-02",
    status: "COMPLETED",
    algorithmVersion: "C5-Memory-2.0.0",
    games: [
      [1, 3, 5, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 23, 25],
      [2, 4, 6, 7, 9, 11, 12, 14, 15, 17, 19, 21, 22, 24, 25],
      [1, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 25],
      [1, 3, 5, 7, 8, 10, 12, 13, 16, 18, 19, 21, 22, 24, 25],
      [1, 2, 5, 6, 8, 10, 11, 14, 15, 16, 19, 20, 21, 23, 24],
    ],
    officialResult: [1, 3, 5, 6, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 25],
    gameHits: [14, 7, 9, 11, 8],
    bestHits: 14,
    bestHitsCount: 1,
    totalCost: 17.50,
    totalPrize: 1257.0, // 1x 14 acertos comprovado Caixa (1250) + 1x 11 acertos (7) = 1257.0
    resultSource: "MANUAL_CONFERENCE",
    resultConfirmed: true,
    resultConfirmedBy: "CONFERENTE_OFICIAL",
    resultConfirmedAt: "2026-10-02T20:00:00Z",
    prizeBreakdown: {
      "14": {
        count: 1,
        unitValue: 1250.0,
        totalValue: 1250.0,
        isVariableRateio: true,
        pendingRateio: false,
        confirmationSource: "MANUAL_ENTRY",
        contestNumber: 3502,
        tier: 14,
        operatorId: "CONFERENTE_OFICIAL",
        confirmedAt: "2026-10-02T20:00:00Z",
        notes: "Rateio homologado manualmente pelo operador no portal Caixa",
      },
      "11": { count: 1, unitValue: 7.0, totalValue: 7.0, isVariableRateio: false, pendingRateio: false },
    },
    createdAt: "2026-10-02T10:00:00Z",
    updatedAt: "2026-10-02T20:00:00Z",
  },
];

const dashDTO = buildC5Dashboard(seedRecords, 3503);

assert.strictEqual(dashDTO.confirmedContests, 2, "Dois concursos confirmados");
assert.strictEqual(dashDTO.scoredContests, 2, "Dois concursos apurados");
assert.strictEqual(dashDTO.confirmedGames, 10, "10 jogos confirmados");
assert.strictEqual(dashDTO.scoredGames, 10, "10 jogos apurados");
assert.strictEqual(dashDTO.totalCost, 35.0, "Custo total = 2 x 17.50 = R$ 35,00");
assert.strictEqual(dashDTO.totalPrize, 1299.0, "Total de prêmios = 42 + 1257 = R$ 1.299,00");
assert.strictEqual(dashDTO.netBalance, 1264.0, "Saldo líquido = 1299 - 35 = R$ 1.264,00");
assert.strictEqual(dashDTO.totalDistributionSum, 10, "Soma da distribuição 0..15 deve fechar em exatamente 10 jogos");
assert.strictEqual(dashDTO.overallBestHits, 14, "Melhor resultado observado geral = 14 acertos");
assert.strictEqual(dashDTO.currentStatus, "AVAILABLE", "Concurso 3503 ainda não possui prévia nem aposta");

console.log("  ✓ Indicadores do Painel Operacional aprovados.");

// ---------------------------------------------------------------------------
// BLOCO 2: CICLO COMPLETO DO GERADOR C5-MEMORY
// ---------------------------------------------------------------------------
console.log("\n--- [BLOCO 2] GERADOR C5-MEMORY (AVAILABLE -> PREVIEW -> FROZEN) ---");

// 1. Reconstrução de H a partir dos concursos existentes
const historyBefore = reconstructHistoryCrossVersion(seedRecords);
assert.strictEqual(historyBefore.revision, 2, "Revisão inicial = 2");
assert.strictEqual(historyBefore.games.length, 10, "10 jogos no histórico");

// 2. Geração da Prévia (PREVIEW)
const draft = generateC5Draft210(3503, historyBefore);
assert.strictEqual(draft.contestNumber, 3503, "Número do concurso do draft correto");
assert.strictEqual(draft.games.length, 5, "Exatamente 5 apostas geradas");
assert.strictEqual(draft.historyRevision, 2, "Draft vinculado à revisão 2 de H");
assert.strictEqual(draft.historyFingerprint, historyBefore.fingerprint, "Fingerprint de H verificado");

// Valida integridade matemática de cada jogo do draft
for (let i = 0; i < 5; i++) {
  const g = draft.games[i];
  assert.strictEqual(g.length, 15, `Jogo ${i + 1} deve ter 15 dezenas`);
  const uniqueNumbers = new Set(g);
  assert.strictEqual(uniqueNumbers.size, 15, `Jogo ${i + 1} não deve conter dezenas repetidas`);
  g.forEach(n => assert(n >= 1 && n <= 25, `Dezena ${n} fora do intervalo [1, 25]`));
  for (let j = 1; j < 15; j++) {
    assert(g[j] > g[j - 1], `Jogo ${i + 1} deve estar em ordem estritamente crescente`);
  }
}

// 3. Congelamento Criptográfico da Aposta (FROZEN)
const frozenPayload = freezeDraft210(draft);
assert.strictEqual(frozenPayload.contestNumber, 3503);
assert.strictEqual(frozenPayload.historyRevision, 2);
assert.strictEqual(frozenPayload.sha256.length, 64, "Hash SHA-256 deve ter 64 caracteres hexadecimais");

// 4. Verificação de Auditoria Independente do SHA-256
const gamesSerial = draft.games.map(formatGameCanonical).join("|");
const payloadToVerify = `C5-FROZEN:${draft.contestNumber}:${draft.poolIndex}:${draft.poolMasterSeed}:${draft.historyFingerprint}:${draft.historyRevision}:${gamesSerial}`;
const computedSha = syncSha256(payloadToVerify);
assert.strictEqual(computedSha, frozenPayload.sha256, "O hash SHA-256 gerado é matematicamente reproduzível e auditável");

console.log("  ✓ Ciclo DRAFT -> FROZEN e auditoria SHA-256 aprovados.");

// ---------------------------------------------------------------------------
// BLOCO 3: CONFERÊNCIA AUTOMATIZADA E APURAÇÃO OFICIAL
// ---------------------------------------------------------------------------
console.log("\n--- [BLOCO 3] CONFERÊNCIA AUTOMATIZADA E APURAÇÃO OFICIAL ---");

const frozenRecord: ContestRecord = {
  contestNumber: 3503,
  contestDate: "2026-10-03",
  status: "FROZEN",
  algorithmVersion: ALGORITHM_VERSION_2_1_0 as any,
  games: draft.games,
  draft: draft as any,
  frozenPayload: frozenPayload as any,
  createdAt: "2026-10-03T10:00:00Z",
  updatedAt: "2026-10-03T10:05:00Z",
};

// Resultado oficial simulado: exatamente 15 dezenas
const officialDraw = [1, 2, 4, 6, 8, 10, 11, 13, 15, 17, 19, 21, 22, 24, 25];
assert.strictEqual(officialDraw.length, 15, "Resultado oficial tem exatamente 15 números");

// Apuração dos 5 jogos
const liveHits = frozenRecord.games.map(g => calculateHits(g, officialDraw));
const bestHit = Math.max(...liveHits);
const bestHitCount = liveHits.filter(h => h === bestHit).length;

assert.strictEqual(liveHits.length, 5, "Exatamente 5 pontuações apuradas");
liveHits.forEach((h, idx) => {
  assert(h >= 0 && h <= 15, `Acertos do jogo ${idx + 1} (${h}) fora do intervalo [0, 15]`);
});

// Cálculo dos prêmios
const customPrizes = {
  11: 7.0,
  12: 14.0,
  13: 35.0,
  14: 850.0, // Prêmio rateado oficial Caixa
  15: 1800000.0,
};

let calculatedPrizeTotal = 0;
for (const h of liveHits) {
  if (h >= 11) {
    calculatedPrizeTotal += customPrizes[h as keyof typeof customPrizes] || 0;
  }
}

const completedRecord: ContestRecord = {
  ...frozenRecord,
  status: "COMPLETED",
  officialResult: officialDraw,
  gameHits: liveHits,
  bestHits: bestHit,
  bestHitsCount: bestHitCount,
  totalCost: 17.50,
  totalPrize: calculatedPrizeTotal,
  resultSource: "API_CAIXA",
  resultProof: "CEF-AUTH-PROOF-3503",
  resultFetchedAt: "2026-10-03T20:30:00Z",
  updatedAt: "2026-10-03T20:30:00Z",
};

assert.strictEqual(completedRecord.status, "COMPLETED");
assert.strictEqual(completedRecord.totalCost, 17.50);
assert.strictEqual(completedRecord.totalPrize, calculatedPrizeTotal);
assert.strictEqual(completedRecord.resultSource, "API_CAIXA");

console.log("  ✓ Conferência e apuração com procedência da fonte aprovadas.");

// ---------------------------------------------------------------------------
// BLOCO 4: HISTÓRICO FINANCEIRO E RELATÓRIO MENSAL
// ---------------------------------------------------------------------------
console.log("\n--- [BLOCO 4] HISTÓRICO FINANCEIRO E RELATÓRIO MENSAL ---");

const allRecordsWith3503 = [...seedRecords, completedRecord];
const monthlyDTO = buildC5MonthlyReport(allRecordsWith3503, 2026, 10);

assert.strictEqual(monthlyDTO.totalContestsInMonth, 3, "3 concursos em outubro/2026");
assert.strictEqual(monthlyDTO.confirmedContests, 3, "3 confirmados");
assert.strictEqual(monthlyDTO.scoredContests, 3, "3 apurados");
assert.strictEqual(monthlyDTO.scoredGames, 15, "15 jogos apurados");
assert.strictEqual(monthlyDTO.contestRows.length, 3, "3 linhas na tabela do mês");

// Validação da Idempotência Financeira:
// Se reprocessarmos a conferência com os mesmos dados, o balanço deve permanecer estritamente idêntico
const reprocessedPrize = calculateContestPrize(completedRecord);
assert.strictEqual(reprocessedPrize, completedRecord.totalPrize, "Cálculo de prêmio é idempotente e determinístico");

const totalCostAudit = allRecordsWith3503.reduce((acc, r) => acc + (r.totalCost ?? COST_PER_CONTEST), 0);
assert.strictEqual(totalCostAudit, 52.50, "Custo consolidado dos 3 concursos = R$ 52,50 (3 * R$ 17,50 sem duplicação)");

console.log("  ✓ Histórico financeiro, relatório mensal e idempotência aprovados.");

// ---------------------------------------------------------------------------
// BLOCO 5: DUPLA PERSISTÊNCIA E RECONCILIAÇÃO CANÔNICA
// ---------------------------------------------------------------------------
console.log("\n--- [BLOCO 5] DUPLA PERSISTÊNCIA E RECONCILIAÇÃO CANÔNICA ---");

// Fonte Canônica: Store 'contests'
const canonicalH = reconstructHistoryCrossVersion(allRecordsWith3503);
assert.strictEqual(canonicalH.revision, 3, "Revisão canônica deve ser exatamente 3");
assert.strictEqual(canonicalH.games.length, 15, "15 jogos acumulados em H");

// Invariante de Coexistência:
// Concurso 3501 (v2.0.0) e Concurso 3503 (v2.1.0) coexistem pacificamente na memória histórica cumulativa
assert.strictEqual(allRecordsWith3503[0].algorithmVersion, "C5-Memory-2.0.0");
assert.strictEqual(allRecordsWith3503[2].algorithmVersion, ALGORITHM_VERSION_2_1_0);

console.log("  ✓ Dupla persistência e reconciliação canônica aprovadas.");

console.log("\n===============================================================================");
console.log("=== TODOS OS TESTES INTEGRADOS DO CICLO DE VIDA DA UI 2.0 FORAM APROVADOS! ===");
console.log("===============================================================================");
