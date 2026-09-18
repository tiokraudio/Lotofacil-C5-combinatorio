import type { StorageOptions } from "./types.ts";

export const DEFAULT_DB_NAME = "c5-official-generator";
export const DB_VERSION = 1;
export const CONTEST_STORE_NAME = "contestRecords";

/**
 * Obtém a instância de IDBFactory disponível no ambiente ou via injeção.
 */
export function getIDBFactory(options?: StorageOptions): IDBFactory {
  if (options?.idbFactory) {
    return options.idbFactory;
  }
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  // Em ambiente de teste Node.js sem indexedDB global, tenta carregar fake-indexeddb dinamicamente
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fake = require("fake-indexeddb");
    return (fake.indexedDB || fake) as IDBFactory;
  } catch {
    throw new Error(
      "IndexedDB não disponível no ambiente atual. Forneça uma implementação via StorageOptions.idbFactory."
    );
  }
}

/**
 * Abre uma conexão com o IndexedDB do C₅.
 * Suporta migrações de versão incrementais (v1 -> v2 -> v3) sem apagar dados prévios.
 */
export function openDatabase(options?: StorageOptions): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = getIDBFactory(options);
    const dbName = options?.dbName ?? DEFAULT_DB_NAME;
    const request = factory.open(dbName, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Migração inicial para versão 1
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(CONTEST_STORE_NAME)) {
          const store = db.createObjectStore(CONTEST_STORE_NAME, {
            keyPath: "contestNumber",
          });

          store.createIndex("status", "status", { unique: false });
          store.createIndex("generatedAt", "generatedAt", { unique: false });
          store.createIndex("frozenAt", "frozenAt", { unique: false });
          store.createIndex("scoredAt", "scoredAt", { unique: false });
        }
      }

      // Preparado para migrações futuras:
      // if (oldVersion < 2) { ... }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        new Error(
          `Falha ao abrir o IndexedDB (${dbName}): ${request.error?.message || "Erro desconhecido"}`
        )
      );
    };

    request.onblocked = () => {
      console.warn(`Abertura do IndexedDB (${dbName}) bloqueada por outra conexão ativa.`);
    };
  });
}

/**
 * Encapsula uma requisição IDBRequest em Promise tipada.
 */
export function promisifyRequest<T = any>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Erro na requisição IndexedDB"));
  });
}

/**
 * Aguarda a conclusão definitiva de uma transação IndexedDB.
 */
export function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Erro na transação IndexedDB"));
    tx.onabort = () => reject(tx.error || new Error("Transação IndexedDB abortada"));
  });
}

/**
 * Fecha com segurança a conexão ativa com o banco de dados.
 */
export function closeDatabase(db: IDBDatabase): void {
  try {
    db.close();
  } catch (err) {
    console.warn("Erro ao fechar conexão com IndexedDB:", err);
  }
}
