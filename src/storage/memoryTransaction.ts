/**
 * Transação Atômica Certificada C5-Memory (UI-1A.1 / RECERT-0)
 * 
 * Regras Estritas:
 * 1. Uma única transação IndexedDB 'readwrite' englobando 'contests' e 'c5_memory_history'.
 * 2. OCC (Optimistic Concurrency Control) por revision e historyFingerprint.
 * 3. Proteção anti-TOCTOU com rollback integral em caso de abort.
 * 4. Hard Block de repetição exata dentro da transação (EXACT_HISTORY_DUPLICATE_BLOCKED).
 * 5. Persistência atômica do FrozenMemoryPayload.
 */

import { ContestRecord, Draft, FrozenMemoryPayload, MemoryHistory, C5Game } from "../c5-memory/types";
import { freezeDraft } from "../c5-memory/draft";
import { formatGameCanonical, createMemoryHistory } from "../c5-memory/history";

import {
  DB_NAME,
  DB_VERSION,
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  STORE_AUDIT_EVENTS,
  openDB,
} from "./db";

export { DB_NAME, DB_VERSION, STORE_CONTESTS, STORE_MEMORY_HISTORY, STORE_AUDIT_EVENTS };

export interface AtomicConfirmationResult {
  readonly record: ContestRecord;
  readonly updatedHistory: MemoryHistory;
}

/**
 * Confirmação Atômica de Aposta C5-Memory com OCC e Hard Block anti-duplicação
 */
export async function confirmMemoryBetAtomic(
  contestNumber: number,
  draft: Draft,
  expectedRevision: number,
  expectedFingerprint: string
): Promise<AtomicConfirmationResult> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readwrite");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    let completedRecord: ContestRecord | null = null;
    let nextHistory: MemoryHistory | null = null;

    tx.onabort = () => {
      reject(tx.error || new Error("TRANSACTION_ABORTED"));
    };

    tx.onerror = () => {
      reject(tx.error || new Error("TRANSACTION_ERROR"));
    };

    tx.oncomplete = () => {
      if (completedRecord && nextHistory) {
        resolve({ record: completedRecord, updatedHistory: nextHistory });
      } else {
        reject(new Error("TRANSACTION_INCOMPLETE_STATE"));
      }
    };

    // 1. Ler o registro do concurso para checar TOCTOU
    const contestReq = contestStore.get(contestNumber);
    contestReq.onsuccess = () => {
      const currentContest = contestReq.result as ContestRecord | undefined;
      if (currentContest && (currentContest.status === "FROZEN" || currentContest.status === "COMPLETED")) {
        tx.abort();
        reject(new Error("CONTEST_ALREADY_CONFIRMED"));
        return;
      }

      // 2. Ler histórico atual para OCC e Hard Block anti-duplicação
      const histReq = historyStore.get("singleton");
      histReq.onsuccess = () => {
        const currentHistWrapper = histReq.result;
        const currentHistory: MemoryHistory = currentHistWrapper?.history || createMemoryHistory([], 0);

        // Validação OCC por revision e fingerprint
        if (currentHistory.revision !== expectedRevision) {
          tx.abort();
          reject(new Error(`OCC_REVISION_MISMATCH: esperado ${expectedRevision}, encontrado ${currentHistory.revision}`));
          return;
        }

        if (currentHistory.fingerprint !== expectedFingerprint) {
          tx.abort();
          reject(new Error(`OCC_FINGERPRINT_MISMATCH: esperado ${expectedFingerprint}, encontrado ${currentHistory.fingerprint}`));
          return;
        }

        // 3. HARD BLOCK DE REPETIÇÃO: nenhum jogo pode já existir em H
        const historySignatures = new Set(currentHistory.games.map(formatGameCanonical));
        for (let i = 0; i < draft.games.length; i++) {
          const gameSig = formatGameCanonical(draft.games[i]);
          if (historySignatures.has(gameSig)) {
            tx.abort();
            reject(new Error(`EXACT_HISTORY_DUPLICATE_BLOCKED: Jogo ${i + 1} (${gameSig}) já confirmado anteriormente em H.`));
            return;
          }
        }

        // 4. Congelar criptograficamente o Draft
        const frozenPayload: FrozenMemoryPayload = freezeDraft(draft);

        const newRecord: ContestRecord = {
          contestNumber,
          contestDate: currentContest?.contestDate || new Date().toISOString().split("T")[0],
          status: "FROZEN",
          algorithmVersion: "C5-Memory-2.0.0",
          games: draft.games,
          draft,
          frozenPayload,
          createdAt: currentContest?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // 5. Atualizar histórico H (adicionar os 5 jogos confirmados)
        const updatedGames: C5Game[] = [...currentHistory.games, ...draft.games];
        const newHistoryRevision = currentHistory.revision + 1;
        const updatedHistory = createMemoryHistory(updatedGames, newHistoryRevision);

        // Gravações atômicas na mesma transação
        contestStore.put(newRecord);
        historyStore.put({ id: "singleton", history: updatedHistory });

        completedRecord = newRecord;
        nextHistory = updatedHistory;
      };

      histReq.onerror = () => {
        tx.abort();
        reject(histReq.error);
      };
    };

    contestReq.onerror = () => {
      tx.abort();
      reject(contestReq.error);
    };
  });
}
