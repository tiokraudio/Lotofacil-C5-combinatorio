/**
 * Funções Puras Auxiliares para Reconciliação com a CAIXA (v1.4.0)
 * 
 * Centraliza:
 * - Resolução determinística do targetContest (input explícito ou último oficial da CAIXA)
 * - Deduplicação estrita de itens reconciliados baseada exclusivamente em targetContest
 * - Geração de feedback canônico sem risco de apresentar 'null', 'undefined' ou 'NaN'
 */

import type { ReconciledContestItem } from "../components/ReconciliationSection.tsx";
import type { ReconciliationStatus } from "./operationalState.ts";

export type { ReconciledContestItem };

/**
 * Resolve o concurso alvo da reconciliação.
 * Se o usuário digitou um número válido, usa-o.
 * Caso contrário, se o provider retornou o número do último concurso apurado, usa-o.
 */
export function resolveTargetContest(
  input: string | null | undefined,
  latestContestNumber?: number | null
): number | null {
  if (input && input.trim()) {
    const parsed = parseInt(input.trim(), 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (typeof latestContestNumber === "number" && !isNaN(latestContestNumber) && latestContestNumber > 0) {
    return latestContestNumber;
  }
  return null;
}

/**
 * Valida o concurso retornado pela fonte externa contra o concurso alvo.
 * - Se targetContestRequested foi especificado (input não-vazio), exige correspondência exata.
 *   Em caso de divergência, lança erro explícito:
 *   "O resultado consultado pertence ao concurso <externo>, não ao concurso <alvo>."
 * - Se targetContestRequested for null (input vazio), valida que externalContestNumber
 *   é um inteiro positivo estrito (> 0, não-nulo, não-NaN, não-decimal, não-string).
 * 
 * Retorna o targetContest certificado ou lança erro explicativo para abortar a reconciliação.
 */
export function validateResolvedExternalContest(
  targetContestRequested: number | null,
  externalContestNumber: unknown
): number {
  if (
    typeof externalContestNumber !== "number" ||
    !Number.isInteger(externalContestNumber) ||
    isNaN(externalContestNumber) ||
    externalContestNumber <= 0
  ) {
    throw new Error(
      `Número de concurso retornado pela fonte oficial é inválido: ${String(externalContestNumber)}.`
    );
  }

  if (targetContestRequested !== null) {
    if (externalContestNumber !== targetContestRequested) {
      throw new Error(
        `O resultado consultado pertence ao concurso ${externalContestNumber}, não ao concurso ${targetContestRequested}.`
      );
    }
    return targetContestRequested;
  }

  return externalContestNumber;
}

export const assertExternalContestMatchesTarget = validateResolvedExternalContest;

/**
 * Deduplica a lista de itens reconciliados, mantendo o item mais recente no topo.
 * Garante que nunca haverá mais de um item para o mesmo contestNumber.
 */
export function deduplicateReconciledItems(
  newItem: ReconciledContestItem,
  existingItems: readonly ReconciledContestItem[]
): ReconciledContestItem[] {
  return [newItem, ...existingItems.filter((i) => i.contestNumber !== newItem.contestNumber)];
}

export interface ReconciliationFeedback {
  type: "success" | "error" | "info" | "warning";
  message: string;
}

/**
 * Gera mensagem de feedback para a reconciliação garantindo que targetContest é um número válido.
 */
export function generateReconciliationFeedback(
  targetContest: number,
  status: ReconciliationStatus
): ReconciliationFeedback {
  if (typeof targetContest !== "number" || isNaN(targetContest) || targetContest <= 0) {
    throw new Error(`targetContest inválido para feedback: ${targetContest}`);
  }

  if (status === "MATCH") {
    return {
      type: "success",
      message: `Concurso ${targetContest}: Resultado armazenado é 100% IDÊNTICO ao retornado pela CAIXA (MATCH).`,
    };
  } else if (status === "MISMATCH") {
    return {
      type: "error",
      message: `ALERTA DE RECONCILIAÇÃO: Resultado armazenado difere do resultado retornado atualmente pela fonte oficial para o concurso ${targetContest}.`,
    };
  } else if (status === "WAITING_EXTERNAL") {
    return {
      type: "info",
      message: `Concurso ${targetContest}: Registro local aguardando apuração oficial.`,
    };
  } else {
    return {
      type: "info",
      message: `Concurso ${targetContest}: Consulta realizada com sucesso na CAIXA.`,
    };
  }
}
