import {
  OfficialContestResult,
  LotteryFetchError,
  LotteryErrorCode,
  OfficialPrizeReference,
  OfficialPrizeTier,
  PrizeHits,
} from "./types.ts";

export interface ValidationSuccess {
  valid: true;
  data: OfficialContestResult;
}

export interface ValidationFailure {
  valid: false;
  error: string;
  code: LotteryErrorCode;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const VALID_HITS = new Set<number>([11, 12, 13, 14, 15]);

/**
 * Validador estrito e puro para OfficialPrizeReference.
 * Garante que a referência financeira seja completa e íntegra (todas as 5 faixas válidas),
 * ou retorne undefined se houver qualquer divergência ou inconsistência.
 */
export function validateAndNormalizeOfficialPrizeReference(
  raw: unknown,
  expectedContestNumber?: number,
  expectedFetchedAt?: string
): OfficialPrizeReference {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LotteryFetchError(
      "prizeReference deve ser um objeto válido.",
      "INVALID_PAYLOAD"
    );
  }

  const obj = raw as Record<string, unknown>;

  // 1. contestNumber: inteiro positivo
  const contestNumber = obj.contestNumber;
  if (
    typeof contestNumber !== "number" ||
    !Number.isSafeInteger(contestNumber) ||
    contestNumber <= 0
  ) {
    throw new LotteryFetchError(
      "Número do concurso em prizeReference inválido.",
      "INVALID_PAYLOAD"
    );
  }

  if (
    expectedContestNumber !== undefined &&
    contestNumber !== expectedContestNumber
  ) {
    throw new LotteryFetchError(
      `Concurso em prizeReference (${contestNumber}) difere do concurso esperado (${expectedContestNumber}).`,
      "INVALID_PAYLOAD",
      undefined,
      contestNumber
    );
  }

  // 2. source: estritamente "CAIXA"
  if (obj.source !== "CAIXA") {
    throw new LotteryFetchError(
      `Fonte em prizeReference deve ser 'CAIXA', recebido '${String(obj.source)}'.`,
      "INVALID_PAYLOAD",
      undefined,
      contestNumber
    );
  }

  // 3. fetchedAt: ISO-8601 válido
  const fetchedAt = obj.fetchedAt;
  if (
    typeof fetchedAt !== "string" ||
    !fetchedAt.trim() ||
    isNaN(Date.parse(fetchedAt))
  ) {
    throw new LotteryFetchError(
      "Data de captura (fetchedAt) em prizeReference inválida.",
      "INVALID_PAYLOAD",
      undefined,
      contestNumber
    );
  }

  // 4. tiers: exatamente 5 faixas
  if (!Array.isArray(obj.tiers) || obj.tiers.length !== 5) {
    throw new LotteryFetchError(
      `prizeReference deve conter exatamente 5 faixas de premiação (11 a 15), recebido ${Array.isArray(obj.tiers) ? obj.tiers.length : typeof obj.tiers}.`,
      "INVALID_PAYLOAD",
      undefined,
      contestNumber
    );
  }

  const seenHits = new Set<PrizeHits>();
  const normalizedTiers: OfficialPrizeTier[] = [];

  for (const item of obj.tiers) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new LotteryFetchError(
        "Faixa de premiação deve ser um objeto válido.",
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }

    const tierObj = item as Record<string, unknown>;
    const hits = tierObj.hits;

    if (
      typeof hits !== "number" ||
      !Number.isSafeInteger(hits) ||
      !VALID_HITS.has(hits)
    ) {
      throw new LotteryFetchError(
        `Faixa de premiação com acertos inválidos: ${String(hits)}. Deve ser 11, 12, 13, 14 ou 15.`,
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }

    const typedHits = hits as PrizeHits;
    if (seenHits.has(typedHits)) {
      throw new LotteryFetchError(
        `Faixa de premiação duplicada: ${typedHits} acertos.`,
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }
    seenHits.add(typedHits);

    const winners = tierObj.winners;
    if (
      typeof winners !== "number" ||
      !Number.isSafeInteger(winners) ||
      winners < 0
    ) {
      throw new LotteryFetchError(
        `Número de ganhadores inválido na faixa de ${typedHits} acertos.`,
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }

    const prizePerWinnerCents = tierObj.prizePerWinnerCents;
    if (
      typeof prizePerWinnerCents !== "number" ||
      !Number.isSafeInteger(prizePerWinnerCents) ||
      prizePerWinnerCents < 0
    ) {
      throw new LotteryFetchError(
        `Valor do prêmio por ganhador em centavos inválido na faixa de ${typedHits} acertos.`,
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }

    normalizedTiers.push({
      hits: typedHits,
      winners,
      prizePerWinnerCents,
    });
  }

  if (seenHits.size !== 5) {
    throw new LotteryFetchError(
      "prizeReference deve cobrir todas as 5 faixas [11..15].",
      "INVALID_PAYLOAD",
      undefined,
      contestNumber
    );
  }

  // Ordena canonicamente de 15 a 11 acertos (decrescente)
  normalizedTiers.sort((a, b) => b.hits - a.hits);

  return {
    contestNumber,
    source: "CAIXA",
    fetchedAt,
    tiers: normalizedTiers,
  };
}

/**
 * Validador e normalizador estrito de respostas da Lotofácil.
 * Trata o dado de entrada puramente como `unknown` e impõe invariantes rigorosos:
 * - Raiz deve ser objeto puro (não nulo, não array).
 * - contestNumber deve ser inteiro positivo (rejeita string, 0, negativos e decimais).
 * - numbers deve conter exatamente 15 inteiros no intervalo 1..25 sem duplicatas.
 * - drawDate deve ser data válida.
 * - Ordena cópia das dezenas numericamente.
 */
export function validateAndNormalizeOfficialResult(
  raw: unknown,
  expectedContestNumber?: number,
  fallbackSource = "CAIXA"
): ValidationResult {
  if (raw === null || raw === undefined) {
    return {
      valid: false,
      error: "O payload retornado pela fonte externa é nulo ou indefinido.",
      code: "INVALID_PAYLOAD",
    };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      error: "O payload retornado pela fonte externa deve ser um objeto, mas recebeu um array ou tipo primitivo.",
      code: "INVALID_PAYLOAD",
    };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Validação de contestNumber
  if (!("contestNumber" in obj) && !("numero" in obj)) {
    return {
      valid: false,
      error: "Campo obrigatório do número do concurso ausente no payload.",
      code: "INVALID_PAYLOAD",
    };
  }

  const rawContestNumber = "contestNumber" in obj ? obj.contestNumber : obj.numero;

  if (typeof rawContestNumber !== "number") {
    return {
      valid: false,
      error: `O número do concurso deve ser numérico, mas recebeu ${typeof rawContestNumber} (${String(
        rawContestNumber
      )}).`,
      code: "INVALID_PAYLOAD",
    };
  }

  if (!Number.isInteger(rawContestNumber) || rawContestNumber <= 0) {
    return {
      valid: false,
      error: `O número do concurso deve ser um número inteiro estritamente positivo, mas recebeu ${rawContestNumber}.`,
      code: "INVALID_PAYLOAD",
    };
  }

  const contestNumber = rawContestNumber;

  // 1.1 Verificação de divergência com o concurso solicitado
  if (
    expectedContestNumber !== undefined &&
    contestNumber !== expectedContestNumber
  ) {
    return {
      valid: false,
      error: `Divergência de concurso: foi solicitado o resultado do concurso ${expectedContestNumber}, porém a fonte externa retornou o concurso ${contestNumber}.`,
      code: "CONTEST_MISMATCH",
    };
  }

  // 2. Validação de dezenas
  const rawNumbers = "numbers" in obj ? obj.numbers : undefined;

  if (!Array.isArray(rawNumbers)) {
    return {
      valid: false,
      error: "O campo de dezenas sorteadas 'numbers' está ausente ou não é um array.",
      code: "INVALID_PAYLOAD",
    };
  }

  if (rawNumbers.length !== 15) {
    return {
      valid: false,
      error: `A Lotofácil oficial exige exatamente 15 dezenas sorteadas, mas a fonte retornou ${rawNumbers.length}.`,
      code: "INVALID_PAYLOAD",
    };
  }

  const parsedNumbers: number[] = [];
  for (let i = 0; i < rawNumbers.length; i++) {
    const val = rawNumbers[i];

    if (typeof val !== "number") {
      return {
        valid: false,
        error: `Dezena na posição ${i + 1} é inválida (${String(val)}). O modelo normalizado de domínio exige números inteiros, mas recebeu ${typeof val}.`,
        code: "INVALID_PAYLOAD",
      };
    }

    if (!Number.isInteger(val)) {
      return {
        valid: false,
        error: `Dezena na posição ${i + 1} (${val}) não é um número inteiro.`,
        code: "INVALID_PAYLOAD",
      };
    }

    if (val < 1 || val > 25) {
      return {
        valid: false,
        error: `Dezena na posição ${i + 1} (${val}) está fora do intervalo válido da Lotofácil (1 a 25).`,
        code: "INVALID_PAYLOAD",
      };
    }

    parsedNumbers.push(val);
  }

  // 2.1 Verificação de duplicatas
  const uniqueSet = new Set(parsedNumbers);
  if (uniqueSet.size !== 15) {
    return {
      valid: false,
      error: `Dezenas duplicadas detectadas no resultado oficial (${15 - uniqueSet.size} duplicatas).`,
      code: "INVALID_PAYLOAD",
    };
  }

  // Ordenação numérica em cópia defensiva
  const sortedNumbers = [...parsedNumbers].sort((a, b) => a - b);

  // 3. Validação de Data de Apuração / Sorteio
  const rawDate =
    "drawDate" in obj
      ? obj.drawDate
      : "dataApuracao" in obj
      ? obj.dataApuracao
      : "data" in obj
      ? obj.data
      : undefined;

  if (typeof rawDate !== "string" || !rawDate.trim()) {
    return {
      valid: false,
      error: "Data do sorteio está ausente ou em formato inválido.",
      code: "INVALID_PAYLOAD",
    };
  }

  const trimmedDate = rawDate.trim();
  let isValidDate = false;

  // Verifica padrão brasileiro DD/MM/YYYY ou ISO YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmedDate)) {
    const [d, m, y] = trimmedDate.split("/").map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (
      dateObj.getFullYear() === y &&
      dateObj.getMonth() === m - 1 &&
      dateObj.getDate() === d
    ) {
      isValidDate = true;
    }
  } else if (/^\d{4}-\d{2}-\d{2}/.test(trimmedDate)) {
    const parsed = Date.parse(trimmedDate);
    if (!isNaN(parsed)) {
      isValidDate = true;
    }
  }

  if (!isValidDate) {
    return {
      valid: false,
      error: `Data do sorteio inválida: "${trimmedDate}". Deve ser uma data cronológica válida no formato DD/MM/AAAA ou ISO.`,
      code: "INVALID_PAYLOAD",
    };
  }

  // 4. Metadados de Origem e Timestamp
  const source =
    typeof obj.source === "string" && obj.source.trim()
      ? obj.source.trim()
      : fallbackSource;

  const fetchedAt =
    typeof obj.fetchedAt === "string" && !isNaN(Date.parse(obj.fetchedAt))
      ? obj.fetchedAt
      : new Date().toISOString();

  const nextContestNumber =
    typeof obj.nextContestNumber === "number" &&
    Number.isInteger(obj.nextContestNumber) &&
    obj.nextContestNumber > 0
      ? obj.nextContestNumber
      : undefined;

  const nextContestDate =
    typeof obj.dataProximoConcurso === "string" && obj.dataProximoConcurso.trim()
      ? obj.dataProximoConcurso.trim()
      : typeof obj.nextContestDate === "string" && obj.nextContestDate.trim()
      ? obj.nextContestDate.trim()
      : undefined;

  const isAccumulated =
    typeof obj.acumulado === "boolean"
      ? obj.acumulado
      : typeof obj.isAccumulated === "boolean"
      ? obj.isAccumulated
      : undefined;

  let prizeReference: OfficialPrizeReference | undefined = undefined;
  if ("prizeReference" in obj && obj.prizeReference !== undefined) {
    try {
      prizeReference = validateAndNormalizeOfficialPrizeReference(
        obj.prizeReference,
        contestNumber,
        fetchedAt
      );
    } catch {
      // Isolamento V1.9: Falha na referência financeira (rateio inválido, incompleto ou duplicado)
      // descarta a prizeReference (tornando-a undefined), mas NÃO invalida o resultado oficial
      // principal com as 15 dezenas válidas.
      prizeReference = undefined;
    }
  }

  return {
    valid: true,
    data: {
      contestNumber,
      drawDate: trimmedDate,
      numbers: sortedNumbers,
      source,
      fetchedAt,
      nextContestNumber,
      nextContestDate,
      isAccumulated,
      prizeReference,
    },
  };
}

/**
 * Validador que lança LotteryFetchError caso a validação falhe.
 */
export function assertValidOfficialResult(
  raw: unknown,
  expectedContestNumber?: number,
  fallbackSource = "CAIXA"
): OfficialContestResult {
  const result = validateAndNormalizeOfficialResult(
    raw,
    expectedContestNumber,
    fallbackSource
  );

  if (!result.valid) {
    throw new LotteryFetchError(
      result.error,
      result.code,
      undefined,
      expectedContestNumber
    );
  }

  return result.data;
}
