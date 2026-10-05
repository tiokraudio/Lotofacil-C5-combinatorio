/**
 * Gerenciador de Backup, Disaster Recovery & Portabilidade (C5-Memory-2.1.0)
 * Ordem Executiva IC6
 * 
 * Regras Estritas:
 * 1. FONTE CANÔNICA DE VERDADE: Store 'contests'.
 * 2. READ-MODEL RECONSTRUÍVEL: Store 'c5_memory_history' é sempre reconstruído a partir de 'contests'.
 * 3. Validação Criptográfica: Todo FrozenPayload restaurado é verificado via SHA-256.
 * 4. Preservação Absoluta de Identidade de Versão: 2.0.0 permanece 2.0.0, 2.1.0 permanece 2.1.0.
 * 5. Rejeição Estrita de Corrupções e Versões Desconhecidas.
 */

import { ContestRecord, MemoryHistory, C5Game } from "../c5-memory/types";
import { formatGameCanonical } from "../c5-memory/history";
import { syncSha256 } from "../c5-memory/sha256";
import {
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  reconstructHistoryCrossVersion,
} from "./storageManager210";
import { ALGORITHM_VERSION_2_1_0 } from "../c5-memory/engine210";

export const BACKUP_FORMAT_VERSION = "c5-backup-v1.0" as const;
export const SUPPORTED_SCHEMA_VERSION = 2 as const;
export const RESTORE_EXISTING_DATABASE_POLICY = "REJECT_NON_EMPTY_WITHOUT_OVERWRITE_FLAG" as const;
export const UNKNOWN_ALGORITHM_VERSION_POLICY = "REJECT_UNKNOWN_ALGORITHM" as const;

export interface C5BackupPackage {
  readonly backupFormatVersion: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly canonicalSource: "contests";
  readonly contestsCount: number;
  readonly totalGamesCount: number;
  readonly contests: readonly ContestRecord[];
  readonly readModel?: {
    readonly c5_memory_history?: {
      readonly revision: number;
      readonly fingerprint: string;
      readonly gamesCount: number;
    };
  };
  readonly canonicalPayloadSha256: string;
}

export interface RestoreResult {
  readonly success: boolean;
  readonly restoredContestsCount: number;
  readonly restoredGamesCount: number;
  readonly reconstructedRevision: number;
  readonly reconstructedFingerprint: string;
  readonly errors: readonly string[];
}

/**
 * Normaliza e calcula o SHA-256 canônico dos contests para garantir invariância byte a byte.
 */
export function computeCanonicalPayloadSha256(contests: readonly ContestRecord[]): string {
  const sorted = [...contests].sort((a, b) => a.contestNumber - b.contestNumber);
  const normalized = sorted.map(c => {
    const gamesCanon = c.games.map(formatGameCanonical).join("|");
    const sha = c.frozenPayload?.sha256 || "";
    const result = c.officialResult ? c.officialResult.join(",") : "";
    return `${c.contestNumber}:${c.algorithmVersion}:${c.status}:${gamesCanon}:${sha}:${result}`;
  });
  return syncSha256(`C5-BACKUP-CANONICAL-PAYLOAD:${normalized.join("||")}`);
}

/**
 * Validação rigorosa e determinística da integridade de um pacote de backup.
 */
export function validateBackupPackage(pkg: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!pkg || typeof pkg !== "object") {
    return { valid: false, errors: ["BACKUP_NULL_OR_NOT_OBJECT: Pacote de backup inválido."] };
  }

  // 1. Verificação de versão de formato do backup
  if (pkg.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    errors.push(
      `UNKNOWN_FUTURE_BACKUP_VERSION: Versão de backup '${pkg.backupFormatVersion}' não é suportada (esperada '${BACKUP_FORMAT_VERSION}').`
    );
  }

  // 2. Verificação de versão de schema
  if (pkg.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(`UNSUPPORTED_SCHEMA_VERSION: Schema version ${pkg.schemaVersion} incompatível.`);
  }

  // 3. Verificação da fonte canônica
  if (pkg.canonicalSource !== "contests") {
    errors.push(`INVALID_CANONICAL_SOURCE: Fonte canônica '${pkg.canonicalSource}' deve ser 'contests'.`);
  }

  // 4. Verificação de presença e tipo de contests
  if (!Array.isArray(pkg.contests)) {
    errors.push("INVALID_CONTESTS_PAYLOAD: Lista de concursos ausente ou não é array.");
    return { valid: false, errors };
  }

  const seenContestNumbers = new Set<number>();
  let totalGames = 0;

  for (const c of pkg.contests) {
    if (typeof c.contestNumber !== "number" || c.contestNumber <= 0) {
      errors.push(`INVALID_CONTEST_NUMBER: Concurso com identificador inválido: ${c.contestNumber}`);
    } else {
      if (seenContestNumbers.has(c.contestNumber)) {
        errors.push(`BACKUP_DUPLICATE_CONTEST_NUMBER: Concurso ${c.contestNumber} duplicado no backup.`);
      }
      seenContestNumbers.add(c.contestNumber);
    }

    // Validação de algoritmo
    if (c.algorithmVersion !== "C5-Memory-2.0.0" && c.algorithmVersion !== ALGORITHM_VERSION_2_1_0) {
      errors.push(
        `UNKNOWN_ALGORITHM_VERSION: Concurso ${c.contestNumber} possui algoritmo desconhecido '${c.algorithmVersion}'.`
      );
    }

    // Validação de jogos
    if (!Array.isArray(c.games) || c.games.length !== 5) {
      errors.push(`INVALID_GAMES_CARDINALITY: Concurso ${c.contestNumber} deve possuir exatamente 5 jogos.`);
    } else {
      for (let gIdx = 0; gIdx < c.games.length; gIdx++) {
        const game = c.games[gIdx];
        if (!Array.isArray(game) || game.length !== 15) {
          errors.push(`INVALID_GAME_LENGTH: Jogo ${gIdx + 1} do concurso ${c.contestNumber} não possui 15 dezenas.`);
        } else {
          const unique = new Set(game);
          if (unique.size !== 15 || game.some((n: number) => n < 1 || n > 25)) {
            errors.push(`INVALID_GAME_NUMBERS: Jogo ${gIdx + 1} do concurso ${c.contestNumber} contém dezenas inválidas.`);
          }
        }
      }
      totalGames += c.games.length;
    }

    // Validação criptográfica de FrozenPayload
    if (c.status === "FROZEN" || c.status === "COMPLETED") {
      if (!c.frozenPayload) {
        errors.push(`MISSING_FROZEN_PAYLOAD: Concurso ${c.contestNumber} em status '${c.status}' sem frozenPayload.`);
      } else {
        const fp = c.frozenPayload;
        const gamesSerial = fp.games.map(formatGameCanonical).join("|");
        const computedSha = syncSha256(
          `C5-FROZEN:${fp.contestNumber}:${fp.poolIndex}:${fp.poolMasterSeed}:${fp.historyFingerprint}:${fp.historyRevision}:${gamesSerial}`
        );
        if (computedSha !== fp.sha256) {
          errors.push(
            `FROZEN_SHA_MISMATCH: SHA-256 corrompido no concurso ${c.contestNumber} (declarado ${fp.sha256}, computado ${computedSha}).`
          );
        }
      }
    }
  }

  // 5. Validação de hash do payload canônico
  const computedPayloadSha = computeCanonicalPayloadSha256(pkg.contests);
  if (pkg.canonicalPayloadSha256 && pkg.canonicalPayloadSha256 !== computedPayloadSha) {
    errors.push(
      `CANONICAL_PAYLOAD_SHA_MISMATCH: Hash do payload canônico divergente (esperado ${pkg.canonicalPayloadSha256}, computado ${computedPayloadSha}).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Exporta o estado persistente canônico completo para um pacote de backup auditável.
 */
export async function exportBackup(db: IDBDatabase): Promise<C5BackupPackage> {
  const contests = await new Promise<ContestRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const sortedContests = [...contests].sort((a, b) => a.contestNumber - b.contestNumber);
  const totalGamesCount = sortedContests.reduce((acc, c) => acc + (c.games ? c.games.length : 0), 0);
  const canonicalPayloadSha256 = computeCanonicalPayloadSha256(sortedContests);

  const history = reconstructHistoryCrossVersion(sortedContests);

  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    canonicalSource: "contests",
    contestsCount: sortedContests.length,
    totalGamesCount,
    contests: sortedContests,
    readModel: {
      c5_memory_history: {
        revision: history.revision,
        fingerprint: history.fingerprint,
        gamesCount: history.games.length,
      },
    },
    canonicalPayloadSha256,
  };
}

/**
 * Restaura o estado persistente a partir de um pacote de backup em transação atômica multi-store.
 * Sempre reconstrói c5_memory_history a partir da autoridade de 'contests'.
 */
export async function restoreBackup(
  pkg: C5BackupPackage,
  db: IDBDatabase,
  options: { overwrite?: boolean } = {}
): Promise<RestoreResult> {
  // 1. Validação estrutural e criptográfica completa do pacote antes de qualquer escrita
  const validation = validateBackupPackage(pkg);
  if (!validation.valid) {
    return {
      success: false,
      restoredContestsCount: 0,
      restoredGamesCount: 0,
      reconstructedRevision: 0,
      reconstructedFingerprint: "",
      errors: validation.errors,
    };
  }

  // 2. Política de banco não vazio
  const existingCount = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (existingCount > 0 && !options.overwrite) {
    return {
      success: false,
      restoredContestsCount: 0,
      restoredGamesCount: 0,
      reconstructedRevision: 0,
      reconstructedFingerprint: "",
      errors: [
        `RESTORE_EXISTING_DATABASE_POLICY: O banco contém ${existingCount} concursos e overwrite=false. Restore abortado.`,
      ],
    };
  }

  // 3. Ordenação canônica estrita por contestNumber
  const canonicalOrderedContests = [...pkg.contests].sort((a, b) => a.contestNumber - b.contestNumber);

  // 4. Reconstrução determinística do Read-Model H a partir dos contests
  const reconstructedHistory = reconstructHistoryCrossVersion(canonicalOrderedContests);

  // 5. Execução em Transação Atômica Multi-Store (commit total ou rollback total)
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readwrite");
      const contestStore = tx.objectStore(STORE_CONTESTS);
      const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

      // Limpa dados anteriores se overwrite for true
      if (options.overwrite && existingCount > 0) {
        contestStore.clear();
        historyStore.clear();
      }

      // Insere cada contest
      for (const c of canonicalOrderedContests) {
        contestStore.put(c);
      }

      // Persiste o read-model derivado
      historyStore.put({
        id: "singleton",
        history: reconstructedHistory,
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error("TRANSACTION_ABORTED: A transação de restore foi abortada."));
    });

    return {
      success: true,
      restoredContestsCount: canonicalOrderedContests.length,
      restoredGamesCount: canonicalOrderedContests.reduce((acc, c) => acc + c.games.length, 0),
      reconstructedRevision: reconstructedHistory.revision,
      reconstructedFingerprint: reconstructedHistory.fingerprint,
      errors: [],
    };
  } catch (err: any) {
    return {
      success: false,
      restoredContestsCount: 0,
      restoredGamesCount: 0,
      reconstructedRevision: 0,
      reconstructedFingerprint: "",
      errors: [`ATOMIC_RESTORE_FAILED: ${err.message}`],
    };
  }
}
