/**
 * Constantes e mapeamentos estruturais da geometria combinatória C₅.
 */
import { C5_SLOTS, type C5Slot } from "./types.ts";

export { C5_SLOTS, type C5Slot };

/**
 * Dezenas oficiais da Lotofácil (1 a 25).
 */
export const LOTOFACIL_NUMBERS: readonly number[] = Object.freeze(
  Array.from({ length: 25 }, (_, i) => i + 1)
);

export const TOTAL_NUMBERS = 25;
export const GAME_COUNT = 5;
export const GAME_SIZE = 15;
export const OCCURRENCES_PER_NUMBER = 3;

/**
 * Os 10 pares canônicos de jogos para cálculo de interseções.
 */
export const GAME_PAIRS = [
  { pair: "J1∩J2", g1: 0, g2: 1, type: "cycle" },
  { pair: "J1∩J3", g1: 0, g2: 2, type: "diagonal" },
  { pair: "J1∩J4", g1: 0, g2: 3, type: "diagonal" },
  { pair: "J1∩J5", g1: 0, g2: 4, type: "cycle" },
  { pair: "J2∩J3", g1: 1, g2: 2, type: "cycle" },
  { pair: "J2∩J4", g1: 1, g2: 3, type: "diagonal" },
  { pair: "J2∩J5", g1: 1, g2: 4, type: "diagonal" },
  { pair: "J3∩J4", g1: 2, g2: 3, type: "cycle" },
  { pair: "J3∩J5", g1: 2, g2: 4, type: "diagonal" },
  { pair: "J4∩J5", g1: 3, g2: 4, type: "cycle" },
] as const;

/**
 * Extrai os dois índices de jogos (1..5) onde o slot indica AUSÊNCIA.
 * Exemplo: '12a' -> [1, 2], '51b' -> [5, 1], '35a' -> [3, 5].
 */
export function getAbsentGameNumbers(slot: string): [number, number] {
  const g1 = Number.parseInt(slot[0], 10);
  const g2 = Number.parseInt(slot[1], 10);
  return [g1, g2];
}

/**
 * Retorna os três índices de jogos (0..4, base zero) onde a dezena deste slot DEVE ESTAR PRESENTE.
 * Exemplo: '12a' (ausente de J1, J2) -> presente nos jogos de índice 2, 3, 4 (J3, J4, J5).
 */
export function getPresentGameIndices(slot: string): [number, number, number] {
  const [g1, g2] = getAbsentGameNumbers(slot);
  const absentSet = new Set([g1, g2]);
  const present: number[] = [];
  for (let gameNum = 1; gameNum <= 5; gameNum++) {
    if (!absentSet.has(gameNum)) {
      present.push(gameNum - 1); // 0-indexed
    }
  }
  return [present[0], present[1], present[2]];
}

/**
 * Retorna os dois índices de jogos (0..4, base zero) onde a dezena deste slot DEVE ESTAR AUSENTE.
 */
export function getAbsentGameIndices(slot: string): [number, number] {
  const [g1, g2] = getAbsentGameNumbers(slot);
  return [g1 - 1, g2 - 1];
}
