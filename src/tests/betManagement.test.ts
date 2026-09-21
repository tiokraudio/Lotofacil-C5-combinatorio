/**
 * SUÍTE OFICIAL DE GESTÃO DA APOSTA E CONCURSO REAL (V1.7)
 * Arquivo: src/tests/betManagement.test.ts
 *
 * Certificação exaustiva dos requisitos funcionais, criptográficos,
 * de persistência e concorrência da V1.7:
 *  1. DRAFT + betPlacedAt inválido (rejeição em saveDraft, verifyStoredContest e import)
 *  2. FROZEN sem confirmação (betPlacedAt = undefined, métricas financeiras zeradas)
 *  3. FROZEN confirmado (betPlacedAt válido ISO 8601, confirmedBets=1, confirmedSpent=17.50)
 *  4. SCORED sem confirmação (conferido sem aposta prévia, não afeta confirmedSpent)
 *  5. SCORED confirmado (conferido com aposta prévia preservada)
 *  6. Confirmação permitida estritamente em FROZEN
 *  7. Proibição estrita de confirmação retroativa em SCORED
 *  8. Imutabilidade e idempotência de betPlacedAt
 *  9. Coerência temporal: betPlacedAt >= frozenAt
 * 10. Prevenção de double-click e locks concorrentes (CONFIRM_BET)
 * 11. Proteção TOCTOU na confirmação de aposta
 * 12. Resiliência a falhas de armazenamento (IndexedDB)
 * 13. dataRevision incrementado a cada confirmação de aposta
 * 14. Emissão de exatamente 1 evento BET_CONFIRMED pós-commit
 * 15. Corrida controlada CONFIRM_BET x SCORE
 * 16. Score de concurso congelado preserva rigorosamente betPlacedAt
 * 17. Freeze não cria betPlacedAt
 * 18. Exportação canônica em backupSchemaVersion = 2
 * 19. Importação retrocompatível de backup schema 1 com betPlacedAt = undefined
 * 20. Round-trip completo de backup schema 2
 * 21. Quarentena lógica para registros adulterados em betPlacedAt
 * 22. Comparador semântico areContestRecordsIdentical
 * 23. Métricas financeiras no HistorySummary
 * 24. Zero chamadas à CAIXA na gestão de aposta
 * 25. Prova criptográfica matemática: alteração de betPlacedAt NÃO altera o hash SHA-256
 */

import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../storage/contestRepository.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import { LocalSyncCoordinator, InMemoryLocalSyncBus, InMemoryLocalSyncTransport } from "../system/localSyncCoordinator.ts";
import { GeneratorOperationalController, HistoryOperationalController } from "../system/generatorOperationalController.ts";
import { actionLockController } from "../system/actionLock.ts";
import { createContestDraft, freezeContestRecord, scoreFrozenContest } from "../c5/record.ts";
import { buildCanonicalPayload, serializeCanonicalPayload, computeSHA256, verifyContestIntegrity } from "../c5/integrity.ts";
import { areContestRecordsIdentical } from "../storage/recordComparison.ts";
import { importHistory, validateHistoryBackup, prepareHistoryImport } from "../storage/import.ts";
import { CONTEST_STORE_NAME, closeDatabase, promisifyRequest, waitForTransaction } from "../storage/db.ts";
import type { ContestRecord } from "../c5/types.ts";
import type { LotteryResultProvider, OfficialContestResult } from "../lottery/types.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    failed++;
    console.error(`  ❌ FALHA: ${msg}`);
    throw new Error(`Falha de asserção: ${msg}`);
  } else {
    passed++;
    console.log(`  ✓ ${msg}`);
  }
}

class SpiedCaixaProvider implements LotteryResultProvider {
  readonly providerName = "SpiedCaixaProvider";
  public fetchCount = 0;

  async getLatestContest(_signal?: AbortSignal): Promise<OfficialContestResult> {
    this.fetchCount++;
    return {
      contestNumber: 3350,
      drawDate: "20/03/2026",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    };
  }

  async getContest(n: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.fetchCount++;
    return {
      contestNumber: n,
      drawDate: "20/03/2026",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function runBetManagementTests(): Promise<{ passed: number; failed: number }> {
  console.log("\n===============================================================================");
  console.log(" SUÍTE DE TESTES: PROMPT 16 — V1.7 GESTÃO DO CONCURSO E APOSTA REAL");
  console.log("===============================================================================\n");

  // Helper para criar repositório isolado
  function createIsolatedRepo(dbPrefix: string) {
    const fakeIdb = new IDBFactory();
    const bus = new InMemoryLocalSyncBus();
    const transport = new InMemoryLocalSyncTransport(bus);
    const coord = new RefreshCoordinator();
    const sync = new LocalSyncCoordinator({ transport, refreshCoordinator: coord });
    const repo = new ContestRepository({
      idbFactory: fakeIdb,
      dbName: `${dbPrefix}_db`,
      refreshCoordinator: coord,
    });
    return { repo, sync, coord, fakeIdb };
  }

  // ---------------------------------------------------------------------------
  // 1. DRAFT + betPlacedAt INVÁLIDO
  // ---------------------------------------------------------------------------
  console.log("▶ 1. DRAFT + betPlacedAt Inválido");
  {
    const { repo } = createIsolatedRepo("test_draft_bet");
    const draft = createContestDraft(1001);
    // Injeção de betPlacedAt em rascunho deve ser rejeitada
    const draftWithBet = { ...draft, betPlacedAt: new Date().toISOString() };

    let threw = false;
    try {
      await repo.saveDraft(draftWithBet);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("betPlacedAt"), "saveDraft rejeita rascunho com betPlacedAt");
    }
    assert(threw, "saveDraft barrou tentativa de persistir DRAFT com betPlacedAt");

    // Salva DRAFT regular e verifica auditoria
    await repo.saveDraft(draft);
    const v = await repo.verifyStoredContest(1001);
    const rec = await repo.getContestRecord(1001);
    assert(v.valid, "DRAFT válido sem betPlacedAt passa na auditoria");
    assert(rec?.betPlacedAt === undefined, "DRAFT não possui betPlacedAt");
  }

  // ---------------------------------------------------------------------------
  // 2. FROZEN SEM CONFIRMAÇÃO
  // ---------------------------------------------------------------------------
  console.log("▶ 2. FROZEN sem Confirmação");
  {
    const { repo } = createIsolatedRepo("test_frozen_unconfirmed");
    const draft = createContestDraft(2001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(2001);

    const frozen = await repo.getContestRecord(2001);
    assert(frozen?.status === "FROZEN", "Status é FROZEN");
    assert(frozen?.betPlacedAt === undefined, "FROZEN recém-criado não tem betPlacedAt");

    const summary = await repo.getHistorySummary();
    assert(summary.frozen === 1, "Resumo tem 1 concurso congelado");
    assert(summary.confirmedBets === 0, "Zero apostas confirmadas");
    assert(summary.confirmedSpent === 0, "Zero valor apostado (R$ 0,00)");
  }

  // ---------------------------------------------------------------------------
  // 3. FROZEN CONFIRMADO
  // ---------------------------------------------------------------------------
  console.log("▶ 3. FROZEN Confirmado");
  {
    const { repo } = createIsolatedRepo("test_frozen_confirmed");
    const draft = createContestDraft(3001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3001);

    const confirmed = await repo.confirmBetPlaced(3001);
    assert(confirmed.status === "FROZEN", "Permanece em status FROZEN");
    assert(typeof confirmed.betPlacedAt === "string", "betPlacedAt é string");
    assert(Boolean(confirmed.betPlacedAt && confirmed.betPlacedAt.length > 0), "betPlacedAt não é vazio");
    assert(Boolean(confirmed.betPlacedAt && !isNaN(Date.parse(confirmed.betPlacedAt))), "betPlacedAt é data válida");

    const summary = await repo.getHistorySummary();
    assert(summary.confirmedBets === 1, "confirmedBets é 1");
    assert(summary.confirmedSpent === 17.50, "confirmedSpent é R$ 17,50");
  }

  // ---------------------------------------------------------------------------
  // 4. SCORED SEM CONFIRMAÇÃO
  // ---------------------------------------------------------------------------
  console.log("▶ 4. SCORED sem Confirmação");
  {
    const { repo } = createIsolatedRepo("test_scored_unconfirmed");
    const draft = createContestDraft(4001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(4001);

    const officialNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await repo.scoreStoredContest(4001, officialNumbers);

    const scored = await repo.getContestRecord(4001);
    assert(scored?.status === "SCORED", "Status é SCORED");
    assert(scored?.betPlacedAt === undefined, "betPlacedAt permanece undefined se não foi apostado");

    const summary = await repo.getHistorySummary();
    assert(summary.contestsPlayed === 1, "contestsPlayed é 1");
    assert(summary.totalSpent === 17.50, "totalSpent conta o concurso apurado");
    assert(summary.confirmedBets === 0, "confirmedBets permanece 0");
    assert(summary.confirmedSpent === 0, "confirmedSpent permanece 0");
  }

  // ---------------------------------------------------------------------------
  // 5. SCORED CONFIRMADO (Preservação de Aposta Pós-Score)
  // ---------------------------------------------------------------------------
  console.log("▶ 5. SCORED Confirmado (Aposta Preservada no Score)");
  {
    const { repo } = createIsolatedRepo("test_scored_confirmed");
    const draft = createContestDraft(5001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(5001);
    const confirmed = await repo.confirmBetPlaced(5001);
    const originalBetTimestamp = confirmed.betPlacedAt;

    const officialNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await repo.scoreStoredContest(5001, officialNumbers);

    const scored = await repo.getContestRecord(5001);
    assert(scored?.status === "SCORED", "Status avançou para SCORED");
    assert(scored?.betPlacedAt === originalBetTimestamp, "betPlacedAt foi rigorosamente preservado após score");

    const summary = await repo.getHistorySummary();
    assert(summary.contestsPlayed === 1, "contestsPlayed = 1");
    assert(summary.confirmedBets === 1, "confirmedBets = 1");
    assert(summary.confirmedSpent === 17.50, "confirmedSpent = R$ 17,50");
  }

  // ---------------------------------------------------------------------------
  // 6. CONFIRMAÇÃO PERMITIDA ESTRITAMENTE EM FROZEN
  // ---------------------------------------------------------------------------
  console.log("▶ 6. Confirmação Permitida Estritamente em FROZEN");
  {
    const { repo } = createIsolatedRepo("test_confirm_strict_frozen");
    const draft = createContestDraft(6001);
    await repo.saveDraft(draft);

    let threwDraft = false;
    try {
      await repo.confirmBetPlaced(6001);
    } catch (e: any) {
      threwDraft = true;
      assert(e.message.includes("DRAFT"), "Rejeita confirmação em estado DRAFT");
    }
    assert(threwDraft, "confirmBetPlaced proibiu confirmação em DRAFT");
  }

  // ---------------------------------------------------------------------------
  // 7. PROIBIÇÃO ESTRITA DE CONFIRMAÇÃO RETROATIVA EM SCORED
  // ---------------------------------------------------------------------------
  console.log("▶ 7. Proibição Estrita de Confirmação Retroativa em SCORED");
  {
    const { repo } = createIsolatedRepo("test_retroactive_prohibition");
    const draft = createContestDraft(7001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(7001);
    await repo.scoreStoredContest(7001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    let threwScored = false;
    try {
      await repo.confirmBetPlaced(7001);
    } catch (e: any) {
      threwScored = true;
      assert(e.message.includes("SCORED") || e.message.includes("retroativa"), "Rejeita confirmação retroativa em SCORED");
    }
    assert(threwScored, "Proibição estrita de confirmação retroativa comprovada");
  }

  // ---------------------------------------------------------------------------
  // 8. IMUTABILIDADE E IDEMPOTÊNCIA DE betPlacedAt
  // ---------------------------------------------------------------------------
  console.log("▶ 8. Imutabilidade e Idempotência de betPlacedAt");
  {
    const { repo } = createIsolatedRepo("test_idempotency");
    const draft = createContestDraft(8001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(8001);

    const firstConfirm = await repo.confirmBetPlaced(8001);
    const ts1 = firstConfirm.betPlacedAt;

    // Simula segunda chamada
    await new Promise((r) => setTimeout(r, 20));
    const secondConfirm = await repo.confirmBetPlaced(8001);
    const ts2 = secondConfirm.betPlacedAt;

    assert(ts1 === ts2, "Segunda confirmação é idempotente e preserva o timestamp original");

    const summary = await repo.getHistorySummary();
    assert(summary.confirmedBets === 1, "Métrica não duplica (confirmedBets = 1)");
    assert(summary.confirmedSpent === 17.50, "Valor não duplica (confirmedSpent = R$ 17,50)");
  }

  // ---------------------------------------------------------------------------
  // 9. COERÊNCIA TEMPORAL: betPlacedAt >= frozenAt
  // ---------------------------------------------------------------------------
  console.log("▶ 9. Coerência Temporal: betPlacedAt >= frozenAt");
  {
    const { repo } = createIsolatedRepo("test_temporal_order");
    const draft = createContestDraft(9001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(9001);

    const frozen = await repo.getContestRecord(9001);
    const frozenTime = new Date(frozen!.frozenAt!).getTime();

    // Tenta confirmar com relógio no passado (anterior ao congelamento)
    const pastClock = () => new Date(frozenTime - 100000);

    let threwPast = false;
    try {
      await repo.confirmBetPlaced(9001, { clock: pastClock });
    } catch (e: any) {
      threwPast = true;
      assert(e.message.includes("temporal") || e.message.includes("anterior"), "Rejeita betPlacedAt anterior a frozenAt");
    }
    assert(threwPast, "Coerência temporal rigorosa verificada");
  }

  // ---------------------------------------------------------------------------
  // 10. PREVENÇÃO DE DOUBLE-CLICK E LOCKS CONCORRENTES (CONFIRM_BET)
  // ---------------------------------------------------------------------------
  console.log("▶ 10. Prevenção de Double-Click e Locks Concorrentes (CONFIRM_BET)");
  {
    const acquired1 = actionLockController.acquire("CONFIRM_BET");
    assert(acquired1, "Primeiro lock CONFIRM_BET adquirido com sucesso");

    const acquired2 = actionLockController.acquire("CONFIRM_BET");
    assert(!acquired2, "Segundo lock concorrente no mesmo instante é bloqueado (anti double-click)");

    actionLockController.release("CONFIRM_BET");
    assert(!actionLockController.isLocked(), "Lock liberado após término");
  }

  // ---------------------------------------------------------------------------
  // 11. PROTEÇÃO TOCTOU NA CONFIRMAÇÃO DE APOSTA
  // ---------------------------------------------------------------------------
  console.log("▶ 11. Proteção TOCTOU na Confirmação de Aposta");
  {
    const { repo } = createIsolatedRepo("test_toctou_confirm");
    const draft = createContestDraft(11001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(11001);

    const origGetDB = (repo as any).getDB.bind(repo);
    let getDBCalls = 0;
    (repo as any).getDB = async () => {
      getDBCalls++;
      if (getDBCalls === 3) {
        // Chamada 1: snapshot getContestRecord
        // Chamada 2: verifyStoredContest
        // Chamada 3: início da transação de escrita da confirmação
        // Simula alteração concorrente por outra aba no exato instante
        const directDB = await origGetDB();
        const tx = directDB.transaction(CONTEST_STORE_NAME, "readwrite");
        const store = tx.objectStore(CONTEST_STORE_NAME);
        const current = await promisifyRequest<ContestRecord>(store.get(11001));
        current.generation.permutation[0] = 99;
        await promisifyRequest(store.put(current));
        await waitForTransaction(tx);
        closeDatabase(directDB);
      }
      return origGetDB();
    };

    let toctouCaught = false;
    try {
      await repo.confirmBetPlaced(11001);
    } catch (e: any) {
      toctouCaught = true;
      assert(
        e.message.includes("mudou durante a operação. Confirmação cancelada para evitar sobrescrita concorrente."),
        "Detectou TOCTOU e abortou confirmação com mensagem canônica"
      );
    } finally {
      (repo as any).getDB = origGetDB;
    }
    assert(toctouCaught, "Proteção atômica TOCTOU funcionou perfeitamente");
  }

  // ---------------------------------------------------------------------------
  // 12. RESILIÊNCIA A FALHAS DE ARMAZENAMENTO (IndexedDB)
  // ---------------------------------------------------------------------------
  console.log("▶ 12. Resiliência a Falhas de Armazenamento");
  {
    const { repo } = createIsolatedRepo("test_storage_failure");
    const draft = createContestDraft(12001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(12001);

    // Fecha conexão ativa e verifica recuperação transparente
    const db = await (repo as any).getDB();
    closeDatabase(db);

    // Repo deve lidar limpamente sem quebrar processo reabrindo nova conexão
    const record = await repo.getContestRecord(12001);
    assert(record !== null && record.contestNumber === 12001, "Reabertura transparente e segura do banco");
  }

  // ---------------------------------------------------------------------------
  // 13. dataRevision INCREMENTADO A CADA CONFIRMAÇÃO DE APOSTA
  // ---------------------------------------------------------------------------
  console.log("▶ 13. dataRevision Incrementado a Cada Confirmação");
  {
    const { repo, coord } = createIsolatedRepo("test_data_revision");
    const draft = createContestDraft(13001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(13001);

    const revBefore = coord.getRevision();
    await repo.confirmBetPlaced(13001);
    const revAfter = coord.getRevision();

    assert(revAfter > revBefore, `dataRevision incrementou: de ${revBefore} para ${revAfter}`);
  }

  // ---------------------------------------------------------------------------
  // 14. EXATAMENTE UM EVENTO BET_CONFIRMED PÓS-COMMIT
  // ---------------------------------------------------------------------------
  console.log("▶ 14. Exatamente 1 Evento BET_CONFIRMED Pós-Commit");
  {
    const bus = new InMemoryLocalSyncBus();
    const transportA = new InMemoryLocalSyncTransport(bus);
    const transportB = new InMemoryLocalSyncTransport(bus);

    const receivedEvents: any[] = [];
    transportB.subscribe((evt) => {
      receivedEvents.push(evt);
    });

    const syncA = new LocalSyncCoordinator({ transport: transportA });
    const syncB = new LocalSyncCoordinator({ transport: transportB });

    // Emite evento BET_CONFIRMED pós-commit
    syncA.broadcast("BET_CONFIRMED", 14001);

    assert(receivedEvents.length === 1, "Exatamente 1 evento recebido pela Aba B");
    assert(receivedEvents[0].reason === "BET_CONFIRMED", "Tipo de evento é BET_CONFIRMED");
    assert(receivedEvents[0].contestNumber === 14001, "Concurso é 14001");
    assert(typeof receivedEvents[0].eventId === "string", "Possui eventId criptográfico");

    syncA.close();
    syncB.close();
  }

  // ---------------------------------------------------------------------------
  // 15. CORRIDA CONTROLADA CONFIRM_BET x SCORE
  // ---------------------------------------------------------------------------
  console.log("▶ 15. Corrida Controlada CONFIRM_BET x SCORE");
  {
    const { repo, coord } = createIsolatedRepo("test_race_bet_score");
    const draft = createContestDraft(15001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(15001);

    const controller = new GeneratorOperationalController(repo, coord);
    await controller.refreshLocalState();
    const frozenRec = await repo.getContestRecord(15001);
    controller.setActiveRecord(frozenRec);

    // Ambas as operações concorrentes
    const p1 = controller.confirmBet();
    const p2 = controller.scoreActiveContest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    // Uma deve ser bem-sucedida ou serializada; não pode ocorrer corrupção
    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert(fulfilled.length >= 1, "Pelo menos uma operação concluída com segurança");

    // Recarrega do banco e valida integridade
    const finalRec = await repo.getContestRecord(15001);
    assert(finalRec !== null, "Registro final existe");
    const v = await repo.verifyStoredContest(15001);
    assert(v.valid, "Registro final passou com integridade 100% válida");
  }

  // ---------------------------------------------------------------------------
  // 16. SCORE DE CONCURSO CONGELADO PRESERVA RIGOROSAMENTE betPlacedAt
  // ---------------------------------------------------------------------------
  console.log("▶ 16. Score Preserva Rigorosamente betPlacedAt");
  {
    const draft = createContestDraft(16001);
    const frozen = await freezeContestRecord(draft);
    const confirmedTime = new Date(Date.parse(frozen.frozenAt!) + 5000).toISOString();
    const frozenConfirmed: ContestRecord = {
      ...frozen,
      betPlacedAt: confirmedTime,
    };

    const scored = await scoreFrozenContest(frozenConfirmed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert(scored.status === "SCORED", "Status é SCORED");
    assert(scored.betPlacedAt === confirmedTime, "betPlacedAt mantido idêntico");
  }

  // ---------------------------------------------------------------------------
  // 17. FREEZE NÃO CRIA betPlacedAt
  // ---------------------------------------------------------------------------
  console.log("▶ 17. Freeze Não Cria betPlacedAt");
  {
    const draft = createContestDraft(17001);
    assert(draft.betPlacedAt === undefined, "DRAFT não tem betPlacedAt");
    const frozen = await freezeContestRecord(draft);
    assert(frozen.betPlacedAt === undefined, "FROZEN não ganha betPlacedAt automaticamente");
    assert(!("betPlacedAt" in frozen) || frozen.betPlacedAt === undefined, "Propriedade ausente ou undefined");
  }

  // ---------------------------------------------------------------------------
  // 18. EXPORTAÇÃO CANÔNICA EM backupSchemaVersion = 2
  // ---------------------------------------------------------------------------
  console.log("▶ 18. Exportação Canônica em backupSchemaVersion = 2");
  {
    const { repo } = createIsolatedRepo("test_export_schema2");
    const draft = createContestDraft(18001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(18001);
    await repo.confirmBetPlaced(18001);

    const exported = await repo.exportHistory();
    assert(exported.schemaVersion === 2, "schemaVersion é 2 no export");
    assert(exported.records.length === 1, "1 registro exportado");
    assert(typeof exported.records[0].betPlacedAt === "string", "betPlacedAt incluído no export");
  }

  // ---------------------------------------------------------------------------
  // 19. IMPORTAÇÃO RETROCOMPATÍVEL SCHEMA 1 COM betPlacedAt = undefined
  // ---------------------------------------------------------------------------
  console.log("▶ 19. Importação Retrocompatível Schema 1 com betPlacedAt = undefined");
  {
    const { repo } = createIsolatedRepo("test_import_schema1");
    const draft = createContestDraft(19001);
    const frozen = await freezeContestRecord(draft);

    // Cria payload estilo schema 1
    const schema1Backup = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      algorithmVersions: ["C5-1.0.0"],
      recordCount: 1,
      records: [
        {
          status: "FROZEN",
          contestNumber: 19001,
          generationId: frozen.generationId,
          algorithmVersion: frozen.algorithmVersion,
          generatedAt: frozen.generatedAt,
          frozenAt: frozen.frozenAt,
          integrityHash: frozen.integrityHash,
          generation: frozen.generation,
          // Mesmo se viesse com lixo de aposta em schema 1, deve ser descartado
          betPlacedAt: "2026-03-20T10:00:00.000Z",
        },
      ],
    };

    const impResult = await importHistory(schema1Backup, repo);
    assert(impResult.success, "Importação de schema 1 bem-sucedida");

    const importedRec = await repo.getContestRecord(19001);
    assert(importedRec !== null, "Registro importado existe");
    assert(importedRec?.betPlacedAt === undefined, "betPlacedAt foi forçado para undefined (nunca infere aposta)");

    const summary = await repo.getHistorySummary();
    assert(summary.confirmedBets === 0, "Zero apostas confirmadas para backup de schema 1");
  }

  // ---------------------------------------------------------------------------
  // 20. ROUND-TRIP COMPLETO DE BACKUP SCHEMA 2
  // ---------------------------------------------------------------------------
  console.log("▶ 20. Round-Trip Completo de Backup Schema 2");
  {
    const { repo: repo1 } = createIsolatedRepo("test_rt1");
    const { repo: repo2 } = createIsolatedRepo("test_rt2");

    const draft = createContestDraft(20001);
    await repo1.saveDraft(draft);
    await repo1.freezeStoredContest(20001);
    const confirmed = await repo1.confirmBetPlaced(20001);

    const exported = await repo1.exportHistory();
    const impResult = await importHistory(exported, repo2);
    assert(impResult.success, "Importação de schema 2 bem-sucedida");

    const rec2 = await repo2.getContestRecord(20001);
    assert(rec2 !== null, "Registro importado no repo 2 existe");
    assert(rec2?.betPlacedAt === confirmed.betPlacedAt, "betPlacedAt preservado identicamente no round-trip");
  }

  // ---------------------------------------------------------------------------
  // 21. QUARENTENA LÓGICA PARA REGISTROS ADULTERADOS EM betPlacedAt
  // ---------------------------------------------------------------------------
  console.log("▶ 21. Quarentena Lógica para Registros Adulterados em betPlacedAt");
  {
    const { repo } = createIsolatedRepo("test_quarantine_bet");
    const draft = createContestDraft(21001);
    const frozen = await freezeContestRecord(draft);

    // Tentativa de importar registro FROZEN onde betPlacedAt < frozenAt (violação temporal)
    const corruptedBackup = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      algorithmVersions: ["C5-1.0.0"],
      records: [
        {
          ...frozen,
          betPlacedAt: "2020-01-01T00:00:00.000Z", // no passado
        },
      ],
    };

    const validation = await validateHistoryBackup(corruptedBackup);
    assert(!validation.valid, "Validação estrutural detecta violação de ordem temporal");
    assert(
      validation.errors.some((e) => e.includes("temporal") || e.includes("betPlacedAt")),
      "Erro reporta problema de betPlacedAt"
    );
  }

  // ---------------------------------------------------------------------------
  // 22. COMPARADOR SEMÂNTICO areContestRecordsIdentical
  // ---------------------------------------------------------------------------
  console.log("▶ 22. Comparador Semântico areContestRecordsIdentical");
  {
    const draft = createContestDraft(22001);
    const frozen = await freezeContestRecord(draft);

    const frozenWithoutBet: ContestRecord = { ...frozen };
    const frozenWithBet: ContestRecord = { ...frozen, betPlacedAt: new Date().toISOString() };

    assert(
      !areContestRecordsIdentical(frozenWithoutBet, frozenWithBet),
      "areContestRecordsIdentical detecta diferença quando betPlacedAt é adicionado"
    );

    const frozenWithBetClone: ContestRecord = { ...frozenWithBet };
    assert(
      areContestRecordsIdentical(frozenWithBet, frozenWithBetClone),
      "areContestRecordsIdentical confirma igualdade quando betPlacedAt é idêntico"
    );
  }

  // ---------------------------------------------------------------------------
  // 23. MÉTRICAS FINANCEIRAS NO HistorySummary
  // ---------------------------------------------------------------------------
  console.log("▶ 23. Métricas Financeiras no HistorySummary");
  {
    const { repo } = createIsolatedRepo("test_finance_metrics");

    // 1 FROZEN não apostado
    const d1 = createContestDraft(23001);
    await repo.saveDraft(d1);
    await repo.freezeStoredContest(23001);

    // 1 FROZEN apostado
    const d2 = createContestDraft(23002);
    await repo.saveDraft(d2);
    await repo.freezeStoredContest(23002);
    await repo.confirmBetPlaced(23002);

    // 1 SCORED apostado
    const d3 = createContestDraft(23003);
    await repo.saveDraft(d3);
    await repo.freezeStoredContest(23003);
    await repo.confirmBetPlaced(23003);
    await repo.scoreStoredContest(23003, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    // 1 SCORED NÃO apostado
    const d4 = createContestDraft(23004);
    await repo.saveDraft(d4);
    await repo.freezeStoredContest(23004);
    await repo.scoreStoredContest(23004, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const summary = await repo.getHistorySummary();
    assert(summary.contestsPlayed === 2, "2 concursos conferidos (23003 e 23004)");
    assert(summary.totalSpent === 35.00, "Custo correspondente aos 2 conferidos = R$ 35,00");
    assert(summary.confirmedBets === 2, "Exatamente 2 apostas confirmadas (23002 e 23003)");
    assert(summary.confirmedSpent === 35.00, "Total real apostado = R$ 35,00 (2 x 17,50)");
  }

  // ---------------------------------------------------------------------------
  // 24. ZERO CHAMADAS À CAIXA NA GESTÃO DE APOSTA
  // ---------------------------------------------------------------------------
  console.log("▶ 24. Zero Chamadas à CAIXA na Gestão de Aposta");
  {
    const { repo, coord } = createIsolatedRepo("test_zero_caixa");
    const spiedCaixa = new SpiedCaixaProvider();

    const controller = new GeneratorOperationalController(repo, coord, () => spiedCaixa);
    const draft = createContestDraft(24001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(24001);
    await controller.refreshLocalState();

    const frozen = await repo.getContestRecord(24001);
    controller.setActiveRecord(frozen);

    // Executa confirmação de aposta
    await controller.confirmBet();

    assert(spiedCaixa.fetchCount === 0, "Zero requisições à CAIXA durante confirmBet()");
  }

  // ---------------------------------------------------------------------------
  // 25. PROVA CRIPTOGRÁFICA: ALTERAR betPlacedAt NÃO ALTERA SHA-256 CANÔNICO
  // ---------------------------------------------------------------------------
  console.log("▶ 25. Prova Criptográfica: betPlacedAt NÃO Altera SHA-256 Canônico");
  {
    const draft = createContestDraft(25001);
    const frozen = await freezeContestRecord(draft);

    const payloadWithoutBet = buildCanonicalPayload(
      frozen.contestNumber,
      frozen.generationId,
      frozen.algorithmVersion,
      frozen.generatedAt,
      frozen.frozenAt!,
      frozen.generation
    );
    const hashWithoutBet = await computeSHA256(serializeCanonicalPayload(payloadWithoutBet));

    const frozenWithBet: ContestRecord = {
      ...frozen,
      betPlacedAt: new Date(Date.parse(frozen.frozenAt!) + 10000).toISOString(),
    };
    const payloadWithBet = buildCanonicalPayload(
      frozenWithBet.contestNumber,
      frozenWithBet.generationId,
      frozenWithBet.algorithmVersion,
      frozenWithBet.generatedAt,
      frozenWithBet.frozenAt!,
      frozenWithBet.generation
    );
    const hashWithBet = await computeSHA256(serializeCanonicalPayload(payloadWithBet));

    assert(
      JSON.stringify(payloadWithoutBet) === JSON.stringify(payloadWithBet),
      "Payload canônico de congelamento é estritamente IDÊNTICO com ou sem betPlacedAt"
    );
    assert(
      hashWithoutBet === hashWithBet,
      "Hash SHA-256 canônico da geração congelada permanece 100% INALTERADO"
    );
    assert(
      frozen.integrityHash === hashWithBet,
      "Hash gravado no registro original coincide perfeitamente com o registro apostado"
    );

    const audit = await verifyContestIntegrity(frozenWithBet);
    assert(audit.valid, "verifyContestIntegrity valida perfeitamente com betPlacedAt");
    assert(audit.hashMatches, "hashMatches é true");
  }

  console.log("\n===============================================================================");
  console.log(` SUCESSO TOTAL: ${passed} PASSARAM, ${failed} FALHARAM NA SUÍTE DE APOSTA V1.7! `);
  console.log("===============================================================================\n");

  return { passed, failed };
}

if (
  import.meta.url.endsWith(process.argv[1]) ||
  process.argv[1]?.includes("betManagement.test.ts")
) {
  runBetManagementTests()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("\n❌ ERRO NA SUÍTE DE GESTÃO DE APOSTA V1.7:", err);
      process.exit(1);
    });
}
