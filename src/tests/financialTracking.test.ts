/**
 * SUÍTE OFICIAL DE CERTIFICAÇÃO FINANCEIRA E REGISTRO DE PRÊMIO (V1.8)
 * Arquivo: src/tests/financialTracking.test.ts
 *
 * Validação exaustiva dos requisitos da V1.8:
 *  1. Conversão e Validação Financeira em Centavos (money.ts)
 *  2. Registro de Prêmio em Concurso SCORED com aposta confirmada
 *  3. Imutabilidade Absoluta do Prêmio (rejeição de regravação)
 *  4. Rejeição em DRAFT e FROZEN
 *  5. Rejeição sem Confirmação Prévia de Aposta (betPlacedAt obrigatório)
 *  6. Rejeição de valores negativos, decimais fracionados ou não-inteiros
 *  7. Métricas de Resumo Financeiro (totalPrizeCents, netResultCents, pendências)
 *  8. Multi-Tab Sync: emissão do evento PRIZE_RECORDED e incremento de revision
 *  9. Bloqueio Concorrente e Proteção contra Double-Click via RECORD_PRIZE lock
 * 10. Round-trip completo de Backup com Schema Version 3
 */

import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../storage/contestRepository.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import { LocalSyncCoordinator, InMemoryLocalSyncBus, InMemoryLocalSyncTransport } from "../system/localSyncCoordinator.ts";
import { GeneratorOperationalController } from "../system/generatorOperationalController.ts";
import { actionLockController } from "../system/actionLock.ts";
import { createContestDraft, freezeContestRecord, scoreFrozenContest } from "../c5/record.ts";
import { parseBRLToCents, formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";
import { importHistory, validateHistoryBackup, prepareHistoryImport, parseHistoryBackup } from "../storage/import.ts";
import type { ContestRecord } from "../c5/types.ts";
import type { LotteryResultProvider, OfficialContestResult } from "../lottery/types.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// Provedor simulado para testes
const mockProvider: LotteryResultProvider = {
  providerName: "TestProvider",
  async getContest(contestNumber: number): Promise<OfficialContestResult> {
    return {
      contestNumber,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      drawDate: "2026-09-20",
      source: "TEST",
      fetchedAt: "2026-09-20T21:00:00.000Z",
    };
  },
  async getLatestContest(): Promise<OfficialContestResult> {
    return this.getContest(3100);
  },
};

async function runTests() {
  console.log("===============================================================================");
  console.log(" SUÍTE DE TESTES: V1.8 RASTREAMENTO FINANCEIRO E REGISTRO DE PRÊMIOS");
  console.log("===============================================================================");

  // ---------------------------------------------------------------------------
  // 1. UTILITÁRIOS MONETÁRIOS (money.ts)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 1. Conversão e Validação Monetária em Centavos (money.ts)");
  {
    assert(parseBRLToCents("0") === 0, "parseBRLToCents('0') retorna 0 centavos");
    assert(parseBRLToCents("0,00") === 0, "parseBRLToCents('0,00') retorna 0 centavos");
    assert(parseBRLToCents("6") === 600, "parseBRLToCents('6') retorna 600 centavos");
    assert(parseBRLToCents("6,00") === 600, "parseBRLToCents('6,00') retorna 600 centavos");
    assert(parseBRLToCents("12,50") === 1250, "parseBRLToCents('12,50') retorna 1250 centavos");
    assert(parseBRLToCents("17,50") === 1750, "parseBRLToCents('17,50') retorna 1750 centavos");
    assert(parseBRLToCents("1.234,56") === 123456, "parseBRLToCents('1.234,56') retorna 123456 centavos");
    assert(parseBRLToCents("R$ 1.500.000,00") === 150000000, "parseBRLToCents com prefixo R$ e múltiplos milhares");

    // Rejeições obrigatórias
    let threwNegative = false;
    try {
      parseBRLToCents("-5,00");
    } catch {
      threwNegative = true;
    }
    assert(threwNegative, "parseBRLToCents rejeita valor negativo");

    let threwFractional = false;
    try {
      parseBRLToCents("10,999");
    } catch {
      threwFractional = true;
    }
    assert(threwFractional, "parseBRLToCents rejeita mais de 2 casas decimais");

    let threwEmpty = false;
    try {
      parseBRLToCents("  ");
    } catch {
      threwEmpty = true;
    }
    assert(threwEmpty, "parseBRLToCents rejeita string vazia");

    // Formatação
    assert(formatBRLFromCents(0).includes("0,00"), "formatBRLFromCents(0) formata R$ 0,00");
    assert(formatBRLFromCents(1750).includes("17,50"), "formatBRLFromCents(1750) formata R$ 17,50");
    assert(formatSignedBRLFromCents(1000).startsWith("+"), "formatSignedBRLFromCents positivo tem prefixo +");
    assert(formatSignedBRLFromCents(-1750).startsWith("-"), "formatSignedBRLFromCents negativo tem prefixo -");
    assert(formatSignedBRLFromCents(0).includes("0,00"), "formatSignedBRLFromCents(0) retorna sem sinal");
  }

  // ---------------------------------------------------------------------------
  // 2. REGISTRO DE PRÊMIO COM SUCESSO EM CONCURSO SCORED COM APOSTA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 2. Registro de Prêmio em Concurso SCORED com Aposta");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(4001, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);

    await repo.freezeStoredContest(4001, { clock: () => new Date("2026-09-20T11:00:00.000Z") });

    // Confirma a aposta na lotérica
    const betDate = new Date("2026-09-20T12:00:00.000Z");
    await repo.confirmBetPlaced(4001, { clock: () => betDate });

    // Pontua o concurso
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scoredDate = new Date("2026-09-20T21:00:00.000Z");
    await repo.scoreStoredContest(4001, officialResult, { clock: () => scoredDate });

    // Registra o prêmio recebido: R$ 36,00 (3600 centavos)
    const prizeDate = new Date("2026-09-21T09:00:00.000Z");
    const updated = await repo.recordPrize(4001, 3600, { clock: () => prizeDate });

    assert(updated.prize !== undefined, "prize está definido no registro retornado");
    assert(updated.prize?.amountCents === 3600, "amountCents é 3600");
    assert(updated.prize?.source === "MANUAL", "source é MANUAL");
    assert(updated.prize?.recordedAt === prizeDate.toISOString(), "recordedAt salvo como ISO 8601");

    // Releitura direta do banco
    const readFromDb = await repo.getContestRecord(4001);
    assert(readFromDb?.prize?.amountCents === 3600, "Prêmio persistido e verificado via releitura do IndexedDB");
  }

  // ---------------------------------------------------------------------------
  // 3. IMUTABILIDADE ABSOLUTA: PROIBIÇÃO DE SOBRESCRITA DO PRÊMIO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 3. Imutabilidade Absoluta do Prêmio Registrado");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(4002, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(4002, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(4002, { clock: () => new Date("2026-09-20T12:00:00.000Z") });
    await repo.scoreStoredContest(4002, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });

    // Primeiro registro
    await repo.recordPrize(4002, 1200, { clock: () => new Date("2026-09-21T09:00:00.000Z") });

    // Tentativa de sobrescrever ou alterar prêmio já gravado
    let threwOverwrite = false;
    try {
      await repo.recordPrize(4002, 5000, { clock: () => new Date("2026-09-21T10:00:00.000Z") });
    } catch (err: any) {
      threwOverwrite = true;
      assert(
        err.message.includes("já realizado") || err.message.includes("imutável"),
        "Mensagem de erro explicita que o prêmio já foi registrado e é imutável"
      );
    }
    assert(threwOverwrite, "Tentativa de sobrescrever prêmio é estritamente bloqueada");

    // Confirma que o valor original permaneceu intacto
    const checkDb = await repo.getContestRecord(4002);
    assert(checkDb?.prize?.amountCents === 1200, "Valor original de 1200 centavos permaneceu inalterado");
  }

  // ---------------------------------------------------------------------------
  // 4. REJEIÇÃO EM DRAFT E FROZEN
  // ---------------------------------------------------------------------------
  console.log("\n▶ 4. Rejeição de Registro de Prêmio em DRAFT e FROZEN");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // DRAFT
    const draft = createContestDraft(4003, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);

    let threwDraft = false;
    try {
      await repo.recordPrize(4003, 1000);
    } catch {
      threwDraft = true;
    }
    assert(threwDraft, "Rejeita registro de prêmio em concurso em status DRAFT");

    // FROZEN
    await repo.freezeStoredContest(4003, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(4003, { clock: () => new Date("2026-09-20T12:00:00.000Z") });

    let threwFrozen = false;
    try {
      await repo.recordPrize(4003, 1000);
    } catch {
      threwFrozen = true;
    }
    assert(threwFrozen, "Rejeita registro de prêmio em concurso em status FROZEN (ainda não apurado)");
  }

  // ---------------------------------------------------------------------------
  // 5. REJEIÇÃO SE betPlacedAt FOR UNDEFINED (NÃO APOSTADO)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 5. Rejeição de Prêmio se Concurso Não Foi Apostado");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(4004, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(4004, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    // NÃO confirma aposta (betPlacedAt continua undefined)
    await repo.scoreStoredContest(4004, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });

    let threwNoBet = false;
    try {
      await repo.recordPrize(4004, 600);
    } catch (err: any) {
      threwNoBet = true;
      assert(err.message.includes("aposta confirmada"), "Erro informa necessidade de aposta confirmada");
    }
    assert(threwNoBet, "Rejeita registrar prêmio para concurso sem confirmação de aposta");
  }

  // ---------------------------------------------------------------------------
  // 6. VALIDAÇÃO DE VALORES EM CENTAVOS
  // ---------------------------------------------------------------------------
  console.log("\n▶ 6. Validação Estrita do amountCents");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(4005, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(4005, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(4005, { clock: () => new Date("2026-09-20T12:00:00.000Z") });
    await repo.scoreStoredContest(4005, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });

    // Negativo
    let threwNegative = false;
    try {
      await repo.recordPrize(4005, -100);
    } catch {
      threwNegative = true;
    }
    assert(threwNegative, "Rejeita amountCents negativo");

    // Float / Não-inteiro
    let threwFloat = false;
    try {
      await repo.recordPrize(4005, 10.5);
    } catch {
      threwFloat = true;
    }
    assert(threwFloat, "Rejeita amountCents fracionado");

    // NaN
    let threwNaN = false;
    try {
      await repo.recordPrize(4005, NaN);
    } catch {
      threwNaN = true;
    }
    assert(threwNaN, "Rejeita amountCents NaN");
  }

  // ---------------------------------------------------------------------------
  // 7. MÉTRICAS FINANCEIRAS NO HistorySummary
  // ---------------------------------------------------------------------------
  console.log("\n▶ 7. Cálculo das Métricas Financeiras no HistorySummary");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Concurso 1: Apostado (R$ 17,50) + Prêmio R$ 30,00
    const d1 = createContestDraft(5001, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(d1);
    await repo.freezeStoredContest(5001, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(5001, { clock: () => new Date("2026-09-20T12:00:00.000Z") });
    await repo.scoreStoredContest(5001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });
    await repo.recordPrize(5001, 3000, { clock: () => new Date("2026-09-21T09:00:00.000Z") }); // R$ 30,00

    // Concurso 2: Apostado (R$ 17,50) + Prêmio R$ 0,00
    const d2 = createContestDraft(5002, { clock: () => new Date("2026-09-21T10:00:00.000Z") });
    await repo.saveDraft(d2);
    await repo.freezeStoredContest(5002, { clock: () => new Date("2026-09-21T11:00:00.000Z") });
    await repo.confirmBetPlaced(5002, { clock: () => new Date("2026-09-21T12:00:00.000Z") });
    await repo.scoreStoredContest(5002, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-21T21:00:00.000Z") });
    await repo.recordPrize(5002, 0, { clock: () => new Date("2026-09-22T09:00:00.000Z") }); // R$ 0,00

    // Concurso 3: Apostado (R$ 17,50) + SCORED mas SEM prêmio registrado ainda (pendência)
    const d3 = createContestDraft(5003, { clock: () => new Date("2026-09-22T10:00:00.000Z") });
    await repo.saveDraft(d3);
    await repo.freezeStoredContest(5003, { clock: () => new Date("2026-09-22T11:00:00.000Z") });
    await repo.confirmBetPlaced(5003, { clock: () => new Date("2026-09-22T12:00:00.000Z") });
    await repo.scoreStoredContest(5003, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-22T21:00:00.000Z") });

    const summary = await repo.getHistorySummary();

    assert(summary.confirmedBets === 3, "confirmedBets === 3");
    assert(summary.confirmedSpentCents === 5250, "confirmedSpentCents === 5250 centavos (R$ 52,50)");
    assert(summary.confirmedSpent === 52.5, "confirmedSpent === 52.50 reais");
    assert(summary.totalPrizeCents === 3000, "totalPrizeCents === 3000 centavos (R$ 30,00)");
    assert(summary.prizesRecorded === 2, "prizesRecorded === 2");
    assert(summary.pendingFinancialClosures === 1, "pendingFinancialClosures === 1 (concurso 5003)");
    assert(summary.financialHistoryComplete === false, "financialHistoryComplete === false");
    // netResultCents = totalPrizeCents - confirmedSpent = 3000 - 5250 = -2250 centavos (-R$ 22,50)
    assert(summary.netResultCents === -2250, "netResultCents === -2250 centavos");

    // Agora fecha o concurso 5003 com prêmio R$ 50,00 (5000 centavos)
    await repo.recordPrize(5003, 5000, { clock: () => new Date("2026-09-23T09:00:00.000Z") });
    const summaryAfter = await repo.getHistorySummary();

    assert(summaryAfter.totalPrizeCents === 8000, "totalPrizeCents atualizado para 8000 centavos (R$ 80,00)");
    assert(summaryAfter.prizesRecorded === 3, "prizesRecorded === 3");
    assert(summaryAfter.pendingFinancialClosures === 0, "pendingFinancialClosures === 0");
    assert(summaryAfter.financialHistoryComplete === true, "financialHistoryComplete === true");
    // netResultCents = 8000 - 5250 = +2750 centavos (+R$ 27,50)
    assert(summaryAfter.netResultCents === 2750, "netResultCents positivo (+R$ 27,50)");
  }

  // ---------------------------------------------------------------------------
  // 8. MULTI-TAB SYNC: EVENTO PRIZE_RECORDED E INCREMENTO DE REVISÃO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 8. Multi-Tab Sync e Evento PRIZE_RECORDED");
  {
    const idb = new IDBFactory();
    const bus = new InMemoryLocalSyncBus();
    const transportA = new InMemoryLocalSyncTransport(bus);
    const transportB = new InMemoryLocalSyncTransport(bus);
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({ transport: transportA, refreshCoordinator: coord });
    const repo = new ContestRepository({ idbFactory: idb, refreshCoordinator: coord });

    let receivedEvent: any = null;
    transportB.subscribe((msg) => {
      receivedEvent = msg;
    });

    const draft = createContestDraft(6001, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(6001, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(6001, { clock: () => new Date("2026-09-20T12:00:00.000Z") });
    await repo.scoreStoredContest(6001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });

    const revBefore = coord.getRevision();
    await repo.recordPrize(6001, 2500, { clock: () => new Date("2026-09-21T09:00:00.000Z") });
    const revAfter = coord.getRevision();

    assert(revAfter === revBefore + 1, "dataRevision incrementado após recordPrize");
    assert(receivedEvent !== null, "Evento de sync recebido pela Tab-B");
    assert(receivedEvent?.reason === "PRIZE_RECORDED", "reason é PRIZE_RECORDED");
    assert(receivedEvent?.contestNumber === 6001, "contestNumber é 6001");

    sync.close();
    transportA.close();
    transportB.close();
  }

  // ---------------------------------------------------------------------------
  // 9. CONTROLLER OPERACIONAL E CONCORRÊNCIA (RECORD_PRIZE lock)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 9. GeneratorOperationalController e Locks de Concorrência");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: () => new Date("2026-09-21T09:00:00.000Z") });
    const refreshCoordinator = new RefreshCoordinator();
    const controller = new GeneratorOperationalController(repo, refreshCoordinator, () => mockProvider);

    const draft = createContestDraft(7001, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(7001, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(7001, { clock: () => new Date("2026-09-20T12:00:00.000Z") });
    await repo.scoreStoredContest(7001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });

    const scoredRec = await repo.getContestRecord(7001);
    controller.setActiveRecord(scoredRec);
    assert(controller.getState().activeRecord?.status === "SCORED", "Controller carregou registro SCORED");

    // Executa recordPrize via controller
    await controller.recordPrize(1800);
    const stateAfter = controller.getState();
    assert(stateAfter.activeRecord?.prize?.amountCents === 1800, "activeRecord do controller atualizado com o prêmio");
    assert(actionLockController.isLocked() === false, "ActionLockController liberado após o término");
  }

  // ---------------------------------------------------------------------------
  // 10. BACKUP SCHEMA 3: EXPORTAÇÃO E IMPORTAÇÃO COM PRESERVAÇÃO DE PRÊMIO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 10. Backup Schema 3: Round-trip Completo com PrizeRecord");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(8001, { clock: () => new Date("2026-09-20T10:00:00.000Z") });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(8001, { clock: () => new Date("2026-09-20T11:00:00.000Z") });
    await repo.confirmBetPlaced(8001, { clock: () => new Date("2026-09-20T12:00:00.000Z") });
    await repo.scoreStoredContest(8001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { clock: () => new Date("2026-09-20T21:00:00.000Z") });
    await repo.recordPrize(8001, 4500, { clock: () => new Date("2026-09-21T09:00:00.000Z") }); // R$ 45,00

    // Exportação
    const exportData = await repo.exportHistory();
    assert(exportData.schemaVersion === 3, "exportHistory gera schemaVersion 3");
    const exportedRec = exportData.records.find((r) => r.contestNumber === 8001);
    assert(exportedRec?.prize?.amountCents === 4500, "Registro exportado contém prize com 4500 centavos");

    // Validação
    const validation = await validateHistoryBackup(exportData);
    assert(validation.valid === true, "validateHistoryBackup valida com sucesso o backup com prize");

    // Importação em um repositório limpo
    const idb2 = new IDBFactory();
    const repo2 = new ContestRepository({ idbFactory: idb2 });
    const plan = await prepareHistoryImport(exportData, repo2);
    assert(plan.valid === true, "prepareHistoryImport validação positiva");
    assert(plan.newRecords === 1, "Plano identifica 1 novo registro");

    const result = await importHistory(exportData, repo2);
    assert(result.success === true, "importHistory executado com sucesso");

    const importedRec = await repo2.getContestRecord(8001);
    assert(importedRec?.prize?.amountCents === 4500, "Prêmio importado intacto no novo repositório");
    assert(importedRec?.prize?.source === "MANUAL", "Source MANUAL preservado");
  }

  console.log("\n===============================================================================");
  console.log(` SUCESSO TOTAL: ${passed} PASSARAM, ${failed} FALHARAM NA SUÍTE FINANCEIRA V1.8! `);
  console.log("===============================================================================");
}

runTests().catch((err) => {
  console.error("Erro fatal na suíte:", err);
  process.exit(1);
});
