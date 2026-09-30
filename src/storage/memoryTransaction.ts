/**
 * Fronteira Transacional Atômica, OCC e Proteção Anti-TOCTOU para C5-Memory-2.0.0 (IC7)
 *
 * Implementa integralmente os requisitos de persistência atômica:
 * - VALIDATE + WRITE = ONE STORAGE TRANSACTION
 * - Leitura, validação de revision e fingerprint, persistência e avanço de histórico ocorrem
 *   dentro da mesma e única transação readwrite do IndexedDB.
 * - OCC estrito: expectedHistoryRevision === currentHistoryRevision && expectedHistoryFingerprint === currentHistoryFingerprint.
 * - Divergência resulta em STALE_REVISION_REJECTED imediato e abort da transação (zero efeitos colaterais).
 * - Fonte canônica única: store 'contestRecords' do IndexedDB oficial.
 * - Suporta coexistência com registros legados V1.13 sem regravação retroativa.
 */

import {
  openDatabase,
  closeDatabase,
  promisifyRequest,
  CONTEST_STORE_NAME,
} from "./db.ts";
import { deepCloneRecord } from "./contestRepository.ts";
import {
  buildHistoryFromRecords,
  computeHistoryFingerprint,
} from "../c5-memory/history.ts";
import {
  StaleRevisionRejectedError,
  STALE_REVISION_REJECTED,
  type C5MemoryDraft,
} from "../c5-memory/draft.ts";
import {
  buildCanonicalPayload,
  serializeCanonicalPayload,
} from "../c5/integrity.ts";
import { sha256 } from "../c5-memory/sha256.ts";
import type { ContestRecord, C5Generation, FrozenMemoryPayload } from "../c5/types.ts";
import type { StorageOptions } from "./types.ts";

export interface ConfirmMemoryBetParams {
  contestNumber: number;
  draft: C5MemoryDraft;
  clock?: () => Date;
  options?: StorageOptions;
  db?: IDBDatabase;
  simulateCommitFailure?: boolean;
}

export interface AtomicConfirmationResult {
  record: ContestRecord;
  previousRevision: number;
  newRevision: number;
  previousFingerprint: string;
  newFingerprint: string;
}

/**
 * Lê o estado histórico corrente (H, revision, fingerprint) diretamente do IndexedDB.
 */
export async function getMemoryHistoryState(
  options?: StorageOptions,
  dbInstance?: IDBDatabase
): Promise<{
  historyRevision: number;
  historyFingerprint: string;
  H: number[][];
  recordsCount: number;
  eligibleCount: number;
}> {
  const db = dbInstance ?? (await openDatabase(options));
  try {
    const tx = db.transaction(CONTEST_STORE_NAME, "readonly");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const allRecords: ContestRecord[] = await promisifyRequest(store.getAll());

    const eligibleRecords = allRecords.filter(
      (r) =>
        r &&
        r.status !== "DRAFT" &&
        ((typeof r.betPlacedAt === "string" && r.betPlacedAt.trim().length > 0) ||
          (r.betPlacedAt === undefined && (r.status === "FROZEN" || r.status === "SCORED")))
    );

    const H: number[][] = buildHistoryFromRecords(allRecords).map((g) => [...g]);
    const historyRevision = eligibleRecords.length;
    const historyFingerprint = computeHistoryFingerprint(H);

    return {
      historyRevision,
      historyFingerprint,
      H,
      recordsCount: allRecords.length,
      eligibleCount: eligibleRecords.length,
    };
  } finally {
    if (!dbInstance) {
      closeDatabase(db);
    }
  }
}

/**
 * Executa a confirmação de uma aposta C5-Memory em UMA ÚNICA TRANSAÇÃO ATÔMICA IndexedDB.
 *
 * Sequência executada integralmente no escopo exclusivo da transação:
 * 1. Obtenção de todos os registros do store canônico 'contestRecords';
 * 2. Cômputo do histórico H corrente e de sua revision e fingerprint de forma síncrona;
 * 3. Validação OCC contra o Draft (expectedRevision e expectedFingerprint);
 * 4. Verificação de inexistência de colisão com aposta confirmada prévia para o concurso;
 * 5. Persistência do registro com betPlacedAt e status FROZEN sem microtask gaps;
 * 6. Commit definitivo com rollback integral se qualquer asserção falhar.
 */
export async function confirmMemoryBetAtomic(
  params: ConfirmMemoryBetParams
): Promise<AtomicConfirmationResult> {
  const {
    contestNumber,
    draft,
    clock = () => new Date(),
    options,
    db: externalDb,
    simulateCommitFailure,
  } = params;

  if (typeof contestNumber !== "number" || contestNumber <= 0 || !Number.isInteger(contestNumber)) {
    throw new Error(`Número de concurso inválido: ${contestNumber}`);
  }
  if (!draft || draft.algorithmVersion !== "C5-Memory-2.0.0") {
    throw new Error("Draft inválido para confirmação C5-Memory.");
  }

  const db = externalDb ?? (await openDatabase(options));
  try {
    return await new Promise<AtomicConfirmationResult>((resolve, reject) => {
      let settled = false;
      const safeReject = (err: any) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      let resultHolder: AtomicConfirmationResult | null = null;

      tx.onabort = () => {
        if (!settled) {
          settled = true;
          reject(tx.error || new Error("Transação IndexedDB abortada."));
        }
      };

      tx.onerror = () => {
        if (!settled) {
          settled = true;
          reject(tx.error || new Error("Erro na transação IndexedDB."));
        }
      };

      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          if (resultHolder) {
            resolve(resultHolder);
          } else {
            reject(new Error("Transação completada sem resultado gerado."));
          }
        }
      };

      // 1. LEITURA ATÔMICA DO ESTADO CORRENTE
      const readRequest = store.getAll();

      readRequest.onerror = () => {
        safeReject(readRequest.error || new Error("Erro ao ler registros do IndexedDB."));
      };

      readRequest.onsuccess = () => {
        try {
          const allRecords: ContestRecord[] = readRequest.result || [];

          // 2. OBTENÇÃO DA REVISÃO E FINGERPRINT DENTRO DA TRANSAÇÃO
          const eligibleRecords = allRecords.filter(
            (r) =>
              r &&
              r.status !== "DRAFT" &&
              ((typeof r.betPlacedAt === "string" && r.betPlacedAt.trim().length > 0) ||
                (r.betPlacedAt === undefined && (r.status === "FROZEN" || r.status === "SCORED")))
          );
          const H = buildHistoryFromRecords(allRecords);
          const currentHistoryRevision = eligibleRecords.length;
          const currentHistoryFingerprint = computeHistoryFingerprint(H);

          // 3. VALIDAÇÃO OCC (REVISION + FINGERPRINT)
          const expectedRev = draft.expectedHistoryRevision ?? draft.draftHistoryRevision;
          const expectedFp = draft.expectedHistoryFingerprint ?? draft.draftHistoryFingerprint;

          const revisionMatches = expectedRev === currentHistoryRevision;
          const fingerprintMatches = expectedFp === currentHistoryFingerprint;

          if (!revisionMatches || !fingerprintMatches) {
            const staleErr = new StaleRevisionRejectedError(
              expectedRev,
              currentHistoryRevision,
              expectedFp,
              currentHistoryFingerprint,
              `STALE_REVISION_REJECTED: Divergência detectada dentro da transação atômica (esperado: rev=${expectedRev}, fp=${expectedFp}; atual: rev=${currentHistoryRevision}, fp=${currentHistoryFingerprint})`
            );
            safeReject(staleErr);
            tx.abort();
            return;
          }

          // 4. VERIFICAÇÃO DE IDEMPOTÊNCIA E COLISÃO
          const existing = allRecords.find((r) => r.contestNumber === contestNumber);
          if (existing && existing.status !== "DRAFT") {
            const collisionErr = new Error(
              `Colisão: Concurso ${contestNumber} já possui registro em estado '${existing.status}'. Confirmação duplicada rejeitada.`
            );
            safeReject(collisionErr);
            tx.abort();
            return;
          }

          // 5. PREPARAÇÃO DO REGISTRO CONFIRMADO
          const nowIso = clock().toISOString();
          const generationId = `c5m-${contestNumber}-${draft.poolMasterSeed}-${draft.poolIndex}`;

          const generation: C5Generation = {
            permutation: [],
            slotAssignments: {},
            games: [
              [...draft.selectedC5[0]],
              [...draft.selectedC5[1]],
              [...draft.selectedC5[2]],
              [...draft.selectedC5[3]],
              [...draft.selectedC5[4]],
            ],
          };

          const draftCreatedTime = draft.createdAt ? new Date(draft.createdAt).getTime() : NaN;
          const nowTime = new Date(nowIso).getTime();
          const effectiveGeneratedAt = (!isNaN(draftCreatedTime) && draftCreatedTime <= nowTime) ? draft.createdAt : nowIso;

          const canonicalPayload = buildCanonicalPayload(
            contestNumber,
            generationId,
            draft.algorithmVersion,
            effectiveGeneratedAt,
            nowIso,
            generation
          );
          const serialized = serializeCanonicalPayload(canonicalPayload);
          // Cálculo síncrono puro de SHA-256 para preservar a transação ativa sem microtask gaps
          const integrityHash = sha256(serialized);

          const memoryPayload: FrozenMemoryPayload = {
            algorithmVersion: draft.algorithmVersion,
            poolMasterSeed: draft.poolMasterSeed,
            poolIndex: draft.poolIndex,
            selectedC5: [
              [...draft.selectedC5[0]],
              [...draft.selectedC5[1]],
              [...draft.selectedC5[2]],
              [...draft.selectedC5[3]],
              [...draft.selectedC5[4]],
            ],
            historyRevision: draft.expectedHistoryRevision ?? draft.draftHistoryRevision,
            historyFingerprint: draft.expectedHistoryFingerprint ?? draft.draftHistoryFingerprint,
            winnerHistogram: [...draft.winnerHistogram],
            confirmedRevision: currentHistoryRevision + 1,
            confirmedAt: nowIso,
          };

          const confirmedRecord: ContestRecord = {
            status: "FROZEN",
            contestNumber,
            generationId,
            algorithmVersion: draft.algorithmVersion,
            generatedAt: effectiveGeneratedAt,
            frozenAt: nowIso,
            betPlacedAt: nowIso,
            generation,
            integrityHash,
            memoryPayload,
          };

          // 6. SIMULAÇÃO DE FALHA INJETADA (SE ATIVADA)
          if (simulateCommitFailure) {
            const injectedErr = new Error("Falha injetada simulada antes da conclusão do commit.");
            safeReject(injectedErr);
            tx.abort();
            return;
          }

          // 7. GRAVAÇÃO NO OBJECT STORE (EXECUTADA IMEDIATAMENTE)
          const clone = deepCloneRecord(confirmedRecord);
          store.put(clone);

          // 8. RESULTADO PÓS-COMMIT
          const newH = [...H, ...draft.selectedC5.map((g) => [...g])];
          const newFingerprint = computeHistoryFingerprint(newH);
          const newRevision = currentHistoryRevision + 1;

          resultHolder = {
            record: deepCloneRecord(clone),
            previousRevision: currentHistoryRevision,
            newRevision,
            previousFingerprint: currentHistoryFingerprint,
            newFingerprint,
          };
        } catch (innerErr) {
          safeReject(innerErr);
          try {
            tx.abort();
          } catch {}
        }
      };
    });
  } finally {
    if (!externalDb) {
      closeDatabase(db);
    }
  }
}
