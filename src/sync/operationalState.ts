/**
 * Modelo de Situação Operacional e Reconciliação com Fonte Oficial CAIXA (v1.4.0).
 * 
 * Centraliza funções puras e determinísticas para:
 * 1. Derivação de estado operacional do concurso (ContestOperationalState)
 * 2. Validação estrita de resultado oficial (validateOfficialResult)
 * 3. Reconciliação do resultado oficial armazenado com a fonte oficial (reconcileOfficialResult)
 * 4. Mapeamento centralizado de Ação Principal (Primary Action)
 * 
 * Regras Absolutas:
 * - Funções 100% puras (sem mutação de entradas nem de banco).
 * - Prioridade absoluta da Quarentena (isolamento lógico intransponível).
 * - Separação estrita entre RNG/Geração e Resultado Oficial.
 * - Concurso exato (external.contestNumber === local.contestNumber).
 */

import type { ContestRecord } from "../c5/types.ts";
import type { OfficialContestResult } from "../lottery/types.ts";

/**
 * Estados operacionais inequívocos do ciclo de vida de um concurso.
 */
export type ContestOperationalState =
  | "NO_RECORD"
  | "DRAFT"
  | "FROZEN_WAITING_RESULT"
  | "FROZEN_RESULT_AVAILABLE"
  | "SCORED"
  | "QUARANTINED"
  | "EXTERNAL_UNAVAILABLE";

/**
 * Status de reconciliação entre o registro local e o snapshot oficial da CAIXA.
 */
export type ReconciliationStatus =
  | "NOT_APPLICABLE"
  | "WAITING_EXTERNAL"
  | "MATCH"
  | "MISMATCH"
  | "INVALID_EXTERNAL";

/**
 * Estrutura imutável de prévia do resultado oficial consultado da CAIXA.
 */
export interface OfficialResultPreview {
  readonly contestNumber: number;
  readonly result: readonly number[];
  readonly numbers: readonly number[];
  readonly drawDate: string;
  readonly fetchedAt: string;
  readonly source: string;
}

/**
 * Descritor canônico da ação principal operacional baseada no estado.
 */
export interface OperationalPrimaryAction {
  readonly state: ContestOperationalState;
  readonly actionKey:
    | "GENERATE_GAMES"
    | "FREEZE_GAMES"
    | "FETCH_RESULT"
    | "SCORE_CONTEST"
    | "OPEN_AUDIT"
    | "NONE";
  readonly label: string;
  readonly description: string;
  readonly isDestructive: boolean;
}

/**
 * Validação rigorosa de resultado oficial da Lotofácil.
 * Exige:
 * - Array de exatamente 15 inteiros
 * - Intervalo 1..25
 * - Zero duplicatas
 * Retorna array ordenado e tipado ou lança erro descritivo.
 */
export function validateOfficialResult(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new Error("O resultado oficial deve ser uma lista (array) de números.");
  }

  if (raw.length !== 15) {
    throw new Error(
      `O resultado oficial da Lotofácil exige exatamente 15 dezenas, mas recebeu ${raw.length}.`
    );
  }

  const parsed: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const val = raw[i];
    if (typeof val !== "number" || !Number.isInteger(val)) {
      throw new Error(
        `Dezena na posição ${i + 1} inválida (${String(val)}). Deve ser um número inteiro.`
      );
    }
    if (val < 1 || val > 25) {
      throw new Error(
        `Dezena na posição ${i + 1} (${val}) fora do intervalo permitido (1 a 25).`
      );
    }
    parsed.push(val);
  }

  const uniqueSet = new Set(parsed);
  if (uniqueSet.size !== 15) {
    throw new Error(
      `Dezenas duplicadas detectadas no resultado oficial (${15 - uniqueSet.size} duplicatas).`
    );
  }

  return [...parsed].sort((a, b) => a - b);
}

/**
 * Verificador booleano seguro para resultado oficial sem lançamento de exceção.
 */
export function isValidOfficialResult(raw: unknown): boolean {
  try {
    validateOfficialResult(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cria snapshot normalizado e imutável para a prévia do resultado oficial.
 */
export function createOfficialResultPreview(
  data: OfficialContestResult | { contestNumber: number; numbers: number[]; drawDate?: string; fetchedAt?: string; source?: string }
): OfficialResultPreview {
  const validatedNumbers = validateOfficialResult(data.numbers);
  const fetchedAt = data.fetchedAt || new Date().toISOString();
  const drawDate = data.drawDate || "";
  const source = data.source || "CAIXA";

  return Object.freeze({
    contestNumber: data.contestNumber,
    result: Object.freeze([...validatedNumbers]),
    numbers: Object.freeze([...validatedNumbers]),
    drawDate,
    fetchedAt,
    source,
  });
}

/**
 * Função Pura de Derivação do Estado Operacional do Concurso.
 * 
 * Regra de Precedência Estrita:
 * 1. QUARANTINED: Se existe registro local e auditoria falha, estado é QUARANTINED
 *    (a quarentena tem prioridade absoluta sobre qualquer snapshot externo ou status).
 * 2. NO_RECORD: Se não há registro local (ou EXTERNAL_UNAVAILABLE se sinalizado explicitamente).
 * 3. DRAFT: Se status local é DRAFT.
 * 4. SCORED: Se status local é SCORED.
 * 5. FROZEN_RESULT_AVAILABLE: Se status local é FROZEN, snapshot externo existe, é válido e
 *    pertence ao mesmo concurso exato (external.contestNumber === local.contestNumber).
 * 6. FROZEN_WAITING_RESULT: Se status local é FROZEN e resultado ainda não está disponível
 *    para este concurso específico (ou consulta externa falhou - preserva estado local).
 */
export function deriveContestOperationalState(params: {
  localRecord?: ContestRecord | null;
  localAudit?: { valid: boolean } | null;
  externalSnapshot?: OfficialContestResult | OfficialResultPreview | null;
  isExternalUnavailable?: boolean;
}): ContestOperationalState {
  const { localRecord, localAudit, externalSnapshot, isExternalUnavailable } = params;

  // 1. PRIORIDADE ABSOLUTA DA QUARENTENA
  if (localRecord && localAudit && !localAudit.valid) {
    return "QUARANTINED";
  }

  // 2. AUSÊNCIA DE REGISTRO LOCAL
  if (!localRecord) {
    if (isExternalUnavailable) {
      return "EXTERNAL_UNAVAILABLE";
    }
    return "NO_RECORD";
  }

  // 3. RASCUNHO NÃO CONGELADO
  if (localRecord.status === "DRAFT") {
    return "DRAFT";
  }

  // 4. CONCURSO CONFERIDO E PONTUADO
  if (localRecord.status === "SCORED") {
    return "SCORED";
  }

  // 5 e 6. CONCURSO FROZEN
  if (localRecord.status === "FROZEN") {
    if (externalSnapshot) {
      const numbers =
        "numbers" in externalSnapshot
          ? externalSnapshot.numbers
          : (externalSnapshot as any).result;

      const hasValidNumbers = isValidOfficialResult(numbers);
      const isExactContest =
        externalSnapshot.contestNumber === localRecord.contestNumber;

      if (hasValidNumbers && isExactContest) {
        return "FROZEN_RESULT_AVAILABLE";
      }
    }

    // Se externo falhou ou não está disponível para este concurso,
    // o concurso FROZEN permanece operacionalmente aguardando resultado.
    return "FROZEN_WAITING_RESULT";
  }

  return "NO_RECORD";
}

/**
 * Função Pura de Reconciliação com a Fonte Oficial CAIXA.
 * 
 * Compara o resultado armazenado no registro com o snapshot retornado pela CAIXA.
 * Não realiza qualquer mutação.
 * 
 * Retornos:
 * - NOT_APPLICABLE: Registro inexistente ou ainda em DRAFT.
 * - WAITING_EXTERNAL: Registro FROZEN ou SCORED sem snapshot externo válido para o mesmo concurso.
 * - INVALID_EXTERNAL: Snapshot externo possui estrutura ou dezenas inválidas.
 * - MATCH: Concurso SCORED cujo resultado oficial persistido é idêntico ao snapshot da CAIXA.
 * - MISMATCH: Concurso SCORED cujo resultado oficial persistido difere do retornado pela CAIXA.
 */
export function reconcileOfficialResult(
  localRecord: ContestRecord | null | undefined,
  externalSnapshot: OfficialContestResult | OfficialResultPreview | unknown | null | undefined
): ReconciliationStatus {
  if (!localRecord) {
    return "NOT_APPLICABLE";
  }

  if (localRecord.status === "DRAFT") {
    return "NOT_APPLICABLE";
  }

  if (!externalSnapshot) {
    return "WAITING_EXTERNAL";
  }

  // Validação da estrutura externa
  if (typeof externalSnapshot !== "object" || externalSnapshot === null) {
    return "INVALID_EXTERNAL";
  }

  const ext = externalSnapshot as Record<string, unknown>;
  const rawContestNum = ext.contestNumber;
  if (
    typeof rawContestNum !== "number" ||
    !Number.isInteger(rawContestNum) ||
    rawContestNum <= 0
  ) {
    return "INVALID_EXTERNAL";
  }

  const rawNumbers = "numbers" in ext ? ext.numbers : ext.result;
  let extSortedNumbers: number[];
  try {
    extSortedNumbers = validateOfficialResult(rawNumbers);
  } catch {
    return "INVALID_EXTERNAL";
  }

  // Se o snapshot pertence a outro concurso, não reconcilia o concurso local atual
  if (rawContestNum !== localRecord.contestNumber) {
    return "WAITING_EXTERNAL";
  }

  // Para registros FROZEN, o resultado oficial ainda não foi apurado localmente
  if (localRecord.status === "FROZEN") {
    return "WAITING_EXTERNAL";
  }

  // Para registros SCORED: comparação estrita de dezenas
  if (localRecord.status === "SCORED") {
    const localResult = localRecord.officialResult || localRecord.score?.result;
    if (!localResult || !Array.isArray(localResult)) {
      return "MISMATCH";
    }

    let localSortedNumbers: number[];
    try {
      localSortedNumbers = validateOfficialResult(localResult);
    } catch {
      return "MISMATCH";
    }

    if (localSortedNumbers.length !== 15 || extSortedNumbers.length !== 15) {
      return "MISMATCH";
    }

    for (let i = 0; i < 15; i++) {
      if (localSortedNumbers[i] !== extSortedNumbers[i]) {
        return "MISMATCH";
      }
    }

    return "MATCH";
  }

  return "NOT_APPLICABLE";
}

/**
 * Mapeamento determinístico da Ação Principal conforme Seção 37 do requisito v1.4.
 * 
 * Regra:
 * NO_RECORD -> GERAR 5 JOGOS
 * DRAFT -> CONGELAR JOGOS
 * FROZEN_WAITING_RESULT -> CONSULTAR RESULTADO
 * FROZEN_RESULT_AVAILABLE -> PONTUAR CONCURSO
 * SCORED -> nenhuma ação destrutiva
 * QUARANTINED -> ABRIR AUDITORIA
 */
export function getOperationalPrimaryAction(
  state: ContestOperationalState,
  contestNumber?: number
): OperationalPrimaryAction {
  switch (state) {
    case "NO_RECORD":
      return {
        state,
        actionKey: "GENERATE_GAMES",
        label: "GERAR 5 JOGOS",
        description: contestNumber
          ? `Gera 5 apostas combinatórias C₅ para o concurso ${contestNumber}.`
          : "Gera 5 apostas combinatórias C₅ com garantias matemáticas.",
        isDestructive: false,
      };

    case "DRAFT":
      return {
        state,
        actionKey: "FREEZE_GAMES",
        label: "CONGELAR JOGOS",
        description:
          "Sela criptograficamente os 5 jogos com hash SHA-256 no banco local.",
        isDestructive: true,
      };

    case "FROZEN_WAITING_RESULT":
    case "EXTERNAL_UNAVAILABLE":
      return {
        state,
        actionKey: "FETCH_RESULT",
        label: "CONSULTAR RESULTADO",
        description:
          "Consulta a apuração oficial do concurso na base pública da CAIXA.",
        isDestructive: false,
      };

    case "FROZEN_RESULT_AVAILABLE":
      return {
        state,
        actionKey: "SCORE_CONTEST",
        label: "PONTUAR CONCURSO",
        description:
          "Confere as 15 dezenas oficiais contra os 5 jogos congelados e grava a pontuação.",
        isDestructive: true,
      };

    case "SCORED":
      return {
        state,
        actionKey: "NONE",
        label: "CONCURSO CONFERIDO",
        description:
          "Este concurso já foi pontuado e seu histórico está auditado e arquivado.",
        isDestructive: false,
      };

    case "QUARANTINED":
      return {
        state,
        actionKey: "OPEN_AUDIT",
        label: "ABRIR AUDITORIA",
        description:
          "Registro em quarentena por falha de integridade. Acesse o painel de auditoria.",
        isDestructive: false,
      };
  }
}
