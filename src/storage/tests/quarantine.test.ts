/**
 * Bateria de Testes Exaustivos de Quarentena, Auditoria e Integridade Local (v1.3).
 * Valida os requisitos 17.1 a 17.9:
 * 17.1 DRAFT corrompido
 * 17.2 FROZEN corrompido
 * 17.3 SCORED corrompido
 * 17.4 Histórico misto
 * 17.5 Exportação de diagnóstico
 * 17.6 Bloqueio de backup operacional normal
 * 17.7 Recuperação segura e tratamento de conflito na importação
 * 17.8 Não-mutação / preservação de evidência do registro em quarentena
 * 17.9 Rejeição de arquivo de diagnóstico na importação operacional
 */
import { IDBFactory } from "fake-indexeddb";
import {
  createContestDraft,
  createMulberry32,
  defaultClock,
} from "../../c5/index.ts";
import { ContestRepository, generateDiagnosticFilename } from "../contestRepository.ts";
import {
  openDatabase,
  closeDatabase,
  promisifyRequest,
  CONTEST_STORE_NAME,
} from "../db.ts";
import {
  parseHistoryBackup,
  validateHistoryBackup,
  prepareHistoryImport,
} from "../import.ts";
import type { ContestRecord, Clock } from "../../c5/types.ts";

export async function runQuarantineTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("=== INICIANDO TESTES DE AUDITORIA, QUARENTENA E RECUPERAÇÃO SEGURA (v1.3) ===");

  const fixedDate1 = new Date("2026-09-17T12:00:00.000Z");
  const fixedDate2 = new Date("2026-09-17T12:05:00.000Z");
  const fixedDate3 = new Date("2026-09-17T20:30:00.000Z");

  const clock1: Clock = () => fixedDate1;
  const clock2: Clock = () => fixedDate2;
  const clock3: Clock = () => fixedDate3;

  const standardResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  // =========================================================================
  // 17.1 DRAFT Corrompido
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    const draft = createContestDraft(3100, {
      rng: createMulberry32(100),
      clock: clock1,
      generationId: "a3100000-0000-4000-8000-000000003100",
    });
    await repo.saveDraft(draft);

    // Corromper o DRAFT diretamente no IndexedDB (geração com dezena duplicada)
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<ContestRecord>(store.get(3100));
    rec.generation.games[0][0] = rec.generation.games[0][1]; // Duplica dezena no jogo J1
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    // a) auditEntireHistory aponta QUARANTINED
    const audit = await repo.auditEntireHistory();
    assert(
      !audit.valid && audit.quarantinedRecords === 1 && audit.quarantinedList[0].contestNumber === 3100,
      "17.1.a auditEntireHistory aponta DRAFT corrompido como QUARANTINED"
    );

    // b) getContestRecord retorna o registro para diagnóstico forense
    const fetched = await repo.getContestRecord(3100);
    assert(
      fetched !== null && fetched.contestNumber === 3100,
      "17.1.b getContestRecord preserva e retorna o registro corrompido para diagnóstico"
    );

    // c) freezeStoredContest BLOQUEIA com erro explícito
    let freezeBlocked = false;
    try {
      await repo.freezeStoredContest(3100, { clock: clock2 });
    } catch (e: any) {
      freezeBlocked = e.message.includes("falhou na auditoria de integridade");
    }
    assert(freezeBlocked, "17.1.c freezeStoredContest bloqueia congelamento de DRAFT em quarentena");

    // d) deleteDraft bloqueia exclusão de registro em quarentena
    let deleteBlocked = false;
    try {
      await repo.deleteDraft(3100);
    } catch (e: any) {
      deleteBlocked = e.message.includes("falhou na auditoria de integridade");
    }
    assert(deleteBlocked, "17.1.d deleteDraft bloqueia deleção de DRAFT em quarentena");
  }

  // =========================================================================
  // 17.2 FROZEN Corrompido
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    const draft = createContestDraft(3200, {
      rng: createMulberry32(200),
      clock: clock1,
      generationId: "a3200000-0000-4000-8000-000000003200",
    });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3200, { clock: clock2 });

    // Corromper hash no IndexedDB
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<ContestRecord>(store.get(3200));
    rec.integrityHash = "f".repeat(64); // Hash falso
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    // a) detectado como QUARANTINED
    const verify = await repo.verifyStoredContest(3200);
    assert(
      !verify.valid && verify.quarantinedRecord !== null,
      "17.2.a FROZEN com hash corrompido classificado como QUARANTINED"
    );

    // b) scoreStoredContest BLOQUEIA
    let scoreBlocked = false;
    try {
      await repo.scoreStoredContest(3200, standardResult, { clock: clock3 });
    } catch (e: any) {
      scoreBlocked = e.message.includes("falhou na auditoria de integridade");
    }
    assert(scoreBlocked, "17.2.b scoreStoredContest bloqueia pontuação de FROZEN em quarentena");

    // c) Não entra em métricas de frozen pendente
    const summary = await repo.getHistorySummary();
    assert(
      summary.frozen === 0 && summary.quarantinedRecords === 1,
      "17.2.c FROZEN corrompido é isolado das contagens operacionais de pendentes"
    );
  }

  // =========================================================================
  // 17.3 SCORED Corrompido
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    const draft = createContestDraft(3300, {
      rng: createMulberry32(300),
      clock: clock1,
      generationId: "a3300000-0000-4000-8000-000000003300",
    });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3300, { clock: clock2 });
    await repo.scoreStoredContest(3300, standardResult, { clock: clock3 });

    // Adulterar officialResult e score no banco
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<ContestRecord>(store.get(3300));
    rec.score!.maxHits = 15; // Adulteração indevida de prêmio máximo
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    // a) detectado como QUARANTINED
    const verify = await repo.verifyStoredContest(3300);
    assert(
      !verify.valid && verify.quarantinedRecord !== null,
      "17.3.a SCORED com score adulterado classificado como QUARANTINED"
    );

    // b) Excluído de getHistorySummary (totalSpent = 0, hits15 = 0)
    const summary = await repo.getHistorySummary();
    assert(
      summary.scored === 0 &&
        summary.totalSpent === 0 &&
        summary.hits15 === 0 &&
        summary.quarantinedRecords === 1,
      "17.3.b SCORED corrompido é sumariamente excluído das métricas financeiras e de acertos"
    );
  }

  // =========================================================================
  // 17.4 Histórico Misto (3 Válidos + 2 Corrompidos)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    // 1 Válido DRAFT (3401)
    await repo.saveDraft(
      createContestDraft(3401, {
        rng: createMulberry32(401),
        clock: clock1,
        generationId: "a3401000-0000-4000-8000-000000003401",
      })
    );

    // 1 Válido FROZEN (3402)
    await repo.saveDraft(
      createContestDraft(3402, {
        rng: createMulberry32(402),
        clock: clock1,
        generationId: "a3402000-0000-4000-8000-000000003402",
      })
    );
    await repo.freezeStoredContest(3402, { clock: clock2 });

    // 1 Válido SCORED (3403)
    await repo.saveDraft(
      createContestDraft(3403, {
        rng: createMulberry32(403),
        clock: clock1,
        generationId: "a3403000-0000-4000-8000-000000003403",
      })
    );
    await repo.freezeStoredContest(3403, { clock: clock2 });
    await repo.scoreStoredContest(3403, standardResult, { clock: clock3 });

    // 2 Corrompidos:
    // Corrompido 1 (3404): FROZEN com dezena adulterada
    await repo.saveDraft(
      createContestDraft(3404, {
        rng: createMulberry32(404),
        clock: clock1,
        generationId: "a3404000-0000-4000-8000-000000003404",
      })
    );
    await repo.freezeStoredContest(3404, { clock: clock2 });

    // Corrompido 2 (3405): DRAFT com status desconhecido/lixo
    await repo.saveDraft(
      createContestDraft(3405, {
        rng: createMulberry32(405),
        clock: clock1,
        generationId: "a3405000-0000-4000-8000-000000003405",
      })
    );

    // Injetar as corrupções no IndexedDB
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);

    const rec3404 = await promisifyRequest<ContestRecord>(store.get(3404));
    rec3404.generation.games[0][0] = 99; // dezena inválida fora de 1..25
    await promisifyRequest(store.put(rec3404));

    const rec3405 = await promisifyRequest<any>(store.get(3405));
    rec3405.status = "CORRUPTED_GARBAGE"; // status desconhecido
    await promisifyRequest(store.put(rec3405));

    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    // Auditoria Global: 5 total, 3 válidos, 2 quarentena
    const audit = await repo.auditEntireHistory();
    assert(
      audit.totalRecords === 5 &&
        audit.validRecords === 3 &&
        audit.quarantinedRecords === 2 &&
        audit.quarantinedList.length === 2 &&
        !audit.valid,
      "17.4.a Auditoria global em base mista relata exatamente: 5 total, 3 válidos, 2 quarentena"
    );

    // Métricas financeiras e de acertos consideram APENAS o único SCORED válido (3403)
    const summary = await repo.getHistorySummary();
    assert(
      summary.totalRecords === 5 &&
        summary.validRecords === 3 &&
        summary.quarantinedRecords === 2 &&
        summary.drafts === 1 &&
        summary.frozen === 1 &&
        summary.scored === 1 &&
        summary.totalSpent === 17.5, // Apenas 1 concurso conferido (R$ 17,50)
      "17.4.b Resumo financeiro contabiliza estritamente os registros válidos, ignorando os 2 corrompidos"
    );
  }

  // =========================================================================
  // 17.5 Exportação de Diagnóstico (exportDiagnostic)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock3 });

    // Inserir registro corrompido
    await repo.saveDraft(
      createContestDraft(3501, {
        rng: createMulberry32(501),
        clock: clock1,
        generationId: "a3501000-0000-4000-8000-000000003501",
      })
    );
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<any>(store.get(3501));
    rec.generationId = "invalid-uuid";
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    const diag = await repo.exportDiagnostic();
    const filename = generateDiagnosticFilename();

    assert(
      diag.diagnosticSchemaVersion === 1 &&
        diag.audit.quarantinedRecords === 1 &&
        diag.quarantined.length === 1 &&
        diag.quarantined[0].contestNumber === 3501 &&
        diag.quarantined[0].reasons.length > 0 &&
        filename.startsWith("lotofacil-c5-diagnostico-") &&
        filename.endsWith(".json"),
      "17.5 exportDiagnostic() gera relatório serializável com evidências e nome padronizado"
    );
  }

  // =========================================================================
  // 17.6 Bloqueio de Backup Normal com Quarentena > 0
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock3 });

    await repo.saveDraft(
      createContestDraft(3601, {
        rng: createMulberry32(601),
        clock: clock1,
        generationId: "a3601000-0000-4000-8000-000000003601",
      })
    );

    // Corromper 3601
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<any>(store.get(3601));
    rec.algorithmVersion = "UNSUPPORTED_VERSION_99";
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    let backupBlocked = false;
    try {
      await repo.exportHistory();
    } catch (e: any) {
      backupBlocked = e.message.includes("backup operacional foi bloqueado");
    }
    assert(
      backupBlocked,
      "17.6 exportHistory() BLOQUEIA lançamento de backup com mensagem explicativa se houver quarentena"
    );
  }

  // =========================================================================
  // 17.7 Recuperação Segura e Tratamento de Conflito na Importação
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    // Local possui: 3701 (corrompido) e 3702 (válido)
    await repo.saveDraft(
      createContestDraft(3701, {
        rng: createMulberry32(701),
        clock: clock1,
        generationId: "a3701000-0000-4000-8000-000000003701",
      })
    );
    await repo.saveDraft(
      createContestDraft(3702, {
        rng: createMulberry32(702),
        clock: clock1,
        generationId: "a3702000-0000-4000-8000-000000003702",
      })
    );

    // Corromper 3701 no IndexedDB
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<any>(store.get(3701));
    rec.generation.games[0] = [1, 2, 3]; // inválido (só 3 dezenas)
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    // Backup íntegro recebido contendo versão válida de 3701 e 3702
    const validDraft3701 = createContestDraft(3701, {
      rng: createMulberry32(701),
      clock: clock1,
      generationId: "a3701000-0000-4000-8000-000000003701",
    });
    const validDraft3702 = createContestDraft(3702, {
      rng: createMulberry32(702),
      clock: clock1,
      generationId: "a3702000-0000-4000-8000-000000003702",
    });

    const backupData = {
      schemaVersion: 1,
      exportedAt: fixedDate1.toISOString(),
      recordCount: 2,
      algorithmVersions: ["C5-1.0.0"],
      records: [validDraft3701, validDraft3702],
    };

    const importPlan = await prepareHistoryImport(backupData, repo);
    const conflictItem = importPlan.records.find((i) => i.contestNumber === 3701);
    assert(
      conflictItem !== undefined &&
        conflictItem.action === "CONFLICT" &&
        Boolean(conflictItem.reason?.includes("quarentena")),
      "17.7 prepareHistoryImport classifica registro local corrompido como CONFLICT para preservar evidência"
    );
  }

  // =========================================================================
  // 17.8 Não-Mutação do Registro Corrompido
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    await repo.saveDraft(
      createContestDraft(3801, {
        rng: createMulberry32(801),
        clock: clock1,
        generationId: "a3801000-0000-4000-8000-000000003801",
      })
    );

    // Inserir anomalia específica em campo canônico
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<any>(store.get(3801));
    rec.generation.games[0][0] = 99; // valor anômalo fora de 1..25
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    const snapshotBefore = JSON.stringify(await repo.getContestRecord(3801));

    // Executar múltiplas operações de auditoria e inspeção
    await repo.auditEntireHistory();
    await repo.verifyStoredContest(3801);
    await repo.getHistorySummary();
    await repo.exportDiagnostic();

    const snapshotAfter = JSON.stringify(await repo.getContestRecord(3801));

    assert(
      snapshotBefore === snapshotAfter && snapshotAfter.includes("99"),
      "17.8 Registro em quarentena permanece rigorosamente idêntico byte a byte (zero auto-reparo/mutação silenciosa)"
    );
  }

  // =========================================================================
  // 17.9 Rejeição de Arquivo de Diagnóstico na Importação Operacional
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock1 });

    await repo.saveDraft(
      createContestDraft(3901, {
        rng: createMulberry32(901),
        clock: clock1,
        generationId: "a3901000-0000-4000-8000-000000003901",
      })
    );
    // Corromper para gerar diagnóstico
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const rec = await promisifyRequest<any>(store.get(3901));
    rec.generationId = "invalid";
    await promisifyRequest(store.put(rec));
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });
    closeDatabase(rawDB);

    const diagnosticPayload = await repo.exportDiagnostic();
    const diagnosticJson = JSON.stringify(diagnosticPayload);

    // a) parseHistoryBackup deve rejeitar
    let parseRejected = false;
    try {
      parseHistoryBackup(diagnosticJson);
    } catch (e: any) {
      parseRejected = e.message.includes("diagnóstico");
    }
    assert(
      parseRejected,
      "17.9.a parseHistoryBackup recusa terminantemente arquivo de diagnóstico com erro explicativo"
    );

    // b) validateHistoryBackup deve rejeitar
    const validation = await validateHistoryBackup(diagnosticPayload);
    assert(
      !validation.valid &&
        validation.errors.some((err) => err.includes("diagnóstico")),
      "17.9.b validateHistoryBackup recusa payload de diagnóstico indicando uso indevido como backup"
    );
  }

  console.log(
    `=== FIM DOS TESTES DE QUARENTENA E RECUPERAÇÃO SEGURA: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (
  import.meta.url.endsWith(process.argv[1]) ||
  process.argv[1]?.includes("quarantine.test.ts")
) {
  runQuarantineTests().then(({ failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
  });
}
