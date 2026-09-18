/**
 * Módulo de pontuação e auditoria de resultados para a arquitetura combinatória C₅ da Lotofácil.
 */
import { validateC5 } from "./validator.ts";
import type {
  C5Generation,
  C5Score,
  GameScore,
  HitCount,
  PrizeCounts,
} from "./types.ts";

/**
 * Valida de forma independente um resultado da Lotofácil.
 *
 * Exigências:
 * - Deve ser um array contendo exatamente 15 elementos;
 * - Todos os elementos devem ser números inteiros;
 * - Todos os elementos devem pertencer ao domínio [1, 25];
 * - Não pode haver dezenas repetidas.
 *
 * @param result Array contendo as dezenas sorteadas.
 * @returns Array com as 15 dezenas validadas e ordenadas numericamente.
 * @throws Error com mensagem detalhada caso qualquer regra seja violada.
 */
export function validateOfficialResult(result: unknown): number[] {
  if (!Array.isArray(result)) {
    throw new Error("Resultado oficial inválido: deve ser um array.");
  }

  if (result.length !== 15) {
    throw new Error(
      `Resultado oficial inválido: deve conter exatamente 15 dezenas (recebido ${result.length}).`
    );
  }

  const seen = new Set<number>();
  const validatedNumbers: number[] = [];

  for (let i = 0; i < result.length; i++) {
    const val = result[i];

    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new Error(
        `Resultado oficial inválido: elemento no índice ${i} não é um número válido (${String(val)}).`
      );
    }

    if (!Number.isInteger(val)) {
      throw new Error(
        `Resultado oficial inválido: a dezena ${val} não é um número inteiro.`
      );
    }

    if (val < 1 || val > 25) {
      throw new Error(
        `Resultado oficial inválido: a dezena ${val} está fora do domínio 1..25.`
      );
    }

    if (seen.has(val)) {
      throw new Error(
        `Resultado oficial inválido: a dezena ${val} está duplicada no resultado.`
      );
    }

    seen.add(val);
    validatedNumbers.push(val);
  }

  // Retorna cópia ordenada ascendentemente sem mutar a entrada
  return validatedNumbers.sort((a, b) => a - b);
}

/**
 * Calcula a pontuação e auditoria completa de uma geração C₅ frente a um resultado oficial.
 *
 * Esta função é determinística, pura e não mutaciona nenhum argumento recebido.
 * Antes de calcular acertos, ela valida independentemente tanto o resultado oficial
 * quanto a geração C₅ recebida (através de validateC5).
 *
 * @param generation Instância de C5Generation a ser pontuada.
 * @param result Array de 15 dezenas oficiais da Lotofácil (1..25).
 * @returns Instância completa de C5Score com pontuações individuais, premiações e auditoria.
 * @throws Error se o resultado oficial for inválido ou se a geração violar qualquer invariante C₅.
 */
export function scoreC5(
  generation: C5Generation,
  result: readonly number[]
): C5Score {
  // 1. Validação estrita e independente do resultado oficial
  const validatedResult = validateOfficialResult(result);
  const resultSet = new Set(validatedResult);

  // 2. Validação da geração C₅ antes da pontuação
  const genValidation = validateC5(generation);
  if (!genValidation.valid) {
    throw new Error(
      `Geração C5 inválida fornecida para pontuação: ${genValidation.errors.join("; ")}`
    );
  }

  // 3. Pontuação de cada um dos 5 jogos
  const gameScores: GameScore[] = [];
  const prizeCounts: PrizeCounts = {
    hits11: 0,
    hits12: 0,
    hits13: 0,
    hits14: 0,
    hits15: 0,
  };

  const gameIndices: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];

  for (let i = 0; i < 5; i++) {
    const game = generation.games[i];
    const gameIndex = gameIndices[i];

    const matchedNumbers: number[] = [];
    const missedNumbers: number[] = [];

    for (const num of game) {
      if (resultSet.has(num)) {
        matchedNumbers.push(num);
      } else {
        missedNumbers.push(num);
      }
    }

    matchedNumbers.sort((a, b) => a - b);
    missedNumbers.sort((a, b) => a - b);

    const hits = matchedNumbers.length as HitCount;

    // Invariantes adicionais de integridade interna
    if (matchedNumbers.length + missedNumbers.length !== 15) {
      throw new Error(
        `Incoerência interna na pontuação do jogo J${gameIndex}: matched (${matchedNumbers.length}) + missed (${missedNumbers.length}) !== 15.`
      );
    }

    if (hits === 11) prizeCounts.hits11++;
    else if (hits === 12) prizeCounts.hits12++;
    else if (hits === 13) prizeCounts.hits13++;
    else if (hits === 14) prizeCounts.hits14++;
    else if (hits === 15) prizeCounts.hits15++;

    gameScores.push({
      gameIndex,
      hits,
      matchedNumbers,
      missedNumbers,
    });
  }

  // 4. Melhor resultado do portfólio (M_t = max(H1..H5))
  let maxHits: HitCount = 0;
  for (const gs of gameScores) {
    if (gs.hits > maxHits) {
      maxHits = gs.hits;
    }
  }

  // 5. Jogos com a melhor pontuação (trata empates)
  const bestGameIndexes: Array<1 | 2 | 3 | 4 | 5> = [];
  for (const gs of gameScores) {
    if (gs.hits === maxHits) {
      bestGameIndexes.push(gs.gameIndex);
    }
  }

  // 6. Flags cumulativas
  const has11Plus = maxHits >= 11;
  const has12Plus = maxHits >= 12;
  const has13Plus = maxHits >= 13;
  const has14Plus = maxHits >= 14;
  const has15 = maxHits === 15;

  return {
    result: validatedResult,
    games: [
      gameScores[0],
      gameScores[1],
      gameScores[2],
      gameScores[3],
      gameScores[4],
    ],
    maxHits,
    bestGameIndexes,
    prizeCounts,
    has11Plus,
    has12Plus,
    has13Plus,
    has14Plus,
    has15,
  };
}
