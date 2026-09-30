/**
 * Módulo de Domínio de Draft, Preview, Concorrência Lógica e Freshness
 * para o C5-Memory-2.0.0 (IC6)
 *
 * Implementa integralmente os contratos congelados:
 * - C5M-DRAFT-STALE-CONTRACT-V1
 * - Especificação de Integração v1.0 — Seções 5 e 6
 * - Golden Vectors GV-I07, GV-I08, GV-I09, GV-I10, GV-I18
 *
 * Características normativas:
 * 1. Draft carrega metadados congelados imutáveis:
 *    - algorithmVersion ("C5-Memory-2.0.0")
 *    - poolMasterSeed (uint32 / string normalizada)
 *    - poolIndex (0..499)
 *    - selectedC5 (5 jogos de 15 dezenas)
 *    - expectedHistoryRevision
 *    - expectedHistoryFingerprint
 * 2. Imutabilidade do Preview: deriva diretamente e exclusivamente de selectedC5 do Draft.
 * 3. Freshness estrito: expectedHistoryRevision === currentHistoryRevision AND
 *                       expectedHistoryFingerprint === currentHistoryFingerprint.
 * 4. Qualquer divergência gera estritamente STALE_REVISION_REJECTED.
 * 5. Proibição absoluta de auto-regeneração de apostas stale.
 * 6. Funções puras sem efeitos colaterais nem mutação de argumentos.
 */

import { generatePool } from "./pool.ts";
import { selectBestCandidate } from "./math.ts";
import type { C5Candidate, JohnsonHistogram, PoolCandidate } from "./types.ts";

export const C5_MEMORY_ALGORITHM_VERSION = "C5-Memory-2.0.0" as const;
export const STALE_REVISION_REJECTED = "STALE_REVISION_REJECTED" as const;

/**
 * Erro canônico lançado ou referenciado em condições de stale.
 */
export class StaleRevisionRejectedError extends Error {
  public readonly code = STALE_REVISION_REJECTED;
  public readonly expectedRevision: number;
  public readonly currentRevision: number;
  public readonly expectedFingerprint: string;
  public readonly currentFingerprint: string;

  constructor(
    expectedRevision: number,
    currentRevision: number,
    expectedFingerprint: string,
    currentFingerprint: string,
    message?: string
  ) {
    super(
      message ||
        `STALE_REVISION_REJECTED: Revisão ou Fingerprint incompatível com o Draft (esperado: rev=${expectedRevision}, fp=${expectedFingerprint}; atual: rev=${currentRevision}, fp=${currentFingerprint})`
    );
    this.name = "StaleRevisionRejectedError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
    this.expectedFingerprint = expectedFingerprint;
    this.currentFingerprint = currentFingerprint;
    Object.setPrototypeOf(this, StaleRevisionRejectedError.prototype);
  }
}

/**
 * Interface canônica imutável do Draft C5-Memory.
 */
export interface C5MemoryDraft {
  readonly algorithmVersion: typeof C5_MEMORY_ALGORITHM_VERSION;
  readonly poolMasterSeed: number | string;
  readonly poolIndex: number;
  readonly selectedPoolIndex: number; // Alias normativo C5M-DRAFT-STALE-CONTRACT-V1
  readonly selectedC5: C5Candidate;
  readonly expectedHistoryRevision: number;
  readonly draftHistoryRevision: number; // Alias normativo
  readonly expectedHistoryFingerprint: string;
  readonly draftHistoryFingerprint: string; // Alias normativo
  readonly winnerHistogram: JohnsonHistogram;
  readonly createdAt: string;
}

/**
 * Parâmetros de criação de um Draft.
 */
export interface CreateDraftParams {
  readonly H: readonly (readonly number[])[];
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly poolMasterSeed: number | string;
  readonly poolSize?: number;
}

/**
 * Resultado da validação de freshness.
 */
export interface FreshnessValidationResult {
  readonly isStale: boolean;
  readonly validationStatus: "COMPATIBLE" | typeof STALE_REVISION_REJECTED;
  readonly action: "ALLOW_CONFIRMATION" | "ABORT_PERSISTENCE_TRANSACTION";
  readonly silentRecomputeAllowed: false;
  readonly reason?: typeof STALE_REVISION_REJECTED;
}

/**
 * Cria um Draft determinístico C5-Memory a partir do estado histórico confirmado e da seed.
 *
 * @param params Parâmetros de geração contendo H, revisão, fingerprint e seed
 * @returns Instância imutável (congelada) de C5MemoryDraft
 */
export function createDraft(params: CreateDraftParams): C5MemoryDraft {
  const { H, historyRevision, historyFingerprint, poolMasterSeed, poolSize = 500 } = params;

  if (typeof historyRevision !== "number" || historyRevision < 0 || !Number.isInteger(historyRevision)) {
    throw new Error(`historyRevision inválido: ${historyRevision}. Deve ser inteiro >= 0.`);
  }
  if (typeof historyFingerprint !== "string" || historyFingerprint.length === 0) {
    throw new Error("historyFingerprint inválido: string obrigatória.");
  }
  if (poolMasterSeed === undefined || poolMasterSeed === null) {
    throw new Error("poolMasterSeed obrigatória.");
  }

  // 1. Gera o pool determinístico de K candidatos (K = 500)
  const pool = generatePool(poolMasterSeed, poolSize);

  // 2. Executa seleção MAX-LEXIMIN estrita
  const selection = selectBestCandidate(pool, H);
  const winner = pool[selection.winnerIndex];

  // 3. Monta o candidato congelado
  const selectedC5: C5Candidate = Object.freeze([
    Object.freeze([...winner.games[0]]),
    Object.freeze([...winner.games[1]]),
    Object.freeze([...winner.games[2]]),
    Object.freeze([...winner.games[3]]),
    Object.freeze([...winner.games[4]]),
  ]) as unknown as C5Candidate;

  const draft: C5MemoryDraft = Object.freeze({
    algorithmVersion: C5_MEMORY_ALGORITHM_VERSION,
    poolMasterSeed,
    poolIndex: winner.poolIndex,
    selectedPoolIndex: winner.poolIndex,
    selectedC5,
    expectedHistoryRevision: historyRevision,
    draftHistoryRevision: historyRevision,
    expectedHistoryFingerprint: historyFingerprint,
    draftHistoryFingerprint: historyFingerprint,
    winnerHistogram: Object.freeze([...selection.winnerHistogram]) as JohnsonHistogram,
    createdAt: new Date().toISOString(),
  });

  return draft;
}

/**
 * Deriva o Preview diretamente e exclusivamente do Draft.
 * O Preview é garantidamente idêntico ao selectedC5 do Draft.
 * Não regenera seed, não consome RNG e não consulta novo histórico.
 *
 * @param draft Draft a partir do qual o preview é exibido
 * @returns Os 5 jogos do C5 congelado
 */
export function derivePreview(draft: C5MemoryDraft): C5Candidate {
  if (!draft || draft.algorithmVersion !== C5_MEMORY_ALGORITHM_VERSION) {
    throw new Error("Draft inválido para exibição de Preview.");
  }
  return draft.selectedC5;
}

/**
 * Valida a freshness lógica de um Draft frente ao estado histórico corrente da aplicação.
 *
 * Condição necessária e suficiente de frescor:
 * draft.expectedHistoryRevision === currentHistoryRevision &&
 * draft.expectedHistoryFingerprint === currentHistoryFingerprint
 *
 * Caso contrário, resulta imediatamente em STALE_REVISION_REJECTED.
 *
 * @param draft Draft que se pretende confirmar
 * @param currentHistoryRevision Revisão atual do repositório/store
 * @param currentHistoryFingerprint Fingerprint atual do repositório/store
 * @returns FreshnessValidationResult indicando COMPATIBLE ou STALE_REVISION_REJECTED
 */
export function validateDraftFreshness(
  draft: C5MemoryDraft,
  currentHistoryRevision: number,
  currentHistoryFingerprint: string
): FreshnessValidationResult {
  if (!draft) {
    throw new Error("Draft obrigatório para validação de freshness.");
  }

  const expectedRev = draft.expectedHistoryRevision ?? draft.draftHistoryRevision;
  const expectedFp = draft.expectedHistoryFingerprint ?? draft.draftHistoryFingerprint;

  const revisionMatches = expectedRev === currentHistoryRevision;
  const fingerprintMatches = expectedFp === currentHistoryFingerprint;

  if (revisionMatches && fingerprintMatches) {
    return {
      isStale: false,
      validationStatus: "COMPATIBLE",
      action: "ALLOW_CONFIRMATION",
      silentRecomputeAllowed: false,
    };
  }

  return {
    isStale: true,
    validationStatus: STALE_REVISION_REJECTED,
    action: "ABORT_PERSISTENCE_TRANSACTION",
    silentRecomputeAllowed: false,
    reason: STALE_REVISION_REJECTED,
  };
}

/**
 * Tenta autorizar logicamente a confirmação de um Draft.
 * Lança StaleRevisionRejectedError se o Draft estiver stale.
 * É terminantemente proibido recomputar silenciosamente ou atualizar o Draft.
 *
 * @param draft Draft submetido à confirmação
 * @param currentHistoryRevision Revisão atual
 * @param currentHistoryFingerprint Fingerprint atual
 * @returns true se a confirmação for admissível
 */
export function assertDraftFreshness(
  draft: C5MemoryDraft,
  currentHistoryRevision: number,
  currentHistoryFingerprint: string
): boolean {
  const result = validateDraftFreshness(draft, currentHistoryRevision, currentHistoryFingerprint);
  if (result.isStale) {
    throw new StaleRevisionRejectedError(
      draft.expectedHistoryRevision ?? draft.draftHistoryRevision,
      currentHistoryRevision,
      draft.expectedHistoryFingerprint ?? draft.draftHistoryFingerprint,
      currentHistoryFingerprint
    );
  }
  return true;
}

/**
 * Reconstrói deterministicamente o candidato e o poolIndex do Draft a partir da seed
 * e do histórico H correspondente.
 *
 * Comprova que:
 * replayedCandidate == draft.selectedC5
 * replayedPoolIndex == draft.poolIndex
 *
 * @param draft Draft a ser auditado
 * @param H Histórico congelado correspondente ao draft
 * @returns Objeto com os dados auditados e o status de correspondência
 */
export function replayDraft(
  draft: C5MemoryDraft,
  H: readonly (readonly number[])[]
): {
  readonly poolMatches: boolean;
  readonly poolIndexMatches: boolean;
  readonly gamesMatch: boolean;
  readonly replayedPoolIndex: number;
  readonly replayedC5: C5Candidate;
} {
  const pool = generatePool(draft.poolMasterSeed);
  const selection = selectBestCandidate(pool, H);
  const replayedWinner = pool[selection.winnerIndex];

  const poolIndexMatches = replayedWinner.poolIndex === draft.poolIndex;

  let gamesMatch = true;
  for (let g = 0; g < 5; g++) {
    const origGame = draft.selectedC5[g];
    const repGame = replayedWinner.games[g];
    if (origGame.length !== repGame.length) {
      gamesMatch = false;
      break;
    }
    for (let d = 0; d < origGame.length; d++) {
      if (origGame[d] !== repGame[d]) {
        gamesMatch = false;
        break;
      }
    }
    if (!gamesMatch) break;
  }

  return {
    poolMatches: poolIndexMatches && gamesMatch,
    poolIndexMatches,
    gamesMatch,
    replayedPoolIndex: replayedWinner.poolIndex,
    replayedC5: replayedWinner.games,
  };
}
