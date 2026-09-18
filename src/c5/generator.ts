/**
 * Motor gerador da arquitetura combinatória C₅ para a Lotofácil.
 */
import {
  C5_SLOTS,
  LOTOFACIL_NUMBERS,
  getPresentGameIndices,
} from "./constants.ts";
import { defaultRNG, shuffleFisherYates } from "./random.ts";
import type { C5Generation, RNG } from "./types.ts";

/**
 * Gera um conjunto de 5 apostas da Lotofácil mapeadas sobre a arquitetura combinatória canônica C₅.
 *
 * O fluxo de geração é estritamente direto e determinístico:
 * 1. Gera uma única permutação uniforme das 25 dezenas (1..25) via Fisher-Yates;
 * 2. Mapeia de forma unívoca a permutação aos 25 slots canônicos;
 * 3. Deriva programaticamente os 5 jogos a partir dos pares de ausência definidos em cada slot;
 * 4. Ordena as dezenas dentro de cada jogo em ordem crescente para apresentação.
 *
 * @param rng Função geradora pseudo-aleatória opcional para injeção de dependência e testes.
 * @returns Instância completa de C5Generation com permutação, atribuição de slots e 5 jogos.
 */
export function generateC5(rng?: RNG): C5Generation {
  // 1. Permutação uniforme das 25 dezenas (criptográfica sem modulo bias)
  const permutation = shuffleFisherYates(LOTOFACIL_NUMBERS, rng);

  // 2. Mapeamento direto aos 25 slots canônicos
  const slotAssignments: Record<string, number> = {};
  for (let i = 0; i < C5_SLOTS.length; i++) {
    const slot = C5_SLOTS[i];
    slotAssignments[slot] = permutation[i];
  }

  // 3. Construção programática dos cinco jogos a partir dos pares de ausência
  const rawGames: [number[], number[], number[], number[], number[]] = [
    [],
    [],
    [],
    [],
    [],
  ];

  for (const slot of C5_SLOTS) {
    const num = slotAssignments[slot];
    const [gA, gB, gC] = getPresentGameIndices(slot);
    rawGames[gA].push(num);
    rawGames[gB].push(num);
    rawGames[gC].push(num);
  }

  // 4. Ordenação numérica interna de cada jogo para apresentação consistente
  const games: [number[], number[], number[], number[], number[]] = [
    [...rawGames[0]].sort((a, b) => a - b),
    [...rawGames[1]].sort((a, b) => a - b),
    [...rawGames[2]].sort((a, b) => a - b),
    [...rawGames[3]].sort((a, b) => a - b),
    [...rawGames[4]].sort((a, b) => a - b),
  ];

  return {
    permutation,
    slotAssignments,
    games,
  };
}
