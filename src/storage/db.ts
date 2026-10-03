/**
 * Camada de Persistência IndexedDB para Lotofácil C5-Memory
 */

import { ContestRecord, MemoryHistory, C5Game } from "../c5-memory/types";
import { createMemoryHistory } from "../c5-memory/history";

const DB_NAME = "LotofacilC5DB";
const DB_VERSION = 2;

const STORE_CONTESTS = "contests";
const STORE_MEMORY_HISTORY = "c5_memory_history";

function openDB(): Promise<IDBDatabase> {
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
