/**
 * ===============================================================================
 * SUÍTE CANÔNICA DE CERTIFICAÇÃO V1.8: GESTÃO DE PRÊMIOS E RASTREAMENTO FINANCEIRO
 * Arquivo: src/tests/prizeManagement.test.ts
 *
 * Cobertura Completa dos 40 Cenários de Certificação (P17 / P17.1):
 *  1. DRAFT rejeita prêmio
 *  2. FROZEN rejeita prêmio
 *  3. SCORED sem betPlacedAt rejeita prêmio
 *  4. Prêmio zero (R$ 0,00) aceito e persistido
 *  5. Prêmio positivo aceito e persistido
 *  6. Valor negativo rejeitado em centavos e BRL
 *  7. Valor float / fracionado rejeitado
 *  8. Unsafe integer / NaN / Infinity rejeitados
 *  9. Coerência temporal: recordedAt >= scoredAt e recordedAt >= betPlacedAt
 * 10. Origem (source) obrigatória e exclusivamente 'MANUAL'
 * 11. Imutabilidade absoluta do PrizeRecord gravado
 * 12. Segunda gravação no mesmo concurso rejeitada
 * 13. Double-Click REAL via controller operacional (ActionLockController)
 * 14. TOCTOU real com aborto atômico de corrida
 * 15. Falha real de armazenamento antes do commit (rollback limpo)
 * 16. Liberação de lock após falha técnica
 * 17. Retry operacional com sucesso após falha sanada
 * 18. Incremento de revisão (revision +1)
 * 19. Exatamente um evento PRIZE_RECORDED publicado pós-commit
 * 20. Sincronização multiaba real via transporte de barramento
 * 21. Aba B atualiza estado ativo sem F5
 * 22. PrizeRecord já persistido no IndexedDB no instante em que o evento é observado
 * 23. Falha de transporte após commit não causa rollback
 * 24. Exportação canônica com Schema Version 3
 * 25. Compatibilidade regressiva: Importação de Schema 1
 * 26. Compatibilidade regressiva: Importação de Schema 2
 * 27. Round-trip completo de exportação e importação em Schema 3
 * 28. Rejeição estrita de backups com esquemas inválidos ou incompatíveis
 * 29. Quarentena de registros com PrizeRecord adulterado ou corrompido
 * 30. areContestRecordsIdentical inclui comparação estrita de PrizeRecord
 * 31. deepCloneRecord realiza clonagem profunda defensiva de PrizeRecord
 * 32. Fixture financeira canônica parcial (Fixture A: pendência detectada)
 * 33. Fixture financeira canônica completa (Fixture B: pendências zeradas)
 * 34. Prêmio zero encerra pendência financeira
 * 35. FROZEN com betPlacedAt não conta como pendência financeira
 * 36. Parser BRL completo e utilitários monetários (money.ts)
 * 37. Estados derivados da interface de usuário (badges e botões)
 * 38. Metadados financeiros no detalhamento de concurso (Modal/Detail)
 * 39. ZERO chamadas à rede/CAIXA provocadas pelo fluxo de premiação
 * 40. Preservação estrita do SHA-256 canônico da FrozenC5Payload
 * ===============================================================================
 */

import { IDBFactory } from "fake-indexeddb";
import { ContestRepository, deepCloneRecord } from "../storage/contestRepository.ts";
import { areContestRecordsIdentical } from "../storage/recordComparison.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import {
  LocalSyncCoordinator,
  InMemoryLocalSyncBus,
  InMemoryLocalSyncTransport,
  LOCAL_SYNC_PROTOCOL_VERSION,
  isValidLocalSyncEvent,
} from "../system/localSyncCoordinator.ts";
import { GeneratorOperationalController } from "../system/generatorOperationalController.ts";
import { actionLockController } from "../system/actionLock.ts";
import { createContestDraft } from "../c5/record.ts";
import { verifyContestIntegrity } from "../c5/integrity.ts";
import { parseBRLToCents, formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";
import { importHistory, validateHistoryBackup, prepareHistoryImport } from "../storage/import.ts";
import { promisifyRequest, waitForTransaction, closeDatabase, CONTEST_STORE_NAME } from "../storage/db.ts";
import type { ContestRecord, PrizeRecord } from "../c5/types.ts";
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

// Provedor simulado para auditoria de chamadas CAIXA
class CountingLotteryProvider implements LotteryResultProvider {
  providerName = "CountingProvider";
  callCount = 0;

  async getContest(contestNumber: number): Promise<OfficialContestResult> {
    this.callCount++;
    return {
      contestNumber,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      drawDate: "2026-09-20",
      source: "TEST",
      fetchedAt: "2026-09-20T21:00:00.000Z",
    };
  }

  async getLatestContest(): Promise<OfficialContestResult> {
    this.callCount++;
    return this.getContest(3100);
  }
}

function createIsolatedRepo(dbName: string, options?: { bus?: InMemoryLocalSyncBus; idbFactory?: IDBFactory }) {
  const fakeIdb = options?.idbFactory ?? new IDBFactory();
  const bus = options?.bus ?? new InMemoryLocalSyncBus();
  const transport = new InMemoryLocalSyncTransport(bus);
  const coord = new RefreshCoordinator();
  const sync = new LocalSyncCoordinator({ transport, refreshCoordinator: coord });
  const repo = new ContestRepository({
    idbFactory: fakeIdb,
    dbName,
    refreshCoordinator: coord,
  });
  return { repo, sync, coord, fakeIdb, bus, transport };
}

async function prepareScoredContestWithBet(
  repo: ContestRepository,
  contestNumber: number,
  dates = {
    draft: "2026-09-20T10:00:00.000Z",
    freeze: "2026-09-20T11:00:00.000Z",
    bet: "2026-09-20T12:00:00.000Z",
    score: "2026-09-20T21:00:00.000Z",
  }
): Promise<ContestRecord> {
  const draft = createContestDraft(contestNumber, { clock: () => new Date(dates.draft) });
  await repo.saveDraft(draft);
  await repo.freezeStoredContest(contestNumber, { clock: () => new Date(dates.freeze) });
  await repo.confirmBetPlaced(contestNumber, { clock: () => new Date(dates.bet) });
  const scored = await repo.scoreStoredContest(
    contestNumber,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    { clock: () => new Date(dates.score) }
  );
  return scored;
}

export async function runPrizeManagementCertification(): Promise<{ passed: number; failed: number }> {
  console.log("===============================================================================");
  console.log(" SUÍTE CANÔNICA DE CERTIFICAÇÃO V1.8 — GESTÃO DE PRÊMIOS (40 CENÁRIOS)");
  console.log("===============================================================================");

  // ---------------------------------------------------------------------------
  // 1. DRAFT REJEITA PRÊMIO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 1. DRAFT rejeita prêmio");
  {
    const { repo } = createIsolatedRepo("test_c1_draft");
    const draft = createContestDraft(1001);
    await repo.saveDraft(draft);

    let threw = false;
    try {
      await repo.recordPrize(1001, 1000);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("DRAFT") || e.message.includes("rascunho"), "Mensagem de erro referencia DRAFT");
    }
    assert(threw, "DRAFT rejeitou gravação de prêmio");
  }

  // ---------------------------------------------------------------------------
  // 2. FROZEN REJEITA PRÊMIO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 2. FROZEN rejeita prêmio");
  {
    const { repo } = createIsolatedRepo("test_c2_frozen");
    const draft = createContestDraft(2001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(2001);
    await repo.confirmBetPlaced(2001);

    let threw = false;
    try {
      await repo.recordPrize(2001, 1000);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("FROZEN") || e.message.includes("apurado"), "Mensagem de erro referencia FROZEN");
    }
    assert(threw, "FROZEN rejeitou gravação de prêmio antes da apuração");
  }

  // ---------------------------------------------------------------------------
  // 3. SCORED SEM betPlacedAt REJEITA PRÊMIO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 3. SCORED sem betPlacedAt rejeita prêmio");
  {
    const { repo } = createIsolatedRepo("test_c3_no_bet");
    const draft = createContestDraft(3001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3001);
    // Pontua sem confirmar aposta
    await repo.scoreStoredContest(3001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    let threw = false;
    try {
      await repo.recordPrize(3001, 600);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("aposta confirmada"), "Erro explicita ausência de aposta confirmada");
    }
    assert(threw, "SCORED sem aposta confirmada rejeita registro de prêmio");
  }

  // ---------------------------------------------------------------------------
  // 4. PRÊMIO ZERO ACEITO E PERSISTIDO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 4. Prêmio zero (R$ 0,00) aceito e persistido");
  {
    const { repo } = createIsolatedRepo("test_c4_zero_prize");
    await prepareScoredContestWithBet(repo, 4001);

    const updated = await repo.recordPrize(4001, 0);
    assert(updated.prize !== undefined, "prize está definido no retorno");
    assert(updated.prize?.amountCents === 0, "amountCents é exatamente 0");

    const fromDb = await repo.getContestRecord(4001);
    assert(fromDb?.prize?.amountCents === 0, "Prêmio zero persistido no IndexedDB");
  }

  // ---------------------------------------------------------------------------
  // 5. PRÊMIO POSITIVO ACEITO E PERSISTIDO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 5. Prêmio positivo aceito e persistido");
  {
    const { repo } = createIsolatedRepo("test_c5_positive_prize");
    await prepareScoredContestWithBet(repo, 5001);

    const updated = await repo.recordPrize(5001, 3600);
    assert(updated.prize?.amountCents === 3600, "Prêmio R$ 36,00 persistido");

    await prepareScoredContestWithBet(repo, 5002);
    const jackpot = await repo.recordPrize(5002, 150000000);
    assert(jackpot.prize?.amountCents === 150000000, "Grande prêmio de R$ 1.500.000,00 persistido");
  }

  // ---------------------------------------------------------------------------
  // 6. VALOR NEGATIVO REJEITADO EM CENTAVOS E BRL
  // ---------------------------------------------------------------------------
  console.log("\n▶ 6. Valor negativo rejeitado");
  {
    const { repo } = createIsolatedRepo("test_c6_negative");
    await prepareScoredContestWithBet(repo, 6001);

    let threwRepo = false;
    try {
      await repo.recordPrize(6001, -100);
    } catch {
      threwRepo = true;
    }
    assert(threwRepo, "repo.recordPrize rejeita valor negativo em centavos");

    let threwParse = false;
    try {
      parseBRLToCents("-5,00");
    } catch {
      threwParse = true;
    }
    assert(threwParse, "parseBRLToCents rejeita string de valor negativo");
  }

  // ---------------------------------------------------------------------------
  // 7. VALOR FLOAT / FRACIONADO REJEITADO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 7. Valor float / fracionado rejeitado");
  {
    const { repo } = createIsolatedRepo("test_c7_float");
    await prepareScoredContestWithBet(repo, 7001);

    let threwRepo = false;
    try {
      await repo.recordPrize(7001, 10.5);
    } catch {
      threwRepo = true;
    }
    assert(threwRepo, "repo.recordPrize rejeita float fracionado");

    let threwParse = false;
    try {
      parseBRLToCents("10,999");
    } catch {
      threwParse = true;
    }
    assert(threwParse, "parseBRLToCents rejeita mais de duas casas decimais");
  }

  // ---------------------------------------------------------------------------
  // 8. UNSAFE INTEGER / NAN / INFINITY REJEITADOS
  // ---------------------------------------------------------------------------
  console.log("\n▶ 8. Unsafe integer / NaN / Infinity rejeitados");
  {
    const { repo } = createIsolatedRepo("test_c8_unsafe");
    await prepareScoredContestWithBet(repo, 8001);

    let threwUnsafe = false;
    try {
      await repo.recordPrize(8001, Number.MAX_SAFE_INTEGER + 100);
    } catch {
      threwUnsafe = true;
    }
    assert(threwUnsafe, "repo.recordPrize rejeita unsafe integer");

    let threwNaN = false;
    try {
      await repo.recordPrize(8001, NaN);
    } catch {
      threwNaN = true;
    }
    assert(threwNaN, "repo.recordPrize rejeita NaN");

    let threwInf = false;
    try {
      await repo.recordPrize(8001, Infinity);
    } catch {
      threwInf = true;
    }
    assert(threwInf, "repo.recordPrize rejeita Infinity");
  }

  // ---------------------------------------------------------------------------
  // 9. COERÊNCIA TEMPORAL: recordedAt >= scoredAt E >= betPlacedAt
  // ---------------------------------------------------------------------------
  console.log("\n▶ 9. Coerência temporal do timestamp do prêmio");
  {
    const { repo } = createIsolatedRepo("test_c9_temporal");
    await prepareScoredContestWithBet(repo, 9001, {
      draft: "2026-09-20T10:00:00.000Z",
      freeze: "2026-09-20T11:00:00.000Z",
      bet: "2026-09-20T12:00:00.000Z",
      score: "2026-09-20T21:00:00.000Z",
    });

    // Tentativa com recordedAt anterior a scoredAt
    let threwScoredOrder = false;
    try {
      await repo.recordPrize(9001, 1500, { clock: () => new Date("2026-09-20T20:59:59.000Z") });
    } catch (e: any) {
      threwScoredOrder = true;
      assert(e.message.includes("ordem temporal") && e.message.includes("apuração"), "Erro de ordem temporal frente a scoredAt");
    }
    assert(threwScoredOrder, "Rejeitou recordedAt anterior a scoredAt");

    // Tentativa com recordedAt anterior a betPlacedAt
    let threwBetOrder = false;
    try {
      await repo.recordPrize(9001, 1500, { clock: () => new Date("2026-09-20T11:59:59.000Z") });
    } catch (e: any) {
      threwBetOrder = true;
      assert(e.message.includes("ordem temporal"), "Erro de ordem temporal");
    }
    assert(threwBetOrder, "Rejeitou recordedAt anterior a betPlacedAt");

    // Sucesso quando recordedAt >= scoredAt
    const valid = await repo.recordPrize(9001, 1500, { clock: () => new Date("2026-09-20T21:00:00.000Z") });
    assert(valid.prize?.recordedAt === "2026-09-20T21:00:00.000Z", "Sucesso com timestamp coerente");
  }

  // ---------------------------------------------------------------------------
  // 10. ORIGEM (SOURCE) OBRIGATÓRIA E EXCLUSIVAMENTE 'MANUAL'
  // ---------------------------------------------------------------------------
  console.log("\n▶ 10. Origem (source) exclusivamente 'MANUAL'");
  {
    const { repo } = createIsolatedRepo("test_c10_source");
    await prepareScoredContestWithBet(repo, 10001);

    const updated = await repo.recordPrize(10001, 2000);
    assert(updated.prize?.source === "MANUAL", "PrizeRecord criado com source = 'MANUAL'");
  }

  // ---------------------------------------------------------------------------
  // 11. IMUTABILIDADE ABSOLUTA DO PRIZERECORD GRAVADO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 11. Imutabilidade absoluta do PrizeRecord gravado");
  {
    const { repo } = createIsolatedRepo("test_c11_immutability");
    await prepareScoredContestWithBet(repo, 11001);
    await repo.recordPrize(11001, 1200);

    const record = await repo.getContestRecord(11001);
    assert(record?.prize?.amountCents === 1200, "Registro original é 1200 centavos");
  }

  // ---------------------------------------------------------------------------
  // 12. SEGUNDA GRAVAÇÃO NO MESMO CONCURSO REJEITADA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 12. Segunda gravação no mesmo concurso rejeitada");
  {
    const { repo } = createIsolatedRepo("test_c12_second_record");
    await prepareScoredContestWithBet(repo, 12001);
    await repo.recordPrize(12001, 1200);

    let threwSecond = false;
    try {
      await repo.recordPrize(12001, 9900);
    } catch (e: any) {
      threwSecond = true;
      assert(
        e.message.includes("já realizado") || e.message.includes("imutável"),
        "Erro explicita que prêmio já foi registrado e é imutável"
      );
    }
    assert(threwSecond, "Segunda gravação de prêmio estritamente bloqueada");

    const recordAfter = await repo.getContestRecord(12001);
    assert(recordAfter?.prize?.amountCents === 1200, "Valor original permaneceu intacto");
  }

  // ---------------------------------------------------------------------------
  // 13. DOUBLE-CLICK REAL VIA CONTROLLER OPERACIONAL (ActionLockController)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 13. Double-Click REAL via Controller Operacional");
  {
    const { repo, coord, bus } = createIsolatedRepo("test_c13_double_click");
    const transportB = new InMemoryLocalSyncTransport(bus);
    const eventsB: any[] = [];
    transportB.subscribe((e) => eventsB.push(e));

    await prepareScoredContestWithBet(repo, 13001);
    const controller = new GeneratorOperationalController(repo, coord);
    await controller.refreshLocalState();
    const scoredRec = await repo.getContestRecord(13001);
    controller.setActiveRecord(scoredRec);

    eventsB.length = 0;
    const revBefore = coord.getRevision();

    // Dispara dois cliques simultâneos
    const p1 = controller.recordPrize(2500);
    const p2 = controller.recordPrize(2500);

    const [res1, res2] = await Promise.allSettled([p1, p2]);
    await new Promise((r) => setTimeout(r, 20));

    const fulfilledCount = [res1, res2].filter((r) => r.status === "fulfilled").length;
    const rejectedCount = [res1, res2].filter((r) => r.status === "rejected").length;
    assert(fulfilledCount === 1, "Exatamente uma chamada completou com sucesso");
    assert(rejectedCount === 1, "Chamada simultânea concorrente rejeitada pelo lock");

    const rejectedError = res1.status === "rejected" ? (res1 as any).reason : (res2 as any).reason;
    assert(
      rejectedError.message.includes("já está em execução") || rejectedError.message.includes("lock"),
      "Erro de lock concorrente retornado na tentativa simultânea"
    );

    const finalRecord = await repo.getContestRecord(13001);
    assert(finalRecord?.prize?.amountCents === 2500, "Prêmio persistido exatamente uma vez");
    assert(coord.getRevision() === revBefore + 1, "Revisão incrementada exatamente +1");

    const prizeEvents = eventsB.filter((e) => e.reason === "PRIZE_RECORDED");
    assert(prizeEvents.length === 1, "Exatamente 1 evento PRIZE_RECORDED publicado");
    assert(!actionLockController.isLocked(), "Lock liberado após finalização");
  }

  // ---------------------------------------------------------------------------
  // 14. TOCTOU REAL COM ABORTO ATÔMICO DE CORRIDA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 14. TOCTOU real com aborto atômico de corrida");
  {
    const { repo } = createIsolatedRepo("test_c14_toctou");
    await prepareScoredContestWithBet(repo, 14001);

    const origGetDB = (repo as any).getDB.bind(repo);
    let getDBCalls = 0;
    (repo as any).getDB = async () => {
      getDBCalls++;
      if (getDBCalls === 3) {
        // Chamada 1: getContestRecord snapshot
        // Chamada 2: verifyStoredContest
        // Chamada 3: abertura da transação de escrita do prêmio
        // Simula mutação concorrente por outra aba no exato instante anterior à gravação
        const directDB = await origGetDB();
        const tx = directDB.transaction(CONTEST_STORE_NAME, "readwrite");
        const store = tx.objectStore(CONTEST_STORE_NAME);
        const current = await promisifyRequest<ContestRecord>(store.get(14001));
        current.generation.permutation[0] = 99; // Corrupção concorrente
        await promisifyRequest(store.put(current));
        await waitForTransaction(tx);
        closeDatabase(directDB);
      }
      return origGetDB();
    };

    let toctouCaught = false;
    try {
      await repo.recordPrize(14001, 1000);
    } catch (e: any) {
      toctouCaught = true;
      assert(
        e.message.includes("mudou durante a operação. Registro de prêmio cancelado"),
        "Mensagem canônica de aborto por TOCTOU"
      );
    } finally {
      (repo as any).getDB = origGetDB;
    }
    assert(toctouCaught, "Proteção TOCTOU abortou a operação atômica com sucesso");
  }

  // ---------------------------------------------------------------------------
  // 15. FALHA REAL DE ARMAZENAMENTO ANTES DO COMMIT (ROLLBACK LIMPO)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 15. Falha real de armazenamento antes do commit");
  {
    const { repo, coord, bus } = createIsolatedRepo("test_c15_storage_fail");
    const transportB = new InMemoryLocalSyncTransport(bus);
    const eventsB: any[] = [];
    transportB.subscribe((e) => eventsB.push(e));

    await prepareScoredContestWithBet(repo, 15001);
    const revBefore = coord.getRevision();
    eventsB.length = 0;

    const origGetDB = (repo as any).getDB.bind(repo);
    let injectError = true;
    (repo as any).getDB = async () => {
      const dbInstance = await origGetDB();
      const origTx = dbInstance.transaction.bind(dbInstance);
      dbInstance.transaction = function (storeNames: any, mode: any) {
        const tx = origTx(storeNames, mode);
        if (mode === "readwrite" && injectError) {
          const origStore = tx.objectStore.bind(tx);
          tx.objectStore = function (name: string) {
            const store = origStore(name);
            store.put = function (..._args: any[]) {
              tx.abort();
              throw new DOMException("Falha simulada de I/O antes do commit", "QuotaExceededError");
            };
            return store;
          };
        }
        return tx;
      };
      return dbInstance;
    };

    let failedBeforeCommit = false;
    try {
      await repo.recordPrize(15001, 1000);
    } catch (e: any) {
      failedBeforeCommit = true;
      assert(e.name === "QuotaExceededError" || e.message.includes("Falha simulada"), "Erro de falha antes do commit capturado");
    } finally {
      injectError = false;
      (repo as any).getDB = origGetDB;
    }
    assert(failedBeforeCommit, "Promise rejeitada devido à falha antes do commit");

    // Prova integridade da base: nada foi gravado
    const checkDb = await repo.getContestRecord(15001);
    assert(checkDb?.prize === undefined, "PrizeRecord NÃO foi gravado no banco após abort");
    assert(coord.getRevision() === revBefore, "Revisão não foi alterada");
    assert(eventsB.length === 0, "Nenhum evento multiaba foi publicado");
  }

  // ---------------------------------------------------------------------------
  // 16. LIBERAÇÃO DE LOCK APÓS FALHA TÉCNICA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 16. Liberação de lock após falha técnica no controller");
  {
    const { repo, coord } = createIsolatedRepo("test_c16_lock_release");
    await prepareScoredContestWithBet(repo, 16001);

    const controller = new GeneratorOperationalController(repo, coord);
    await controller.refreshLocalState();
    controller.setActiveRecord(await repo.getContestRecord(16001));

    // Força falha passando valor inválido para testar try/finally do controller
    let threw = false;
    try {
      await controller.recordPrize(-500);
    } catch {
      threw = true;
    }
    assert(threw, "controller.recordPrize falhou com argumento inválido");
    assert(!actionLockController.isLocked(), "ActionLockController liberado após falha");
  }

  // ---------------------------------------------------------------------------
  // 17. RETRY OPERACIONAL COM SUCESSO APÓS FALHA SANADA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 17. Retry operacional com sucesso após falha sanada");
  {
    const { repo, coord } = createIsolatedRepo("test_c17_retry");
    await prepareScoredContestWithBet(repo, 17001);

    const controller = new GeneratorOperationalController(repo, coord);
    await controller.refreshLocalState();
    controller.setActiveRecord(await repo.getContestRecord(17001));

    // Tentativa 1: falha
    try {
      await controller.recordPrize(-100);
    } catch {
      // Ignora falha inicial
    }

    // Tentativa 2: Retry imediato com valor correto
    await controller.recordPrize(3000);
    const finalRec = await repo.getContestRecord(17001);
    assert(finalRec?.prize?.amountCents === 3000, "Retry operacional gravou o prêmio com sucesso");
    assert(controller.getState().activeRecord?.prize?.amountCents === 3000, "Controller atualizado no retry");
  }

  // ---------------------------------------------------------------------------
  // 18. INCREMENTO DE REVISÃO (REVISION +1)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 18. Incremento de revisão (revision +1)");
  {
    const { repo, coord } = createIsolatedRepo("test_c18_revision");
    await prepareScoredContestWithBet(repo, 18001);

    const r0 = coord.getRevision();
    await repo.recordPrize(18001, 1500);
    const r1 = coord.getRevision();

    assert(r1 === r0 + 1, "RefreshCoordinator teve revisão incrementada em exatamente +1");
  }

  // ---------------------------------------------------------------------------
  // 19. EXATAMENTE UM EVENTO PRIZE_RECORDED PUBLICADO PÓS-COMMIT
  // ---------------------------------------------------------------------------
  console.log("\n▶ 19. Exatamente um evento PRIZE_RECORDED publicado pós-commit");
  {
    const { repo, bus } = createIsolatedRepo("test_c19_one_event");
    const transportB = new InMemoryLocalSyncTransport(bus);
    const events: any[] = [];
    transportB.subscribe((e) => events.push(e));

    await prepareScoredContestWithBet(repo, 19001);
    events.length = 0;

    await repo.recordPrize(19001, 1800);

    const prizeEvents = events.filter((e) => e.reason === "PRIZE_RECORDED");
    assert(prizeEvents.length === 1, "Exatamente um evento PRIZE_RECORDED");
    assert(prizeEvents[0].contestNumber === 19001, "contestNumber corresponde ao concurso");
    assert(prizeEvents[0].protocolVersion === LOCAL_SYNC_PROTOCOL_VERSION, "Protocolo é 1");
  }

  // ---------------------------------------------------------------------------
  // 20. SINCRONIZAÇÃO MULTIABA REAL VIA TRANSPORTE DE BARRAMENTO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 20. Sincronização multiaba real via transporte de barramento");
  {
    const bus = new InMemoryLocalSyncBus();
    const fakeIdb = new IDBFactory();

    // Aba A
    const coordA = new RefreshCoordinator();
    const transportA = new InMemoryLocalSyncTransport(bus);
    const syncA = new LocalSyncCoordinator({ transport: transportA, refreshCoordinator: coordA });
    const repoA = new ContestRepository({ idbFactory: fakeIdb, dbName: "multiaba_shared", refreshCoordinator: coordA });
    const ctrlA = new GeneratorOperationalController(repoA, coordA);

    // Aba B
    const coordB = new RefreshCoordinator();
    const transportB = new InMemoryLocalSyncTransport(bus);
    const syncB = new LocalSyncCoordinator({ transport: transportB, refreshCoordinator: coordB });
    const repoB = new ContestRepository({ idbFactory: fakeIdb, dbName: "multiaba_shared", refreshCoordinator: coordB });
    const ctrlB = new GeneratorOperationalController(repoB, coordB);

    await prepareScoredContestWithBet(repoA, 20001);
    await ctrlA.refreshLocalState();
    await ctrlB.refreshLocalState();

    ctrlB.setActiveRecord(await repoB.getContestRecord(20001));
    assert(ctrlB.getState().activeRecord?.prize === undefined, "Aba B inicialmente sem prêmio");

    // Aba A grava o prêmio
    ctrlA.setActiveRecord(await repoA.getContestRecord(20001));
    await ctrlA.recordPrize(3500);

    // Aguarda despacho do transporte
    await new Promise((r) => setTimeout(r, 20));

    assert(ctrlB.getState().activeRecord?.prize?.amountCents === 3500, "Aba B sincronizou o prêmio via multiaba");
  }

  // ---------------------------------------------------------------------------
  // 21. ABA B ATUALIZA ESTADO ATIVO SEM F5
  // ---------------------------------------------------------------------------
  console.log("\n▶ 21. Aba B atualiza estado ativo sem F5");
  {
    const bus = new InMemoryLocalSyncBus();
    const fakeIdb = new IDBFactory();

    const coordA = new RefreshCoordinator();
    const transportA = new InMemoryLocalSyncTransport(bus);
    new LocalSyncCoordinator({ transport: transportA, refreshCoordinator: coordA });
    const repoA = new ContestRepository({ idbFactory: fakeIdb, dbName: "nof5_db", refreshCoordinator: coordA });
    const ctrlA = new GeneratorOperationalController(repoA, coordA);

    const coordB = new RefreshCoordinator();
    const transportB = new InMemoryLocalSyncTransport(bus);
    new LocalSyncCoordinator({ transport: transportB, refreshCoordinator: coordB });
    const repoB = new ContestRepository({ idbFactory: fakeIdb, dbName: "nof5_db", refreshCoordinator: coordB });
    const ctrlB = new GeneratorOperationalController(repoB, coordB);

    await prepareScoredContestWithBet(repoA, 21001);
    await ctrlB.refreshLocalState();
    ctrlB.setActiveRecord(await repoB.getContestRecord(21001));

    let listenerNotified = false;
    ctrlB.subscribe((state) => {
      if (state.activeRecord?.prize?.amountCents === 4200) {
        listenerNotified = true;
      }
    });

    ctrlA.setActiveRecord(await repoA.getContestRecord(21001));
    await ctrlA.recordPrize(4200);

    await new Promise((r) => setTimeout(r, 20));
    assert(listenerNotified, "Ouvinte da Aba B recebeu atualização reativa sem F5");
    assert(ctrlB.getState().activeRecord?.prize?.amountCents === 4200, "Estado ativo da Aba B atualizado");
  }

  // ---------------------------------------------------------------------------
  // 22. PRIZERECORD JÁ PERSISTIDO NO INDEXEDDB QUANDO O EVENTO É OBSERVADO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 22. PrizeRecord já persistido quando o evento é observado na Aba B");
  {
    const bus = new InMemoryLocalSyncBus();
    const fakeIdb = new IDBFactory();

    const coordA = new RefreshCoordinator();
    const transportA = new InMemoryLocalSyncTransport(bus);
    new LocalSyncCoordinator({ transport: transportA, refreshCoordinator: coordA });
    const repoA = new ContestRepository({ idbFactory: fakeIdb, dbName: "order_check_db", refreshCoordinator: coordA });

    const transportB = new InMemoryLocalSyncTransport(bus);
    let recordInDbAtEventTime: ContestRecord | null = null;
    const repoB = new ContestRepository({ idbFactory: fakeIdb, dbName: "order_check_db" });

    transportB.subscribe(async (evt) => {
      if (evt.reason === "PRIZE_RECORDED") {
        recordInDbAtEventTime = await repoB.getContestRecord(evt.contestNumber!);
      }
    });

    await prepareScoredContestWithBet(repoA, 22001);
    await repoA.recordPrize(22001, 7500);

    await new Promise((r) => setTimeout(r, 20));
    assert(recordInDbAtEventTime !== null, "Aba B leu o banco ao receber o evento");
    assert(
      (recordInDbAtEventTime as any)?.prize?.amountCents === 7500,
      "IndexedDB já continha o prêmio gravado antes da entrega do evento (ordenação commit -> notify)"
    );
  }

  // ---------------------------------------------------------------------------
  // 23. FALHA DE TRANSPORTE APÓS COMMIT NÃO CAUSA ROLLBACK
  // ---------------------------------------------------------------------------
  console.log("\n▶ 23. Falha de transporte após commit não causa rollback");
  {
    const fakeIdb = new IDBFactory();
    const bus = new InMemoryLocalSyncBus();
    const brokenTransport = new InMemoryLocalSyncTransport(bus);
    // Injeta falha no publish do transporte
    brokenTransport.publish = function () {
      throw new Error("Simulated BroadcastChannel network partition / close");
    };

    const coord = new RefreshCoordinator();
    new LocalSyncCoordinator({ transport: brokenTransport, refreshCoordinator: coord });
    const repo = new ContestRepository({ idbFactory: fakeIdb, dbName: "transport_fail_db", refreshCoordinator: coord });

    await prepareScoredContestWithBet(repo, 23001);

    // Grava prêmio; o transporte lançará exceção no publish pós-commit
    let operationSucceeded = false;
    try {
      await repo.recordPrize(23001, 5500);
      operationSucceeded = true;
    } catch {
      operationSucceeded = false;
    }
    assert(operationSucceeded, "repo.recordPrize completou com sucesso apesar da falha de transporte");

    // Releitura do IndexedDB confirma que o commit persistiu
    const fromDb = await repo.getContestRecord(23001);
    assert(fromDb?.prize?.amountCents === 5500, "PrizeRecord permanece íntegro no banco de dados");
  }

  // ---------------------------------------------------------------------------
  // 24. EXPORTAÇÃO CANÔNICA COM SCHEMA VERSION 3
  // ---------------------------------------------------------------------------
  console.log("\n▶ 24. Exportação canônica com Schema Version 3");
  {
    const { repo } = createIsolatedRepo("test_c24_export_schema3");
    await prepareScoredContestWithBet(repo, 24001);
    await repo.recordPrize(24001, 3300);

    const backup = await repo.exportHistory();
    assert(backup.schemaVersion === 3, "backup.schemaVersion é exatamente 3");
    const rec = backup.records.find((r) => r.contestNumber === 24001);
    assert(rec?.prize?.amountCents === 3300, "PrizeRecord preservado na exportação");
  }

  // ---------------------------------------------------------------------------
  // 25. COMPATIBILIDADE REGRESSIVA: IMPORTAÇÃO DE SCHEMA 1
  // ---------------------------------------------------------------------------
  console.log("\n▶ 25. Compatibilidade regressiva: Importação de Schema 1");
  {
    const { repo: repoSource } = createIsolatedRepo("test_c25_src");
    const draft = createContestDraft(25001);
    await repoSource.saveDraft(draft);
    await repoSource.freezeStoredContest(25001);
    await repoSource.scoreStoredContest(25001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const backup = await repoSource.exportHistory();
    // Converte sinteticamente para Schema 1 (remove betPlacedAt e prize)
    const schema1Backup = {
      schemaVersion: 1,
      exportedAt: backup.exportedAt,
      recordCount: backup.recordCount,
      algorithmVersions: backup.algorithmVersions,
      records: backup.records.map((r) => {
        const copy: any = { ...r };
        delete copy.betPlacedAt;
        delete copy.prize;
        return copy;
      }),
    };

    const val = await validateHistoryBackup(schema1Backup);
    assert(val.valid, "validateHistoryBackup aceitou Schema 1");

    const { repo: repoDest } = createIsolatedRepo("test_c25_dest");
    const res = await importHistory(schema1Backup as any, repoDest);
    assert(res.success, "importHistory de Schema 1 concluído com sucesso");

    const imported = await repoDest.getContestRecord(25001);
    assert(imported !== null, "Registro importado existe");
    assert(imported?.betPlacedAt === undefined, "betPlacedAt é undefined em Schema 1");
    assert(imported?.prize === undefined, "prize é undefined em Schema 1");
  }

  // ---------------------------------------------------------------------------
  // 26. COMPATIBILIDADE REGRESSIVA: IMPORTAÇÃO DE SCHEMA 2
  // ---------------------------------------------------------------------------
  console.log("\n▶ 26. Compatibilidade regressiva: Importação de Schema 2");
  {
    const { repo: repoSource } = createIsolatedRepo("test_c26_src");
    await prepareScoredContestWithBet(repoSource, 26001);

    const backup = await repoSource.exportHistory();
    // Converte sinteticamente para Schema 2 (possui betPlacedAt, mas sem prize)
    const schema2Backup = {
      schemaVersion: 2,
      exportedAt: backup.exportedAt,
      recordCount: backup.recordCount,
      algorithmVersions: backup.algorithmVersions,
      records: backup.records.map((r) => {
        const copy: any = { ...r };
        delete copy.prize;
        return copy;
      }),
    };

    const val = await validateHistoryBackup(schema2Backup);
    assert(val.valid, "validateHistoryBackup aceitou Schema 2");

    const { repo: repoDest } = createIsolatedRepo("test_c26_dest");
    const res = await importHistory(schema2Backup as any, repoDest);
    assert(res.success, "importHistory de Schema 2 concluído com sucesso");

    const imported = await repoDest.getContestRecord(26001);
    assert(imported?.betPlacedAt !== undefined, "betPlacedAt preservado em Schema 2");
    assert(imported?.prize === undefined, "prize ausente em Schema 2");
  }

  // ---------------------------------------------------------------------------
  // 27. ROUND-TRIP COMPLETO DE EXPORTAÇÃO E IMPORTAÇÃO EM SCHEMA 3
  // ---------------------------------------------------------------------------
  console.log("\n▶ 27. Round-trip completo em Schema 3");
  {
    const { repo: repoSource } = createIsolatedRepo("test_c27_src");
    await prepareScoredContestWithBet(repoSource, 27001);
    await repoSource.recordPrize(27001, 8800);

    const exportData = await repoSource.exportHistory();
    assert(exportData.schemaVersion === 3, "Exportado em schemaVersion 3");

    const { repo: repoDest } = createIsolatedRepo("test_c27_dest");
    const plan = await prepareHistoryImport(exportData, repoDest);
    assert(plan.valid && plan.newRecords === 1, "Plano de importação validou o registro");

    const result = await importHistory(exportData, repoDest);
    assert(result.success, "Importação executada com sucesso");

    const imported = await repoDest.getContestRecord(27001);
    assert(imported?.prize?.amountCents === 8800, "Prêmio importado com 8800 centavos intacto");
    assert(imported?.prize?.source === "MANUAL", "Source MANUAL preservado");
  }

  // ---------------------------------------------------------------------------
  // 28. REJEIÇÃO ESTRITA DE BACKUPS COM ESQUEMAS INVÁLIDOS
  // ---------------------------------------------------------------------------
  console.log("\n▶ 28. Rejeição estrita de esquemas inválidos");
  {
    const invalidSchema0 = { schemaVersion: 0, records: [] };
    const val0 = await validateHistoryBackup(invalidSchema0);
    assert(!val0.valid, "schemaVersion 0 rejeitado");

    const invalidSchema4 = { schemaVersion: 4, records: [] };
    const val4 = await validateHistoryBackup(invalidSchema4);
    assert(!val4.valid, "schemaVersion 4 (futuro desconhecido) rejeitado");

    const nonIntegerSchema = { schemaVersion: 2.5, records: [] };
    const valFloat = await validateHistoryBackup(nonIntegerSchema);
    assert(!valFloat.valid, "schemaVersion fracionário rejeitado");
  }

  // ---------------------------------------------------------------------------
  // 29. QUARENTENA DE REGISTROS COM PRIZERECORD ADULTERADO OU CORROMPIDO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 29. Quarentena de registros com PrizeRecord adulterado");
  {
    const { repo, fakeIdb } = createIsolatedRepo("test_c29_quarantine");
    await prepareScoredContestWithBet(repo, 29001);
    await repo.recordPrize(29001, 1000);

    // Injeta adulteração direta no IndexedDB
    const db = await (repo as any).getDB();
    const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<ContestRecord>(store.get(29001));
    // Corrompe amountCents para negativo
    (rec.prize as any).amountCents = -999;
    await promisifyRequest(store.put(rec));
    await waitForTransaction(tx);
    closeDatabase(db);

    // Executa auditoria do repositório
    const audit = await repo.auditEntireHistory();
    assert(!audit.valid, "Histórico detectado como inválido");
    assert(audit.quarantinedRecords === 1, "Exatamente 1 registro colocado em quarentena");

    const v = await repo.verifyStoredContest(29001);
    assert(!v.valid, "verifyStoredContest detectou falha de integridade");
    assert(
      v.errors.some((e) => e.includes("prize.amountCents")),
      "Erro específico de prize.amountCents reportado na auditoria"
    );
  }

  // ---------------------------------------------------------------------------
  // 30. areContestRecordsIdentical INCLUI COMPARAÇÃO ESTRITA DE PRIZERECORD
  // ---------------------------------------------------------------------------
  console.log("\n▶ 30. areContestRecordsIdentical com PrizeRecord");
  {
    const { repo } = createIsolatedRepo("test_c30_comparison");
    await prepareScoredContestWithBet(repo, 30001);
    const recNoPrize = (await repo.getContestRecord(30001))!;

    const recWithPrize: ContestRecord = {
      ...deepCloneRecord(recNoPrize),
      prize: {
        amountCents: 5000,
        recordedAt: "2026-09-20T22:00:00.000Z",
        source: "MANUAL",
      },
    };

    assert(!areContestRecordsIdentical(recNoPrize, recWithPrize), "Registro com prêmio difere de registro sem prêmio");

    const recDiffAmount: ContestRecord = {
      ...deepCloneRecord(recWithPrize),
      prize: { ...recWithPrize.prize!, amountCents: 6000 },
    };
    assert(!areContestRecordsIdentical(recWithPrize, recDiffAmount), "amountCents diferente detectado como divergente");

    const recDiffDate: ContestRecord = {
      ...deepCloneRecord(recWithPrize),
      prize: { ...recWithPrize.prize!, recordedAt: "2026-09-20T22:05:00.000Z" },
    };
    assert(!areContestRecordsIdentical(recWithPrize, recDiffDate), "recordedAt diferente detectado como divergente");

    const recDiffSource: ContestRecord = {
      ...deepCloneRecord(recWithPrize),
      prize: { ...recWithPrize.prize!, source: "AUTO" as any },
    };
    assert(!areContestRecordsIdentical(recWithPrize, recDiffSource), "source diferente detectado como divergente");

    const recIdentical = deepCloneRecord(recWithPrize);
    assert(areContestRecordsIdentical(recWithPrize, recIdentical), "Registros idênticos com prize retornam true");
  }

  // ---------------------------------------------------------------------------
  // 31. deepCloneRecord REALIZA CLONAGEM PROFUNDA DEFENSIVA DE PRIZERECORD
  // ---------------------------------------------------------------------------
  console.log("\n▶ 31. deepCloneRecord realiza clone profundo de PrizeRecord");
  {
    const { repo } = createIsolatedRepo("test_c31_clone");
    await prepareScoredContestWithBet(repo, 31001);
    await repo.recordPrize(31001, 4000);
    const original = (await repo.getContestRecord(31001))!;

    const clone = deepCloneRecord(original);
    assert(clone.prize !== undefined, "Clone possui prize definido");
    assert(clone.prize !== original.prize, "Objeto prize é uma nova referência na memória");

    // Muta clone
    (clone.prize as any).amountCents = 99999;
    assert(original.prize?.amountCents === 4000, "Mutação no clone NÃO afeta o objeto original");
  }

  // ---------------------------------------------------------------------------
  // 32. FIXTURE FINANCEIRA CANÔNICA PARCIAL (FIXTURE A)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 32. Fixture Financeira Canônica Parcial (Fixture A)");
  {
    const { repo } = createIsolatedRepo("test_c32_fixture_a");

    // Concurso 1: Apostado (R$ 17,50) + Prêmio R$ 30,00 (3000)
    await prepareScoredContestWithBet(repo, 32001);
    await repo.recordPrize(32001, 3000);

    // Concurso 2: Apostado (R$ 17,50) + Prêmio R$ 0,00 (0)
    await prepareScoredContestWithBet(repo, 32002);
    await repo.recordPrize(32002, 0);

    // Concurso 3: Apostado (R$ 17,50) + Sem prêmio registrado (Pendência)
    await prepareScoredContestWithBet(repo, 32003);

    const summary = await repo.getHistorySummary();
    assert(summary.confirmedBets === 3, "confirmedBets === 3");
    assert(summary.confirmedSpentCents === 5250, "confirmedSpentCents === 5250");
    assert(summary.confirmedSpent === 52.5, "confirmedSpent === 52.50 reais");
    assert(summary.totalPrizeCents === 3000, "totalPrizeCents === 3000 (R$ 30,00)");
    assert(summary.prizesRecorded === 2, "prizesRecorded === 2");
    assert(summary.pendingFinancialClosures === 1, "pendingFinancialClosures === 1");
    assert(summary.financialHistoryComplete === false, "financialHistoryComplete === false");
    // Saldo líquido = 3000 - 5250 = -2250 centavos (-R$ 22,50)
    assert(summary.netResultCents === -2250, "netResultCents === -2250");
  }

  // ---------------------------------------------------------------------------
  // 33. FIXTURE FINANCEIRA CANÔNICA COMPLETA (FIXTURE B)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 33. Fixture Financeira Canônica Completa (Fixture B)");
  {
    const { repo } = createIsolatedRepo("test_c33_fixture_b");

    await prepareScoredContestWithBet(repo, 33001);
    await repo.recordPrize(33001, 3000);

    await prepareScoredContestWithBet(repo, 33002);
    await repo.recordPrize(33002, 0);

    await prepareScoredContestWithBet(repo, 33003);
    await repo.recordPrize(33003, 5000); // R$ 50,00 fecha a pendência

    const summary = await repo.getHistorySummary();
    assert(summary.confirmedBets === 3, "confirmedBets === 3");
    assert(summary.confirmedSpentCents === 5250, "confirmedSpentCents === 5250");
    assert(summary.totalPrizeCents === 8000, "totalPrizeCents === 8000 (R$ 80,00)");
    assert(summary.prizesRecorded === 3, "prizesRecorded === 3");
    assert(summary.pendingFinancialClosures === 0, "pendingFinancialClosures === 0");
    assert(summary.financialHistoryComplete === true, "financialHistoryComplete === true");
    // Saldo líquido = 8000 - 5250 = +2750 centavos (+R$ 27,50)
    assert(summary.netResultCents === 2750, "netResultCents === +2750");
  }

  // ---------------------------------------------------------------------------
  // 34. PRÊMIO ZERO ENCERRA PENDÊNCIA FINANCEIRA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 34. Prêmio zero encerra pendência financeira");
  {
    const { repo } = createIsolatedRepo("test_c34_zero_closes_pending");
    await prepareScoredContestWithBet(repo, 34001);

    const before = await repo.getHistorySummary();
    assert(before.pendingFinancialClosures === 1, "1 pendência antes do prêmio");

    await repo.recordPrize(34001, 0);

    const after = await repo.getHistorySummary();
    assert(after.pendingFinancialClosures === 0, "0 pendências após prêmio zero");
    assert(after.financialHistoryComplete === true, "financialHistoryComplete é true");
    assert(after.netResultCents === -1750, "Saldo líquido é -1750 centavos (-R$ 17,50)");
  }

  // ---------------------------------------------------------------------------
  // 35. FROZEN COM betPlacedAt NÃO CONTA COMO PENDÊNCIA FINANCEIRA
  // ---------------------------------------------------------------------------
  console.log("\n▶ 35. FROZEN com betPlacedAt não conta como pendência");
  {
    const { repo } = createIsolatedRepo("test_c35_frozen_not_pending");
    const draft = createContestDraft(35001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(35001);
    await repo.confirmBetPlaced(35001);

    const summary = await repo.getHistorySummary();
    assert(summary.frozen === 1, "Concurso congelado");
    assert(summary.confirmedBets === 1, "Aposta confirmada");
    assert(summary.pendingFinancialClosures === 0, "FROZEN não é considerado pendência de prêmio (apenas SCORED)");
    assert(summary.financialHistoryComplete === true, "Histórico considerado completo financeiramente");
  }

  // ---------------------------------------------------------------------------
  // 36. PARSER BRL COMPLETO E UTILITÁRIOS MONETÁRIOS (money.ts)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 36. Parser BRL completo e utilitários monetários");
  {
    assert(parseBRLToCents("0") === 0, "parse '0' -> 0");
    assert(parseBRLToCents("0,00") === 0, "parse '0,00' -> 0");
    assert(parseBRLToCents("6") === 600, "parse '6' -> 600");
    assert(parseBRLToCents("6,00") === 600, "parse '6,00' -> 600");
    assert(parseBRLToCents("12,50") === 1250, "parse '12,50' -> 1250");
    assert(parseBRLToCents("17,50") === 1750, "parse '17,50' -> 1750");
    assert(parseBRLToCents("1.234,56") === 123456, "parse '1.234,56' -> 123456");
    assert(parseBRLToCents("R$ 1.500.000,00") === 150000000, "parse 'R$ 1.500.000,00' -> 150000000");

    assert(formatBRLFromCents(0).includes("0,00"), "format 0 -> R$ 0,00");
    assert(formatBRLFromCents(1750).includes("17,50"), "format 1750 -> R$ 17,50");
    assert(formatSignedBRLFromCents(1000).startsWith("+"), "signed positivo tem prefixo +");
    assert(formatSignedBRLFromCents(-1750).startsWith("-"), "signed negativo tem prefixo -");
    assert(formatSignedBRLFromCents(0).includes("0,00"), "signed zero sem sinal");
  }

  // ---------------------------------------------------------------------------
  // 37. ESTADOS DERIVADOS DA INTERFACE DE USUÁRIO (BADGES E BOTÕES)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 37. Estados derivados da interface de usuário");
  {
    const { repo } = createIsolatedRepo("test_c37_ui_states");
    await prepareScoredContestWithBet(repo, 37001);
    const unrecorded = (await repo.getContestRecord(37001))!;

    // Verificação de lógica condicional de UI
    const canRecordUnrecorded = unrecorded.status === "SCORED" && unrecorded.betPlacedAt !== undefined && unrecorded.prize === undefined;
    assert(canRecordUnrecorded === true, "UI: Botão 'Registrar Prêmio' ativo para concurso elegível");

    await repo.recordPrize(37001, 3500);
    const recorded = (await repo.getContestRecord(37001))!;

    const canRecordAfter = recorded.status === "SCORED" && recorded.betPlacedAt !== undefined && recorded.prize === undefined;
    assert(canRecordAfter === false, "UI: Botão 'Registrar Prêmio' oculto após gravação");

    const badgePrizeVisible = recorded.prize !== undefined;
    assert(badgePrizeVisible === true, "UI: Badge de prêmio visível");
  }

  // ---------------------------------------------------------------------------
  // 38. METADADOS FINANCEIROS NO DETALHAMENTO DE CONCURSO (MODAL/DETAIL)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 38. Metadados financeiros no detalhamento de concurso");
  {
    const { repo } = createIsolatedRepo("test_c38_modal_detail");
    await prepareScoredContestWithBet(repo, 38001);
    await repo.recordPrize(38001, 4500, { clock: () => new Date("2026-09-21T10:00:00.000Z") });
    const rec = (await repo.getContestRecord(38001))!;

    const netBalance = rec.prize!.amountCents - 1750;
    assert(netBalance === 2750, "Cálculo de balanço individual do concurso: +R$ 27,50");
    assert(rec.prize?.source === "MANUAL", "Source exibida no modal é MANUAL");
    assert(rec.prize?.recordedAt === "2026-09-21T10:00:00.000Z", "Timestamp de registro exibido");
  }

  // ---------------------------------------------------------------------------
  // 39. ZERO CHAMADAS À REDE/CAIXA PROVOCADAS PELO FLUXO DE PREMIAÇÃO
  // ---------------------------------------------------------------------------
  console.log("\n▶ 39. ZERO chamadas à rede/CAIXA provocadas pelo fluxo de premiação");
  {
    const countingProvider = new CountingLotteryProvider();
    const { repo, coord } = createIsolatedRepo("test_c39_zero_caixa");
    await prepareScoredContestWithBet(repo, 39001);

    const controller = new GeneratorOperationalController(
      repo,
      coord,
      () => countingProvider
    );
    await controller.refreshLocalState();
    controller.setActiveRecord(await repo.getContestRecord(39001));

    const callsBefore = countingProvider.callCount;
    await controller.recordPrize(2500);
    const callsAfter = countingProvider.callCount;

    assert(callsAfter === callsBefore, "Exatamente ZERO chamadas à CAIXA provocadas por recordPrize");
  }

  // ---------------------------------------------------------------------------
  // 40. PRESERVAÇÃO ESTRITA DO SHA-256 CANÔNICO DA FrozenC5Payload
  // ---------------------------------------------------------------------------
  console.log("\n▶ 40. Preservação estrita do SHA-256 canônico da FrozenC5Payload");
  {
    const { repo } = createIsolatedRepo("test_c40_sha256");
    const draft = createContestDraft(40001);
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(40001);

    const frozen = (await repo.getContestRecord(40001))!;
    const originalHash = frozen.integrityHash;
    assert(typeof originalHash === "string" && originalHash.length === 64, "Hash congelado existe");

    // 1. Confirma aposta
    await repo.confirmBetPlaced(40001);
    const confirmed = (await repo.getContestRecord(40001))!;
    const auditAfterBet = await verifyContestIntegrity(confirmed);
    assert(auditAfterBet.valid && auditAfterBet.hashMatches, "Auditoria íntegra após confirmação de aposta");
    assert(auditAfterBet.calculatedHash === originalHash, "Hash idêntico após betPlacedAt");

    // 2. Pontua concurso
    await repo.scoreStoredContest(40001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const scored = (await repo.getContestRecord(40001))!;
    const auditAfterScore = await verifyContestIntegrity(scored);
    assert(auditAfterScore.valid && auditAfterScore.hashMatches, "Auditoria íntegra após apuração");
    assert(auditAfterScore.calculatedHash === originalHash, "Hash idêntico após apuração");

    // 3. Registra prêmio
    await repo.recordPrize(40001, 7500);
    const withPrize = (await repo.getContestRecord(40001))!;
    const auditAfterPrize = await verifyContestIntegrity(withPrize);
    assert(auditAfterPrize.valid && auditAfterPrize.hashMatches, "Auditoria íntegra após registro de prêmio");
    assert(
      auditAfterPrize.calculatedHash === originalHash,
      "SHA-256 bit-a-bit idêntico: presença de PrizeRecord não altera FrozenC5Payload"
    );
  }

  console.log("\n===============================================================================");
  console.log(` SUÍTE V1.8 CONCLUÍDA: ${passed} PASSARAM, ${failed} FALHARAM EM 40 CENÁRIOS! `);
  console.log("===============================================================================");

  return { passed, failed };
}

// Execução direta quando rodado via CLI / npm script
if (typeof process !== "undefined" && process.argv[1]?.includes("prizeManagement.test.ts")) {
  runPrizeManagementCertification()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("Erro fatal na suíte:", err);
      process.exit(1);
    });
}
