import { C5Game } from "./types";

/**
 * Validação canônica de um jogo Lotofácil
 */
export function isValidLotofacilGame(game: readonly number[]): boolean {
  if (!Array.isArray(game) || game.length !== 15) return false;
  const set = new Set<number>();
  for (let i = 0; i < game.length; i++) {
    const n = game[i];
    if (!Number.isInteger(n) || n < 1 || n > 25) return false;
    if (i > 0 && n <= game[i - 1]) return false; // Deve ser estritamente crescente
    set.add(n);
  }
  return set.size === 15;
}

/**
 * Quantidade de dezenas coincidentes entre dois jogos
 */
export function countIntersection(a: readonly number[], b: readonly number[]): number {
  let count = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      count++;
      i++;
      j++;
    } else if (a[i] < b[j]) {
      i++;
    } else {
      j++;
    }
  }
  return count;
}

/**
 * Distância combinatória entre dois jogos: 15 - dezenas em comum (Implementação de Referência eafbd3c)
 */
export function distanceBetweenGamesReference(a: readonly number[], b: readonly number[]): number {
  return 15 - countIntersection(a, b);
}

export function distanceBetweenGames(a: readonly number[], b: readonly number[]): number {
  return 15 - countIntersection(a, b);
}

// Tabela estática de 16-bit popcount pré-calculada para resolução O(1) ultrarrápida
const POPCOUNT_16_TABLE = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) {
  let count = 0;
  let x = i;
  while (x > 0) {
    count += x & 1;
    x >>>= 1;
  }
  POPCOUNT_16_TABLE[i] = count;
}

/**
 * Popcount determinístico e exato para inteiros de até 25 bits
 */
export function fastPopcount25(v: number): number {
  return POPCOUNT_16_TABLE[v & 0xffff] + POPCOUNT_16_TABLE[v >>> 16];
}

/**
 * Converte jogo Lotofácil canônico (15 dezenas 1..25) para máscara de 25 bits
 */
export function gameToMask25(game: readonly number[]): number {
  let mask = 0;
  const len = game.length;
  for (let i = 0; i < len; i++) {
    mask |= 1 << (game[i] - 1);
  }
  return mask;
}

/**
 * Distância combinatória via bitmasks de 25 bits
 */
export function distanceBetweenMasks(maskA: number, maskB: number): number {
  return 15 - fastPopcount25(maskA & maskB);
}

/**
 * Distância mínima de um jogo até o conjunto histórico H (Implementação de Referência eafbd3c)
 */
export function minDistanceToHistoryReference(game: readonly number[], history: readonly C5Game[]): number {
  if (history.length === 0) return 15;
  let min = 15;
  for (let i = 0; i < history.length; i++) {
    const d = distanceBetweenGamesReference(game, history[i]);
    if (d < min) {
      min = d;
      if (min === 0) break;
    }
  }
  return min;
}

/**
 * Distância mínima de um jogo até o conjunto histórico H (Implementação Otimizada Exata via Bitmask Popcount)
 * Matematicamente e estritamente equivalente a minDistanceToHistoryReference.
 */
export function minDistanceToHistory(game: readonly number[], history: readonly C5Game[]): number {
  const hLen = history.length;
  if (hLen === 0) return 15;
  const gMask = gameToMask25(game);
  let maxHit = 0;
  for (let i = 0; i < hLen; i++) {
    const hit = fastPopcount25(gMask & gameToMask25(history[i]));
    if (hit > maxHit) {
      maxHit = hit;
      if (maxHit === 15) return 0;
    }
  }
  return 15 - maxHit;
}

/**
 * Avaliação ultrarrápida da distância mínima de uma máscara contra um buffer contíguo de máscaras de histórico.
 */
export function minDistanceToHistoryMasks(
  gameMask: number,
  historyMasks: Int32Array,
  historyCount: number
): number {
  if (historyCount === 0) return 15;
  let maxHit = 0;
  for (let i = 0; i < historyCount; i++) {
    const hit = fastPopcount25(gameMask & historyMasks[i]);
    if (hit > maxHit) {
      maxHit = hit;
      if (maxHit === 15) return 0;
    }
  }
  return 15 - maxHit;
}

/**
 * Perfil Leximin de um candidato C5 (5 jogos) em relação ao histórico H (Implementação de Referência eafbd3c)
 */
export function computeLeximinProfileReference(
  candidateGames: readonly C5Game[],
  history: readonly C5Game[]
): readonly number[] {
  const profile = candidateGames.map(game => minDistanceToHistoryReference(game, history));
  return profile.sort((a, b) => a - b);
}

/**
 * Perfil Leximin de um candidato C5 (5 jogos) em relação ao histórico H (Implementação Otimizada Exata)
 */
export function computeLeximinProfile(
  candidateGames: readonly C5Game[],
  history: readonly C5Game[]
): readonly number[] {
  const profile = candidateGames.map(game => minDistanceToHistory(game, history));
  return profile.sort((a, b) => a - b);
}

/**
 * Perfil Leximin a partir de máscaras pré-computadas contra histórico em Int32Array
 */
export function computeLeximinProfileMasks(
  candidateMasks: readonly number[],
  historyMasks: Int32Array,
  historyCount: number
): readonly number[] {
  const p = [
    minDistanceToHistoryMasks(candidateMasks[0], historyMasks, historyCount),
    minDistanceToHistoryMasks(candidateMasks[1], historyMasks, historyCount),
    minDistanceToHistoryMasks(candidateMasks[2], historyMasks, historyCount),
    minDistanceToHistoryMasks(candidateMasks[3], historyMasks, historyCount),
    minDistanceToHistoryMasks(candidateMasks[4], historyMasks, historyCount),
  ];
  return p.sort((a, b) => a - b);
}

/**
 * Comparação Leximin entre dois perfis:
 * Retorna > 0 se profileA > profileB (A maximiza o leximin)
 * Retorna < 0 se profileA < profileB
 * Retorna 0 se idênticos
 */
export function compareLeximin(profileA: readonly number[], profileB: readonly number[]): number {
  for (let i = 0; i < Math.min(profileA.length, profileB.length); i++) {
    if (profileA[i] !== profileB[i]) {
      return profileA[i] - profileB[i];
    }
  }
  return 0;
}

/**
 * Cálculo de acertos de um jogo frente a um resultado oficial
 */
export function calculateHits(game: readonly number[], officialResult: readonly number[]): number {
  return countIntersection(game, officialResult);
}
