/**
 * Camada de Aplicação Canônica C5-Memory-2.1.0 (Application Boundary)
 * Ordem Executiva IC4
 * 
 * Responsabilidade Única:
 * Fronteira operacional exclusiva entre a UI e os motores matemáticos/storage.
 * Encapsula completamente:
 * - Geração e seleção de pool K=500
 * - PRNG e Structural C5
 * - Derivação de seeds e fingerprints
 * - Transação atômica multi-store
 * - Reconstrução do estado operacional a partir da fonte canônica ('contests')
 */

import { ContestRecord, ContestStatus, C5Game } from "../types";
import {
  Draft210,
  FrozenMemoryPayload210,
  generateC5Draft210,
  ALGORITHM_VERSION_2_1_0
} from "../engine210";
import {
  Draft30,
  FrozenMemoryPayload30,
  generateC5Draft30,
  ALGORITHM_VERSION_3_0_0,
} from "../engine30";
import {
  getAllOfficialLotofacilDraws,
  fetchLatestOfficialLotofacilContest,
  setVerifiedLatestOfficialReference,
  syncMissingOfficialDraws,
} from "../officialDraws";
import { formatGameCanonical } from "../history";
import { isValidLotofacilGame } from "../math";
import { syncSha256 } from "../sha256";
import {
  STORE_CONTESTS,
  reconstructHistoryCrossVersion,
  confirmMemoryBetAtomic210,
  scoreContestAtomic210,
  ScoreContestOptions,
  validateOfficialLotofacilResult,
} from "../../storage/storageManager210";

export { validateOfficialLotofacilResult };

export interface OperationalStateDTO210 {
  readonly contestNumber: number;
  readonly status: ContestStatus;
  readonly algorithmVersion: string;
  readonly games: readonly C5Game[];
  readonly draft?: Draft30 | Draft210;
  readonly frozenPayload?: FrozenMemoryPayload30 | FrozenMemoryPayload210;
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly officialResult?: readonly number[];
  readonly gameHits?: readonly number[];
  readonly bestHits?: number;
  readonly bestHitsCount?: number;
}

export interface AuditDetailsDTO210 {
  readonly contestNumber: number;
  readonly algorithmVersion: string;
  readonly status: ContestStatus;
  readonly poolIndex?: number;
  readonly poolMasterSeed?: string;
  readonly historyFingerprint?: string;
  readonly historyRevision?: number;
  readonly sha256?: string;
  readonly frozenAt?: string;
  readonly isCryptographicallyValid: boolean;
  readonly computedSha256?: string;
}

/**
 * Helper para leitura de concursos do IndexedDB
 */
function getContestFromStore(db: IDBDatabase, contestNumber: number): Promise<ContestRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.get(contestNumber);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllContestsFromStore(db: IDBDatabase): Promise<ContestRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function saveContestToStore(db: IDBDatabase, record: ContestRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readwrite");
    const store = tx.objectStore(STORE_CONTESTS);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 1. AVAILABLE -> PREVIEW: Gera explicitamente um Draft C5-Memory 3.0 estrutural
 * Invariantes:
 * - Exatamente 5 jogos por operação;
 * - Rejeição estrita de qualquer duplicata contra sorteios oficiais e jogos gerados anteriores;
 * - Uso dos concursos oficiais anteriores como histórico de comparação quando H estiver vazio.
 */
export interface GenerateDraftOptions {
  readonly customFetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly skipDynamicVerification?: boolean;
}

/**
 * 1. AVAILABLE -> PREVIEW: Geração de Prévia C5-Memory 3.0
 * 
 * Antes de gerar o draft, sincroniza automaticamente concursos ausentes na fonte oficial da Caixa.
 * Compara candidatos contra Base A (todos os resultados oficiais) e Base B (todos os jogos registrados do usuário).
 * Se a consulta falhar ou exceder o timeout, preserva a geração offline com status UNVERIFIED_OFFLINE (sem selo de cobertura integral).
 */
export async function generateMemoryDraft210(
  contestNumber: number,
  db: IDBDatabase,
  options?: GenerateDraftOptions
): Promise<Draft30> {
  const existing = await getContestFromStore(db, contestNumber);
  if (existing && (existing.status === "FROZEN" || existing.status === "COMPLETED")) {
    throw new Error(`CONTEST_ALREADY_LOCKED: Concurso ${contestNumber} já está no estado ${existing.status}`);
  }

  // 1. Sincronização automática incremental com a fonte oficial da Caixa antes de gerar
  if (!options?.skipDynamicVerification) {
    try {
      await syncMissingOfficialDraws(
        db,
        options?.customFetch,
        options?.timeoutMs ?? 4000
      );
    } catch {
      // Falha de rede ou timeout: preserva o modo offline com status UNVERIFIED_OFFLINE
      setVerifiedLatestOfficialReference(null);
    }
  }

  // Carrega histórico canônico a partir dos concursos confirmados no banco
  const allContests = await getAllContestsFromStore(db);
  const canonicalHistory = reconstructHistoryCrossVersion(allContests);
  const officialDraws = getAllOfficialLotofacilDraws(allContests);

  // Extrai todos os jogos já registrados pelo usuário em qualquer concurso (Base B completa)
  const allUserGamesMap = new Map<string, C5Game>();
  for (const c of allContests) {
    if (Array.isArray(c.games)) {
      for (const g of c.games) {
        if (isValidLotofacilGame(g)) {
          allUserGamesMap.set(formatGameCanonical(g), g);
        }
      }
    }
    if (c.draft && Array.isArray(c.draft.games)) {
      for (const g of c.draft.games) {
        if (isValidLotofacilGame(g)) {
          allUserGamesMap.set(formatGameCanonical(g), g);
        }
      }
    }
  }
  const allUserRegisteredGames = Array.from(allUserGamesMap.values());

  // Gera aposta Structural C5 via motor 3.0 (utilizando Base A de oficiais e Base B completa do usuário)
  const draft = generateC5Draft30(
    contestNumber,
    canonicalHistory,
    officialDraws,
    undefined,
    allUserRegisteredGames
  );

  // Grava exclusivamente o draft em status PREVIEW no store 'contests'
  const previewRecord: ContestRecord = {
    contestNumber,
    contestDate: existing?.contestDate || new Date().toISOString().split("T")[0],
    status: "PREVIEW",
    algorithmVersion: ALGORITHM_VERSION_3_0_0,
    games: draft.games,
    draft,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveContestToStore(db, previewRecord);
  return draft;
}

export const generateMemoryDraft30 = generateMemoryDraft210;

/**
 * 2. PREVIEW -> FROZEN: Confirmação Atômica
 * Valida e congela o draft C5-Memory 3.0 (ou 2.1.0 legado) com integridade criptográfica SHA-256.
 */
export async function confirmMemoryDraft210(
  contestNumber: number,
  draft: Draft30 | Draft210,
  db: IDBDatabase
): Promise<ContestRecord> {
  const result = await confirmMemoryBetAtomic210(
    db,
    contestNumber,
    draft,
    draft.historyRevision,
    draft.historyFingerprint
  );
  return result.record;
}

export const confirmMemoryDraft30 = confirmMemoryDraft210;

/**
 * 3. PREVIEW -> AVAILABLE: Descarte de Prévia
 * Reverte o concurso para AVAILABLE com zero resíduos e zero alterações no histórico.
 */
export async function discardMemoryDraft210(
  contestNumber: number,
  db: IDBDatabase
): Promise<void> {
  const existing = await getContestFromStore(db, contestNumber);
  if (existing && existing.status === "PREVIEW") {
    const availableRecord: ContestRecord = {
      contestNumber,
      contestDate: existing.contestDate,
      status: "AVAILABLE",
      algorithmVersion: ALGORITHM_VERSION_2_1_0 as any,
      games: [],
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await saveContestToStore(db, availableRecord);
  }
}

/**
 * 4. Consulta do Estado Operacional
 * Derivado rigorosamente da fonte canônica 'contests'.
 */
export async function getMemoryOperationalState210(
  contestNumber: number,
  db: IDBDatabase
): Promise<OperationalStateDTO210> {
  const allContests = await getAllContestsFromStore(db);
  const record = allContests.find(c => c.contestNumber === contestNumber);
  const canonicalHistory = reconstructHistoryCrossVersion(allContests);

  return {
    contestNumber,
    status: record?.status || "AVAILABLE",
    algorithmVersion: record?.algorithmVersion || ALGORITHM_VERSION_3_0_0,
    games: record?.games || [],
    draft: record?.draft as any,
    frozenPayload: record?.frozenPayload as any,
    historyRevision: canonicalHistory.revision,
    historyFingerprint: canonicalHistory.fingerprint,
    officialResult: record?.officialResult,
    gameHits: record?.gameHits,
    bestHits: record?.bestHits,
    bestHitsCount: record?.bestHitsCount,
  };
}

/**
 * 5. Detalhes de Auditoria Criptográfica
 * Estritamente READ-ONLY (nenhuma mutação de banco ou estado).
 */
export async function getMemoryAuditDetails210(
  contestNumber: number,
  db: IDBDatabase
): Promise<AuditDetailsDTO210> {
  const record = await getContestFromStore(db, contestNumber);
  if (!record || !record.frozenPayload) {
    return {
      contestNumber,
      algorithmVersion: record?.algorithmVersion || ALGORITHM_VERSION_3_0_0,
      status: record?.status || "AVAILABLE",
      isCryptographicallyValid: false,
    };
  }

  const fp = record.frozenPayload as FrozenMemoryPayload210;
  const gamesSerial = fp.games.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${fp.contestNumber}:${fp.poolIndex}:${fp.poolMasterSeed}:${fp.historyFingerprint}:${fp.historyRevision}:${gamesSerial}`;
  const computedSha256 = syncSha256(payloadToHash);
  const isValid = computedSha256 === fp.sha256;

  return {
    contestNumber,
    algorithmVersion: record.algorithmVersion,
    status: record.status,
    poolIndex: fp.poolIndex,
    poolMasterSeed: fp.poolMasterSeed,
    historyFingerprint: fp.historyFingerprint,
    historyRevision: fp.historyRevision,
    sha256: fp.sha256,
    frozenAt: fp.frozenAt,
    isCryptographicallyValid: isValid,
    computedSha256,
  };
}

/**
 * 6. FROZEN -> COMPLETED: Apuração Oficial da Aposta
 */
export async function scoreContestOperation210(
  contestNumber: number,
  officialResult: readonly number[],
  db: IDBDatabase,
  options?: ScoreContestOptions
): Promise<ContestRecord> {
  return scoreContestAtomic210(db, contestNumber, officialResult, options);
}

// Aliases padronizados da Application Boundary
export const generateMemoryDraft = generateMemoryDraft210;
export const confirmMemoryDraft = confirmMemoryDraft210;
export const discardMemoryDraft = discardMemoryDraft210;
export const getMemoryOperationalState = getMemoryOperationalState210;
export const getMemoryAuditDetails = getMemoryAuditDetails210;
export const scoreContestOperation = scoreContestOperation210;
