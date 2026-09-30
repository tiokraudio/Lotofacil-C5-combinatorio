/**
 * Testes Unitários e de Integração para a Fronteira Transacional Atômica C5-Memory (IC7)
 */

import { IDBFactory } from "fake-indexeddb";
import {
  confirmMemoryBetAtomic,
  getMemoryHistoryState,
} from "../memoryTransaction.ts";
import { openDatabase, closeDatabase, promisifyRequest, CONTEST_STORE_NAME } from "../db.ts";
import { createDraft, StaleRevisionRejectedError } from "../../c5-memory/draft.ts";
import { computeHistoryFingerprint } from "../../c5-memory/history.ts";
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

  console.log("🎉 Todos os testes unitários de fronteira transacional passaram com SUCESSO!");
}

runTests().catch((err) => {
  console.error("FALHA NOS TESTES DE TRANSAÇÃO:", err);
  process.exit(1);
});
