/**
 * C5-Memory — Builder Estrutural Canônico e Validador Geométrico
 * Ordem Executiva IC2-R2 (C5-Memory-2.1.0)
 * 
 * Função estrutural pura:
 * Permutação das 25 dezenas (P) -> Candidato C5 com geometria estrutural exata.
 */

import { C5Game } from "./types";

/**
 * Valida se uma permutação das 25 dezenas é válida
 */
export function isValidPermutation25(p: readonly number[]): boolean {
  if (!Array.isArray(p) || p.length !== 25) return false;
  const set = new Set<number>();
  for (const n of p) {
    if (!Number.isInteger(n) || n < 1 || n > 25) return false;
    set.add(n);
  }
  return set.size === 25;
}

/**
 * Constrói os 5 jogos de um C5 Estrutural a partir de uma permutação das 25 dezenas (0-indexed).
 * 
 * Distribuição canônica dos slots:
 * Ciclo (multiplicidade 3):
 * - 12: P[0..2]
 * - 23: P[3..5]
 * - 34: P[6..8]
 * - 45: P[9..11]
 * - 51: P[12..14]
 * 
 * Diagonais (multiplicidade 2):
 * - 13: P[15..16]
 * - 14: P[17..18]
 * - 24: P[19..20]
 * - 25: P[21..22]
 * - 35: P[23..24]
 * 
 * Jogos resultantes:
 * J1 = 23 ∪ 34 ∪ 45 ∪ 24 ∪ 25 ∪ 35  (15 dezenas)
 * J2 = 34 ∪ 45 ∪ 51 ∪ 13 ∪ 14 ∪ 35  (15 dezenas)
 * J3 = 12 ∪ 45 ∪ 51 ∪ 14 ∪ 24 ∪ 25  (15 dezenas)
 * J4 = 12 ∪ 23 ∪ 51 ∪ 13 ∪ 25 ∪ 35  (15 dezenas)
 * J5 = 12 ∪ 23 ∪ 34 ∪ 13 ∪ 14 ∪ 24  (15 dezenas)
 */
export function buildStructuralC5(permutation: readonly number[]): C5Game[] {
  if (!isValidPermutation25(permutation)) {
    throw new Error("buildStructuralC5 exige uma permutação válida das 25 dezenas [1..25].");
  }

  const s12 = [permutation[0], permutation[1], permutation[2]];
  const s23 = [permutation[3], permutation[4], permutation[5]];
  const s34 = [permutation[6], permutation[7], permutation[8]];
  const s45 = [permutation[9], permutation[10], permutation[11]];
  const s51 = [permutation[12], permutation[13], permutation[14]];

  const s13 = [permutation[15], permutation[16]];
  const s14 = [permutation[17], permutation[18]];
  const s24 = [permutation[19], permutation[20]];
  const s25 = [permutation[21], permutation[22]];
  const s35 = [permutation[23], permutation[24]];

  const j1 = [...s23, ...s34, ...s45, ...s24, ...s25, ...s35].sort((a, b) => a - b);
  const j2 = [...s34, ...s45, ...s51, ...s13, ...s14, ...s35].sort((a, b) => a - b);
  const j3 = [...s12, ...s45, ...s51, ...s14, ...s24, ...s25].sort((a, b) => a - b);
  const j4 = [...s12, ...s23, ...s51, ...s13, ...s25, ...s35].sort((a, b) => a - b);
  const j5 = [...s12, ...s23, ...s34, ...s13, ...s14, ...s24].sort((a, b) => a - b);

  return [j1, j2, j3, j4, j5];
}

/**
 * Valida rigorosamente se um conjunto de jogos satisfaz todas as invariantes geométricas do C5:
 * 1. Exatamente 5 jogos
 * 2. Exatamente 15 dezenas por jogo, domínio 1..25, ordenadas e sem repetição
 * 3. 5 jogos distintos
 * 4. Frequência global = 3 para todas as 25 dezenas
 * 5. Interseções entre os 10 pares ordenadas: [7, 7, 7, 7, 7, 8, 8, 8, 8, 8]
 */
export function isStructuralC5(c5Games: readonly (readonly number[])[]): boolean {
  if (!Array.isArray(c5Games) || c5Games.length !== 5) return false;

  const signatures = new Set<string>();
  const freq = new Array(26).fill(0);

  for (const game of c5Games) {
    if (!Array.isArray(game) || game.length !== 15) return false;
    const gameSet = new Set<number>();
    for (let i = 0; i < 15; i++) {
      const n = game[i];
      if (!Number.isInteger(n) || n < 1 || n > 25) return false;
      if (i > 0 && n <= game[i - 1]) return false;
      gameSet.add(n);
      freq[n]++;
    }
    if (gameSet.size !== 15) return false;
    signatures.add(game.join("-"));
  }

  if (signatures.size !== 5) return false;

  for (let n = 1; n <= 25; n++) {
    if (freq[n] !== 3) return false;
  }

  const intersections: number[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const gA = c5Games[i];
      const gB = c5Games[j];
      const common = gA.filter((x: number) => gB.includes(x)).length;
      intersections.push(common);
    }
  }
  intersections.sort((a, b) => a - b);
  const expected = [7, 7, 7, 7, 7, 8, 8, 8, 8, 8];

  for (let i = 0; i < 10; i++) {
    if (intersections[i] !== expected[i]) return false;
  }

  return true;
}
