/**
 * Auditoria da Dupla Persistência & Integridade Canônica (RECERT-0.1 Item 1)
 * 
 * Definição Formal de Autoridade:
 * - FONTE CANÔNICA DE VERDADE: Store 'contests' (Registro Primário dos Concursos)
 * - REPRESENTAÇÃO DERIVADA: Store 'c5_memory_history' (Snapshot / Read-Model Acelerador)
 * 
 * Regra:
 * O histórico H, a revision e o historyFingerprint são estritamente derivados da
 * sequência ordenada de concursos confirmados ('FROZEN' ou 'COMPLETED').
 */

import { ContestRecord, MemoryHistory, C5Game } from "../c5-memory/types";
import { formatGameCanonical, createMemoryHistory } from "../c5-memory/history";
import { STORE_CONTESTS, STORE_MEMORY_HISTORY, DB_NAME, DB_VERSION } from "./memoryTransaction";

export const CANONICAL_STORAGE_SOURCE = "contests";
export const DERIVED_STORAGE_SOURCE = "c5_memory_history";

/**
 * Reconstrução determinística de H exclusivamente a partir da fonte canônica 'contests'
 */
export function reconstructHistoryFromCanonicalContests(
  contests: readonly ContestRecord[]
): MemoryHistory {
  // Filtra apenas concursos confirmados (FROZEN ou COMPLETED)
  const confirmed = contests.filter(
    c => c.algorithmVersion === "C5-Memory-2.0.0" && (c.status === "FROZEN" || c.status === "COMPLETED")
  );

  // Ordena por concurso crescente para garantir determinismo estrito
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
 * Auditoria de Integridade Cruzada entre a fonte canônica e o read-model derivado
 */
export async function verifyCrossStoreIntegrity(db: IDBDatabase): Promise<{
  readonly isValid: boolean;
  readonly canonicalRevision: number;
  readonly canonicalFingerprint: string;
  readonly derivedRevision?: number;
  readonly derivedFingerprint?: string;
  readonly error?: string;
}> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readonly");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    let allContests: ContestRecord[] = [];
    let derivedHistory: MemoryHistory | undefined = undefined;

    const reqC = contestStore.getAll();
    reqC.onsuccess = () => {
      allContests = reqC.result || [];
    };

    const reqH = historyStore.get("singleton");
    reqH.onsuccess = () => {
      derivedHistory = reqH.result?.history;
    };

    tx.oncomplete = () => {
      const canonicalH = reconstructHistoryFromCanonicalContests(allContests);

      if (!derivedHistory) {
        if (canonicalH.revision === 0) {
          resolve({
            isValid: true,
            canonicalRevision: 0,
            canonicalFingerprint: canonicalH.fingerprint,
          });
        } else {
          resolve({
            isValid: false,
            canonicalRevision: canonicalH.revision,
            canonicalFingerprint: canonicalH.fingerprint,
            error: "CROSS_STORE_DIVERGENCE: 'c5_memory_history' ausente enquanto existem concursos em 'contests'",
          });
        }
        return;
      }

      const revMatch = canonicalH.revision === derivedHistory.revision;
      const fpMatch = canonicalH.fingerprint === derivedHistory.fingerprint;
      const gamesCountMatch = canonicalH.games.length === derivedHistory.games.length;

      if (!revMatch || !fpMatch || !gamesCountMatch) {
        resolve({
          isValid: false,
          canonicalRevision: canonicalH.revision,
          canonicalFingerprint: canonicalH.fingerprint,
          derivedRevision: derivedHistory.revision,
          derivedFingerprint: derivedHistory.fingerprint,
          error: `CROSS_STORE_DIVERGENCE_DETECTED: Canônico (rev=${canonicalH.revision}, fp=${canonicalH.fingerprint.substring(0,8)}) != Derivado (rev=${derivedHistory.revision}, fp=${derivedHistory.fingerprint.substring(0,8)})`,
        });
      } else {
        resolve({
          isValid: true,
          canonicalRevision: canonicalH.revision,
          canonicalFingerprint: canonicalH.fingerprint,
          derivedRevision: derivedHistory.revision,
          derivedFingerprint: derivedHistory.fingerprint,
        });
      }
    };

    tx.onerror = () => reject(tx.error);
  });
}
