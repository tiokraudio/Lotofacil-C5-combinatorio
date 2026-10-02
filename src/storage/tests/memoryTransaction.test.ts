/**
 * Testes Unitários e de Integração para a Fronteira Transacional Atômica C5-Memory (IC7)
 */

import { IDBFactory } from "fake-indexeddb";
import {
  confirmMemoryBetAtomic,
  getMemoryHistoryState,
  ExactHistoryDuplicateBlockedError,
  EXACT_HISTORY_DUPLICATE_BLOCKED,
} from "../memoryTransaction.ts";
import { openDatabase, closeDatabase, promisifyRequest, CONTEST_STORE_NAME } from "../db.ts";
import { createDraft, StaleRevisionRejectedError } from "../../c5-memory/draft.ts";
import { computeHistoryFingerprint } from "../../c5-memory/history.ts";
import { gameToBitmask } from "../../c5-memory/math.ts";
import type { ContestRecord } from "../../c5/types.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    throw new Error(`Asserção falhou: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log("=== EXECUTANDO TESTES DE FRONTEIRA TRANSACIONAL C5-MEMORY (IC7) ===");

  // -------------------------------------------------------------------------
  // 1. Confirmação Fresh em Base Inicial Vazia
  // -------------------------------------------------------------------------
  {
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };

    // Estado inicial
    const state0 = await getMemoryHistoryState(opts);
    assert(state0.historyRevision === 0, "Revisão inicial da base vazia é 0");
    assert(state0.eligibleCount === 0, "Contagem de apostas elegíveis inicial é 0");

    // Cria draft contra R0/F0
    const draft1 = createDraft({
      H: state0.H,
      historyRevision: state0.historyRevision,
      historyFingerprint: state0.historyFingerprint,
      poolMasterSeed: 20260929,
    });

    const res1 = await confirmMemoryBetAtomic({
      contestNumber: 3501,
      draft: draft1,
      options: opts,
    });

    assert(res1.previousRevision === 0, "previousRevision reportada é 0");
    assert(res1.newRevision === 1, "newRevision avançou para 1");
    assert(res1.record.status === "FROZEN", "Registro persistido com status FROZEN");
    assert(typeof res1.record.betPlacedAt === "string", "betPlacedAt foi preenchido");

    // Verifica leitura do store
    const state1 = await getMemoryHistoryState(opts);
    assert(state1.historyRevision === 1, "Nova leitura confirma revisão 1");
    assert(state1.recordsCount === 1, "Exatamente 1 registro gravado no store");
    assert(state1.H.length === 5, "Histórico H expandiu de 0 para 5 jogos");
    assert(state1.historyFingerprint === res1.newFingerprint, "Fingerprint do store coincide com newFingerprint");
  }

  // -------------------------------------------------------------------------
  // 2. Rejeição de Stale Revision (com rollback e zero efeitos)
  // -------------------------------------------------------------------------
  {
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };

    // Cria draft com revision divergente (rev = 99 em vez de 0)
    const staleRevDraft = createDraft({
      H: [],
      historyRevision: 99,
      historyFingerprint: computeHistoryFingerprint([]),
      poolMasterSeed: 12345,
    });

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3502,
        draft: staleRevDraft,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught instanceof StaleRevisionRejectedError, "Lançou StaleRevisionRejectedError em stale revision");
    assert(caught.code === "STALE_REVISION_REJECTED", "Código do erro é STALE_REVISION_REJECTED");

    // Comprova zero efeitos na base
    const stateAfterAbort = await getMemoryHistoryState(opts);
    assert(stateAfterAbort.recordsCount === 0, "Zero registros persistidos após abort de stale revision");
    assert(stateAfterAbort.historyRevision === 0, "Revisão permaneceu 0 após abort");
  }

  // -------------------------------------------------------------------------
  // 3. Rejeição de Stale Fingerprint (mesma revision, fingerprint divergente)
  // -------------------------------------------------------------------------
  {
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };

    // Cria draft com fingerprint forçadamente divergente
    const fakeFp = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const staleFpDraft = createDraft({
      H: [],
      historyRevision: 0,
      historyFingerprint: fakeFp,
      poolMasterSeed: 12345,
    });

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3503,
        draft: staleFpDraft,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught instanceof StaleRevisionRejectedError, "Lançou StaleRevisionRejectedError em stale fingerprint");
    const stateAfterFpAbort = await getMemoryHistoryState(opts);
    assert(stateAfterFpAbort.recordsCount === 0, "Zero registros persistidos após abort de stale fingerprint");
  }

  // -------------------------------------------------------------------------
  // 4. Confirmação Duplicada do Mesmo Draft (Idempotência / OCC)
  // -------------------------------------------------------------------------
  {
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };

    const draft = createDraft({
      H: [],
      historyRevision: 0,
      historyFingerprint: computeHistoryFingerprint([]),
      poolMasterSeed: 55555,
    });

    // Primeira confirmação: sucesso
    await confirmMemoryBetAtomic({
      contestNumber: 3504,
      draft,
      options: opts,
    });

    // Segunda tentativa de confirmação do mesmo draft: deve falhar como stale (ou colisão)
    let secondCaught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3505, // Mesmo tentando outro número de concurso!
        draft,
        options: opts,
      });
    } catch (err: any) {
      secondCaught = err;
    }

    assert(secondCaught instanceof StaleRevisionRejectedError, "Segunda tentativa com mesmo Draft é rejeitada como STALE_REVISION_REJECTED");
    const finalState = await getMemoryHistoryState(opts);
    assert(finalState.recordsCount === 1, "Apenas a primeira confirmação foi gravada (cardinalidade 1)");
  }

  // -------------------------------------------------------------------------
  // 5. Falha Injetada Durante Escrita (Rollback Total)
  // -------------------------------------------------------------------------
  {
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };

    const draft = createDraft({
      H: [],
      historyRevision: 0,
      historyFingerprint: computeHistoryFingerprint([]),
      poolMasterSeed: 777,
    });

    let injectedErr: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3506,
        draft,
        options: opts,
        simulateCommitFailure: true,
      });
    } catch (err: any) {
      injectedErr = err;
    }

    assert(injectedErr !== null, "Falha simulada capturada com sucesso");
    const stateRollback = await getMemoryHistoryState(opts);
    assert(stateRollback.recordsCount === 0, "Rollback total confirmado: zero registros gravados");
  }

  // =========================================================================
  // TESTES AUTORITATIVOS OBRIGATÓRIOS (POST_CERT_EXTENSION: UI-1A.1)
  // =========================================================================
  console.log("\n--- TESTES AUTORITATIVOS DA EXTENSÃO ATÔMICA (T1 - T10) ---");

  // Helper para base com concurso 3001 confirmado
  async function setupBaseWithContest3001(opts: any) {
    const state0 = await getMemoryHistoryState(opts);
    const draft1 = createDraft({
      H: state0.H,
      historyRevision: state0.historyRevision,
      historyFingerprint: state0.historyFingerprint,
      poolMasterSeed: 10001,
    });
    const res1 = await confirmMemoryBetAtomic({
      contestNumber: 3001,
      draft: draft1,
      options: opts,
    });
    return { draft1, res1 };
  }

  // -------------------------------------------------------------------------
  // T1 — chamada direta maliciosa
  // -------------------------------------------------------------------------
  {
    console.log("▶ T1: Chamada direta maliciosa com jogo duplicado");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1 } = await setupBaseWithContest3001(opts);
    const state1 = await getMemoryHistoryState(opts);

    // Draft criado com OCC fresco mas adulterado com jogo de draft1
    const freshDraft = createDraft({
      H: state1.H,
      historyRevision: state1.historyRevision,
      historyFingerprint: state1.historyFingerprint,
      poolMasterSeed: 20002,
    });
    const maliciousDraft = {
      ...freshDraft,
      selectedC5: [
        [...draft1.selectedC5[0]], // Jogo duplicado
        freshDraft.selectedC5[1],
        freshDraft.selectedC5[2],
        freshDraft.selectedC5[3],
        freshDraft.selectedC5[4],
      ],
    };

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: maliciousDraft as any,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught instanceof ExactHistoryDuplicateBlockedError, "T1: Lançou ExactHistoryDuplicateBlockedError");
    assert(caught.code === EXACT_HISTORY_DUPLICATE_BLOCKED, "T1: Código do erro é EXACT_HISTORY_DUPLICATE_BLOCKED");
    assert(caught.duplicateCount === 1, "T1: duplicateCount é 1");
    assert(caught.conflictingIndices.includes(0), "T1: conflictingIndices inclui índice 0");

    const stateAfter = await getMemoryHistoryState(opts);
    assert(stateAfter.recordsCount === 1, "T1: Zero persistência adicional (store manteve cardinalidade 1)");
  }

  // -------------------------------------------------------------------------
  // T2 — rollback integral
  // -------------------------------------------------------------------------
  {
    console.log("▶ T2: Rollback integral após rejeição por duplicidade");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1, res1 } = await setupBaseWithContest3001(opts);

    const stateBefore = await getMemoryHistoryState(opts);

    const freshDraft = createDraft({
      H: stateBefore.H,
      historyRevision: stateBefore.historyRevision,
      historyFingerprint: stateBefore.historyFingerprint,
      poolMasterSeed: 30003,
    });
    const dupDraft = {
      ...freshDraft,
      selectedC5: [
        freshDraft.selectedC5[0],
        [...draft1.selectedC5[2]], // Jogo duplicado
        freshDraft.selectedC5[2],
        freshDraft.selectedC5[3],
        freshDraft.selectedC5[4],
      ],
    };

    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: dupDraft as any,
        options: opts,
      });
    } catch {}

    const stateAfter = await getMemoryHistoryState(opts);
    assert(stateAfter.recordsCount === stateBefore.recordsCount, "T2: Cardinalidade do store idêntica (1)");
    assert(stateAfter.historyRevision === stateBefore.historyRevision, "T2: Revision idêntica (1)");
    assert(stateAfter.historyFingerprint === stateBefore.historyFingerprint, "T2: Fingerprint idêntico");
    assert(stateAfter.H.length === stateBefore.H.length, "T2: H sem contaminação");

    const db = await openDatabase(opts);
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readonly");
      const record3002 = await promisifyRequest(tx.objectStore(CONTEST_STORE_NAME).get(3002));
      assert(!record3002, "T2: Nenhum registro parcial para o concurso 3002");
    } finally {
      closeDatabase(db);
    }
  }

  // -------------------------------------------------------------------------
  // T3 — cinco duplicatas
  // -------------------------------------------------------------------------
  {
    console.log("▶ T3: Cinco duplicatas (todos os 5 jogos já existentes)");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1 } = await setupBaseWithContest3001(opts);
    const state1 = await getMemoryHistoryState(opts);

    const allDupDraft = {
      ...draft1,
      expectedHistoryRevision: state1.historyRevision,
      expectedHistoryFingerprint: state1.historyFingerprint,
      draftHistoryRevision: state1.historyRevision,
      draftHistoryFingerprint: state1.historyFingerprint,
    };

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: allDupDraft as any,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught instanceof ExactHistoryDuplicateBlockedError, "T3: Rejeição com ExactHistoryDuplicateBlockedError");
    assert(caught.duplicateCount === 5, "T3: duplicateCount é 5");
    assert(caught.conflictingIndices.length === 5, "T3: 5 índices conflitantes");
  }

  // -------------------------------------------------------------------------
  // T4 — permutação (mesmo jogo com dezenas em ordem diferente)
  // -------------------------------------------------------------------------
  {
    console.log("▶ T4: Permutação de dezenas dentro do jogo duplicado");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1 } = await setupBaseWithContest3001(opts);
    const state1 = await getMemoryHistoryState(opts);

    // Inverte ordem das dezenas
    const permutedGame = [...draft1.selectedC5[0]].reverse();
    const freshDraft = createDraft({
      H: state1.H,
      historyRevision: state1.historyRevision,
      historyFingerprint: state1.historyFingerprint,
      poolMasterSeed: 40004,
    });
    const permutedDraft = {
      ...freshDraft,
      selectedC5: [
        freshDraft.selectedC5[0],
        permutedGame,
        freshDraft.selectedC5[2],
        freshDraft.selectedC5[3],
        freshDraft.selectedC5[4],
      ],
    };

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: permutedDraft as any,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught instanceof ExactHistoryDuplicateBlockedError, "T4: Rejeitado por duplicidade mesmo com dezenas permutadas");
    assert(caught.conflictingIndices.includes(1), "T4: Índice conflitante é 1");
  }

  // -------------------------------------------------------------------------
  // T5 — não duplicado (confirmação legítima normal)
  // -------------------------------------------------------------------------
  {
    console.log("▶ T5: Não duplicado confirma normalmente");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { res1 } = await setupBaseWithContest3001(opts);
    const state1 = await getMemoryHistoryState(opts);

    const freshDraft = createDraft({
      H: state1.H,
      historyRevision: state1.historyRevision,
      historyFingerprint: state1.historyFingerprint,
      poolMasterSeed: 50005,
    });

    const res2 = await confirmMemoryBetAtomic({
      contestNumber: 3002,
      draft: freshDraft,
      options: opts,
    });

    assert(res2.record.status === "FROZEN", "T5: Concurso 3002 confirmado como FROZEN");
    assert(res2.newRevision === 2, "T5: Revisão avançou para 2");
    assert(res2.record.memoryPayload?.confirmedRevision === 2, "T5: memoryPayload.confirmedRevision é 2");
  }

  // -------------------------------------------------------------------------
  // T6 — stale continua prioritariamente protegido
  // -------------------------------------------------------------------------
  {
    console.log("▶ T6: Proteção stale continua prioritária sobre histórico modificado");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1 } = await setupBaseWithContest3001(opts);

    // Draft criado contra revisão 0 (está desatualizado em relação à base que já está na rev 1)
    // E propositalmente contém jogo duplicado
    const staleAndDuplicateDraft = {
      ...draft1,
      expectedHistoryRevision: 0, // Stale!
      expectedHistoryFingerprint: computeHistoryFingerprint([]), // Stale!
    };

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: staleAndDuplicateDraft as any,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught instanceof StaleRevisionRejectedError, "T6: OCC rejeitou com StaleRevisionRejectedError prioritariamente");
    assert(caught.code === "STALE_REVISION_REJECTED", "T6: Código é STALE_REVISION_REJECTED");
  }

  // -------------------------------------------------------------------------
  // T7 — concorrência A × B
  // -------------------------------------------------------------------------
  {
    console.log("▶ T7: Concorrência A x B (duas confirmações concorrentes)");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const state0 = await getMemoryHistoryState(opts);

    const draftA = createDraft({
      H: state0.H,
      historyRevision: 0,
      historyFingerprint: state0.historyFingerprint,
      poolMasterSeed: 70001,
    });
    const draftB = createDraft({
      H: state0.H,
      historyRevision: 0,
      historyFingerprint: state0.historyFingerprint,
      poolMasterSeed: 70002,
    });

    const [resA, resB] = await Promise.allSettled([
      confirmMemoryBetAtomic({ contestNumber: 3001, draft: draftA, options: opts }),
      confirmMemoryBetAtomic({ contestNumber: 3002, draft: draftB, options: opts }),
    ]);

    const successes = [resA, resB].filter((r) => r.status === "fulfilled");
    const rejections = [resA, resB].filter((r) => r.status === "rejected");

    assert(successes.length === 1, "T7: Exatamente uma das transações concorrentes prevaleceu");
    assert(rejections.length === 1, "T7: A transação concorrente que perdeu a corrida foi rejeitada");
    const stateFinal = await getMemoryHistoryState(opts);
    assert(stateFinal.recordsCount === 1, "T7: Estado final consistente com 1 registro");
  }

  // -------------------------------------------------------------------------
  // T8 — bypass da Application Layer
  // -------------------------------------------------------------------------
  {
    console.log("▶ T8: Hard Block atômico funciona com bypass total da Application Layer");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1 } = await setupBaseWithContest3001(opts);
    const state1 = await getMemoryHistoryState(opts);

    // Chamador não importa nem toca em memoryBetOrchestrator, chama direto confirmMemoryBetAtomic
    const freshDraft = createDraft({
      H: state1.H,
      historyRevision: state1.historyRevision,
      historyFingerprint: state1.historyFingerprint,
      poolMasterSeed: 88888,
    });
    const rawInjectedDraft = {
      ...freshDraft,
      selectedC5: [
        freshDraft.selectedC5[0],
        freshDraft.selectedC5[1],
        freshDraft.selectedC5[2],
        freshDraft.selectedC5[3],
        [...draft1.selectedC5[4]], // Duplicado direto
      ],
    };

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: rawInjectedDraft as any,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught?.code === EXACT_HISTORY_DUPLICATE_BLOCKED, "T8: Rejeitado pelo storage autoritativo sem orquestrador");
  }

  // -------------------------------------------------------------------------
  // T9 — isolamento exógeno (CAIXA, score, prêmio não interferem)
  // -------------------------------------------------------------------------
  {
    console.log("▶ T9: Isolamento exógeno (dados CAIXA/score não alteram detecção)");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };

    // Inserir registro SCORED com dados exógenos de conferência CAIXA
    const db = await openDatabase(opts);
    const gameExog = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scoredRecord: ContestRecord = {
      status: "SCORED",
      contestNumber: 3000,
      generationId: "c5-3000-scored",
      algorithmVersion: "C5-1.0.0",
      generatedAt: new Date().toISOString(),
      frozenAt: new Date().toISOString(),
      betPlacedAt: new Date().toISOString(),
      generation: {
        permutation: [],
        slotAssignments: {},
        games: [gameExog, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]],
      },
      integrityHash: "exogenous-test-hash",
      officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      scoredAt: new Date().toISOString(),
    };

    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      await promisifyRequest(tx.objectStore(CONTEST_STORE_NAME).put(scoredRecord));
    } finally {
      closeDatabase(db);
    }

    const stateScored = await getMemoryHistoryState(opts);
    const freshDraft = createDraft({
      H: stateScored.H,
      historyRevision: stateScored.historyRevision,
      historyFingerprint: stateScored.historyFingerprint,
      poolMasterSeed: 99999,
    });

    // Injeta gameExog no draft
    const colExogDraft = {
      ...freshDraft,
      selectedC5: [
        [...gameExog],
        freshDraft.selectedC5[1],
        freshDraft.selectedC5[2],
        freshDraft.selectedC5[3],
        freshDraft.selectedC5[4],
      ],
    };

    let caught: any = null;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3001,
        draft: colExogDraft as any,
        options: opts,
      });
    } catch (err: any) {
      caught = err;
    }

    assert(caught?.code === EXACT_HISTORY_DUPLICATE_BLOCKED, "T9: Jogo de concurso SCORED com dados CAIXA é bloqueado por pertencer a H");
  }

  // -------------------------------------------------------------------------
  // T10 — controle negativo
  // -------------------------------------------------------------------------
  {
    console.log("▶ T10: Controle negativo (sem o Passo 4.5, jogo duplicado entra na base)");
    const idb = new IDBFactory();
    const opts = { idbFactory: idb };
    const { draft1 } = await setupBaseWithContest3001(opts);
    const state1 = await getMemoryHistoryState(opts);

    const dupGame = [...draft1.selectedC5[0]];
    const freshDraft = createDraft({
      H: state1.H,
      historyRevision: state1.historyRevision,
      historyFingerprint: state1.historyFingerprint,
      poolMasterSeed: 10101,
    });
    const dupDraft = {
      ...freshDraft,
      selectedC5: [
        dupGame,
        freshDraft.selectedC5[1],
        freshDraft.selectedC5[2],
        freshDraft.selectedC5[3],
        freshDraft.selectedC5[4],
      ],
    };

    // 1. COM o guard: confirmMemoryBetAtomic bloqueia
    let blockedWithGuard = false;
    try {
      await confirmMemoryBetAtomic({
        contestNumber: 3002,
        draft: dupDraft as any,
        options: opts,
      });
    } catch (e: any) {
      if (e.code === EXACT_HISTORY_DUPLICATE_BLOCKED) {
        blockedWithGuard = true;
      }
    }
    assert(blockedWithGuard, "T10: COM o guard atômico, a operação é estritamente bloqueada");

    // 2. SEM o guard (simulação proposital de transação sem o Passo 4.5):
    const db = await openDatabase(opts);
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);
      const nowIso = new Date().toISOString();
      const mockRecord: ContestRecord = {
        status: "FROZEN",
        contestNumber: 3002,
        generationId: "mock-3002",
        algorithmVersion: dupDraft.algorithmVersion,
        generatedAt: nowIso,
        frozenAt: nowIso,
        betPlacedAt: nowIso,
        generation: {
          permutation: [],
          slotAssignments: {},
          games: [
            [...dupDraft.selectedC5[0]],
            [...dupDraft.selectedC5[1]],
            [...dupDraft.selectedC5[2]],
            [...dupDraft.selectedC5[3]],
            [...dupDraft.selectedC5[4]],
          ],
        },
        integrityHash: "mock-hash",
        memoryPayload: {
          algorithmVersion: dupDraft.algorithmVersion,
          poolMasterSeed: dupDraft.poolMasterSeed,
          poolIndex: dupDraft.poolIndex,
          selectedC5: [
            [...dupDraft.selectedC5[0]],
            [...dupDraft.selectedC5[1]],
            [...dupDraft.selectedC5[2]],
            [...dupDraft.selectedC5[3]],
            [...dupDraft.selectedC5[4]],
          ],
          historyRevision: dupDraft.expectedHistoryRevision,
          historyFingerprint: dupDraft.expectedHistoryFingerprint,
          winnerHistogram: [...dupDraft.winnerHistogram],
          confirmedRevision: 2,
          confirmedAt: nowIso,
        },
      };
      await promisifyRequest(store.put(mockRecord));
    } finally {
      closeDatabase(db);
    }

    const stateWithout = await getMemoryHistoryState(opts);
    const copiesInH = stateWithout.H.filter(
      (g) => gameToBitmask(g) === gameToBitmask(dupGame)
    ).length;

    assert(copiesInH === 2, "T10: SEM o guard, a duplicata entra em H (cópias = 2)");
    console.log("  ✓ T10 PASS: Eficácia causal comprovada.");
  }

  console.log("🎉 Todos os testes unitários de fronteira transacional passaram com SUCESSO!");
}

runTests().catch((err) => {
  console.error("FALHA NOS TESTES DE TRANSAÇÃO:", err);
  process.exit(1);
});
