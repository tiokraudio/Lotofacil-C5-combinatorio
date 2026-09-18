/**
 * Camada de gerenciamento do ciclo de vida, congelamento prospectivo e auditoria de registros de concurso C₅.
 */
import { C5_ALGORITHM_VERSION } from "./version.ts";
import { generateC5 } from "./generator.ts";
import { validateC5 } from "./validator.ts";
import { scoreC5, validateOfficialResult } from "./scorer.ts";
import {
  buildCanonicalPayload,
  computeSHA256,
  serializeCanonicalPayload,
  verifyContestIntegrity,
} from "./integrity.ts";
import type {
  Clock,
  ContestRecord,
  C5Generation,
  C5Score,
  ScoreIntegrityVerification,
} from "./types.ts";

/**
 * Relógio padrão do sistema emitindo a data UTC atual.
 */
export const defaultClock: Clock = () => new Date();

/**
 * Realiza uma clonagem defensiva profunda de uma geração C₅.
 */
export function deepCloneGeneration(gen: C5Generation): C5Generation {
  return {
    permutation: [...gen.permutation],
    slotAssignments: { ...gen.slotAssignments },
    games: [
      [...gen.games[0]],
      [...gen.games[1]],
      [...gen.games[2]],
      [...gen.games[3]],
      [...gen.games[4]],
    ],
  };
}

/**
 * Realiza uma clonagem defensiva profunda de um C5Score.
 */
export function deepCloneScore(score: C5Score): C5Score {
  return {
    result: [...score.result],
    games: [
      {
        gameIndex: score.games[0].gameIndex,
        hits: score.games[0].hits,
        matchedNumbers: [...score.games[0].matchedNumbers],
        missedNumbers: [...score.games[0].missedNumbers],
      },
      {
        gameIndex: score.games[1].gameIndex,
        hits: score.games[1].hits,
        matchedNumbers: [...score.games[1].matchedNumbers],
        missedNumbers: [...score.games[1].missedNumbers],
      },
      {
        gameIndex: score.games[2].gameIndex,
        hits: score.games[2].hits,
        matchedNumbers: [...score.games[2].matchedNumbers],
        missedNumbers: [...score.games[2].missedNumbers],
      },
      {
        gameIndex: score.games[3].gameIndex,
        hits: score.games[3].hits,
        matchedNumbers: [...score.games[3].matchedNumbers],
        missedNumbers: [...score.games[3].missedNumbers],
      },
      {
        gameIndex: score.games[4].gameIndex,
        hits: score.games[4].hits,
        matchedNumbers: [...score.games[4].matchedNumbers],
        missedNumbers: [...score.games[4].missedNumbers],
      },
    ],
    maxHits: score.maxHits,
    bestGameIndexes: [...score.bestGameIndexes],
    prizeCounts: { ...score.prizeCounts },
    has11Plus: score.has11Plus,
    has12Plus: score.has12Plus,
    has13Plus: score.has13Plus,
    has14Plus: score.has14Plus,
    has15: score.has15,
  };
}

/**
 * Cria um novo rascunho (DRAFT) de geração C₅ para um concurso especificado.
 *
 * Exigências:
 * 1. Validação estrita do número do concurso (inteiro positivo);
 * 2. Geração única e determinística via motor C5;
 * 3. Validação matemática integral da geração gerada;
 * 4. Atribuição de UUID único e versão canônica do algoritmo;
 * 5. Registro do timestamp UTC de geração;
 * 6. Imutabilidade com cópia defensiva profunda.
 *
 * @param contestNumber Número oficial do concurso (inteiro > 0).
 * @param options Configurações opcionais de gerador RNG, relógio e ID.
 * @returns Novo registro com status DRAFT.
 */
export function createContestDraft(
  contestNumber: number,
  options?: {
    rng?: () => number;
    clock?: Clock;
    generationId?: string;
  }
): ContestRecord {
  if (
    typeof contestNumber !== "number" ||
    !Number.isFinite(contestNumber) ||
    !Number.isInteger(contestNumber) ||
    contestNumber <= 0
  ) {
    throw new Error(
      `Número de concurso inválido: '${String(
        contestNumber
      )}'. Deve ser um número inteiro estritamente positivo (ex: 3200).`
    );
  }

  const clock = options?.clock ?? defaultClock;
  const generation = generateC5(options?.rng);

  const validation = validateC5(generation);
  if (!validation.valid) {
    throw new Error(
      `Falha na validação do motor C5 durante criação do rascunho: ${validation.errors.join("; ")}`
    );
  }

  const generationId = options?.generationId ?? crypto.randomUUID();
  const generatedAt = clock().toISOString();

  return {
    status: "DRAFT",
    contestNumber,
    generationId,
    algorithmVersion: C5_ALGORITHM_VERSION,
    generatedAt,
    generation: deepCloneGeneration(generation),
  };
}

/**
 * Congela oficialmente um rascunho (DRAFT), tornando os 5 jogos e os metadados imutáveis.
 *
 * Somente registros em estado DRAFT podem ser congelados.
 * Antes de congelar, a geração é rigorosamente validada frente às invariantes C5.
 * A função é pura e retorna um novo objeto ContestRecord no estado FROZEN,
 * contendo o payload canônico e o hash SHA-256 (64 caracteres hexadecimais).
 *
 * @param record Registro em estado DRAFT a ser congelado.
 * @param options Configurações opcionais (como injeção de relógio).
 * @returns Novo registro em estado FROZEN com integrityHash preenchido.
 */
export async function freezeContestRecord(
  record: ContestRecord,
  options?: { clock?: Clock }
): Promise<ContestRecord> {
  if (record.status !== "DRAFT") {
    throw new Error(
      `Transição de estado inválida: apenas registros em estado DRAFT podem ser congelados. Estado atual: '${record.status}'.`
    );
  }

  const validation = validateC5(record.generation);
  if (!validation.valid) {
    throw new Error(
      `Tentativa de congelar geração com invariantes C5 violadas: ${validation.errors.join("; ")}`
    );
  }

  const clock = options?.clock ?? defaultClock;
  const frozenAt = clock().toISOString();

  const canonicalPayload = buildCanonicalPayload(
    record.contestNumber,
    record.generationId,
    record.algorithmVersion,
    record.generatedAt,
    frozenAt,
    record.generation
  );

  const serialized = serializeCanonicalPayload(canonicalPayload);
  const integrityHash = await computeSHA256(serialized);

  return {
    status: "FROZEN",
    contestNumber: record.contestNumber,
    generationId: record.generationId,
    algorithmVersion: record.algorithmVersion,
    generatedAt: record.generatedAt,
    frozenAt,
    generation: deepCloneGeneration(record.generation),
    integrityHash,
  };
}

/**
 * Pontua um registro previamente congelado (FROZEN) frente a um resultado oficial da Lotofácil.
 *
 * Fluxo obrigatório:
 * 1. Auditoria de integridade da geração congelada (verifyContestIntegrity);
 * 2. Validação estrita do resultado oficial (validateOfficialResult);
 * 3. Cálculo determinístico dos acertos (scoreC5);
 * 4. Transição segura para o estado SCORED, preservando o hash e a geração imutáveis.
 *
 * @param record Registro em estado FROZEN.
 * @param officialResult Array com as 15 dezenas do sorteio oficial.
 * @param options Configurações opcionais (relógio).
 * @returns Novo registro no estado SCORED.
 */
export async function scoreFrozenContest(
  record: ContestRecord,
  officialResult: readonly number[],
  options?: { clock?: Clock }
): Promise<ContestRecord> {
  if (record.status !== "FROZEN") {
    throw new Error(
      `Transição de estado inválida: apenas registros em estado FROZEN podem ser pontuados. Estado atual: '${record.status}'.`
    );
  }

  // 1. Auditoria prévia obrigatória de integridade da geração congelada
  const integrity = await verifyContestIntegrity(record);
  if (!integrity.valid) {
    throw new Error(
      `Recusando pontuação: a integridade do registro congelado foi violada: ${integrity.errors.join("; ")}`
    );
  }

  // 2. Validação estrita e cópia do resultado oficial
  const validatedResult = validateOfficialResult(officialResult);

  // 3. Pontuação determinística
  const calculatedScore = scoreC5(record.generation, validatedResult);

  const clock = options?.clock ?? defaultClock;
  const scoredAt = clock().toISOString();

  return {
    status: "SCORED",
    contestNumber: record.contestNumber,
    generationId: record.generationId,
    algorithmVersion: record.algorithmVersion,
    generatedAt: record.generatedAt,
    frozenAt: record.frozenAt,
    generation: deepCloneGeneration(record.generation),
    integrityHash: record.integrityHash,
    officialResult: [...validatedResult],
    scoredAt,
    score: deepCloneScore(calculatedScore),
  };
}

/**
 * Audita a integridade da pontuação de um registro no estado SCORED.
 *
 * 1. Valida a presença e consistência do resultado oficial armazenado;
 * 2. Recalcula deterministicamente scoreC5 a partir da geração e do resultado;
 * 3. Compara semanticamente todas as métricas de pontuação calculadas com as armazenadas.
 *
 * @param record Registro em estado SCORED.
 * @returns Relatório de auditoria de pontuação.
 */
export function verifyScoreIntegrity(
  record: ContestRecord
): ScoreIntegrityVerification {
  const errors: string[] = [];

  if (record.status !== "SCORED") {
    errors.push(
      `Registro em estado inválido para verificação de pontuação: status '${record.status}'. Requer SCORED.`
    );
    return {
      valid: false,
      scoreMatches: false,
      officialResultValid: false,
      errors,
    };
  }

  if (!record.officialResult) {
    errors.push("Campo 'officialResult' ausente no registro pontuado.");
  }

  if (!record.score) {
    errors.push("Campo 'score' ausente no registro pontuado.");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      scoreMatches: false,
      officialResultValid: false,
      errors,
    };
  }

  let officialResultValid = false;
  let scoreMatches = false;

  try {
    const validatedResult = validateOfficialResult(record.officialResult);
    officialResultValid = true;

    const recomputed = scoreC5(record.generation, validatedResult);
    const stored = record.score!;

    // Comparação semântica exaustiva
    const maxHitsMatch = recomputed.maxHits === stored.maxHits;
    const flagsMatch =
      recomputed.has11Plus === stored.has11Plus &&
      recomputed.has12Plus === stored.has12Plus &&
      recomputed.has13Plus === stored.has13Plus &&
      recomputed.has14Plus === stored.has14Plus &&
      recomputed.has15 === stored.has15;

    const prizesMatch =
      recomputed.prizeCounts.hits11 === stored.prizeCounts.hits11 &&
      recomputed.prizeCounts.hits12 === stored.prizeCounts.hits12 &&
      recomputed.prizeCounts.hits13 === stored.prizeCounts.hits13 &&
      recomputed.prizeCounts.hits14 === stored.prizeCounts.hits14 &&
      recomputed.prizeCounts.hits15 === stored.prizeCounts.hits15;

    let gamesMatch = recomputed.games.length === stored.games.length;
    if (gamesMatch) {
      for (let i = 0; i < 5; i++) {
        const rg = recomputed.games[i];
        const sg = stored.games[i];
        if (
          rg.gameIndex !== sg.gameIndex ||
          rg.hits !== sg.hits ||
          rg.matchedNumbers.join(",") !== sg.matchedNumbers.join(",") ||
          rg.missedNumbers.join(",") !== sg.missedNumbers.join(",")
        ) {
          gamesMatch = false;
          break;
        }
      }
    }

    scoreMatches = maxHitsMatch && flagsMatch && prizesMatch && gamesMatch;

    if (!scoreMatches) {
      errors.push("Divergência detectada entre a pontuação armazenada e a pontuação recalculada.");
    }
  } catch (err: any) {
    errors.push(`Erro durante verificação do resultado ou pontuação: ${err?.message ?? String(err)}`);
  }

  const valid = officialResultValid && scoreMatches && errors.length === 0;

  return {
    valid,
    scoreMatches,
    officialResultValid,
    errors,
  };
}
