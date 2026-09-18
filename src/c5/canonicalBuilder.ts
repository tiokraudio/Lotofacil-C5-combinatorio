/**
 * Construtor Canônico C₅ (Arquitetura Combinatória Lotofácil).
 *
 * Mapeamento determinístico puro:
 * Permutação (25 dezenas) -> Atribuição de Slots -> 5 Jogos Ordenados.
 *
 * Requisitos de pureza:
 * - Não usa RNG
 * - Não persiste
 * - Não gera UUID
 * - Não gera timestamp
 * - Não consulta APIs externas
 * - Única implementação oficial em todo o sistema.
 */
import { C5_SLOTS, getPresentGameIndices } from "./constants.ts";
import type { C5Generation } from "./types.ts";

/**
 * Constrói uma instância C5Generation a partir de uma permutação das 25 dezenas.
 *
 * @param permutation Array de 25 dezenas (1..25).
 * @returns Instância pura de C5Generation com permutação, atribuição de slots e 5 jogos ordenados.
 */
export function buildC5FromPermutation(permutation: number[]): C5Generation {
  if (permutation.length !== 25) {
    throw new Error(
      `Permutação deve conter exatamente 25 dezenas, recebido ${permutation.length}`
    );
  }

  // Mapeamento direto aos 25 slots canônicos
  const slotAssignments: Record<string, number> = {};
  for (let i = 0; i < C5_SLOTS.length; i++) {
    const slot = C5_SLOTS[i];
    slotAssignments[slot] = permutation[i];
  }

  // Construção programática dos cinco jogos a partir dos pares de ausência
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

  // Ordenação numérica interna de cada jogo para apresentação consistente
  const games: [number[], number[], number[], number[], number[]] = [
    [...rawGames[0]].sort((a, b) => a - b),
    [...rawGames[1]].sort((a, b) => a - b),
    [...rawGames[2]].sort((a, b) => a - b),
    [...rawGames[3]].sort((a, b) => a - b),
    [...rawGames[4]].sort((a, b) => a - b),
  ];

  return {
    permutation: [...permutation],
    slotAssignments,
    games,
  };
}
