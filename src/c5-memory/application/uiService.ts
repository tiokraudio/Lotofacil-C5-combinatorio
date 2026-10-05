/**
 * Serviço de Integração UI da Application Layer (UI Boundary Service)
 * Ordem Executiva IC5
 * 
 * Fornece a fronteira única e exclusiva entre os componentes React e a Application Layer (service210).
 * Impede que a UI importe diretamente:
 * - Núcleo C5 matemático (structuralC5, engine210, math, pool, prng)
 * - Módulos de persistência interna (db, memoryTransaction, storageManager210)
 * - Analytics como entrada de seleção
 */

import { ContestRecord, MemoryHistory, C5Game } from "../types";
import {
  generateMemoryDraft210,
  confirmMemoryDraft210,
  discardMemoryDraft210,
  getMemoryOperationalState210,
  getMemoryAuditDetails210,
  scoreContestOperation210,
  OperationalStateDTO210,
  AuditDetailsDTO210,
} from "./service210";
import { Draft210 } from "../engine210";
import { buildC5Dashboard, buildC5MonthlyReport } from "../analytics/c5Analytics";

export type { Draft210, OperationalStateDTO210, AuditDetailsDTO210 };
export { buildC5Dashboard, buildC5MonthlyReport };

const DB_NAME = "LotofacilC5DB";
const DB_VERSION = 2;
const STORE_CONTESTS = "contests";
const STORE_MEMORY_HISTORY = "c5_memory_history";

let dbInstance: IDBDatabase | null = null;

export function openAppDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não disponível no ambiente atual."));
      return;
    }
    if (dbInstance) {
      try {
        // Testa se a conexão ainda está ativa
        dbInstance.transaction(STORE_CONTESTS, "readonly");
        resolve(dbInstance);
        return;
      } catch {
        dbInstance = null;
      }
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_CONTESTS)) {
        db.createObjectStore(STORE_CONTESTS, { keyPath: "contestNumber" });
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY_HISTORY)) {
        db.createObjectStore(STORE_MEMORY_HISTORY, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * 1. AVAILABLE -> PREVIEW
 * Gera um Draft 2.1.0 estrutural através da Application Layer homologada.
 */
export async function generateMemoryDraftUI(contestNumber: number): Promise<Draft210> {
  const db = await openAppDB();
  return generateMemoryDraft210(contestNumber, db);
}

/**
 * 2. PREVIEW -> FROZEN
 * Confirmação atômica através da Application Layer homologada.
 */
export async function confirmMemoryDraftUI(
  contestNumber: number,
  draft: Draft210
): Promise<ContestRecord> {
  const db = await openAppDB();
  return confirmMemoryDraft210(contestNumber, draft, db);
}

/**
 * 3. PREVIEW -> AVAILABLE
 * Descarte seguro da prévia com zero efeitos residuais.
 */
export async function discardMemoryDraftUI(contestNumber: number): Promise<void> {
  const db = await openAppDB();
  return discardMemoryDraft210(contestNumber, db);
}

/**
 * 4. Consulta do Estado Operacional
 * Reconstruído dinamicamente a partir da fonte canônica 'contests'.
 */
export async function getMemoryOperationalStateUI(
  contestNumber: number
): Promise<OperationalStateDTO210> {
  const db = await openAppDB();
  return getMemoryOperationalState210(contestNumber, db);
}

/**
 * 5. Detalhes de Auditoria Criptográfica
 * Estritamente read-only, sem efeitos colaterais no estado do banco.
 */
export async function getMemoryAuditDetailsUI(
  contestNumber: number
): Promise<AuditDetailsDTO210> {
  const db = await openAppDB();
  return getMemoryAuditDetails210(contestNumber, db);
}

/**
 * 6. FROZEN -> COMPLETED (Apuração Oficial)
 * Realizada estritamente através da operação atômica de scoring da Application Layer.
 */
export async function scoreContestOperationUI(
  contestNumber: number,
  officialResult: readonly number[]
): Promise<ContestRecord> {
  const db = await openAppDB();
  return scoreContestOperation210(contestNumber, officialResult, db);
}

/**
 * 7. Leitura Canônica de Todos os Concursos
 */
export async function getAllContestRecordsUI(): Promise<ContestRecord[]> {
  const db = await openAppDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 8. Inicialização Segura de Dados Demo (Histórico Legado 2.0.0)
 */
export async function initializeSeedDataUI(): Promise<void> {
  const db = await openAppDB();
  const existing = await getAllContestRecordsUI();
  if (existing.length > 0) return;

  const demoContests = [
    {
      contestNumber: 3501,
      contestDate: "2026-10-01",
      status: "COMPLETED" as const,
      games: [
        [1, 2, 4, 5, 7, 9, 11, 13, 14, 16, 18, 19, 21, 23, 25],
        [2, 3, 5, 6, 8, 10, 11, 12, 15, 17, 18, 20, 22, 24, 25],
        [1, 3, 4, 6, 7, 9, 10, 13, 15, 16, 17, 19, 21, 22, 24],
        [2, 4, 5, 8, 9, 11, 12, 14, 15, 18, 20, 21, 23, 24, 25],
        [1, 2, 3, 6, 7, 8, 10, 12, 13, 16, 17, 19, 20, 22, 25],
      ],
      officialResult: [1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 16, 18, 19, 21, 25],
    },
    {
      contestNumber: 3502,
      contestDate: "2026-10-02",
      status: "COMPLETED" as const,
      games: [
        [1, 3, 5, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 23, 25],
        [2, 4, 6, 7, 9, 11, 12, 14, 15, 17, 19, 21, 22, 24, 25],
        [1, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 25],
        [3, 4, 5, 7, 8, 10, 12, 13, 16, 18, 19, 21, 22, 24, 25],
        [1, 2, 5, 6, 8, 10, 11, 14, 15, 16, 19, 20, 21, 23, 24],
      ],
      officialResult: [1, 3, 5, 6, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 25],
    },
    {
      contestNumber: 3503,
      contestDate: "2026-10-03",
      status: "COMPLETED" as const,
      games: [
        [2, 3, 4, 6, 8, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24],
        [1, 4, 5, 7, 8, 10, 11, 13, 15, 17, 18, 20, 22, 24, 25],
        [2, 3, 5, 6, 9, 10, 12, 13, 15, 16, 18, 20, 21, 23, 25],
        [1, 2, 4, 7, 8, 10, 11, 14, 15, 17, 19, 21, 22, 23, 25],
        [3, 5, 6, 7, 9, 11, 12, 13, 16, 18, 19, 20, 22, 24, 25],
      ],
      officialResult: [2, 3, 4, 6, 8, 9, 11, 12, 14, 15, 16, 17, 19, 21, 23],
    },
    {
      contestNumber: 3504,
      contestDate: "2026-10-05",
      status: "COMPLETED" as const,
      games: [
        [1, 2, 3, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 25],
        [2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 24, 25],
        [1, 3, 4, 6, 7, 10, 11, 13, 14, 16, 18, 20, 21, 24, 25],
        [2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22, 23, 25],
        [1, 4, 5, 6, 8, 9, 11, 12, 15, 16, 18, 20, 22, 24, 25],
      ],
      officialResult: [1, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22, 25],
    },
  ];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readwrite");
    const store = tx.objectStore(STORE_CONTESTS);

    for (const c of demoContests) {
      const hits = c.games.map(g => g.filter(n => c.officialResult.includes(n)).length);
      const best = Math.max(...hits);
      const rec: ContestRecord = {
        contestNumber: c.contestNumber,
        contestDate: c.contestDate,
        status: c.status,
        algorithmVersion: "C5-Memory-2.0.0",
        games: c.games,
        officialResult: c.officialResult,
        gameHits: hits,
        bestHits: best,
        bestHitsCount: hits.filter(h => h === best).length,
        createdAt: `${c.contestDate}T10:00:00.000Z`,
        updatedAt: `${c.contestDate}T12:00:00.000Z`,
      };
      store.put(rec);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
