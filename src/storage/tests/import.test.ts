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
  isValidGenerationId,
  hasDangerousKeys,
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
      importResult.success && importResult.importedCount === 3 && importResult.skippedIdenticalCount === 0,
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
        importRes.success && importRes.importedCount === 1 && importRes.conflictCount === 1,
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
    // 6.1 Detecção de {"__proto__": {"polluted": true}} -> REJECT
    let protoRejected = false;
    try {
      parseHistoryBackup('{"__proto__": {"polluted": true}}');
    } catch (e: any) {
      protoRejected = e.message.includes("chave potencialmente perigosa detectada");
    }
    assert(protoRejected, "6.1. Detecção e rejeição imediata de __proto__ via reviver");

    // 6.2 Detecção de {"constructor": {"prototype": {"polluted2": true}}} -> REJECT
    let ctorRejected = false;
    try {
      parseHistoryBackup('{"constructor": {"prototype": {"polluted2": true}}}');
    } catch (e: any) {
      ctorRejected = e.message.includes("chave potencialmente perigosa detectada");
    }
    assert(ctorRejected, "6.2. Detecção e rejeição imediata de constructor/prototype via reviver");

    // 6.3 Ocorrência aninhada dentro de records[]
    let recordsProtoRejected = false;
    try {
      parseHistoryBackup('{"schemaVersion": 1, "exportedAt": "2026-09-17T12:00:00.000Z", "algorithmVersions": ["C5-1.0.0"], "records": [{"__proto__": {"polluted": true}}]}');
    } catch (e: any) {
      recordsProtoRejected = e.message.includes("chave potencialmente perigosa detectada");
    }
    assert(recordsProtoRejected, "6.3. Detecção e rejeição de __proto__ aninhado em records[]");

    // 6.4 Ocorrência aninhada dentro de generation
    let genProtoRejected = false;
    try {
      parseHistoryBackup('{"schemaVersion": 1, "exportedAt": "2026-09-17T12:00:00.000Z", "algorithmVersions": ["C5-1.0.0"], "records": [{"contestNumber": 1, "generation": {"__proto__": {"polluted": true}}}]}');
    } catch (e: any) {
      genProtoRejected = e.message.includes("chave potencialmente perigosa detectada");
    }
    assert(genProtoRejected, "6.4. Detecção e rejeição de __proto__ aninhado em generation");

    // 6.5 Ocorrência aninhada dentro de slotAssignments
    let slotProtoRejected = false;
    try {
      parseHistoryBackup('{"schemaVersion": 1, "exportedAt": "2026-09-17T12:00:00.000Z", "algorithmVersions": ["C5-1.0.0"], "records": [{"contestNumber": 1, "generation": {"slotAssignments": {"__proto__": {"polluted": true}}}}]}');
    } catch (e: any) {
      slotProtoRejected = e.message.includes("chave potencialmente perigosa detectada");
    }
    assert(slotProtoRejected, "6.5. Detecção e rejeição de __proto__ aninhado em slotAssignments");

    // 6.6 Ocorrência aninhada dentro de score
    let scoreProtoRejected = false;
    try {
      parseHistoryBackup('{"schemaVersion": 1, "exportedAt": "2026-09-17T12:00:00.000Z", "algorithmVersions": ["C5-1.0.0"], "records": [{"contestNumber": 1, "score": {"__proto__": {"polluted": true}}}]}');
    } catch (e: any) {
      scoreProtoRejected = e.message.includes("chave potencialmente perigosa detectada");
    }
    assert(scoreProtoRejected, "6.6. Detecção e rejeição de __proto__ aninhado em score");

    // 6.7 Confirmação de que Object.prototype permanece intocado e limpo
    const isProtoPolluted =
      (Object.prototype as any).polluted !== undefined ||
      (Object.prototype as any).polluted2 !== undefined;
    assert(!isProtoPolluted, "6.7. Object.prototype permanece completamente limpo sem nenhuma mutação");

    // 6.8 Confirmação de que IndexedDB não sofreu mutação
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const countBefore = (await repo.getAllContestRecords()).length;
    let importMaliciousFailed = false;
    try {
      await importHistory('{"__proto__": {"polluted": true}}', repo);
    } catch {
      importMaliciousFailed = true;
    }
    const countAfter = (await repo.getAllContestRecords()).length;
    assert(
      importMaliciousFailed && countBefore === 0 && countAfter === 0,
      "6.8. IndexedDB permanece sem mutação após tentativa de injeção maliciosa"
    );

    // 6.9 Limite de tamanho
    let sizeError = false;
    try {
      const hugeJson = " ".repeat(MAX_JSON_SIZE_BYTES + 10);
      parseHistoryBackup(hugeJson);
    } catch (e: any) {
      sizeError = e.message.includes("excede o limite máximo permitido");
    }
    assert(sizeError, "6.9. Arquivo que excede 10 MB é bloqueado imediatamente");

    // 6.10 Arquivo vazio
    let emptyError = false;
    try {
      parseHistoryBackup("   ");
    } catch (e: any) {
      emptyError = e.message.includes("vazio");
    }
    assert(emptyError, "6.10. Arquivo vazio é explicitamente rejeitado");

    // 6.11 Array no nível raiz
    let rootArrayError = false;
    try {
      parseHistoryBackup("[1, 2, 3]");
    } catch (e: any) {
      rootArrayError = e.message.includes("array no nível raiz");
    }
    assert(rootArrayError, "6.11. Array no nível raiz é explicitamente rejeitado");
  }

  // =========================================================================
  // 7. TESTES DE VALIDAÇÃO DE UUID v4 RFC 4122 ESTRITO
  // =========================================================================
  {
    assert(isValidGenerationId("f47ac10b-58cc-4372-a567-0e02b2c3d479"), "7.1. UUID v4 RFC 4122 válido é aceito (PASS)");
    assert(isValidGenerationId("c45b8823-3913-4a11-8e89-61ab93d18301"), "7.2. Outro UUID v4 RFC 4122 válido é aceito (PASS)");
    assert(!isValidGenerationId("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "7.3. UUID v1 é estritamente rejeitado (FAIL)");
    assert(!isValidGenerationId("f47ac10b-58cc-1372-a567-0e02b2c3d479"), "7.4. UUID sem versão correta (v1) é rejeitado (FAIL)");
    assert(!isValidGenerationId("f47ac10b-58cc-5372-a567-0e02b2c3d479"), "7.5. UUID v5 é rejeitado (FAIL)");
    assert(!isValidGenerationId("f47ac10b-58cc-4372-3567-0e02b2c3d479"), "7.6. UUID v4 com variante RFC inválida (não 8,9,a,b) é rejeitado (FAIL)");
    assert(!isValidGenerationId("gen-test-uuid-1"), "7.7. ID artificial 'gen-test-uuid-1' é estritamente rejeitado (FAIL)");
    assert(!isValidGenerationId("auth-uuid-777"), "7.8. ID artificial 'auth-uuid-777' é estritamente rejeitado (FAIL)");
    assert(!isValidGenerationId("uuid-3300"), "7.9. ID artificial 'uuid-3300' é estritamente rejeitado (FAIL)");
    assert(!isValidGenerationId(""), "7.10. String vazia é rejeitada (FAIL)");
    assert(!isValidGenerationId("not-a-uuid"), "7.11. String malformada não-UUID é rejeitada (FAIL)");
    assert(!isValidGenerationId("f47ac10b58cc4372a5670e02b2c3d479"), "7.12. UUID sem hífens é rejeitado (FAIL)");
  }

  // =========================================================================
  // 8. TESTES DE IDENTIDADE SEMÂNTICA EXAUSTIVA (A/B)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draftA = createContestDraft(8001, { rng: createMulberry32(1234), clock: clock1 });
    await repo.saveDraft(draftA);
    await repo.freezeStoredContest(8001, { clock: clock2 });
    const offRes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scoredA = await repo.scoreStoredContest(8001, offRes, { clock: clock3 });

    // Clonar para B
    const cloneB = (): ContestRecord => JSON.parse(JSON.stringify(scoredA));

    // Inicialmente idênticos
    assert(areContestRecordsIdentical(scoredA, cloneB()), "8.0. Registros A e B idênticos produzem areContestRecordsIdentical = true");

    // Adulterações pontuais independentes (uma por teste)
    const testCases: { name: string; mutate: (b: ContestRecord) => void }[] = [
      {
        name: "score.result",
        mutate: (b) => { b.score!.result[0] = b.score!.result[0] === 1 ? 2 : 1; },
      },
      {
        name: "score.bestGameIndexes",
        mutate: (b) => { b.score!.bestGameIndexes = [4]; },
      },
      {
        name: "score.games[0].gameIndex",
        mutate: (b) => { (b.score!.games[0] as any).gameIndex = 99; },
      },
      {
        name: "score.games[0].hits",
        mutate: (b) => { (b.score!.games[0] as any).hits = (b.score!.games[0].hits + 1) as any; },
      },
      {
        name: "score.games[0].matchedNumbers",
        mutate: (b) => { b.score!.games[0].matchedNumbers.pop(); },
      },
      {
        name: "score.games[0].missedNumbers",
        mutate: (b) => { b.score!.games[0].missedNumbers.pop(); },
      },
      {
        name: "score.prizeCounts.hits11",
        mutate: (b) => { b.score!.prizeCounts.hits11 = b.score!.prizeCounts.hits11 + 10; },
      },
      {
        name: "score.maxHits",
        mutate: (b) => { (b.score as any).maxHits = (b.score!.maxHits === 15 ? 14 : 15); },
      },
      {
        name: "score.has11Plus",
        mutate: (b) => { b.score!.has11Plus = !b.score!.has11Plus; },
      },
      {
        name: "officialResult",
        mutate: (b) => { b.officialResult![0] = b.officialResult![0] === 1 ? 2 : 1; },
      },
      {
        name: "generation.permutation",
        mutate: (b) => {
          const tmp = b.generation.permutation[0];
          b.generation.permutation[0] = b.generation.permutation[1];
          b.generation.permutation[1] = tmp;
        },
      },
      {
        name: "generation.slotAssignments",
        mutate: (b) => {
          const orig = b.generation.slotAssignments["12a"];
          b.generation.slotAssignments["12a"] = b.generation.slotAssignments["12b"];
          b.generation.slotAssignments["12b"] = orig;
        },
      },
      {
        name: "generation.games",
        mutate: (b) => {
          const tmp = b.generation.games[0][0];
          b.generation.games[0][0] = b.generation.games[0][1];
          b.generation.games[0][1] = tmp;
        },
      },
      {
        name: "integrityHash",
        mutate: (b) => { b.integrityHash = "f".repeat(64); },
      },
      {
        name: "generationId",
        mutate: (b) => { b.generationId = "e0000000-0000-4000-8000-000000000001"; },
      },
      {
        name: "timestamps (generatedAt)",
        mutate: (b) => { b.generatedAt = "2026-09-01T00:00:00.000Z"; },
      },
      {
        name: "timestamps (frozenAt)",
        mutate: (b) => { b.frozenAt = "2026-09-01T00:00:00.000Z"; },
      },
      {
        name: "timestamps (scoredAt)",
        mutate: (b) => { b.scoredAt = "2026-09-01T00:00:00.000Z"; },
      },
    ];

    let testIdx = 1;
    for (const tc of testCases) {
      const adulteratedB = cloneB();
      tc.mutate(adulteratedB);

      const identical = areContestRecordsIdentical(scoredA, adulteratedB);
      assert(!identical, `8.${testIdx}. Adulteração em '${tc.name}' produz areContestRecordsIdentical = false`);

      // Verifica que no prepareHistoryImport nunca resulta em SKIP_IDENTICAL
      const backupTest: HistoryExportData = {
        schemaVersion: 1,
        exportedAt: fixedDate3.toISOString(),
        recordCount: 1,
        algorithmVersions: ["C5-1.0.0"],
        records: [adulteratedB],
      };
      const plan = await prepareHistoryImport(backupTest, repo);
      assert(
        plan.identicalRecords === 0,
        `8.${testIdx}.b. Adulteração em '${tc.name}' NUNCA é classificada como SKIP_IDENTICAL`
      );

      testIdx++;
    }
  }

  // =========================================================================
  // 9. TESTE DE BACKUP MISTO (1 SKIP_IDENTICAL, 1 CONFLICT, 2 IMPORT)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Banco local:
    // Concurso 9001: FROZEN (será SKIP_IDENTICAL no backup)
    const draft9001 = createContestDraft(9001, { rng: createMulberry32(10), clock: clock1 });
    await repo.saveDraft(draft9001);
    const frozen9001 = await repo.freezeStoredContest(9001, { clock: clock2 });

    // Concurso 9002: DRAFT original no local (será CONFLICT no backup)
    const draft9002Local = createContestDraft(9002, { rng: createMulberry32(20), clock: clock1 });
    await repo.saveDraft(draft9002Local);

    // Snapshot antes da importação
    const localBefore9001 = await repo.getContestRecord(9001);
    const localBefore9002 = await repo.getContestRecord(9002);

    // Backup contém:
    // 1. Concurso 9001 (exatamente idêntico a frozen9001) -> SKIP_IDENTICAL
    // 2. Concurso 9002 (com geração diferente do local) -> CONFLICT
    // 3. Concurso 9003 (novo) -> IMPORT
    // 4. Concurso 9004 (novo) -> IMPORT
    const draft9002Backup = createContestDraft(9002, { rng: createMulberry32(999), clock: clock1 });
    const draft9003 = createContestDraft(9003, { rng: createMulberry32(30), clock: clock1 });
    const draft9004 = createContestDraft(9004, { rng: createMulberry32(40), clock: clock1 });

    const mixedBackup: HistoryExportData = {
      schemaVersion: 1,
      exportedAt: fixedDate3.toISOString(),
      recordCount: 4,
      algorithmVersions: ["C5-1.0.0"],
      records: [frozen9001, draft9002Backup, draft9003, draft9004],
    };

    // 1. Prévia do plano
    const plan = await prepareHistoryImport(mixedBackup, repo);
    assert(
      plan.valid &&
        plan.totalBackupRecords === 4 &&
        plan.newRecords === 2 &&
        plan.identicalRecords === 1 &&
        plan.conflicts === 1,
      "9.1. Plano de backup misto: valid=true, newRecords=2, identicalRecords=1, conflicts=1"
    );

    // 2. Execução da importação
    const importRes = await importHistory(mixedBackup, repo);
    assert(
      importRes.success === true &&
        importRes.importedCount === 2 &&
        importRes.skippedIdenticalCount === 1 &&
        importRes.conflictCount === 1,
      "9.2. Execução: success=true, importedCount=2, skippedIdenticalCount=1, conflictCount=1"
    );

    // 3. Verificação do banco local
    const localAfter9001 = await repo.getContestRecord(9001);
    const localAfter9002 = await repo.getContestRecord(9002);
    const localAfter9003 = await repo.getContestRecord(9003);
    const localAfter9004 = await repo.getContestRecord(9004);

    assert(
      localAfter9001 !== null && areContestRecordsIdentical(localBefore9001!, localAfter9001),
      "9.3. Registro idêntico local (9001) permaneceu 100% inalterado"
    );
    assert(
      localAfter9002 !== null && areContestRecordsIdentical(localBefore9002!, localAfter9002),
      "9.4. Registro conflitante local (9002) permaneceu 100% inalterado (não foi sobrescrito)"
    );
    assert(
      localAfter9003 !== null && localAfter9003.contestNumber === 9003,
      "9.5. Novo concurso 9003 foi importado com sucesso"
    );
    assert(
      localAfter9004 !== null && localAfter9004.contestNumber === 9004,
      "9.6. Novo concurso 9004 foi importado com sucesso"
    );
  }

  // =========================================================================
  // 10. TESTES DE RECÁLCULO E ADULTERAÇÃO DE SCORE EM BACKUP SCORED
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(9500, { rng: createMulberry32(555), clock: clock1 });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(9500, { clock: clock2 });
    const offResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const authenticScored = await repo.scoreStoredContest(9500, offResult, { clock: clock3 });

    const buildBackup = (rec: ContestRecord): HistoryExportData => ({
      schemaVersion: 1,
      exportedAt: fixedDate3.toISOString(),
      recordCount: 1,
      algorithmVersions: ["C5-1.0.0"],
      records: [rec],
    });

    // 10.0 Baseline autêntico é válido
    const baseVal = await validateHistoryBackup(buildBackup(authenticScored));
    assert(baseVal.valid, "10.0. Backup SCORED autêntico é 100% válido");

    // 10.1 score.result adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      tampered.score!.result[0] = tampered.score!.result[0] === 1 ? 2 : 1;
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.1. Adulteração em 'score.result' resulta em BACKUP INVALID");
    }

    // 10.2 gameIndex adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      (tampered.score!.games[0] as any).gameIndex = 99;
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.2. Adulteração em 'score.games[0].gameIndex' resulta em BACKUP INVALID");
    }

    // 10.3 hits adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      (tampered.score!.games[0] as any).hits = ((tampered.score!.games[0].hits + 1) % 15) as any;
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.3. Adulteração em 'score.games[0].hits' resulta em BACKUP INVALID");
    }

    // 10.4 matchedNumbers adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      tampered.score!.games[0].matchedNumbers.pop();
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.4. Adulteração em 'score.games[0].matchedNumbers' resulta em BACKUP INVALID");
    }

    // 10.5 missedNumbers adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      tampered.score!.games[0].missedNumbers.pop();
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.5. Adulteração em 'score.games[0].missedNumbers' resulta em BACKUP INVALID");
    }

    // 10.6 bestGameIndexes adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      tampered.score!.bestGameIndexes = [4];
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.6. Adulteração em 'score.bestGameIndexes' resulta em BACKUP INVALID");
    }

    // 10.7 prizeCounts adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      tampered.score!.prizeCounts.hits11 = tampered.score!.prizeCounts.hits11 + 5;
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.7. Adulteração em 'score.prizeCounts' resulta em BACKUP INVALID");
    }

    // 10.8 flags adulteradas (has11Plus, has12Plus, has13Plus, has14Plus, has15)
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      tampered.score!.has11Plus = !tampered.score!.has11Plus;
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.8. Adulteração em flags de pontuação resulta em BACKUP INVALID");
    }

    // 10.9 maxHits adulterado
    {
      const tampered: ContestRecord = JSON.parse(JSON.stringify(authenticScored));
      (tampered.score as any).maxHits = (tampered.score!.maxHits === 15 ? 14 : 15);
      const v = await validateHistoryBackup(buildBackup(tampered));
      assert(!v.valid, "10.9. Adulteração em 'score.maxHits' resulta em BACKUP INVALID");
    }
  }

  // =========================================================================
  // 11. TESTES DE ENFORCEMENT DE recordCount
  // =========================================================================
  {
    const draft = createContestDraft(9600, { rng: createMulberry32(666), clock: clock1 });

    // 11.1 Backup novo com recordCount presente e idêntico a records.length -> PASS
    const newBackup = {
      schemaVersion: 1,
      exportedAt: fixedDate3.toISOString(),
      recordCount: 1,
      algorithmVersions: ["C5-1.0.0"],
      records: [draft],
    };
    const vNew = await validateHistoryBackup(newBackup);
    assert(vNew.valid && vNew.data?.recordCount === 1, "11.1. Backup novo com recordCount === records.length é aceito (PASS)");

    // 11.2 Backup legado schemaVersion 1 sem recordCount -> PASS com normalização interna
    const legacyBackup = {
      schemaVersion: 1,
      exportedAt: fixedDate3.toISOString(),
      algorithmVersions: ["C5-1.0.0"],
      records: [draft],
    };
    const vLegacy = await validateHistoryBackup(legacyBackup);
    assert(
      vLegacy.valid && vLegacy.data?.recordCount === 1,
      "11.2. Backup legado sem recordCount é aceito (PASS) e normalizado para records.length"
    );

    // 11.3 Backup adulterado com recordCount !== records.length -> REJECT
    const adulteratedBackup = {
      schemaVersion: 1,
      exportedAt: fixedDate3.toISOString(),
      recordCount: 999, // adulterado
      algorithmVersions: ["C5-1.0.0"],
      records: [draft],
    };
    const vAdulterated = await validateHistoryBackup(adulteratedBackup);
    assert(!vAdulterated.valid, "11.3. Backup adulterado com recordCount !== records.length é rejeitado (REJECT)");
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
