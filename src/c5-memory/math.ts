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
 * Distância combinatória entre dois jogos: 15 - dezenas em comum
 */
export function distanceBetweenGames(a: readonly number[], b: readonly number[]): number {
  return 15 - countIntersection(a, b);
}

/**
 * Distância mínima de um jogo até o conjunto histórico H
 */
export function minDistanceToHistory(game: readonly number[], history: readonly C5Game[]): number {
  if (history.length === 0) return 15;
  let min = 15;
  for (let i = 0; i < history.length; i++) {
    const d = distanceBetweenGames(game, history[i]);
    if (d < min) {
      min = d;
      if (min === 0) break;
    }
  }
  return min;
}

/**
 * Perfil Leximin de um candidato C5 (5 jogos) em relação ao histórico H
 * Retorna vetor de 5 distâncias ordenado crescentemente: [d1, d2, d3, d4, d5]
 */
export function computeLeximinProfile(
  candidateGames: readonly C5Game[],
  history: readonly C5Game[]
): readonly number[] {
  const profile = candidateGames.map(game => minDistanceToHistory(game, history));
  return profile.sort((a, b) => a - b);
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
