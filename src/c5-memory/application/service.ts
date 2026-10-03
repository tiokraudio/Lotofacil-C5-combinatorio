/**
 * Camada de Aplicação Canônica C5-Memory (Application Layer)
 * 
 * Fronteira arquitetural obrigatória entre a UI e o Core Matemático / Storage.
 * A UI não chama diretamente o núcleo matemático nem a transação de storage.
 */

import { Draft, ContestRecord, MemoryHistory } from "../types";
import { generateC5Draft } from "../draft";
import { syncSha256 } from "../sha256";
import { formatGameCanonical } from "../history";
import { getContestRecord, getStoredMemoryHistory, saveContestRecord } from "../../storage/db";
import { confirmMemoryBetAtomic } from "../../storage/memoryTransaction";
import { OperationalStateDTO, AuditDetailsDTO } from "./types";

/**
 * Gera um Draft de aposta C5-Memory para o concurso alvo
 * Regras:
 * - Rejeita auto-geração se o concurso já estiver FROZEN ou COMPLETED.
 * - Avalia K=500 candidatos com critério MAX-LEXIMIN e Hard Block anti-duplicação.
 * - Registra o draft em estado PREVIEW.
 */
export async function generateMemoryDraft(contestNumber: number): Promise<Draft> {
  const existingRecord = await getContestRecord(contestNumber);
  if (existingRecord && (existingRecord.status === "FROZEN" || existingRecord.status === "COMPLETED")) {
    throw new Error(`CONTEST_ALREADY_LOCKED: Concurso ${contestNumber} já está no estado ${existingRecord.status}`);
  }

  const history: MemoryHistory = await getStoredMemoryHistory();
  const draft = generateC5Draft(contestNumber, history);

  const previewRecord: ContestRecord = {
    contestNumber,
    contestDate: existingRecord?.contestDate || new Date().toISOString().split("T")[0],
    status: "PREVIEW",
    algorithmVersion: "C5-Memory-2.0.0",
    games: draft.games,
    draft,
    createdAt: existingRecord?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveContestRecord(previewRecord);
  return draft;
}

/**
 * Confirma e congela a aposta atomicamente no IndexedDB
 * Aciona confirmMemoryBetAtomic com OCC por revision e historyFingerprint e Hard Block.
 */
export async function confirmMemoryDraft(
  contestNumber: number,
  draft: Draft
): Promise<ContestRecord> {
  const result = await confirmMemoryBetAtomic(
    contestNumber,
    draft,
    draft.historyRevision,
    draft.historyFingerprint
  );
  return result.record;
}

/**
 * Descarta a prévia sem modificar o histórico H
 */
export async function discardMemoryDraft(contestNumber: number): Promise<void> {
  const existingRecord = await getContestRecord(contestNumber);
  if (existingRecord && existingRecord.status === "PREVIEW") {
    const availableRecord: ContestRecord = {
      contestNumber,
      contestDate: existingRecord.contestDate,
      status: "AVAILABLE",
      algorithmVersion: "C5-Memory-2.0.0",
      games: [],
      createdAt: existingRecord.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await saveContestRecord(availableRecord);
  }
}

/**
 * Obtém o estado operacional completo para o concurso
 */
export async function getMemoryOperationalState(contestNumber: number): Promise<OperationalStateDTO> {
  const record = await getContestRecord(contestNumber);
  const history = await getStoredMemoryHistory();

  return {
    contestNumber,
    status: record?.status || "AVAILABLE",
    games: record?.games || [],
    draft: record?.draft,
    frozenPayload: record?.frozenPayload,
    historyRevision: history.revision,
    historyFingerprint: history.fingerprint,
    officialResult: record?.officialResult,
    gameHits: record?.gameHits,
    bestHits: record?.bestHits,
  };
}

/**
 * Obtém os detalhes auditáveis criptograficamente verificados de um concurso
 */
export async function getMemoryAuditDetails(contestNumber: number): Promise<AuditDetailsDTO> {
  const record = await getContestRecord(contestNumber);
  if (!record || !record.frozenPayload) {
    return {
      contestNumber,
      algorithmVersion: record?.algorithmVersion || "C5-Memory-2.0.0",
      status: record?.status || "AVAILABLE",
      isCryptographicallyValid: false,
    };
  }

  const payload = record.frozenPayload;
  const gamesSerial = payload.games.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${payload.contestNumber}:${payload.poolIndex}:${payload.poolMasterSeed}:${payload.historyFingerprint}:${payload.historyRevision}:${gamesSerial}`;
  const computedSha256 = syncSha256(payloadToHash);
  const isValid = computedSha256 === payload.sha256;

  return {
    contestNumber,
    algorithmVersion: record.algorithmVersion,
    status: record.status,
    poolIndex: payload.poolIndex,
    poolMasterSeed: payload.poolMasterSeed,
    historyFingerprint: payload.historyFingerprint,
    historyRevision: payload.historyRevision,
    sha256: payload.sha256,
    frozenAt: payload.frozenAt,
    isCryptographicallyValid: isValid,
    computedSha256,
  };
}
