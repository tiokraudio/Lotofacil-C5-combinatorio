/**
 * Bateria exaustiva de testes de importação segura de backups JSON.
 * Cobre: round-trip, 14 casos de corrupção, conflitos A..E, atomicidade, TOCTOU e prototype pollution.
 */
import { IDBFactory } from "fake-indexeddb";
import {
  ContestRepository,
  freezeStoredContest,
  scoreStoredContest,
  auditEntireHistory,
} from "../index.ts";
import {
  createContestDraft,
  createMulberry32,
  scoreC5,
} from "../../c5/index.ts";
import {
  parseHistoryBackup,
  validateHistoryBackup,
  prepareHistoryImport,
  importHistory,
  areContestRecordsIdentical,
  MAX_JSON_SIZE_BYTES,
} from "../import.ts";
import type { HistoryExportData } from "../types.ts";
import type { ContestRecord, Clock } from "../../c5/types.ts";

export async function runImportTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("=== INICIANDO TESTES DE IMPORTAÇÃO DE BACKUPS JSON (IMPORT.TEST) ===");

  const fixedDate1 = new Date("2026-09-17T10:00:00.000Z");
  const fixedDate2 = new Date("2026-09-17T10:05:00.000Z");
  const fixedDate3 = new Date("2026-09-17T20:30:00.000Z");

  const clock1: Clock = () => fixedDate1;
  const clock2: Clock = () => fixedDate2;
  const clock3: Clock = () => fixedDate3;

  // =========================================================================
  // 1. TESTE ROUND-TRIP (Banco A -> Export -> Import -> Banco B)
  // =========================================================================
  {
    const idbA = new IDBFactory();
    const repoA = new ContestRepository({ idbFactory: idbA });

    // Criar registros em Banco A: 1 DRAFT, 1 FROZEN, 1 SCORED
    const draftA = createContestDraft(3001, { rng: createMulberry32(111), clock: clock1 });
    await repoA.saveDraft(draftA);

    const draftB = createContestDraft(3002, { rng: createMulberry32(222), clock: clock1 });
    await repoA.saveDraft(draftB);
    await repoA.freezeStoredContest(3002, { clock: clock2 });

    const draftC = createContestDraft(3003, { rng: createMulberry32(333), clock: clock1 });
    await repoA.saveDraft(draftC);
    await repoA.freezeStoredContest(3003, { clock: clock2 });
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await repoA.scoreStoredContest(3003, officialResult, { clock: clock3 });

    // Exportar Banco A
    const exportedA = await repoA.exportHistory();
    const jsonString = JSON.stringify(exportedA);

    // Banco B (totalmente limpo)
    const idbB = new IDBFactory();
    const repoB = new ContestRepository({ idbFactory: idbB });

    // Fluxo seguro: Parse -> Validate -> Prepare -> Import
    const parsed = parseHistoryBackup(jsonString);
    const validation = await validateHistoryBackup(parsed);
    assert(validation.valid, "1.1. Validação do backup exportado do Banco A passa com 100% de sucesso", validation.errors.join("; "));

    const plan = await prepareHistoryImport(validation.data, repoB);
    assert(
      plan.valid && plan.totalBackupRecords === 3 && plan.newRecords === 3 && plan.conflicts === 0,
      "1.2. Plano de importação no Banco B planeja 3 novos registros sem nenhum conflito",
      plan.errors.join("; ")
    );

    const importResult = await importHistory(validation.data, repoB);
    assert(
      importResult.success && importResult.importedCount === 3 && importResult.skippedCount === 0,
      "1.3. Importação atômica no Banco B concluída com 3 registros importados"
    );

    // Comparar registros do Banco B com Banco A
    const allA = await repoA.getAllContestRecords();
    const allB = await repoB.getAllContestRecords();
    assert(allA.length === allB.length, "1.4. Banco B contém exatamente a mesma quantidade de registros de Banco A");

    let identicalAll = true;
    for (const recA of allA) {
      const recB = allB.find((r) => r.contestNumber === recA.contestNumber);
      if (!recB || !areContestRecordsIdentical(recA, recB)) {
        identicalAll = false;
        break;
      }
    }
    assert(
      identicalAll,
      "1.5. Round-trip completo: 100% dos registros importados no Banco B são semanticamente e criptograficamente idênticos ao Banco A"
    );

    const auditB = await repoB.auditEntireHistory();
    assert(auditB.valid && auditB.invalidRecords === 0, "1.6. Auditoria pós-importação no Banco B passa com 100% de fidelidade");
  }

  // =========================================================================
  // 2. TESTES DE CORRUPÇÃO OBRIGATÓRIOS (14 CASOS REJEITADOS ANTES DO COMMIT)
  // =========================================================================
  {
    // Gera um backup autêntico base para corromper
    const idbRef = new IDBFactory();
    const repoRef = new ContestRepository({ idbFactory: idbRef });

    const d1 = createContestDraft(3101, { rng: createMulberry32(401), clock: clock1 });
    await repoRef.saveDraft(d1);

    const d2 = createContestDraft(3102, { rng: createMulberry32(402), clock: clock1 });
    await repoRef.saveDraft(d2);
    await repoRef.freezeStoredContest(3102, { clock: clock2 });

    const d3 = createContestDraft(3103, { rng: createMulberry32(403), clock: clock1 });
    await repoRef.saveDraft(d3);
    await repoRef.freezeStoredContest(3103, { clock: clock2 });
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    await repoRef.scoreStoredContest(3103, officialResult, { clock: clock3 });

    const validBackup = await repoRef.exportHistory();

    // 2.1 Adulterar uma dezena em games
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3102);
      target.generation.games[0][0] = 99; // Corrompe dezena
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.1. Corrupção em 'games' é detectada e rejeitada");
    }

    // 2.2 Adulterar permutation
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3102);
      target.generation.permutation[0] = 99;
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.2. Corrupção em 'permutation' é detectada e rejeitada");
    }

    // 2.3 Adulterar slotAssignments
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3102);
      target.generation.slotAssignments["12a"] = 99;
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.3. Corrupção em 'slotAssignments' é detectada e rejeitada");
    }

    // 2.4 Adulterar integrityHash
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3102);
      target.integrityHash = "f".repeat(64); // Hash falso
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.4. Adulteração de 'integrityHash' é detectada com quebra de integridade");
    }

    // 2.5 Adulterar officialResult
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3103);
      target.officialResult[0] = 99;
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.5. Adulteração em 'officialResult' é detectada e rejeitada");
    }

    // 2.6 Adulterar score.maxHits (forjar acertos)
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3103);
      target.score.maxHits = 15; // Forja 15 acertos
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.6. Adulteração forjada em 'score.maxHits' é detectada pela auditoria matemática");
    }

    // 2.7 Adulterar matchedNumbers
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3103);
      target.score.games[0].matchedNumbers = [99];
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.7. Adulteração em 'matchedNumbers' é detectada e rejeitada");
    }

    // 2.8 Adulterar contestNumber
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3101);
      target.contestNumber = -10; // Inválido
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.8. Concurso negativo ou inválido é detectado e rejeitado");
    }

    // 2.9 Adulterar algorithmVersion
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      corrupt.algorithmVersions = ["C5-2.0.0"];
      corrupt.records[0].algorithmVersion = "C5-2.0.0";
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.9. Versão desconhecida de algoritmo é categoricamente rejeitada");
    }

    // 2.10 Status incompatível com campos (DRAFT com frozenAt)
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3101);
      target.frozenAt = fixedDate2.toISOString(); // DRAFT não pode ter frozenAt
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.10. Status DRAFT com campos de estados posteriores é rejeitado");
    }

    // 2.11 Timestamp incoerente (generatedAt > frozenAt)
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      const target = corrupt.records.find((r: any) => r.contestNumber === 3102);
      target.generatedAt = "2026-09-17T11:00:00.000Z";
      target.frozenAt = "2026-09-17T10:00:00.000Z"; // frozenAt anterior a generatedAt
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.11. Coerência temporal violada (generatedAt > frozenAt) é rejeitada");
    }

    // 2.12 generationId duplicado dentro do backup
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      corrupt.records[0].generationId = corrupt.records[1].generationId; // mesmo UUID
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.12. generationId duplicado dentro do backup resulta em rejeição total");
    }

    // 2.13 Concurso duplicado dentro do backup
    {
      const corrupt = JSON.parse(JSON.stringify(validBackup));
      corrupt.records[0].contestNumber = corrupt.records[1].contestNumber; // mesmo concurso
      const val = await validateHistoryBackup(corrupt);
      assert(!val.valid, "2.13. Concurso duplicado no arquivo resulta em rejeição do backup inteiro");
    }

    // 2.14 schemaVersion desconhecido (2, 0, "1", null)
    {
      const corrupt1 = JSON.parse(JSON.stringify(validBackup));
      corrupt1.schemaVersion = 2;
      const v1 = await validateHistoryBackup(corrupt1);

      const corrupt2 = JSON.parse(JSON.stringify(validBackup));
      corrupt2.schemaVersion = "1";
      const v2 = await validateHistoryBackup(corrupt2);

      assert(!v1.valid && !v2.valid, "2.14. schemaVersion diferente de 1 é rejeitado sem tentativa de migração silenciosa");
    }
  }

  // =========================================================================
  // 3. TESTES DE CONFLITO (CENÁRIOS A, B, C, D, E)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Cria concurso 4000 no banco local
    const draft4000 = createContestDraft(4000, { rng: createMulberry32(500), clock: clock1 });
    await repo.saveDraft(draft4000);
    const frozen4000 = await repo.freezeStoredContest(4000, { clock: clock2 });

    // CENÁRIO A: Backup com concurso 4000 idêntico ao local -> SKIP_IDENTICAL
    {
      const backupA: HistoryExportData = {
        schemaVersion: 1,
        exportedAt: fixedDate3.toISOString(),
        recordCount: 1,
        algorithmVersions: ["C5-1.0.0"],
        records: [frozen4000],
      };
      const planA = await prepareHistoryImport(backupA, repo);
      assert(
        planA.valid && planA.newRecords === 0 && planA.identicalRecords === 1 && planA.conflicts === 0,
        "3.A. Registro idêntico ao banco local é classificado como SKIP_IDENTICAL sem conflito"
      );
    }

    // CENÁRIO B: Mesmo concurso 4000, geração diferente -> CONFLICT
    {
      const draftDiff = createContestDraft(4000, { rng: createMulberry32(999), clock: clock1 });
      const backupB: HistoryExportData = {
        schemaVersion: 1,
        exportedAt: fixedDate3.toISOString(),
        recordCount: 1,
        algorithmVersions: ["C5-1.0.0"],
        records: [draftDiff],
      };
      const planB = await prepareHistoryImport(backupB, repo);
      assert(
        planB.valid && planB.conflicts === 1 && planB.records[0].action === "CONFLICT",
        "3.B. Mesmo concurso com dados divergentes é classificado como CONFLICT e preservado"
      );
    }

    // CENÁRIO C: Mesmo concurso 4000, local é FROZEN e backup é SCORED -> CONFLICT
    {
      const res = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      const validScore = scoreC5(frozen4000.generation, res);
      const scored4000Candidate: ContestRecord = {
        ...frozen4000,
        status: "SCORED",
        officialResult: res,
        scoredAt: fixedDate3.toISOString(),
        score: validScore,
      };

      const backupC: HistoryExportData = {
        schemaVersion: 1,
        exportedAt: fixedDate3.toISOString(),
        recordCount: 1,
        algorithmVersions: ["C5-1.0.0"],
        records: [scored4000Candidate],
      };

      const planC = await prepareHistoryImport(backupC, repo);
      assert(
        planC.valid && planC.conflicts === 1 && planC.records[0].action === "CONFLICT",
        "3.C. Local FROZEN e Backup SCORED resulta em CONFLICT sem presunção automática"
      );
    }

    // CENÁRIO D: generationId existente localmente associado a OUTRO concurso -> CONFLICT
    {
      const backupD: HistoryExportData = {
        schemaVersion: 1,
        exportedAt: fixedDate3.toISOString(),
        recordCount: 1,
        algorithmVersions: ["C5-1.0.0"],
        records: [
          {
            ...createContestDraft(4005, { rng: createMulberry32(600), clock: clock1 }),
            generationId: frozen4000.generationId, // Reutiliza generationId do concurso 4000!
          },
        ],
      };
      const planD = await prepareHistoryImport(backupD, repo);
      assert(
        planD.valid && planD.conflicts === 1 && Boolean(planD.records[0].reason?.includes("já está associado localmente")),
        "3.D. generationId colidindo com outro concurso local resulta em CONFLICT"
      );
    }

    // CENÁRIO E: Backup contém novos + conflito -> v1.2 importa os novos e preserva conflitos
    {
      const newDraft = createContestDraft(4010, { rng: createMulberry32(700), clock: clock1 });
      const conflictDraft = createContestDraft(4000, { rng: createMulberry32(800), clock: clock1 });

      const backupE: HistoryExportData = {
        schemaVersion: 1,
        exportedAt: fixedDate3.toISOString(),
        recordCount: 2,
        algorithmVersions: ["C5-1.0.0"],
        records: [newDraft, conflictDraft],
      };

      const planE = await prepareHistoryImport(backupE, repo);
      assert(
        planE.valid && planE.newRecords === 1 && planE.conflicts === 1,
        "3.E.1. Plano identifica 1 novo e 1 conflito e sinaliza valid = true"
      );

      const importRes = await importHistory(backupE, repo);
      assert(
        importRes.success && importRes.importedCount === 1 && importRes.conflictsCount === 1,
        "3.E.2. importHistory importa somente os novos (1) e preserva conflitos (1)"
      );

      const rec4010 = await repo.getContestRecord(4010);
      assert(rec4010 !== null && rec4010.contestNumber === 4010, "3.E.3. Novo registro (4010) gravado com sucesso");

      const rec4000After = await repo.getContestRecord(4000);
      assert(
        rec4000After?.generationId === frozen4000.generationId,
        "3.E.4. Registro existente 4000 não foi sobrescrito nem adulterado"
      );
    }
  }

  // =========================================================================
  // 4. TESTE DE ATOMICIDADE (Rollback total de lote com falha)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Já existe o concurso 5002 no banco
    const existing5002 = createContestDraft(5002, { rng: createMulberry32(801), clock: clock1 });
    await repo.saveDraft(existing5002);

    // Lote preparado com 5001 (novo) e 5002 (já existente no IndexedDB para disparar ConstraintError na transação)
    const new5001 = createContestDraft(5001, { rng: createMulberry32(802), clock: clock1 });
    const coll5002 = createContestDraft(5002, { rng: createMulberry32(803), clock: clock1 });

    let batchFailed = false;
    try {
      await repo.batchInsertRecords([new5001, coll5002]);
    } catch (e: any) {
      batchFailed = true;
    }
    assert(batchFailed, "4.1. batchInsertRecords rejeita lote contendo chave primária colidente");

    // Verificar se 5001 foi gravado ou se houve rollback total
    const check5001 = await repo.getContestRecord(5001);
    assert(check5001 === null, "4.2. Atomicidade comprovada: 0 registros parciais (5001) foram persistidos");
  }

  // =========================================================================
  // 5. TESTE DE CONCORRÊNCIA E TOCTOU
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft6001 = createContestDraft(6001, { rng: createMulberry32(901), clock: clock1 });
    const backup: HistoryExportData = {
      schemaVersion: 1,
      exportedAt: fixedDate3.toISOString(),
      recordCount: 1,
      algorithmVersions: ["C5-1.0.0"],
      records: [draft6001],
    };

    // 1. Gera o plano sem conflito
    const plan = await prepareHistoryImport(backup, repo);
    assert(plan.valid && plan.newRecords === 1, "5.1. Plano inicial gerado sem conflitos");

    // 2. Intervenção concorrente antes do commit: insere localmente o concurso 6001
    const competitor = createContestDraft(6001, { rng: createMulberry32(902), clock: clock1 });
    await repo.saveDraft(competitor);

    // 3. Executar o commit da importação usando o plano pré-calculado: a revalidação TOCTOU deve detectar a colisão
    let toctouCaught = false;
    try {
      await importHistory(plan, repo);
    } catch (err: any) {
      toctouCaught = err.message.includes("O histórico local mudou desde a pré-visualização");
    }
    assert(toctouCaught, "5.2. Revalidação TOCTOU interceptou a modificação concorrente e abortou a importação");

    // Confirma que os dados do concorrente local foram preservados e não sobrescritos
    const current6001 = await repo.getContestRecord(6001);
    assert(
      current6001?.generationId === competitor.generationId,
      "5.3. Registro concorrente local preservado intacto sem sobrescrita"
    );
  }

  // =========================================================================
  // 6. TESTE DE PROTOTYPE POLLUTION E LIMITES DEFENSIVOS
  // =========================================================================
  {
    // A. Prototype pollution em JSON
    const maliciousJson = `
    {
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "polluted2": true } },
      "schemaVersion": 1,
      "exportedAt": "2026-09-17T12:00:00.000Z",
      "algorithmVersions": ["C5-1.0.0"],
      "records": []
    }
    `;

    const parsed = parseHistoryBackup(maliciousJson);
    const isProtoPolluted = (Object.prototype as any).polluted !== undefined || (Object.prototype as any).polluted2 !== undefined;
    assert(!isProtoPolluted, "6.1. Proteção contra Prototype Pollution: Object.prototype não foi contaminado");

    const val = await validateHistoryBackup(parsed);
    assert(val.valid, "6.2. Backup sanitizado é processado sem propagar propriedades poluídas");

    // B. Limite de tamanho
    let sizeError = false;
    try {
      const hugeJson = " ".repeat(MAX_JSON_SIZE_BYTES + 10);
      parseHistoryBackup(hugeJson);
    } catch (e: any) {
      sizeError = e.message.includes("excede o limite máximo permitido");
    }
    assert(sizeError, "6.3. Arquivo que excede 10 MB é bloqueado imediatamente");

    // C. Arquivo vazio
    let emptyError = false;
    try {
      parseHistoryBackup("   ");
    } catch (e: any) {
      emptyError = e.message.includes("vazio");
    }
    assert(emptyError, "6.4. Arquivo vazio é explicitamente rejeitado");

    // D. Array no nível raiz
    let rootArrayError = false;
    try {
      parseHistoryBackup("[1, 2, 3]");
    } catch (e: any) {
      rootArrayError = e.message.includes("array no nível raiz");
    }
    assert(rootArrayError, "6.5. Array no nível raiz é explicitamente rejeitado");
  }

  console.log(
    `=== FIM DOS TESTES DE IMPORTAÇÃO: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("import.test.ts")) {
  runImportTests().then(({ failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
  });
}
