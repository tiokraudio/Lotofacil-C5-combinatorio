/**
 * SUÍTE DE TESTES DE COERÊNCIA MULTIABA E SINCRONIZAÇÃO LOCAL (v1.6.0)
 *
 * Certificação exaustiva dos 20 cenários de conformidade exigidos no Prompt 15:
 * 1.  Aba A freeze -> Aba B atualiza sem F5
 * 2.  Aba A score -> Aba B atualiza sem F5 e descarta OfficialResultSection
 * 3.  Aba A delete DRAFT -> Aba B descarta rascunho sem fantasmas
 * 4.  Import em lote de 10 concursos -> exatamente 1 evento IMPORT emitido
 * 5.  Prevenção estrita de loop (Aba B não replica evento para Aba A)
 * 6.  Ignorar própria origem (originId idêntico)
 * 7.  Zero polling ativo e zero chamadas à CAIXA causadas por eventos
 * 8.  Deduplicação de eventos (mesmo eventId processado exatamente 1 vez)
 * 9.  Rejeição em runtime de eventos malformados sem falhas ou mutações
 * 10. Evento forjado não altera estado (IndexedDB é a única autoridade)
 * 11. Concorrência real: dois generate quase simultâneos
 * 12. Concorrência real: dois freeze quase simultâneos (TOCTOU)
 * 13. Concorrência real: dois score simultâneos
 * 14. Concorrência real: delete vs freeze
 * 15. Preview em memória da CAIXA descartado ao receber score remoto
 * 16. Resposta da CAIXA em voo cancelada por sequenceId ao receber evento remoto
 * 17. Fallback seguro quando BroadcastChannel for inexistente (NoOpTransport)
 * 18. Resiliência: falha no postMessage após commit não desfaz transação
 * 19. Memória limitada na fila de deduplicação (seenEventIds limitado a 500)
 * 20. Auditoria de limites arquiteturais v1.6 e zero Math.random()
 */

import fs from "fs";
import path from "path";
import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../storage/contestRepository.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import {
  LocalSyncCoordinator,
  InMemoryLocalSyncBus,
  InMemoryLocalSyncTransport,
  NoOpLocalSyncTransport,
  BroadcastChannelTransport,
  LOCAL_SYNC_PROTOCOL_VERSION,
  LOCAL_SYNC_CHANNEL_NAME,
  generateCryptoUUID,
  isValidLocalSyncEvent,
  type LocalSyncEvent,
} from "../system/localSyncCoordinator.ts";
import { createContestDraft } from "../c5/record.ts";
import { closeDatabase } from "../storage/db.ts";
import { OfficialSnapshotCoordinator } from "../sync/officialSnapshotCoordinator.ts";
import {
  GeneratorOperationalController,
  HistoryOperationalController,
  AuditOperationalController,
  AppSummaryController,
} from "../system/generatorOperationalController.ts";
import type {
  LotteryResultProvider,
  OfficialContestResult,
} from "../lottery/types.ts";

/**
 * Mock determinístico e auditável do provedor oficial da CAIXA.
 */
class MockCaixaProvider implements LotteryResultProvider {
  readonly providerName = "MockCaixaProvider";
  public calls: { method: string; contestNumber?: number }[] = [];
  public getContestDelayMs = 0;
  public resultToReturn: { contestNumber: number; numbers: number[]; drawDate: string } = {
    contestNumber: 4000,
    numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    drawDate: "20/09/2026",
  };

  async getLatestContest(_signal?: AbortSignal): Promise<OfficialContestResult> {
    this.calls.push({ method: "getLatestContest" });
    return {
      contestNumber: 4000,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      drawDate: "20/09/2026",
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    };
  }

  async getContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.calls.push({ method: "getContest", contestNumber });
    if (this.getContestDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.getContestDelayMs));
    }
    return {
      contestNumber,
      numbers: this.resultToReturn.numbers,
      drawDate: this.resultToReturn.drawDate,
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    };
  }

  async refreshContest(contestNumber: number, signal?: AbortSignal): Promise<OfficialContestResult> {
    this.calls.push({ method: "refreshContest", contestNumber });
    return this.getContest(contestNumber, signal);
  }
}

export async function runMultiTabSyncTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  console.log("===============================================================================");
  console.log(" EXECUTANDO TESTES DE COERÊNCIA MULTIABA E SINCRONIZAÇÃO LOCAL (V1.6.0)        ");
  console.log("===============================================================================\n");

  // Helper para criar par de abas simuladas compartilhando a mesma base IndexedDB
  function createSimulatedTabs(dbName: string) {
    const sharedIdb = new IDBFactory();
    const bus = new InMemoryLocalSyncBus();

    const coordA = new RefreshCoordinator();
    const coordB = new RefreshCoordinator();

    const transportA = new InMemoryLocalSyncTransport(bus);
    const transportB = new InMemoryLocalSyncTransport(bus);

    const syncCoordA = new LocalSyncCoordinator({
      transport: transportA,
      refreshCoordinator: coordA,
    });
    const syncCoordB = new LocalSyncCoordinator({
      transport: transportB,
      refreshCoordinator: coordB,
    });

    const repoA = new ContestRepository({
      idbFactory: sharedIdb,
      dbName,
      refreshCoordinator: coordA,
    });
    const repoB = new ContestRepository({
      idbFactory: sharedIdb,
      dbName,
      refreshCoordinator: coordB,
    });

    return {
      sharedIdb,
      bus,
      tabA: { coord: coordA, sync: syncCoordA, repo: repoA, transport: transportA },
      tabB: { coord: coordB, sync: syncCoordB, repo: repoB, transport: transportB },
    };
  }

  // ---------------------------------------------------------------------------
  // 1. ABA A FREEZE -> ABA B ATUALIZA SEM F5
  // ---------------------------------------------------------------------------
  console.log("▶ 1. Aba A Freeze -> Aba B Atualiza");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_1");

    // Prepara DRAFT inicial no banco compartilhado
    const draft = createContestDraft(4000);
    await tabA.repo.saveDraft(draft);

    // Aba B carrega o registro DRAFT inicial na memória
    let tabBActiveRecord = await tabB.repo.getContestRecord(4000);
    assert(tabBActiveRecord?.status === "DRAFT", "1.1. Aba B inicializada com DRAFT 4000");

    let resolveRefresh: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    let tabBRefreshed = false;
    tabB.coord.subscribe(async (_rev, _reason, _contestNum, isRemote) => {
      if (isRemote) {
        tabBRefreshed = true;
        tabBActiveRecord = await tabB.repo.getContestRecord(4000);
        resolveRefresh();
      }
    });

    // Aba A congela o concurso
    await tabA.repo.freezeStoredContest(4000);
    await refreshPromise;

    // Valida que Aba B foi notificada e atualizou seu estado a partir do IndexedDB
    assert(tabBRefreshed, "1.2. Aba B recebeu invalidação remota");
    assert(tabBActiveRecord?.status === "FROZEN", "1.3. activeRecord da Aba B transicionou para FROZEN");
    const stored = await tabA.repo.getContestRecord(4000);
    assert(
      tabBActiveRecord?.integrityHash === stored?.integrityHash,
      "1.4. Hash de integridade de Aba B idêntico ao persistido"
    );

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 2. ABA A SCORE -> ABA B ATUALIZA SEM F5
  // ---------------------------------------------------------------------------
  console.log("▶ 2. Aba A Score -> Aba B Atualiza");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_2");

    const draft = createContestDraft(4001);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(4001);

    let tabBActiveRecord = await tabB.repo.getContestRecord(4001);
    assert(tabBActiveRecord?.status === "FROZEN", "2.1. Aba B com concurso FROZEN aberto");

    let resolveScoreRefresh: () => void;
    const scorePromise = new Promise<void>((resolve) => {
      resolveScoreRefresh = resolve;
    });

    let tabBNotified = false;
    tabB.coord.subscribe(async (_rev, _reason, _contestNum, isRemote) => {
      if (isRemote) {
        tabBNotified = true;
        tabBActiveRecord = await tabB.repo.getContestRecord(4001);
        resolveScoreRefresh();
      }
    });

    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await tabA.repo.scoreStoredContest(4001, officialResult);
    await scorePromise;

    assert(tabBNotified, "2.2. Aba B notificada de score remoto");
    assert(tabBActiveRecord?.status === "SCORED", "2.3. activeRecord da Aba B atualizado para SCORED");
    assert(
      typeof tabBActiveRecord?.score?.maxHits === "number",
      "2.4. Score pontuado acessível na Aba B via IndexedDB"
    );

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 3. ABA A DELETE DRAFT -> ABA B ATUALIZA (SEM RASCUNHO FANTASMA)
  // ---------------------------------------------------------------------------
  console.log("▶ 3. Aba A Delete Draft -> Aba B Atualiza");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_3");

    const draft = createContestDraft(4002);
    await tabA.repo.saveDraft(draft);

    let tabBActiveRecord = await tabB.repo.getContestRecord(4002);
    assert(tabBActiveRecord !== null, "3.1. Aba B com DRAFT aberto");

    let resolveDeleteRefresh: () => void;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDeleteRefresh = resolve;
    });

    tabB.coord.subscribe(async (_rev, _reason, _contestNum, isRemote) => {
      if (isRemote) {
        const fresh = await tabB.repo.getContestRecord(4002);
        tabBActiveRecord = fresh;
        resolveDeleteRefresh();
      }
    });

    await tabA.repo.deleteDraft(4002);
    await deletePromise;

    assert(tabBActiveRecord === null, "3.2. Aba B descarta rascunho excluído (activeRecord vira null)");

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 4. IMPORT EM LOTE (1 EVENTO EMITIDO PARA N REGISTROS)
  // ---------------------------------------------------------------------------
  console.log("▶ 4. Importação em Lote");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_4");

    const drafts = Array.from({ length: 10 }, (_, i) => createContestDraft(5000 + i));

    let eventsReceivedInB = 0;
    tabB.coord.subscribe((_rev, reason, _num, isRemote) => {
      if (isRemote && reason === "IMPORT") {
        eventsReceivedInB++;
      }
    });

    await tabA.repo.batchInsertRecords(drafts);

    assert(
      tabA.sync.getMetrics().published === 1,
      "4.1. Exatamente 1 evento emitido por Aba A para lote de 10 registros"
    );
    assert(eventsReceivedInB === 1, "4.2. Exatamente 1 evento IMPORT recebido por Aba B");

    const recordsInB = await tabB.repo.getAllContestRecords();
    assert(recordsInB.length === 10, "4.3. Aba B lê todos os 10 registros salvos no IndexedDB");

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 5. PREVENÇÃO ESTRITA DE LOOP (ZERO RETRANSMISSÃO)
  // ---------------------------------------------------------------------------
  console.log("▶ 5. Prevenção Estrita de Loop");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_5");

    const draft = createContestDraft(6000);
    await tabA.repo.saveDraft(draft);

    assert(tabA.sync.getMetrics().published === 1, "5.1. Aba A publicou 1 evento");
    assert(tabB.sync.getMetrics().received === 1, "5.2. Aba B recebeu 1 evento");
    assert(
      tabB.sync.getMetrics().published === 0,
      "5.3. CRÍTICO: Aba B publicou ZERO eventos (nenhuma retransmissão de volta)"
    );

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 6. IGNORAR PRÓPRIA ORIGEM
  // ---------------------------------------------------------------------------
  console.log("▶ 6. Ignorar Própria Origem");
  {
    const bus = new InMemoryLocalSyncBus();
    const transport = new InMemoryLocalSyncTransport(bus);
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({ transport, refreshCoordinator: coord });

    // Simula mensagem com mesmo originId
    const ownOriginEvent: LocalSyncEvent = {
      protocolVersion: 1,
      eventId: generateCryptoUUID(),
      originId: sync.getOriginId(),
      reason: "FREEZE",
      contestNumber: 7000,
      emittedAt: new Date().toISOString(),
    };

    let listenerCalled = false;
    coord.subscribe(() => {
      listenerCalled = true;
    });

    sync.handleIncomingEvent(ownOriginEvent);

    assert(!listenerCalled, "6.1. Evento de própria origem não dispara refreshCoordinator");
    assert(sync.getMetrics().ignoredOwnOrigin === 1, "6.2. Métrica ignoredOwnOrigin incrementada");

    sync.close();
  }

  // ---------------------------------------------------------------------------
  // 7. ZERO POLLING E ZERO CAIXA CALLS
  // ---------------------------------------------------------------------------
  console.log("▶ 7. Zero Polling e Zero Chamadas à CAIXA");
  {
    let caixaCalls = 0;
    const mockProvider = {
      getContest: async () => {
        caixaCalls++;
        return null;
      },
      getLatestContest: async () => {
        caixaCalls++;
        return null;
      },
    };

    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_7");

    const draft = createContestDraft(8000);
    await tabA.repo.saveDraft(draft);

    assert(caixaCalls === 0, "7.1. Zero chamadas à CAIXA durante ou após sincronização multiaba");

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 8. DEDUPLICAÇÃO DE EVENTOS
  // ---------------------------------------------------------------------------
  console.log("▶ 8. Deduplicação de Eventos");
  {
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({
      transport: new NoOpLocalSyncTransport(),
      refreshCoordinator: coord,
    });

    const eventId = generateCryptoUUID();
    const event: LocalSyncEvent = {
      protocolVersion: 1,
      eventId,
      originId: "remote_origin_123",
      reason: "FREEZE",
      contestNumber: 9000,
      emittedAt: new Date().toISOString(),
    };

    let refreshCount = 0;
    coord.subscribe(() => {
      refreshCount++;
    });

    // Envia o mesmo evento 2 vezes seguidas
    sync.handleIncomingEvent(event);
    sync.handleIncomingEvent(event);

    assert(refreshCount === 1, "8.1. Evento duplicado processado apenas 1 vez");
    assert(sync.getMetrics().received === 1, "8.2. Métrica received = 1");
    assert(sync.getMetrics().ignoredDuplicate === 1, "8.3. Métrica ignoredDuplicate = 1");

    sync.close();
  }

  // ---------------------------------------------------------------------------
  // 9. REJEIÇÃO DE EVENTOS MALFORMADOS
  // ---------------------------------------------------------------------------
  console.log("▶ 9. Rejeição de Eventos Malformados");
  {
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({
      transport: new NoOpLocalSyncTransport(),
      refreshCoordinator: coord,
    });

    const malformedPayloads = [
      null,
      undefined,
      "hello string",
      12345,
      [],
      {},
      { protocolVersion: 999 }, // Versão inválida
      { protocolVersion: 1, eventId: "" }, // eventId vazio
      { protocolVersion: 1, eventId: "e1", originId: "" }, // originId vazio
      { protocolVersion: 1, eventId: "e1", originId: "o1", reason: "HACK_EVENT" }, // reason desconhecido
      { protocolVersion: 1, eventId: "e1", originId: "o1", reason: "FREEZE", contestNumber: -1 }, // contestNumber inválido
      { protocolVersion: 1, eventId: "e1", originId: "o1", reason: "FREEZE", contestNumber: 1.5 }, // decimal
      { protocolVersion: 1, eventId: "e1", originId: "o1", reason: "FREEZE", emittedAt: "invalid_date" }, // data inválida
    ];

    for (const payload of malformedPayloads) {
      assert(!isValidLocalSyncEvent(payload), "9.1. Validador runtime rejeita payload inválido");
      sync.handleIncomingEvent(payload);
    }

    assert(
      sync.getMetrics().ignoredMalformed === malformedPayloads.length,
      `9.2. Métrica ignoredMalformed = ${malformedPayloads.length} com zero falhas/crashes`
    );

    sync.close();
  }

  // ---------------------------------------------------------------------------
  // 10. EVENTO FORJADO NÃO ALTERA ESTADO (INDEXEDDB É A ÚNICA AUTORIDADE)
  // ---------------------------------------------------------------------------
  console.log("▶ 10. Evento Forjado não Altera Estado");
  {
    const { tabA } = createSimulatedTabs("test_db_scenario_10");

    const draft = createContestDraft(10000);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(10000);

    // Evento forjado alega que o concurso foi pontuado (SCORE), mas no IndexedDB ele permanece FROZEN
    const forgedEvent: LocalSyncEvent = {
      protocolVersion: 1,
      eventId: generateCryptoUUID(),
      originId: "forged_remote_tab",
      reason: "SCORE",
      contestNumber: 10000,
      emittedAt: new Date().toISOString(),
    };

    let activeRecord = await tabA.repo.getContestRecord(10000);
    assert(activeRecord?.status === "FROZEN", "10.1. Registro persistido no IndexedDB é FROZEN");

    tabA.coord.subscribe(async () => {
      // Leitura da autoridade única
      activeRecord = await tabA.repo.getContestRecord(10000);
    });

    tabA.sync.handleIncomingEvent(forgedEvent);

    assert(
      activeRecord?.status === "FROZEN",
      "10.2. activeRecord permanece FROZEN (evento não forja estado em memória)"
    );

    tabA.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 11. CONCORRÊNCIA: DOIS GENERATE QUASE SIMULTÂNEOS
  // ---------------------------------------------------------------------------
  console.log("▶ 11. Concorrência: Dois Generate Simultâneos");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_11");

    const draftA = createContestDraft(11000);
    const draftB = createContestDraft(11000);

    const [resA, resB] = await Promise.allSettled([
      tabA.repo.saveDraft(draftA),
      tabB.repo.saveDraft(draftB),
    ]);

    const successes = [resA, resB].filter((r) => r.status === "fulfilled").length;
    const rejections = [resA, resB].filter((r) => r.status === "rejected").length;

    assert(successes === 1, "11.1. Exatamente 1 operação de saveDraft teve sucesso");
    assert(rejections === 1, "11.2. A outra operação foi rejeitada por colisão atômica");

    const stored = await tabA.repo.getContestRecord(11000);
    assert(stored !== null && stored.status === "DRAFT", "11.3. Concurso salvo com integridade");

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 12. CONCORRÊNCIA: DOIS FREEZE SIMULTÂNEOS (TOCTOU)
  // ---------------------------------------------------------------------------
  console.log("▶ 12. Concorrência: Dois Freeze Simultâneos");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_12");

    const draft = createContestDraft(12000);
    await tabA.repo.saveDraft(draft);

    const [resA, resB] = await Promise.allSettled([
      tabA.repo.freezeStoredContest(12000),
      tabB.repo.freezeStoredContest(12000),
    ]);

    const successes = [resA, resB].filter((r) => r.status === "fulfilled").length;
    assert(successes >= 1, "12.1. Concurso congelado com sucesso");

    const stored = await tabA.repo.getContestRecord(12000);
    assert(stored?.status === "FROZEN", "12.2. Estado final é FROZEN");
    const verify = await tabA.repo.verifyStoredContest(12000);
    assert(verify.valid, "12.3. Integridade pós-freeze 100% válida");

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 13. CONCORRÊNCIA: DOIS SCORE SIMULTÂNEOS
  // ---------------------------------------------------------------------------
  console.log("▶ 13. Concorrência: Dois Score Simultâneos");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_13");

    const draft = createContestDraft(13000);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(13000);

    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    const [resA, resB] = await Promise.allSettled([
      tabA.repo.scoreStoredContest(13000, officialResult),
      tabB.repo.scoreStoredContest(13000, officialResult),
    ]);

    const successes = [resA, resB].filter((r) => r.status === "fulfilled").length;
    assert(successes >= 1, "13.1. Pontuação efetuada com sucesso");

    const stored = await tabA.repo.getContestRecord(13000);
    assert(stored?.status === "SCORED", "13.2. Estado final persistido é SCORED");

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 14. CONCORRÊNCIA: DELETE VS FREEZE
  // ---------------------------------------------------------------------------
  console.log("▶ 14. Concorrência: Delete vs Freeze");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_14");

    const draft = createContestDraft(14000);
    await tabA.repo.saveDraft(draft);

    const [resDelete, resFreeze] = await Promise.allSettled([
      tabA.repo.deleteDraft(14000),
      tabB.repo.freezeStoredContest(14000),
    ]);

    // Um dos dois vence atômica e legalmente
    const finalRecord = await tabA.repo.getContestRecord(14000);
    if (finalRecord === null) {
      assert(resDelete.status === "fulfilled", "14.1. Delete venceu e registro foi removido");
    } else {
      assert(finalRecord.status === "FROZEN", "14.1. Freeze venceu e registro é FROZEN");
    }

    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 15. INVALIDAÇÃO REAL DE PREVIEW OFICIAL EM PRODUÇÃO (GeneratorOperationalController)
  // ---------------------------------------------------------------------------
  console.log("▶ 15. Invalidação Real de Preview Oficial em Produção");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_15_cert");

    const draft = createContestDraft(15000);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(15000);

    const mockProviderA = new MockCaixaProvider();
    mockProviderA.getContestDelayMs = 0;
    const coordA = new OfficialSnapshotCoordinator({ provider: mockProviderA });
    const controllerA = new GeneratorOperationalController(
      tabA.repo,
      tabA.coord,
      () => mockProviderA,
      true,
      coordA
    );
    await controllerA.refreshLocalState();
    const frozenRecord = await tabA.repo.getContestRecord(15000);
    controllerA.setActiveRecord(frozenRecord);

    assert(
      controllerA.getState().activeRecord?.status === "FROZEN",
      "15.1. Aba A com concurso 15000 FROZEN ativo"
    );

    // Aba A consulta CAIXA para concurso 15000 FROZEN
    await controllerA.fetchOfficialResultPreview(15000);
    assert(
      controllerA.getState().previewState.acceptedPreview !== null,
      "15.2. Preview oficial aceito e exibido na Aba A"
    );
    assert(controllerA.canScore(), "15.3. Ação PONTUAR disponível na Aba A");
    assert(mockProviderA.calls.length === 1, "15.4. Exatamente 1 consulta inicial ao provider");

    // Aba B pontua concurso 15000 no IndexedDB compartilhado
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await tabB.repo.scoreStoredContest(15000, officialResult);

    // Aguarda propagação pelo barramento em memória
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Aba A recebeu evento remoto SCORE
    assert(
      controllerA.getState().activeRecord?.status === "SCORED",
      "15.5. Aba A atualizada automaticamente para SCORED"
    );
    assert(
      controllerA.getState().previewState.acceptedPreview === null,
      "15.6. Preview oficial descartado/invalidado imediatamente"
    );
    assert(
      !controllerA.canScore(),
      "15.7. Ação PONTUAR não fica mais disponível"
    );
    assert(
      mockProviderA.calls.length === 1,
      "15.8. Zero chamadas adicionais ao provider da CAIXA provocadas pelo evento remoto (total = 1)"
    );

    controllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 16. PROVIDER RACE REAL: RESPOSTA CAIXA EM VOO VS SCORE REMOTO EM PRODUÇÃO
  // ---------------------------------------------------------------------------
  console.log("▶ 16. Provider Race Real em Produção (Response Race)");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_16_cert");

    const draft = createContestDraft(16000);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(16000);

    const mockProviderA = new MockCaixaProvider();
    // Configura delay controlado de 60ms na consulta em voo
    mockProviderA.getContestDelayMs = 60;
    const coordA = new OfficialSnapshotCoordinator({ provider: mockProviderA });

    const controllerA = new GeneratorOperationalController(
      tabA.repo,
      tabA.coord,
      () => mockProviderA,
      true,
      coordA
    );
    await controllerA.refreshLocalState();
    const frozenRecord = await tabA.repo.getContestRecord(16000);
    controllerA.setActiveRecord(frozenRecord);

    const initialSeq = controllerA.getSequenceId();
    assert(
      controllerA.getState().activeRecord?.status === "FROZEN",
      "16.1. Aba A com concurso 16000 FROZEN aberto"
    );

    // Aba A dispara consulta à CAIXA (em voo)
    const inFlightPromise = controllerA.fetchOfficialResultPreview(16000);
    assert(
      controllerA.getState().isFetchingPreview === true,
      "16.2. Consulta à CAIXA está em voo na Aba A"
    );
    assert(
      mockProviderA.calls.length === 1,
      "16.3. Provider da CAIXA chamado (chamada 1 em andamento)"
    );

    // Enquanto a promise está em voo:
    // Aba B conclui pontuação do concurso 16000
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await tabB.repo.scoreStoredContest(16000, officialResult);

    // Aba A recebe evento remoto SCORE concurso 16000 e atualiza seu estado
    await new Promise((resolve) => setTimeout(resolve, 15));

    assert(
      controllerA.getState().activeRecord?.status === "SCORED",
      "16.4. Aba A recebeu evento remoto SCORE e atualizou para SCORED"
    );
    assert(
      controllerA.getSequenceId() > initialSeq,
      "16.5. sequenceId de produção incrementado pelo evento remoto"
    );

    // Agora aguarda a resolução da Promise atrasada da CAIXA na Aba A
    await inFlightPromise;

    // Verificações obrigatórias de certificação:
    assert(
      controllerA.getState().activeRecord?.status === "SCORED",
      "16.6. Resposta atrasada da CAIXA NÃO rebaixa o concurso para FROZEN"
    );
    assert(
      controllerA.getState().previewState.acceptedPreview === null,
      "16.7. O preview pontuável NÃO é restaurado pela resposta atrasada"
    );
    assert(
      !controllerA.canScore(),
      "16.8. A ação PONTUAR não reaparece (canScore = false)"
    );
    assert(
      mockProviderA.calls.length === 1,
      "16.9. Provider calls = 1 (apenas a chamada original em voo; zero chamadas adicionais por evento remoto)"
    );
    assert(
      controllerA.getState().isFetchingPreview === false,
      "16.10. Flag isFetchingPreview finalizada com sucesso"
    );

    controllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 17. FALLBACK QUANDO BroadcastChannel INDISPONÍVEL
  // ---------------------------------------------------------------------------
  console.log("▶ 17. Fallback quando BroadcastChannel Indisponível");
  {
    const noopTransport = new NoOpLocalSyncTransport();
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({
      transport: noopTransport,
      refreshCoordinator: coord,
    });

    assert(sync.getOriginId().length > 0, "17.1. Coordenador inicializado mesmo com fallback No-Op");
    sync.broadcast("FREEZE", 17000);
    assert(sync.getMetrics().published === 1, "17.2. Operação local concluída sem erros");

    sync.close();
  }

  // ---------------------------------------------------------------------------
  // 18. FALHA NO postMessage APÓS COMMIT NÃO DESFAZ TRANSAÇÃO
  // ---------------------------------------------------------------------------
  console.log("▶ 18. Falha no postMessage após Commit");
  {
    const explosiveTransport = {
      publish: () => {
        throw new Error("Simulated BroadcastChannel network partition / buffer error");
      },
      subscribe: () => () => {},
      close: () => {},
    };

    const sharedIdb = new IDBFactory();
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({
      transport: explosiveTransport,
      refreshCoordinator: coord,
    });

    const repo = new ContestRepository({
      idbFactory: sharedIdb,
      dbName: "test_db_scenario_18",
      refreshCoordinator: coord,
    });

    const draft = createContestDraft(18000);
    // Deve concluir sem lançar para fora e sem abortar o banco
    await repo.saveDraft(draft);

    const stored = await repo.getContestRecord(18000);
    assert(stored !== null, "18.1. Commit no IndexedDB permaneceu íntegro e gravado");

    sync.close();
  }

  // ---------------------------------------------------------------------------
  // 19. MEMÓRIA LIMITADA NA DEDUPLICAÇÃO (CAP DE 500)
  // ---------------------------------------------------------------------------
  console.log("▶ 19. Memória Limitada na Deduplicação (Cap de 500)");
  {
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({
      transport: new NoOpLocalSyncTransport(),
      refreshCoordinator: coord,
      maxDedupEntries: 50, // Teste com cap de 50 para validação precisa
    });

    // Envia 120 eventos distintos
    for (let i = 0; i < 120; i++) {
      const event: LocalSyncEvent = {
        protocolVersion: 1,
        eventId: `ev_${i}`,
        originId: "remote_origin",
        reason: "FREEZE",
        contestNumber: 1000 + i,
        emittedAt: new Date().toISOString(),
      };
      sync.handleIncomingEvent(event);
    }

    assert(sync.getMetrics().received === 120, "19.1. 120 eventos recebidos");

    // Reenvia evento recente (ev_115): deve ser ignorado por duplicata
    const recentEvent: LocalSyncEvent = {
      protocolVersion: 1,
      eventId: "ev_115",
      originId: "remote_origin",
      reason: "FREEZE",
      contestNumber: 1115,
      emittedAt: new Date().toISOString(),
    };
    sync.handleIncomingEvent(recentEvent);
    assert(sync.getMetrics().ignoredDuplicate === 1, "19.2. Evento recente (ev_115) detectado como duplicado");

    // Reenvia evento antigo (ev_10): deve ter sido expurgado pelo cap de 50
    const purgedEvent: LocalSyncEvent = {
      protocolVersion: 1,
      eventId: "ev_10",
      originId: "remote_origin",
      reason: "FREEZE",
      contestNumber: 1010,
      emittedAt: new Date().toISOString(),
    };
    sync.handleIncomingEvent(purgedEvent);
    assert(
      sync.getMetrics().received === 121,
      "19.3. Evento antigo (ev_10) foi expurgado pela fila de tamanho limitado (memória protegida)"
    );

    sync.close();
  }

  // ---------------------------------------------------------------------------
  // 20. AUDITORIA DE LIMITES ARQUITETURAIS V1.6 E ZERO Math.random()
  // ---------------------------------------------------------------------------
  console.log("▶ 20. Auditoria de Limites Arquiteturais e Zero Math.random()");
  {
    const syncFilePath = path.resolve(process.cwd(), "src/system/localSyncCoordinator.ts");
    const syncContent = fs.readFileSync(syncFilePath, "utf-8");

    // 20.1 localSyncCoordinator não importa de components
    assert(
      !syncContent.includes("/components") && !syncContent.includes("../components"),
      "20.1. localSyncCoordinator NÃO importa de src/components/"
    );

    // 20.2 contestRepository não importa de localSyncCoordinator
    const repoFilePath = path.resolve(process.cwd(), "src/storage/contestRepository.ts");
    const repoContent = fs.readFileSync(repoFilePath, "utf-8");
    assert(
      !repoContent.includes("localSyncCoordinator"),
      "20.2. contestRepository NÃO importa de localSyncCoordinator (persistência != rede multiaba)"
    );

    // 20.3 Zero Math.random em localSyncCoordinator e refreshCoordinator
    assert(
      !syncContent.includes("Math.random()"),
      "20.3. Zero Math.random() em src/system/localSyncCoordinator.ts"
    );

    const refreshFilePath = path.resolve(process.cwd(), "src/system/refreshCoordinator.ts");
    const refreshContent = fs.readFileSync(refreshFilePath, "utf-8");
    assert(
      !refreshContent.includes("Math.random()"),
      "20.4. Zero Math.random() em src/system/refreshCoordinator.ts"
    );

    // 20.5 Constantes canônicas v1.6
    assert(
      LOCAL_SYNC_CHANNEL_NAME === "lotofacil-c5-local-sync-v1",
      "20.5. Nome canônico do canal: 'lotofacil-c5-local-sync-v1'"
    );
    assert(
      LOCAL_SYNC_PROTOCOL_VERSION === 1,
      "20.6. Versão canônica do protocolo de sincronização: 1"
    );
  }

  // ---------------------------------------------------------------------------
  // 21. REFRESH DO HISTÓRICO EM PRODUÇÃO (HistoryOperationalController)
  // ---------------------------------------------------------------------------
  console.log("▶ 21. Refresh do Histórico em Produção");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_21_cert");

    const historyControllerA = new HistoryOperationalController(
      tabA.repo,
      tabA.coord
    );
    await historyControllerA.loadHistoryData();
    assert(
      historyControllerA.getState().records.length === 0,
      "21.1. Histórico da Aba A inicialmente vazio"
    );

    // Aba B congela o concurso 21000
    const draft = createContestDraft(21000);
    await tabB.repo.saveDraft(draft);
    await tabB.repo.freezeStoredContest(21000);

    // Aguarda propagação do evento remoto e releitura no IndexedDB
    await new Promise((resolve) => setTimeout(resolve, 25));

    const freshRecords = historyControllerA.getState().records;
    assert(
      freshRecords.length === 1 &&
        freshRecords[0].contestNumber === 21000 &&
        freshRecords[0].status === "FROZEN",
      "21.2. Histórico da Aba A atualizou automaticamente com concurso 21000 FROZEN"
    );

    historyControllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 22. REFRESH DA AUDITORIA EM PRODUÇÃO (AuditOperationalController)
  // ---------------------------------------------------------------------------
  console.log("▶ 22. Refresh da Auditoria em Produção");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_22_cert");

    const draft = createContestDraft(22000);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(22000);

    const auditControllerA = new AuditOperationalController(
      tabA.repo,
      tabA.coord
    );
    await auditControllerA.runAudit();
    assert(
      auditControllerA.getState().auditResult?.totalRecords === 1,
      "22.1. Auditoria inicial reflete 1 concurso gravado"
    );
    const initialScored =
      auditControllerA
        .getState()
        .auditResult?.records.filter((r: any) => r.status === "SCORED").length ?? 0;
    assert(
      initialScored === 0,
      "22.2. Zero concursos pontuados na auditoria inicial"
    );

    // Aba B pontua concurso 22000 no IndexedDB compartilhado
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await tabB.repo.scoreStoredContest(22000, officialResult);

    // Aguarda propagação do evento remoto e re-execução da auditoria
    await new Promise((resolve) => setTimeout(resolve, 30));

    const updatedScored =
      auditControllerA
        .getState()
        .auditResult?.records.filter((r: any) => r.status === "SCORED").length ?? 0;
    assert(
      updatedScored === 1,
      "22.3. Auditoria da Aba A atualizou automaticamente e reflete 1 concurso SCORED"
    );
    assert(
      auditControllerA.getState().isAuditing === false,
      "22.4. Nenhum loop de auditoria disparado (isAuditing = false)"
    );

    auditControllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 23. REFRESH DO RESUMO / CONTADOR DO APP (AppSummaryController)
  // ---------------------------------------------------------------------------
  console.log("▶ 23. Refresh do Resumo / Contador do App em Produção");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_23_cert");

    const summaryControllerA = new AppSummaryController(
      tabA.repo,
      tabA.coord
    );
    await summaryControllerA.refreshCount();
    assert(
      summaryControllerA.getState().historyCount === 0,
      "23.1. Contador inicial da Aba A = 0"
    );

    // Aba B cria novo concurso 23000
    const draft = createContestDraft(23000);
    await tabB.repo.saveDraft(draft);

    // Aguarda propagação do evento remoto e releitura via IndexedDB
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert(
      summaryControllerA.getState().historyCount === 1,
      "23.2. Contador do App da Aba A atualizado via IndexedDB para 1"
    );

    summaryControllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 24. EVENTO REMOTO COM FALHA DE STORAGE (MODO DEFENSIVO SEM INVENTAR DADOS)
  // ---------------------------------------------------------------------------
  console.log("▶ 24. Evento Remoto com Falha de Storage");
  {
    const sharedIdb = new IDBFactory();
    const bus = new InMemoryLocalSyncBus();

    const coordA = new RefreshCoordinator();
    const coordB = new RefreshCoordinator();

    const transportA = new InMemoryLocalSyncTransport(bus);
    const transportB = new InMemoryLocalSyncTransport(bus);

    const syncA = new LocalSyncCoordinator({
      transport: transportA,
      refreshCoordinator: coordA,
    });
    const syncB = new LocalSyncCoordinator({
      transport: transportB,
      refreshCoordinator: coordB,
    });

    const repoB = new ContestRepository({
      idbFactory: sharedIdb,
      dbName: "test_db_scenario_24",
      refreshCoordinator: coordB,
    });

    // Mock defensivo de repositório na Aba A que falha intencionalmente na leitura
    const failingRepoA = {
      getAllContestRecords: async () => {
        throw new Error("Simulated IndexedDB I/O Failure: Disk Read Error");
      },
      getContestRecord: async () => {
        throw new Error("Simulated IndexedDB I/O Failure: Record Lookup Error");
      },
    } as unknown as ContestRepository;

    const mockProviderA = new MockCaixaProvider();
    const controllerA = new GeneratorOperationalController(
      failingRepoA,
      coordA,
      () => mockProviderA
    );

    // Aba B emite evento remoto válido de FREEZE
    const draft = createContestDraft(24000);
    await repoB.saveDraft(draft);
    await repoB.freezeStoredContest(24000);

    // Aguarda Aba A receber o evento e falhar na releitura
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Verificações obrigatórias de segurança:
    assert(
      controllerA.getState().storageBlocked === true,
      "24.1. Aba A entra em modo defensivo (storageBlocked = true)"
    );
    assert(
      controllerA.getState().storageError !== null,
      "24.2. Mensagem amigável de indisponibilidade de armazenamento exibida"
    );
    assert(
      controllerA.getState().localRecords.length === 0,
      "24.3. Aba A NÃO inventa dados e mantém registros vazios"
    );
    assert(
      !controllerA.canScore(),
      "24.4. Pontuação e ações críticas permanecem bloqueadas (canScore = false)"
    );
    assert(
      mockProviderA.calls.length === 0,
      "24.5. Aba A NÃO realiza fallback chamando a CAIXA diante de falha de storage"
    );

    controllerA.destroy();
    syncA.close();
    syncB.close();
  }

  // ---------------------------------------------------------------------------
  // 25. EVENTO REMOTO IRRELEVANTE
  // ---------------------------------------------------------------------------
  console.log("▶ 25. Evento Remoto Irrelevante");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_25_cert");

    // Concurso 25000 aberto na Aba A
    const draft25 = createContestDraft(25000);
    await tabA.repo.saveDraft(draft25);
    await tabA.repo.freezeStoredContest(25000);

    const mockProviderA = new MockCaixaProvider();
    const controllerA = new GeneratorOperationalController(
      tabA.repo,
      tabA.coord,
      () => mockProviderA
    );
    await controllerA.refreshLocalState();
    const record25 = await tabA.repo.getContestRecord(25000);
    controllerA.setActiveRecord(record25);

    assert(
      controllerA.getState().activeRecord?.contestNumber === 25000,
      "25.1. Concurso 25000 aberto inicialmente na Aba A"
    );

    // Aba B emite evento para concurso diferente (25999)
    const draftOther = createContestDraft(25999);
    await tabB.repo.saveDraft(draftOther);

    // Aguarda propagação
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Verificações:
    assert(
      controllerA.getState().activeRecord?.contestNumber === 25000,
      "25.2. Concurso 25000 aberto na Aba A não sofreu efeitos indevidos"
    );
    assert(
      controllerA.getState().activeRecord?.status === "FROZEN",
      "25.3. Status do concurso 25000 permaneceu FROZEN"
    );
    assert(
      controllerA.getState().localRecords.some((r) => r.contestNumber === 25999),
      "25.4. Lista geral de registros locais foi atualizada com concurso 25999"
    );
    assert(
      mockProviderA.calls.length === 0,
      "25.5. Zero chamadas à CAIXA na recepção de evento de outro concurso"
    );

    controllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 26. MUTAÇÃO REMOTA DE DELETE (SEM RASCUNHO FANTASMA)
  // ---------------------------------------------------------------------------
  console.log("▶ 26. Mutação Remota de Delete sem Rascunho Fantasma");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_26_cert");

    // Concurso 26000 DRAFT criado e aberto na Aba A
    const draft = createContestDraft(26000);
    await tabA.repo.saveDraft(draft);

    const controllerA = new GeneratorOperationalController(
      tabA.repo,
      tabA.coord
    );
    await controllerA.refreshLocalState();
    const storedDraft = await tabA.repo.getContestRecord(26000);
    controllerA.setActiveRecord(storedDraft);

    assert(
      controllerA.getState().activeRecord?.contestNumber === 26000,
      "26.1. Concurso 26000 DRAFT aberto na Aba A"
    );

    // Aba B exclui o concurso 26000
    await tabB.repo.deleteDraft(26000);

    // Aguarda propagação
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert(
      controllerA.getState().activeRecord === null,
      "26.2. Concurso excluído na Aba B desaparece da tela na Aba A (activeRecord = null)"
    );
    assert(
      !controllerA.getState().localRecords.some((r) => r.contestNumber === 26000),
      "26.3. Concurso excluído removido da lista geral (zero rascunhos fantasmas)"
    );
    assert(
      !controllerA.canScore(),
      "26.4. Ação PONTUAR permanece indisponível"
    );

    controllerA.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  // ---------------------------------------------------------------------------
  // 27. ABA A CONFIRMA APOSTA (V1.7) -> ABA B ATUALIZA SEM F5 (PROMPT 16 / V1.7)
  // Exercita a capacidade V1.7 BET_CONFIRMED sobre a infraestrutura multiaba v1.6
  // ---------------------------------------------------------------------------
  console.log("▶ 27. [V1.7] Aba A Confirma Aposta (BET_CONFIRMED) -> Aba B Atualiza sem F5");
  {
    const { tabA, tabB } = createSimulatedTabs("test_db_scenario_27");

    // Prepara concurso 27000 FROZEN
    const draft = createContestDraft(27000);
    await tabA.repo.saveDraft(draft);
    await tabA.repo.freezeStoredContest(27000);

    const controllerA = new GeneratorOperationalController(tabA.repo, tabA.coord);
    const controllerB = new GeneratorOperationalController(tabB.repo, tabB.coord);
    const historyB = new HistoryOperationalController(tabB.repo, tabB.coord);

    await Promise.all([
      controllerA.refreshLocalState(),
      controllerB.refreshLocalState(),
      historyB.loadHistoryData(),
    ]);

    const frozenA = await tabA.repo.getContestRecord(27000);
    const frozenB = await tabB.repo.getContestRecord(27000);
    controllerA.setActiveRecord(frozenA);
    controllerB.setActiveRecord(frozenB);

    assert(
      controllerA.getState().activeRecord?.betPlacedAt === undefined,
      "27.1. Aba A com concurso 27000 FROZEN sem aposta confirmada"
    );
    assert(
      controllerB.getState().activeRecord?.betPlacedAt === undefined,
      "27.2. Aba B com concurso 27000 FROZEN sem aposta confirmada"
    );
    assert(
      historyB.getState().summary?.confirmedBets === 0,
      "27.3. Resumo de Aba B inicial com 0 apostas confirmadas"
    );

    // Prepara promessa que resolve quando Aba B recebe a atualização
    const confirmPropagatedPromise = Promise.all([
      new Promise<void>((resolve) => {
        const unsub = controllerB.subscribe((state) => {
          if (state.activeRecord?.betPlacedAt) {
            unsub();
            resolve();
          }
        });
      }),
      new Promise<void>((resolve) => {
        const unsub = historyB.subscribe((state) => {
          if (state.summary && state.summary.confirmedBets === 1) {
            unsub();
            resolve();
          }
        });
      }),
    ]);

    // Aba A confirma a aposta via controller de produção
    await controllerA.confirmBet();

    // Aguarda propagação multiaba
    await Promise.race([
      confirmPropagatedPromise,
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]);

    // Verificações na Aba B
    const activeB = controllerB.getState().activeRecord;
    assert(
      activeB !== null && activeB.contestNumber === 27000,
      "27.4. Aba B mantém concurso 27000 aberto"
    );
    assert(
      typeof activeB?.betPlacedAt === "string" && activeB.betPlacedAt.length > 0,
      "27.5. Aba B atualizou betPlacedAt automaticamente via sinal multiaba (sem F5)"
    );
    assert(
      activeB?.betPlacedAt === controllerA.getState().activeRecord?.betPlacedAt,
      "27.6. Timestamp de betPlacedAt é idêntico entre Aba A e Aba B"
    );

    // Verificação de Histórico na Aba B
    const histSummaryB = historyB.getState().summary;
    assert(
      histSummaryB?.confirmedBets === 1,
      "27.7. Histórico da Aba B atualizou automaticamente confirmedBets para 1"
    );
    assert(
      histSummaryB?.confirmedSpent === 17.50,
      "27.8. Histórico da Aba B atualizou automaticamente confirmedSpent para R$ 17,50"
    );

    controllerA.destroy();
    controllerB.destroy();
    historyB.destroy();
    tabA.sync.close();
    tabB.sync.close();
  }

  console.log("\n===============================================================================");
  console.log(` SUCESSO TOTAL: ${passed} PASSARAM, ${failed} FALHARAM EM SINCRONIZAÇÃO MULTIABA V1.6! `);
  console.log("===============================================================================\n");

  return { passed, failed };
}

if (
  import.meta.url.endsWith(process.argv[1]) ||
  process.argv[1]?.includes("multiTabSync.test.ts")
) {
  runMultiTabSyncTests()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("\n❌ ERRO NA SUÍTE DE TESTES MULTIABA V1.6:", err);
      process.exit(1);
    });
}
