/**
 * Combinatória Canônica e Estrutura de Bitset para Pesquisa Longitudinal
 * Ordem Executiva IC9 — C5-Memory-2.1.0
 */

import { syncSha256 } from "../sha256";

export const UNIVERSE_TOTAL_OUTCOMES = 3268760; // C(25, 15)
export const BITSET_BYTE_SIZE = 408595; // 3268760 / 8

// Tabela estática de coeficientes binomiais C(n, k) para n, k <= 25
const BINOM_TABLE: number[][] = [];
for (let n = 0; n <= 25; n++) {
  BINOM_TABLE[n] = [];
  for (let k = 0; k <= 25; k++) {
    if (k === 0 || k === n) {
      BINOM_TABLE[n][k] = 1;
    } else if (k > n || k < 0) {
      BINOM_TABLE[n][k] = 0;
    } else {
      let val = 1;
      for (let i = 1; i <= k; i++) {
        val = (val * (n - i + 1)) / i;
      }
      BINOM_TABLE[n][k] = val;
    }
  }
}

/**
 * Mapeamento bijetivo canônico de um jogo ordenado de 15 dezenas (1..25)
 * para um índice escalar no intervalo [0, 3268759] via combinatorial number system (combinadic).
 */
export function gameToOutcomeIndex(game: readonly number[]): number {
  if (game.length !== 15) {
    throw new Error(`Jogo inválido para indexação combinatorial: tamanho ${game.length}`);
  }
  let index = 0;
  for (let i = 0; i < 15; i++) {
    const a = game[i] - 1; // 0..24
    index += BINOM_TABLE[a][i + 1];
  }
  return index;
}

/**
 * Expande um jogo Lotofácil (15 dezenas) nos seus 151 resultados com acerto >= 14:
 * - 1 resultado com 15 acertos (o próprio jogo)
 * - 150 resultados com 14 acertos (substituindo 1 das 15 dezenas por 1 das 10 externas)
 */
export function getOutcomes14Plus(game: readonly number[]): number[] {
  const outcomes: number[] = new Array(151);
  outcomes[0] = gameToOutcomeIndex(game);

  const gameSet = new Set(game);
  const outsideDezenas: number[] = [];
  for (let d = 1; d <= 25; d++) {
    if (!gameSet.has(d)) {
      outsideDezenas.push(d);
    }
  }

  let outIdx = 1;
  // Para cada uma das 15 dezenas do jogo a ser removida:
  for (let dropIdx = 0; dropIdx < 15; dropIdx++) {
    const base = new Array<number>(14);
    let bi = 0;
    for (let gi = 0; gi < 15; gi++) {
      if (gi !== dropIdx) {
        base[bi++] = game[gi];
      }
    }

    // Para cada uma das 10 dezenas externas a ser adicionada:
    for (let oi = 0; oi < 10; oi++) {
      const addNum = outsideDezenas[oi];
      const combo = new Array<number>(15);
      let inserted = false;
      let ci = 0;
      for (let k = 0; k < 14; k++) {
        if (!inserted && addNum < base[k]) {
          combo[ci++] = addNum;
          inserted = true;
        }
        combo[ci++] = base[k];
      }
      if (!inserted) {
        combo[ci++] = addNum;
      }

      outcomes[outIdx++] = gameToOutcomeIndex(combo);
    }
  }

  return outcomes;
}

/**
 * Mapeamento inverso canônico: de um índice escalar [0, 3268759]
 * para o jogo correspondente de 15 dezenas (1..25) ordenado ascendentemente.
 */
export function outcomeIndexToGame(index: number): number[] {
  if (index < 0 || index >= UNIVERSE_TOTAL_OUTCOMES) {
    throw new Error(`Índice fora do universo C(25, 15): ${index}`);
  }
  const game = new Array<number>(15);
  let rem = index;
  let currentA = 24;
  for (let i = 14; i >= 0; i--) {
    while (BINOM_TABLE[currentA][i + 1] > rem) {
      currentA--;
    }
    game[i] = currentA + 1;
    rem -= BINOM_TABLE[currentA][i + 1];
    currentA--;
  }
  return game;
}

/**
 * Retorna os resultados com 15 acertos (exatamente 1 resultado: o próprio jogo)
 */
export function getOutcomes15(game: readonly number[]): number[] {
  return [gameToOutcomeIndex(game)];
}

/**
 * Avaliador de Cobertura de Referência sobre um conjunto de amostras ou universo
 */
export function countCoveredOutcomesReference(
  games: readonly (readonly number[])[],
  minHits: number,
  sampleOutcomes: readonly (readonly number[])[]
): number {
  let coveredCount = 0;
  for (const outcome of sampleOutcomes) {
    let maxHit = 0;
    for (const g of games) {
      let hit = 0;
      let i = 0;
      let j = 0;
      while (i < g.length && j < outcome.length) {
        if (g[i] === outcome[j]) { hit++; i++; j++; }
        else if (g[i] < outcome[j]) { i++; }
        else { j++; }
      }
      if (hit > maxHit) maxHit = hit;
      if (maxHit >= minHits) break;
    }
    if (maxHit >= minHits) {
      coveredCount++;
    }
  }
  return coveredCount;
}

/**
 * Tabela rápida de popcount de 8 bits
 */
const POPCOUNT_8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let c = 0;
  let v = i;
  while (v > 0) {
    c += v & 1;
    v >>= 1;
  }
  POPCOUNT_8[i] = c;
}

/**
 * Bitset compacto representando o universo de combinações C(25, 15).
 * Tamanho exato: 3.268.760 bits = 408.595 bytes.
 */
export class OutcomeBitset {
  public readonly buffer: Uint8Array;

  constructor(existingBuffer?: Uint8Array) {
    if (existingBuffer) {
      if (existingBuffer.length !== BITSET_BYTE_SIZE) {
        throw new Error(
          `Buffer de bitset inválido: esperado ${BITSET_BYTE_SIZE} bytes, recebido ${existingBuffer.length}`
        );
      }
      this.buffer = new Uint8Array(existingBuffer);
    } else {
      this.buffer = new Uint8Array(BITSET_BYTE_SIZE);
    }
  }

  /**
   * Seta o bit no índice indicado. Retorna true se o bit era 0 e foi setado, false se já era 1.
   */
  public set(index: number): boolean {
    if (index < 0 || index >= UNIVERSE_TOTAL_OUTCOMES) {
      throw new Error(`Índice fora do universo C(25,15): ${index}`);
    }
    const byteIdx = index >> 3;
    const bitMask = 1 << (index & 7);
    const prev = this.buffer[byteIdx];
    if ((prev & bitMask) === 0) {
      this.buffer[byteIdx] = prev | bitMask;
      return true;
    }
    return false;
  }

  /**
   * Verifica se o bit está ativo.
   */
  public get(index: number): boolean {
    if (index < 0 || index >= UNIVERSE_TOTAL_OUTCOMES) {
      throw new Error(`Índice fora do universo C(25,15): ${index}`);
    }
    return (this.buffer[index >> 3] & (1 << (index & 7))) !== 0;
  }

  /**
   * Retorna a contagem exata de bits ativos (popcount do universo coberto).
   */
  public countOnes(): number {
    let count = 0;
    const len = this.buffer.length;
    for (let i = 0; i < len; i++) {
      count += POPCOUNT_8[this.buffer[i]];
    }
    return count;
  }

  /**
   * Clona a instância
   */
  public clone(): OutcomeBitset {
    return new OutcomeBitset(new Uint8Array(this.buffer));
  }

  /**
   * Converte para Base64
   */
  public toBase64(): string {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(this.buffer).toString("base64");
    }
    let binary = "";
    const len = this.buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(this.buffer[i]);
    }
    return btoa(binary);
  }

  /**
   * Reconstrói a partir de Base64
   */
  public static fromBase64(base64: string): OutcomeBitset {
    if (typeof Buffer !== "undefined") {
      const buf = Buffer.from(base64, "base64");
      return new OutcomeBitset(new Uint8Array(buf));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new OutcomeBitset(bytes);
  }

  /**
   * Calcula o SHA-256 do buffer bruto do bitset
   */
  public sha256(): string {
    return syncSha256(this.toBase64());
  }
}

// Amostra canônica determinística de 250 jogos do universo C(25, 15) para avaliação metrológica de referência
export const CANONICAL_REFERENCE_SAMPLE_SIZE = 250;
export const CANONICAL_REFERENCE_SAMPLE_OUTCOMES: readonly (readonly number[])[] = (() => {
  const sample: number[][] = new Array(CANONICAL_REFERENCE_SAMPLE_SIZE);
  const step = Math.floor(UNIVERSE_TOTAL_OUTCOMES / CANONICAL_REFERENCE_SAMPLE_SIZE);
  for (let i = 0; i < CANONICAL_REFERENCE_SAMPLE_SIZE; i++) {
    const idx = (i * step + 137) % UNIVERSE_TOTAL_OUTCOMES;
    sample[i] = outcomeIndexToGame(idx);
  }
  return sample;
})();

export interface HierarchicalCoverageResult {
  readonly coverage15: number;
  readonly coverage14Plus: number;
  readonly coverage13Plus: number;
  readonly coverage12Plus: number;
  readonly coverage11Plus: number;
}

/**
 * Avalia de forma cientificamente íntegra a hierarquia completa de coberturas
 * garantindo monotonicidade estrita: Cov(15) <= Cov(14+) <= Cov(13+) <= Cov(12+) <= Cov(11+)
 * e eliminando quaisquer multiplicadores arbitrários.
 */
export function evaluateHierarchicalCoverage(
  games: readonly (readonly number[])[],
  bitset14Plus: OutcomeBitset,
  uniqueGamesCount: number
): HierarchicalCoverageResult {
  const coverage15 = uniqueGamesCount;
  const coverage14Plus = bitset14Plus.countOnes();

  // Avaliação metrológica sobre amostra canônica determinística congelada
  const c13Sample = countCoveredOutcomesReference(games, 13, CANONICAL_REFERENCE_SAMPLE_OUTCOMES);
  const c12Sample = countCoveredOutcomesReference(games, 12, CANONICAL_REFERENCE_SAMPLE_OUTCOMES);
  const c11Sample = countCoveredOutcomesReference(games, 11, CANONICAL_REFERENCE_SAMPLE_OUTCOMES);

  const c13Est = Math.round((c13Sample / CANONICAL_REFERENCE_SAMPLE_SIZE) * UNIVERSE_TOTAL_OUTCOMES);
  const c12Est = Math.round((c12Sample / CANONICAL_REFERENCE_SAMPLE_SIZE) * UNIVERSE_TOTAL_OUTCOMES);
  const c11Est = Math.round((c11Sample / CANONICAL_REFERENCE_SAMPLE_SIZE) * UNIVERSE_TOTAL_OUTCOMES);

  // Invariante de inclusão estrita: Cov(15) <= Cov(14+) <= Cov(13+) <= Cov(12+) <= Cov(11+)
  const coverage13Plus = Math.min(UNIVERSE_TOTAL_OUTCOMES, Math.max(coverage14Plus, c13Est));
  const coverage12Plus = Math.min(UNIVERSE_TOTAL_OUTCOMES, Math.max(coverage13Plus, c12Est));
  const coverage11Plus = Math.min(UNIVERSE_TOTAL_OUTCOMES, Math.max(coverage12Plus, c11Est));

  return {
    coverage15,
    coverage14Plus,
    coverage13Plus,
    coverage12Plus,
    coverage11Plus,
  };
}
