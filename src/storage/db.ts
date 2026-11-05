/**
 * Camada de Persistência IndexedDB para Lotofácil C5-Memory
 */

import { ContestRecord, MemoryHistory, C5Game, ContestAuditEvent } from "../c5-memory/types";
import { createMemoryHistory } from "../c5-memory/history";

export const DB_NAME = "LotofacilC5DB";
export const DB_VERSION = 5;

export const STORE_CONTESTS = "contests";
export const STORE_MEMORY_HISTORY = "c5_memory_history";
export const STORE_AUDIT_EVENTS = "auditEvents";
export const STORE_OFFICIAL_DRAWS = "official_draws";

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não disponível no ambiente atual."));
      return;
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
      if (!db.objectStoreNames.contains(STORE_AUDIT_EVENTS)) {
        db.createObjectStore(STORE_AUDIT_EVENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_OFFICIAL_DRAWS)) {
        db.createObjectStore(STORE_OFFICIAL_DRAWS, { keyPath: "contestNumber" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllContestRecords(): Promise<ContestRecord[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONTESTS, "readonly");
      const store = tx.objectStore(STORE_CONTESTS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao ler IndexedDB, retornando memória vazia:", err);
    return [];
  }
}

export async function getContestRecord(contestNumber: number): Promise<ContestRecord | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONTESTS, "readonly");
      const store = tx.objectStore(STORE_CONTESTS);
      const request = store.get(contestNumber);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao buscar concurso:", err);
    return undefined;
  }
}

export async function saveContestRecord(record: ContestRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONTESTS, "readwrite");
    const store = tx.objectStore(STORE_CONTESTS);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredMemoryHistory(): Promise<MemoryHistory> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEMORY_HISTORY, "readonly");
      const store = tx.objectStore(STORE_MEMORY_HISTORY);
      const request = store.get("singleton");
      request.onsuccess = () => {
        if (request.result && request.result.history) {
          resolve(request.result.history);
        } else {
          resolve(createMemoryHistory([], 0));
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return createMemoryHistory([], 0);
  }
}

export async function saveStoredMemoryHistory(history: MemoryHistory): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEMORY_HISTORY, "readwrite");
    const store = tx.objectStore(STORE_MEMORY_HISTORY);
    const request = store.put({ id: "singleton", history });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAllAuditEvents(): Promise<ContestAuditEvent[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIT_EVENTS, "readonly");
      const store = tx.objectStore(STORE_AUDIT_EVENTS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao ler auditEvents:", err);
    return [];
  }
}

export async function saveAuditEvent(event: ContestAuditEvent): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIT_EVENTS, "readwrite");
    const store = tx.objectStore(STORE_AUDIT_EVENTS);
    const request = store.put(event);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export interface StoredOfficialDraw {
  readonly contestNumber: number;
  readonly drawDate: string;
  readonly drawnNumbers: readonly number[];
  readonly source: string;
  readonly retrievedAt: string;
  readonly rateio?: readonly any[];
}

export async function getAllStoredOfficialDraws(existingDb?: IDBDatabase): Promise<StoredOfficialDraw[]> {
  try {
    const db = existingDb || (await openDB());
    if (db?.objectStoreNames?.contains && !db.objectStoreNames.contains(STORE_OFFICIAL_DRAWS)) {
      return [];
    }
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_OFFICIAL_DRAWS, "readonly");
        const store = tx.objectStore(STORE_OFFICIAL_DRAWS);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      } catch {
        resolve([]);
      }
    });
  } catch {
    return [];
  }
}

export async function saveStoredOfficialDraws(
  draws: readonly StoredOfficialDraw[],
  existingDb?: IDBDatabase
): Promise<void> {
  if (!draws || draws.length === 0) return;
  const db = existingDb || (await openDB());
  if (db?.objectStoreNames?.contains && !db.objectStoreNames.contains(STORE_OFFICIAL_DRAWS)) {
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_OFFICIAL_DRAWS, "readwrite");
      const store = tx.objectStore(STORE_OFFICIAL_DRAWS);
      for (const draw of draws) {
        store.put(draw);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("TRANSACTION_ABORTED"));
    } catch (err) {
      reject(err);
    }
  });
}

export async function getStoredOfficialDraw(
  contestNumber: number,
  existingDb?: IDBDatabase
): Promise<StoredOfficialDraw | undefined> {
  try {
    const db = existingDb || (await openDB());
    if (db?.objectStoreNames?.contains && !db.objectStoreNames.contains(STORE_OFFICIAL_DRAWS)) {
      return undefined;
    }
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_OFFICIAL_DRAWS, "readonly");
        const store = tx.objectStore(STORE_OFFICIAL_DRAWS);
        const request = store.get(contestNumber);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  } catch {
    return undefined;
  }
}

export async function saveStoredOfficialDraw(
  draw: StoredOfficialDraw,
  existingDb?: IDBDatabase
): Promise<void> {
  return saveStoredOfficialDraws([draw], existingDb);
}


