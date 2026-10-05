/**
 * Gerenciador de Persistência e Transação Atômica C5-Memory-2.1.0
 * Ordem Executiva IC3
 * 
 * Regras Estritas:
 * 1. FONTE CANÔNICA DE VERDADE: Store 'contests'.
 * 2. READ-MODEL DERIVADO: Store 'c5_memory_history'.
 * 3. Transação Atômica Multi-Store: commit total ou rollback com zero efeitos.
 * 4. OCC por revision e fingerprint.
 * 5. Anti-TOCTOU na confirmação.
 * 6. Hard Duplicate Guard cross-version (2.0.0 e 2.1.0).
 * 7. Imutabilidade absoluta do estado FROZEN.
 * 8. Preservação estrita da identidade da versão (2.0.0 nunca vira 2.1.0).
 */

import { ContestRecord, MemoryHistory, C5Game } from "../c5-memory/types";
import { Draft210, FrozenMemoryPayload210, freezeDraft210, ALGORITHM_VERSION_2_1_0 } from "../c5-memory/engine210";
import { formatGameCanonical, createMemoryHistory } from "../c5-memory/history";
import { calculateHits } from "../c5-memory/math";

export const STORE_CONTESTS = "contests";
export const STORE_MEMORY_HISTORY = "c5_memory_history";
export const CANONICAL_STORAGE_SOURCE = "contests" as const;
export const DERIVED_STORAGE_SOURCE = "c5_memory_history" as const;

export interface AtomicConfirmationResult210 {
  readonly record: ContestRecord;
  readonly updatedHistory: MemoryHistory;
}

/**
 * Reconstrução determinística de H exclusivamente a partir da fonte canônica 'contests' (Cross-Version)
 */
export function reconstructHistoryCrossVersion(
  contests: readonly ContestRecord[]
): MemoryHistory {
  // Filtra todos os concursos confirmados de C5-Memory (2.0.0 e 2.1.0)
  const confirmed = contests.filter(
    c =>
      ((c.algorithmVersion as string) === "C5-Memory-2.0.0" || (c.algorithmVersion as string) === ALGORITHM_VERSION_2_1_0) &&
      (c.status === "FROZEN" || c.status === "COMPLETED")
  );

  // Ordena estritamente por número de concurso crescente
  const sorted = [...confirmed].sort((a, b) => a.contestNumber - b.contestNumber);

  const accumulatedGames: C5Game[] = [];
  for (const c of sorted) {
    for (const g of c.games) {
      accumulatedGames.push(g);
    }
  }

  const revision = sorted.length;
  return createMemoryHistory(accumulatedGames, revision);
}

/**
 * Confirmação Atômica de Aposta para C5-Memory-2.1.0 com OCC e Hard Block anti-duplicação
 */
export async function confirmMemoryBetAtomic210(
  db: IDBDatabase,
  contestNumber: number,
  draft: Draft210,
  expectedRevision: number,
  expectedFingerprint: string,
  injectedFailurePoint?: "AFTER_CONTEST_WRITE" | "BEFORE_COMPLETE"
): Promise<AtomicConfirmationResult210> {
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

    // 1. Verificar TOCTOU: o concurso já foi confirmado?
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

        // 3. HARD BLOCK DE REPETIÇÃO CROSS-VERSION
        const historySignatures = new Set(currentHistory.games.map(formatGameCanonical));
        for (let i = 0; i < draft.games.length; i++) {
          const gameSig = formatGameCanonical(draft.games[i]);
          if (historySignatures.has(gameSig)) {
            tx.abort();
            reject(new Error(`EXACT_HISTORY_DUPLICATE_BLOCKED: Jogo ${i + 1} (${gameSig}) já confirmado anteriormente em H.`));
            return;
          }
        }

        // 4. Congelar criptograficamente o Draft 2.1.0
        const frozenPayload: FrozenMemoryPayload210 = freezeDraft210(draft);

        const newRecord: ContestRecord = {
          contestNumber,
          contestDate: currentContest?.contestDate || new Date().toISOString().split("T")[0],
          status: "FROZEN",
          algorithmVersion: ALGORITHM_VERSION_2_1_0 as any,
          games: draft.games,
          draft: draft as any,
          frozenPayload: frozenPayload as any,
          createdAt: currentContest?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Gravação do concurso
        contestStore.put(newRecord);

        // Simulação de falha controlada para provar atomicidade
        if (injectedFailurePoint === "AFTER_CONTEST_WRITE") {
          tx.abort();
          return;
        }

        // 5. Atualizar histórico H com os 5 jogos estruturais
        const updatedGames: C5Game[] = [...currentHistory.games, ...draft.games];
        const newHistoryRevision = currentHistory.revision + 1;
        const updatedHistory = createMemoryHistory(updatedGames, newHistoryRevision);

        historyStore.put({ id: "singleton", history: updatedHistory });

        if (injectedFailurePoint === "BEFORE_COMPLETE") {
          tx.abort();
          return;
        }

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

/**
 * Apuração de Concurso (FROZEN -> COMPLETED)
 * Invariante: Preserva integralmente os dados originais de geração
 */
export async function scoreContestAtomic210(
  db: IDBDatabase,
  contestNumber: number,
  officialResult: readonly number[]
): Promise<ContestRecord> {
  if (!Array.isArray(officialResult) || officialResult.length !== 15) {
    throw new Error("Resultado oficial deve ter exatamente 15 dezenas.");
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readwrite");
    const contestStore = tx.objectStore(STORE_CONTESTS);

    let updatedRecord: ContestRecord | null = null;

    tx.oncomplete = () => {
      if (updatedRecord) resolve(updatedRecord);
      else reject(new Error("FALHA_AO_APURAR_CONCURSO"));
    };

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("TRANSACTION_ABORTED"));

    const getReq = contestStore.get(contestNumber);
    getReq.onsuccess = () => {
      const record = getReq.result as ContestRecord | undefined;
      if (!record) {
        tx.abort();
        reject(new Error("CONTEST_NOT_FOUND"));
        return;
      }

      if (record.status === "COMPLETED") {
        tx.abort();
        reject(new Error("CONTEST_ALREADY_COMPLETED"));
        return;
      }

      if (record.status !== "FROZEN") {
        tx.abort();
        reject(new Error("CONTEST_NOT_FROZEN"));
        return;
      }

      // Calcula acertos preservando todos os campos de geração
      const gameHits = record.games.map(g => calculateHits(g, officialResult));
      const bestHits = Math.max(...gameHits);
      const bestHitsCount = gameHits.filter(h => h === bestHits).length;

      updatedRecord = {
        ...record,
        status: "COMPLETED",
        officialResult: [...officialResult],
        gameHits,
        bestHits,
        bestHitsCount,
        updatedAt: new Date().toISOString(),
      };

      contestStore.put(updatedRecord);
    };
  });
}

/**
 * Exporta Backup JSON completo do estado do banco
 */
export async function exportCrossVersionBackup(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readonly");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    let contests: ContestRecord[] = [];
    let historyWrapper: any = null;

    contestStore.getAll().onsuccess = (e: any) => {
      contests = e.target.result || [];
    };

    historyStore.get("singleton").onsuccess = (e: any) => {
      historyWrapper = e.target.result;
    };

    tx.oncomplete = () => {
      const backup = {
        exportedAt: new Date().toISOString(),
        canonicalSource: CANONICAL_STORAGE_SOURCE,
        contests,
        history: historyWrapper?.history || null,
      };
      resolve(JSON.stringify(backup, null, 2));
    };

    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Restaura Backup JSON garantindo guarda estrita contra reclassificação de versões
 */
export async function restoreCrossVersionBackup(
  db: IDBDatabase,
  backupJson: string
): Promise<{ restoredContests: number; restoredRevision: number }> {
  const data = JSON.parse(backupJson);
  if (!Array.isArray(data.contests)) {
    throw new Error("Formato de backup inválido: lista de concursos ausente.");
  }

  // Guarda estrita: verificar se houve tentativa de reclassificação
  for (const c of data.contests) {
    if (c.algorithmVersion !== "C5-Memory-2.0.0" && c.algorithmVersion !== ALGORITHM_VERSION_2_1_0) {
      throw new Error(`RESTORE_VERSION_RECLASSIFICATION: versão desconhecida ou inválida ${c.algorithmVersion}`);
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readwrite");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    // Limpa stores antes de restaurar
    contestStore.clear();
    historyStore.clear();

    for (const c of data.contests) {
      contestStore.put(c);
    }

    // O histórico é reconstruído a partir dos concursos restaurados
    const canonicalHistory = reconstructHistoryCrossVersion(data.contests);
    historyStore.put({ id: "singleton", history: canonicalHistory });

    tx.oncomplete = () => {
      resolve({
        restoredContests: data.contests.length,
        restoredRevision: canonicalHistory.revision,
      });
    };

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("RESTORE_ABORTED"));
  });
}
