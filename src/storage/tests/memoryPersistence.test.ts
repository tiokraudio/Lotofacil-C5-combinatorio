/**
 * Suíte de Testes Unitários de Persistência, Frozen Memory Payload,
 * Backup, Restore e Replay para C5-Memory-2.0.0 (IC8)
 */

import { IDBFactory } from "fake-indexeddb";
import { openDatabase, closeDatabase, CONTEST_STORE_NAME, promisifyRequest } from "../db.ts";
import { ContestRepository, deepCloneRecord, deepCloneMemoryPayload } from "../contestRepository.ts";
import { confirmMemoryBetAtomic, getMemoryHistoryState } from "../memoryTransaction.ts";
import { createDraft, C5_MEMORY_ALGORITHM_VERSION } from "../../c5-memory/draft.ts";
import { generatePool } from "../../c5-memory/pool.ts";
import { buildHistoryFromRecords, computeHistoryFingerprint } from "../../c5-memory/history.ts";
import { buildC5FromPermutation } from "../../c5/canonicalBuilder.ts";
import {
  validateHistoryBackup,
  prepareHistoryImport,
  importHistory,
  validateMemoryPayload,
} from "../import.ts";
import { areContestRecordsIdentical } from "../recordComparison.ts";
import type { ContestRecord, FrozenMemoryPayload } from "../../c5/types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runTests() {
  console.log("=== INICIANDO TESTES DE PERSISTÊNCIA E BACKUP/RESTORE C5-MEMORY (IC8) ===");

  const fixedClock = () => new Date("2026-09-30T15:00:00.000Z");

  // --------------------------------------------------------------------------
  // TESTE 1: deepCloneRecord & deepCloneMemoryPayload
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 1: deepCloneRecord e Imutabilidade / Aliasing");
  {
    const payload: FrozenMemoryPayload = {
      algorithmVersion: C5_MEMORY_ALGORITHM_VERSION,
      poolMasterSeed: "SEED-TEST-01",
      poolIndex: 42,
      selectedC5: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ],
      historyRevision: 3,
      historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
      winnerHistogram: [0, 0, 1, 5, 10, 20, 30, 20, 10, 4, 0],
      confirmedRevision: 4,
      confirmedAt: "2026-09-30T15:00:00.000Z",
    };

    const record: ContestRecord = {
      status: "FROZEN",
      contestNumber: 3001,
      generationId: "c5m-3001-SEED-TEST-01-42",
      algorithmVersion: C5_MEMORY_ALGORITHM_VERSION,
      generatedAt: "2026-09-30T14:55:00.000Z",
      frozenAt: "2026-09-30T15:00:00.000Z",
      betPlacedAt: "2026-09-30T15:00:00.000Z",
      integrityHash: "a".repeat(64),
      generation: {
        permutation: [],
        slotAssignments: {},
        games: payload.selectedC5 as any,
      },
      memoryPayload: payload,
    };

    const clone = deepCloneRecord(record);
    assert(clone.memoryPayload !== undefined, "memoryPayload deve ser preservado pelo deepCloneRecord");
    assert(clone.memoryPayload !== payload, "memoryPayload deve ser uma nova referência");
    assert(clone.memoryPayload?.selectedC5 !== payload.selectedC5, "selectedC5 deve ser nova referência");
    assert((clone.memoryPayload?.selectedC5[0] as number[]) !== payload.selectedC5[0], "jogos internos devem ser novas referências");

    // Teste de aliasing: mutar o clone não afeta o original
    (clone.memoryPayload!.selectedC5[0] as number[])[0] = 99;
    assert((payload.selectedC5[0] as number[])[0] === 1, "Mutação no clone não pode contaminar o payload original");

    // Registro legado sem payload
    const legacyRecord: ContestRecord = {
      status: "FROZEN",
      contestNumber: 2900,
      generationId: "a2900000-0000-4000-8000-000000002900",
      algorithmVersion: "C5-1.0.0",
      generatedAt: "2026-09-01T10:00:00.000Z",
      frozenAt: "2026-09-01T10:05:00.000Z",
      betPlacedAt: "2026-09-01T10:05:00.000Z",
      integrityHash: "b".repeat(64),
      generation: {
        permutation: Array.from({ length: 25 }, (_, i) => i + 1),
        slotAssignments: {},
        games: payload.selectedC5 as any,
      },
    };

    const legacyClone = deepCloneRecord(legacyRecord);
    assert(legacyClone.memoryPayload === undefined, "Registro legado deve permanecer com memoryPayload === undefined");

    console.log("  ✓ deepCloneRecord preserva memoryPayload e isola mutações (zero aliasing)");
    console.log("  ✓ Registro legado mantém memoryPayload === undefined");
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Draft -> Confirmação Atômica -> Payload Identity
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 2: Identidade Campo a Campo (Draft -> FrozenMemoryPayload)");
  {
    const idb = new IDBFactory();
    const draft = createDraft({
      H: [],
      historyRevision: 0,
      historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
      poolMasterSeed: 12345,
    });

    const result = await confirmMemoryBetAtomic({
      contestNumber: 3100,
      draft,
      clock: fixedClock,
      options: { idbFactory: idb },
    });

    const p = result.record.memoryPayload;
    assert(p !== undefined, "Registro persistido deve conter memoryPayload");
    assert(p!.algorithmVersion === draft.algorithmVersion, "algorithmVersion deve conferir");
    assert(p!.poolMasterSeed === draft.poolMasterSeed, "poolMasterSeed deve conferir");
    assert(p!.poolIndex === draft.poolIndex, "poolIndex deve conferir");
    assert(p!.historyRevision === draft.expectedHistoryRevision, "historyRevision deve preservar revisão pré-commit");
    assert(p!.historyFingerprint === draft.expectedHistoryFingerprint, "historyFingerprint deve preservar fingerprint pré-commit");

    for (let g = 0; g < 5; g++) {
      for (let d = 0; d < 15; d++) {
        assert(p!.selectedC5[g][d] === draft.selectedC5[g][d], `selectedC5[${g}][${d}] deve conferir`);
      }
    }

    for (let i = 0; i < 11; i++) {
      assert(p!.winnerHistogram[i] === draft.winnerHistogram[i], `winnerHistogram[${i}] deve conferir`);
    }

    console.log("  ✓ Identidade 100% comprovada entre Draft e FrozenMemoryPayload persistido");
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Storage Round-Trip e Reopen
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 3: Storage Round-Trip e Reopen de Conexão");
  {
    const idb = new IDBFactory();
    const dbName = "test-c5-memory-roundtrip";
    const draft = createDraft({
      H: [],
      historyRevision: 0,
      historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
      poolMasterSeed: "ROUNDTRIP-SEED",
    });

    await confirmMemoryBetAtomic({
      contestNumber: 3200,
      draft,
      clock: fixedClock,
      options: { idbFactory: idb, dbName },
    });

    // Reopen: abrir uma nova conexão independente e ler
    const repo = new ContestRepository({ idbFactory: idb, dbName, clock: fixedClock });
    const stored = await repo.getContestRecord(3200);

    assert(stored !== null, "Registro deve ser recuperado após reabertura");
    assert(stored!.memoryPayload !== undefined, "memoryPayload deve existir após reopen");
    assert(stored!.memoryPayload!.poolMasterSeed === "ROUNDTRIP-SEED", "poolMasterSeed intacto após reopen");
    assert(stored!.memoryPayload!.poolIndex === draft.poolIndex, "poolIndex intacto após reopen");
    assert(stored!.memoryPayload!.historyRevision === 0, "historyRevision intacto após reopen");
    assert(stored!.memoryPayload!.historyFingerprint === draft.expectedHistoryFingerprint, "historyFingerprint intacto após reopen");

    console.log("  ✓ Storage round-trip e reopen preservam memoryPayload integralmente");
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Replay a partir dos metadados persistidos e Controle Negativo
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 4: Replay Determinístico a partir do Payload e Controle Negativo");
  {
    const seed = 987654321;
    const pool = generatePool(seed);
    const poolIndex = 17;
    const candidate = pool[poolIndex];

    // Simula metadados persistidos
    const persistedPayload: FrozenMemoryPayload = {
      algorithmVersion: C5_MEMORY_ALGORITHM_VERSION,
      poolMasterSeed: seed,
      poolIndex,
      selectedC5: candidate.games,
      historyRevision: 0,
      historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
      winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    // Replay usando exclusivamente poolMasterSeed e poolIndex persistidos
    const replayedPool = generatePool(persistedPayload.poolMasterSeed);
    const replayedCandidate = replayedPool[persistedPayload.poolIndex];

    assert(replayedCandidate.poolIndex === persistedPayload.poolIndex, "Replay poolIndex confere");
    for (let g = 0; g < 5; g++) {
      for (let d = 0; d < 15; d++) {
        assert(
          replayedCandidate.games[g][d] === persistedPayload.selectedC5[g][d],
          "Replay dezenas dos jogos conferem 100%"
        );
      }
    }

    // Controle negativo: sabotagem de seed
    const sabotagedSeedPool = generatePool(seed + 1);
    const sabotagedCandidate1 = sabotagedSeedPool[poolIndex];
    let seedMismatch = false;
    for (let g = 0; g < 5; g++) {
      for (let d = 0; d < 15; d++) {
        if (sabotagedCandidate1.games[g][d] !== persistedPayload.selectedC5[g][d]) {
          seedMismatch = true;
          break;
        }
      }
      if (seedMismatch) break;
    }
    assert(seedMismatch, "Controle negativo de seed adulterada detectou divergência com sucesso");

    // Controle negativo: sabotagem de poolIndex
    const sabotagedCandidate2 = replayedPool[(poolIndex + 1) % 500];
    let indexMismatch = false;
    for (let g = 0; g < 5; g++) {
      for (let d = 0; d < 15; d++) {
        if (sabotagedCandidate2.games[g][d] !== persistedPayload.selectedC5[g][d]) {
          indexMismatch = true;
          break;
        }
      }
      if (indexMismatch) break;
    }
    assert(indexMismatch, "Controle negativo de poolIndex adulterado detectou divergência com sucesso");

    console.log("  ✓ Replay determinístico a partir dos metadados persistidos reproduz o candidato exato");
    console.log("  ✓ Controles negativos detectam adulteração de seed e poolIndex com sucesso");
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Backup e Restore no Schema V3 (Legado, Memory e Misto)
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 5: Backup e Restore no Schema V3 (Legado, Memory e Misto)");
  {
    const idb = new IDBFactory();
    const dbName = "test-c5-memory-backup";
    const repo = new ContestRepository({ idbFactory: idb, dbName, clock: fixedClock });

    // Inserir registro legado
    const legacyRec: ContestRecord = {
      status: "FROZEN",
      contestNumber: 2901,
      generationId: "a2901000-0000-4000-8000-000000002901",
      algorithmVersion: "C5-1.0.0",
      generatedAt: "2026-09-01T10:00:00.000Z",
      frozenAt: "2026-09-01T10:05:00.000Z",
      betPlacedAt: "2026-09-01T10:05:00.000Z",
      integrityHash: "bdcfd7abee344b2e484f648d4465e5d048b043b1ca95e358a31d5ac763800f44",
      generation: buildC5FromPermutation(Array.from({ length: 25 }, (_, i) => i + 1)),
    };
    // Inserir registro legado diretamente no store
    const dbPre = await openDatabase({ idbFactory: idb, dbName });
    const txPre = dbPre.transaction(CONTEST_STORE_NAME, "readwrite");
    await promisifyRequest(txPre.objectStore(CONTEST_STORE_NAME).put(legacyRec));
    await new Promise<void>((res) => { txPre.oncomplete = () => res(); });
    closeDatabase(dbPre);

    // Ler o estado corrente para criar o Draft fresco
    const currentState = await getMemoryHistoryState({ idbFactory: idb, dbName });

    // Inserir registro Memory via confirmação atômica
    const draft = createDraft({
      H: currentState.H,
      historyRevision: currentState.historyRevision,
      historyFingerprint: currentState.historyFingerprint,
      poolMasterSeed: 77777,
    });
    await confirmMemoryBetAtomic({
      contestNumber: 2902,
      draft,
      clock: fixedClock,
      options: { idbFactory: idb, dbName },
    });

    // 1. Exportar backup misto
    const backupB0 = await repo.exportHistory();
    assert(backupB0.schemaVersion === 3, "BACKUP_SCHEMA_VERSION deve ser rigorosamente 3");
    assert(backupB0.records.length === 2, "Backup deve conter exatamente 2 registros");

    const exportedLegacy = backupB0.records.find((r) => r.contestNumber === 2901);
    const exportedMemory = backupB0.records.find((r) => r.contestNumber === 2902);

    assert(exportedLegacy?.memoryPayload === undefined, "Registro legado exportado não pode ter memoryPayload");
    assert(exportedMemory?.memoryPayload !== undefined, "Registro memory exportado deve conter memoryPayload");
    assert(exportedMemory?.memoryPayload?.poolMasterSeed === 77777, "poolMasterSeed exportado intacto");

    // 2. Restaurar em banco limpo (Restore Misto)
    const idbClean = new IDBFactory();
    const dbCleanName = "test-c5-memory-restore-clean";
    const repoClean = new ContestRepository({ idbFactory: idbClean, dbName: dbCleanName, clock: fixedClock });

    const plan = await prepareHistoryImport(backupB0, repoClean);
    assert(plan.valid, `Plano de importação deve ser válido: ${plan.errors.join("; ")}`);
    assert(plan.newRecords === 2, "Plano deve marcar 2 registros como novos");

    const execResult = await importHistory(plan, repoClean);
    assert(execResult.success, "Importação executada com sucesso");
    assert(execResult.importedCount === 2, "Exatamente 2 registros importados");

    // 3. Verificar registros restaurados
    const restoredLegacy = await repoClean.getContestRecord(2901);
    const restoredMemory = await repoClean.getContestRecord(2902);

    assert(restoredLegacy?.memoryPayload === undefined, "Restored legacy sem payload");
    assert(restoredMemory?.memoryPayload !== undefined, "Restored memory com payload");
    assert(restoredMemory?.memoryPayload?.poolMasterSeed === 77777, "poolMasterSeed restaurado confere");
    assert(restoredMemory?.memoryPayload?.poolIndex === draft.poolIndex, "poolIndex restaurado confere");

    // 4. Ciclo B0 -> Restore -> B1
    const backupB1 = await repoClean.exportHistory();
    assert(backupB1.schemaVersion === 3, "B1 schemaVersion === 3");
    assert(backupB1.recordCount === backupB0.recordCount, "B1 recordCount === B0 recordCount");
    assert(areContestRecordsIdentical(backupB0.records[0], backupB1.records[0]), "Registro 0 idêntico B0 vs B1");
    assert(areContestRecordsIdentical(backupB0.records[1], backupB1.records[1]), "Registro 1 idêntico B0 vs B1");

    console.log("  ✓ Exportação e Restauração mista (Legacy + Memory) bem-sucedida");
    console.log("  ✓ Ciclo B0 -> Restore -> B1 preserva 100% da semântica dos registros");
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Validação de Import e Matriz de Corrupção
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 6: Validação do Importador e Matriz de Corrupção");
  {
    const validPayload: FrozenMemoryPayload = {
      algorithmVersion: C5_MEMORY_ALGORITHM_VERSION,
      poolMasterSeed: 12345,
      poolIndex: 100,
      selectedC5: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ],
      historyRevision: 1,
      historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
      winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    assert(validateMemoryPayload(validPayload).valid, "Payload autêntico deve ser válido");

    // 1. Versão algorítmica inválida
    const corrupt1 = { ...validPayload, algorithmVersion: "C5-Memory-9.9.9" };
    assert(!validateMemoryPayload(corrupt1).valid, "algorithmVersion inválida deve ser rejeitada");

    // 2. Seed fora de uint32 (número negativo)
    const corrupt2 = { ...validPayload, poolMasterSeed: -1 };
    assert(!validateMemoryPayload(corrupt2).valid, "Seed negativa fora de uint32 deve ser rejeitada");

    // 3. Seed fora de uint32 (> 4294967295)
    const corrupt3 = { ...validPayload, poolMasterSeed: 5000000000 };
    assert(!validateMemoryPayload(corrupt3).valid, "Seed > uint32 deve ser rejeitada");

    // 4. poolIndex fora do intervalo (< 0 ou >= 500)
    const corrupt4 = { ...validPayload, poolIndex: 500 };
    assert(!validateMemoryPayload(corrupt4).valid, "poolIndex 500 deve ser rejeitado");
    const corrupt4b = { ...validPayload, poolIndex: -1 };
    assert(!validateMemoryPayload(corrupt4b).valid, "poolIndex -1 deve ser rejeitado");

    // 5. selectedC5 com quantidade incorreta (4 jogos)
    const corrupt5 = { ...validPayload, selectedC5: validPayload.selectedC5.slice(0, 4) };
    assert(!validateMemoryPayload(corrupt5).valid, "selectedC5 com 4 jogos deve ser rejeitado");

    // 6. jogo com dezenas duplicadas
    const corrupt6Games = validPayload.selectedC5.map((g) => [...g]);
    corrupt6Games[0][1] = corrupt6Games[0][0]; // duplica dezena
    const corrupt6 = { ...validPayload, selectedC5: corrupt6Games };
    assert(!validateMemoryPayload(corrupt6).valid, "Jogo com dezenas duplicadas deve ser rejeitado");

    // 7. fingerprint malformado
    const corrupt7 = { ...validPayload, historyFingerprint: "not-a-sha256" };
    assert(!validateMemoryPayload(corrupt7).valid, "Fingerprint malformado deve ser rejeitado");

    // 8. winnerHistogram com dimensão inválida
    const corrupt8 = { ...validPayload, winnerHistogram: [1, 2, 3] };
    assert(!validateMemoryPayload(corrupt8).valid, "winnerHistogram com dimensão errada deve ser rejeitado");

    console.log("  ✓ Todas as 8 mutações da matriz de corrupção foram rejeitadas estritamente");
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Atomicidade do Restore (Rejeição Total sob Corrupção)
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 7: Atomicidade do Restore (Rejeição Total)");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: fixedClock });

    const corruptedBackup = {
      schemaVersion: 3,
      exportedAt: "2026-09-30T15:00:00.000Z",
      recordCount: 2,
      algorithmVersions: ["C5-1.0.0", "C5-Memory-2.0.0"],
      records: [
        {
          status: "FROZEN",
          contestNumber: 4001,
          generationId: "a4001000-0000-4000-8000-000000004001",
          algorithmVersion: "C5-1.0.0",
          generatedAt: "2026-09-01T10:00:00.000Z",
          frozenAt: "2026-09-01T10:05:00.000Z",
          betPlacedAt: "2026-09-01T10:05:00.000Z",
          integrityHash: "bdcfd7abee344b2e484f648d4465e5d048b043b1ca95e358a31d5ac763800f44",
          generation: buildC5FromPermutation(Array.from({ length: 25 }, (_, i) => i + 1)),
        },
        {
          status: "FROZEN",
          contestNumber: 4002,
          generationId: "c5m-4002-CORRUPT",
          algorithmVersion: "C5-Memory-2.0.0",
          generatedAt: "2026-09-30T15:00:00.000Z",
          frozenAt: "2026-09-30T15:00:00.000Z",
          betPlacedAt: "2026-09-30T15:00:00.000Z",
          integrityHash: "a".repeat(64),
          generation: {
            permutation: [],
            slotAssignments: {},
            games: [
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
              [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
              [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            ],
          },
          memoryPayload: {
            algorithmVersion: "C5-Memory-2.0.0",
            poolMasterSeed: 12345,
            poolIndex: 999, // CORRUPÇÃO: 999 > 499
            selectedC5: [
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
              [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
              [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            ],
            historyRevision: 1,
            historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
            winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          },
        },
      ],
    };

    const validation = await validateHistoryBackup(corruptedBackup);
    assert(!validation.valid, "Backup com registro corrupto deve falhar na validação");
    assert(
      validation.errors.some((e) => e.includes("poolIndex")),
      "Erro deve indicar poolIndex inválido"
    );

    const plan = await prepareHistoryImport(corruptedBackup, repo);
    assert(!plan.valid, "Plano de importação com backup corrupto deve ser inválido");
    assert(plan.preparedRecordsToImport.length === 0, "Zero registros preparados para importação");

    const allRecords = await repo.getAllContestRecords();
    assert(allRecords.length === 0, "Banco permaneceu estritamente vazio (zero escrita parcial)");

    console.log("  ✓ Atomicidade do restore comprovada: rejeição integral sem efeito colateral");
  }

  // --------------------------------------------------------------------------
  // TESTE 8: Integridade Pós-Restore de H, Revision e Fingerprint
  // --------------------------------------------------------------------------
  console.log("\n▶ Teste 8: Equivalência de H, Revision e Fingerprint Pós-Restore");
  {
    const idbA = new IDBFactory();
    const idbB = new IDBFactory();
    const repoA = new ContestRepository({ idbFactory: idbA, clock: fixedClock });
    const repoB = new ContestRepository({ idbFactory: idbB, clock: fixedClock });

    // Criar aposta confirmada no banco A
    const draft = createDraft({
      H: [],
      historyRevision: 0,
      historyFingerprint: "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa",
      poolMasterSeed: 88888,
    });
    await confirmMemoryBetAtomic({
      contestNumber: 5001,
      draft,
      clock: fixedClock,
      options: { idbFactory: idbA },
    });

    const stateA = await getMemoryHistoryState({ idbFactory: idbA });

    // Exportar e restaurar no banco B
    const backup = await repoA.exportHistory();
    const plan = await prepareHistoryImport(backup, repoB);
    await importHistory(plan, repoB);

    const stateB = await getMemoryHistoryState({ idbFactory: idbB });

    assert(stateA.historyRevision === stateB.historyRevision, "historyRevision idêntica pós-restore");
    assert(stateA.historyFingerprint === stateB.historyFingerprint, "historyFingerprint idêntico pós-restore");
    assert(stateA.H.length === stateB.H.length, "|H| idêntico pós-restore");

    for (let i = 0; i < stateA.H.length; i++) {
      for (let d = 0; d < 15; d++) {
        assert(stateA.H[i][d] === stateB.H[i][d], `H[${i}][${d}] idêntico pós-restore`);
      }
    }

    console.log("  ✓ H, historyRevision e historyFingerprint 100% equivalentes pós-restore");
  }

  console.log("\n🎉 TODOS OS TESTES UNITÁRIOS DE PERSISTÊNCIA E BACKUP C5-MEMORY (IC8) PASSARAM COM SUCESSO!");
}

runTests().catch((err) => {
  console.error("FALHA NOS TESTES DE PERSISTÊNCIA IC8:", err);
  process.exit(1);
});
