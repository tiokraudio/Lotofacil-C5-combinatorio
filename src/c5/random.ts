/**
 * Módulo de randomização estritamente criptográfico com embaralhamento uniforme
 * de Fisher-Yates, sem modulo bias e com suporte a RNG injetável para testes.
 */
import type { RNG } from "./types.ts";

/**
 * Gera um inteiro uniforme estritamente no intervalo [0, maxExclusive)
 * utilizando a API nativa criptográfica globalThis.crypto.getRandomValues
 * com amostragem por rejeição (rejection sampling) para eliminação absoluta
 * de viés de módulo (modulo bias).
 *
 * @param maxExclusive Limite superior exclusivo (ex: 25 para intervalo [0, 24]).
 * @returns Inteiro criptograficamente uniforme em [0, maxExclusive).
 */
export function cryptoRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  // Usamos inteiros de 32 bits sem sinal (2^32 = 4.294.967.296)
  const uint32 = new Uint32Array(1);
  const maxUint32 = 0x100000000; // 4294967296
  const limit = maxUint32 - (maxUint32 % maxExclusive);

  let val: number;
  do {
    globalThis.crypto.getRandomValues(uint32);
    val = uint32[0];
  } while (val >= limit);

  return val % maxExclusive;
}

/**
 * RNG padrão criptográfico baseado em globalThis.crypto.getRandomValues.
 * Gera floats uniformes em [0, 1). Substitui Math.random em produção.
 */
export const defaultRNG: RNG = () => {
  const uint32 = new Uint32Array(1);
  globalThis.crypto.getRandomValues(uint32);
  return uint32[0] / 4294967296;
};

/**
 * Cria um gerador determinístico pseudo-aleatório baseado no algoritmo Mulberry32.
 * Utilizado EXCLUSIVAMENTE para testes unitários repetíveis, depuração e simulações com seed fixo.
 * NUNCA utilizado na geração oficial de produção.
 *
 * @param seed Inteiro de 32 bits utilizado como semente inicial.
 * @returns Função RNG compatível gerando floats uniformes em [0, 1).
 */
export function createMulberry32(seed: number): RNG {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Embaralha um array de forma uniforme utilizando o algoritmo Fisher-Yates (Knuth shuffle).
 *
 * Em produção (quando rng não é fornecido ou é defaultRNG), utiliza seleção inteira nativa
 * via cryptoRandomInt (globalThis.crypto.getRandomValues com rejection sampling), garantindo:
 * 1. Nenhuma dependência de Math.random();
 * 2. Ausência total de viés de módulo (zero modulo bias);
 * 3. Todas as 25! permutações com probabilidade estritamente idêntica (1 / 25!).
 *
 * Se um rng customizado for fornecido (ex: createMulberry32 para testes unitários com seed fixo),
 * utiliza o gerador fornecido.
 *
 * @param array Array a ser permutado (não mutacionado).
 * @param rng Função opcional geradora de números uniformes [0, 1).
 * @returns Um novo array contendo a permutação uniforme gerada.
 */
export function shuffleFisherYates<T>(
  array: readonly T[],
  rng?: RNG
): T[] {
  const result = [...array];
  // Se rng não for fornecido ou for o defaultRNG criptográfico, usa seleção inteira direta sem modulo bias
  const useCryptoDirect = !rng || rng === defaultRNG;

  for (let i = result.length - 1; i > 0; i--) {
    const j = useCryptoDirect ? cryptoRandomInt(i + 1) : Math.floor(rng() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

