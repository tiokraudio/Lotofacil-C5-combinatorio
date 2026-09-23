/**
 * V1.11 — Auditoria Oficial Pós-Score e Detecção de Divergências
 * Arquivo: src/sync/officialResultAudit.ts
 *
 * Princípio da V1.11:
 * Função pura de domínio que compara estritamente o officialResult histórico
 * persistido em um ContestRecord SCORED com as 15 dezenas do snapshot CAIXA
 * atualmente observado na sessão.
 */

import type { ContestRecord } from "../c5/types.ts";
import type { OfficialContestResult } from "../lottery/types.ts";
import { validateOfficialResult } from "../c5/scorer.ts";

export type OfficialResultAuditStatus =
  | "NOT_APPLICABLE"
  | "REFERENCE_UNAVAILABLE"
  | "MATCH"
  | "MISMATCH";

export interface OfficialResultAudit {
  status: OfficialResultAuditStatus;

  persistedResult?: readonly number[];
  currentOfficialResult?: readonly number[];

  addedNumbers?: readonly number[];
  removedNumbers?: readonly number[];

  persistedResultSource?: "HISTORICAL_SCORE";
  currentSource?: string;
  currentFetchedAt?: string;
}

/**
 * Função pura de domínio:
 * - Sem efeitos colaterais
 * - Sem acesso a storage / rede / coordinator
 * - Sem mutação de argumentos
 * - Retorna derivação determinística
 */
export function deriveOfficialResultAudit(
  record: ContestRecord | null | undefined,
  snapshot: OfficialContestResult | null | undefined
): OfficialResultAudit {
  // 1. Elegibilidade do Registro Local
  if (!record || record.status !== "SCORED") {
    return { status: "NOT_APPLICABLE" };
  }

  // 2. Validação do Histórico Local
  const localRawNumbers = record.officialResult ?? record.score?.result;
  let persistedSorted: number[];
  try {
    if (!localRawNumbers || !Array.isArray(localRawNumbers)) {
      return { status: "NOT_APPLICABLE" };
    }
    // Se officialResult estiver presente, deve ser rigorosamente válido
    if (record.officialResult) {
      validateOfficialResult(record.officialResult);
    }
    // Se score.result estiver presente, deve ser rigorosamente válido
    if (record.score?.result) {
      validateOfficialResult(record.score.result);
    }
    persistedSorted = validateOfficialResult(localRawNumbers);
    if (persistedSorted.length !== 15) {
      return { status: "NOT_APPLICABLE" };
    }
  } catch {
    return { status: "NOT_APPLICABLE" };
  }

  // 3. Validação da Identidade e Existência do Snapshot
  if (!snapshot || typeof snapshot !== "object") {
    return {
      status: "REFERENCE_UNAVAILABLE",
      persistedResult: persistedSorted,
      persistedResultSource: "HISTORICAL_SCORE",
    };
  }

  // Concurso divergente é REFERENCE_UNAVAILABLE (nunca MISMATCH)
  if (snapshot.contestNumber !== record.contestNumber) {
    return {
      status: "REFERENCE_UNAVAILABLE",
      persistedResult: persistedSorted,
      persistedResultSource: "HISTORICAL_SCORE",
    };
  }

  // 4. Validação das Dezenas do Snapshot Externo
  let currentSorted: number[];
  try {
    if (!snapshot.numbers || !Array.isArray(snapshot.numbers)) {
      return {
        status: "REFERENCE_UNAVAILABLE",
        persistedResult: persistedSorted,
        persistedResultSource: "HISTORICAL_SCORE",
      };
    }
    currentSorted = validateOfficialResult(snapshot.numbers);
    if (currentSorted.length !== 15) {
      return {
        status: "REFERENCE_UNAVAILABLE",
        persistedResult: persistedSorted,
        persistedResultSource: "HISTORICAL_SCORE",
      };
    }
  } catch {
    return {
      status: "REFERENCE_UNAVAILABLE",
      persistedResult: persistedSorted,
      persistedResultSource: "HISTORICAL_SCORE",
    };
  }

  // 5. Comparação Estrita Independente de Ordem Original
  const persistedSet = new Set(persistedSorted);
  const currentSet = new Set(currentSorted);

  const removedNumbers = persistedSorted.filter((n) => !currentSet.has(n));
  const addedNumbers = currentSorted.filter((n) => !persistedSet.has(n));

  if (removedNumbers.length === 0 && addedNumbers.length === 0) {
    return {
      status: "MATCH",
      persistedResult: persistedSorted,
      currentOfficialResult: currentSorted,
      addedNumbers: [],
      removedNumbers: [],
      persistedResultSource: "HISTORICAL_SCORE",
      currentSource: snapshot.source,
      currentFetchedAt: snapshot.fetchedAt,
    };
  }

  return {
    status: "MISMATCH",
    persistedResult: persistedSorted,
    currentOfficialResult: currentSorted,
    addedNumbers,
    removedNumbers,
    persistedResultSource: "HISTORICAL_SCORE",
    currentSource: snapshot.source,
    currentFetchedAt: snapshot.fetchedAt,
  };
}
