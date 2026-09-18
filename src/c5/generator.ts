/**
 * Motor gerador da arquitetura combinatória C₅ para a Lotofácil.
 */
import { LOTOFACIL_NUMBERS } from "./constants.ts";
import { shuffleFisherYates } from "./random.ts";
import { buildC5FromPermutation } from "./canonicalBuilder.ts";
import type { C5Generation, RNG } from "./types.ts";

export { buildC5FromPermutation };

/**
 * Gera um conjunto de 5 apostas da Lotofácil mapeadas sobre a arquitetura combinatória canônica C₅.
 *
 * O fluxo de geração é estritamente direto e determinístico:
 * 1. Gera uma única permutação uniforme das 25 dezenas (1..25) via Fisher-Yates;
 * 2. Constrói a geração C₅ via builder canônico único (buildC5FromPermutation).
 *
 * @param rng Função geradora pseudo-aleatória opcional para injeção de dependência e testes.
 * @returns Instância completa de C5Generation com permutação, atribuição de slots e 5 jogos.
 */
export function generateC5(rng?: RNG): C5Generation {
  // 1. Permutação uniforme das 25 dezenas (criptográfica sem modulo bias)
  const permutation = shuffleFisherYates(LOTOFACIL_NUMBERS, rng);

  // 2. Construção canônica via builder único
  return buildC5FromPermutation(permutation);
}
