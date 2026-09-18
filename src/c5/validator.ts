/**
 * Validador independente para a arquitetura combinatória C₅.
 *
 * Realiza a conferência exaustiva de 9 invariantes matemáticas (A até I)
 * sem assumir conformidade a priori do gerador.
 */
import {
  C5_SLOTS,
  GAME_PAIRS,
  getAbsentGameIndices,
  getPresentGameIndices,
} from "./constants.ts";
import type { C5Generation, C5ValidationResult } from "./types.ts";

/**
 * Valida de forma independente todas as invariantes canônicas de uma geração C₅.
 *
 * @param generation Objeto gerado contendo permutation, slotAssignments e games.
 * @returns C5ValidationResult detalhando validade booleana, erros, frequências e interseções.
 */
export function validateC5(generation: C5Generation): C5ValidationResult {
  const errors: string[] = [];

  // Estrutura de frequências globais inicializada com 1..25
  const frequencies: Record<number, number> = {};
  for (let i = 1; i <= 25; i++) {
    frequencies[i] = 0;
  }

  // =========================================================================
  // Invariante A — Quantidade de jogos
  // =========================================================================
  if (!Array.isArray(generation.games) || generation.games.length !== 5) {
    errors.push(
      `Invariante A falhou: esperava-se exatamente 5 jogos, recebido ${generation.games?.length ?? 0}.`
    );
  }

  const safeGames = Array.isArray(generation.games) ? generation.games : [];

  // =========================================================================
  // Invariante B — Tamanho de cada jogo (exatamente 15 dezenas)
  // =========================================================================
  safeGames.forEach((game, index) => {
    if (!Array.isArray(game) || game.length !== 15) {
      errors.push(
        `Invariante B falhou: o jogo J${index + 1} possui ${game?.length ?? 0} dezenas (esperava-se 15).`
      );
    }
  });

  // =========================================================================
  // Invariante C — Domínio (todas as dezenas devem ser inteiros em 1..25)
  // =========================================================================
  safeGames.forEach((game, gameIndex) => {
    if (Array.isArray(game)) {
      for (const num of game) {
        if (!Number.isInteger(num) || num < 1 || num > 25) {
          errors.push(
            `Invariante C falhou: o jogo J${gameIndex + 1} contém a dezena inválida ${num} fora do domínio 1..25.`
          );
        }
      }
    }
  });

  // =========================================================================
  // Invariante D — Duplicidade interna em cada jogo
  // =========================================================================
  safeGames.forEach((game, gameIndex) => {
    if (Array.isArray(game)) {
      const seen = new Set<number>();
      const duplicates = new Set<number>();
      for (const num of game) {
        if (seen.has(num)) {
          duplicates.add(num);
        }
        seen.add(num);
      }
      if (duplicates.size > 0) {
        errors.push(
          `Invariante D falhou: o jogo J${gameIndex + 1} contém dezenas duplicadas: [${Array.from(duplicates).join(", ")}].`
        );
      }
    }
  });

  // =========================================================================
  // Invariante E — Frequência global (cada dezena 1..25 deve aparecer exatamente 3 vezes)
  // =========================================================================
  let totalIncidences = 0;
  safeGames.forEach((game) => {
    if (Array.isArray(game)) {
      for (const num of game) {
        if (Number.isInteger(num) && num >= 1 && num <= 25) {
          frequencies[num] = (frequencies[num] || 0) + 1;
          totalIncidences++;
        }
      }
    }
  });

  if (totalIncidences !== 75) {
    errors.push(
      `Invariante E falhou: total de incidências foi ${totalIncidences} (esperava-se 75 = 5 × 15).`
    );
  }

  for (let num = 1; num <= 25; num++) {
    const count = frequencies[num] || 0;
    if (count !== 3) {
      errors.push(
        `Invariante E falhou: a dezena ${num} apareceu ${count} vezes nos 5 jogos (esperava-se exatamente 3).`
      );
    }
  }

  // =========================================================================
  // Invariante F — Interseções entre os 10 pares de jogos
  // Devem ser exatamente cinco de tamanho 7 e cinco de tamanho 8: [7,7,7,7,7,8,8,8,8,8]
  // =========================================================================
  const intersections: { pair: string; size: number }[] = [];
  const intersectionSizes: number[] = [];

  for (const { pair, g1, g2 } of GAME_PAIRS) {
    const game1 = safeGames[g1];
    const game2 = safeGames[g2];

    if (Array.isArray(game1) && Array.isArray(game2)) {
      const set2 = new Set(game2);
      let size = 0;
      for (const n of game1) {
        if (set2.has(n)) {
          size++;
        }
      }
      intersections.push({ pair, size });
      intersectionSizes.push(size);
    } else {
      intersections.push({ pair, size: 0 });
      intersectionSizes.push(0);
    }
  }

  const sortedSizes = [...intersectionSizes].sort((a, b) => a - b);
  const expectedSizes = [7, 7, 7, 7, 7, 8, 8, 8, 8, 8];
  const matchesExpectedIntersections =
    sortedSizes.length === 10 &&
    sortedSizes.every((sz, idx) => sz === expectedSizes[idx]);

  if (!matchesExpectedIntersections) {
    errors.push(
      `Invariante F falhou: distribuição de interseções foi [${sortedSizes.join(", ")}], esperava-se rigorosamente [7, 7, 7, 7, 7, 8, 8, 8, 8, 8].`
    );
  }

  // =========================================================================
  // Invariante G — Permutação de 1..25
  // =========================================================================
  if (
    !Array.isArray(generation.permutation) ||
    generation.permutation.length !== 25
  ) {
    errors.push(
      `Invariante G falhou: a permutação deve possuir comprimento 25 (recebido ${generation.permutation?.length ?? 0}).`
    );
  } else {
    const permSet = new Set(generation.permutation);
    if (permSet.size !== 25) {
      errors.push(
        `Invariante G falhou: a permutação contém elementos duplicados (apenas ${permSet.size} distintos).`
      );
    }
    for (let i = 1; i <= 25; i++) {
      if (!permSet.has(i)) {
        errors.push(
          `Invariante G falhou: a permutação não contém a dezena ${i}.`
        );
      }
    }
  }

  // =========================================================================
  // Invariante H — Slots canônicos
  // =========================================================================
  const slotAssignments = generation.slotAssignments || {};
  const assignedSlotKeys = Object.keys(slotAssignments);

  if (assignedSlotKeys.length !== 25) {
    errors.push(
      `Invariante H falhou: esperava-se 25 atribuições de slots (recebido ${assignedSlotKeys.length}).`
    );
  }

  const canonicalSlotSet = new Set<string>(C5_SLOTS);
  for (const slot of C5_SLOTS) {
    if (!(slot in slotAssignments)) {
      errors.push(
        `Invariante H falhou: slot canônico obrigatório '${slot}' ausente nas atribuições.`
      );
    }
  }

  for (const slotKey of assignedSlotKeys) {
    if (!canonicalSlotSet.has(slotKey)) {
      errors.push(
        `Invariante H falhou: slot desconhecido '${slotKey}' encontrado nas atribuições.`
      );
    }
  }

  // Verificar se as dezenas atribuídas aos slots formam uma permutação válida de 1..25
  const slotAssignedNumbers = Object.values(slotAssignments);
  const slotNumbersSet = new Set(slotAssignedNumbers);
  if (slotNumbersSet.size !== 25) {
    errors.push(
      `Invariante H falhou: dezenas atribuídas aos slots contêm repetições (apenas ${slotNumbersSet.size} dezenas distintas).`
    );
  }
  for (let num = 1; num <= 25; num++) {
    if (!slotNumbersSet.has(num)) {
      errors.push(
        `Invariante H falhou: dezena ${num} não foi atribuída a nenhum slot.`
      );
    }
  }

  // =========================================================================
  // Invariante I — Coerência estrita Slots ↔ Jogos
  // Cada dezena deve estar AUSENTE exatamente dos 2 jogos do slot e PRESENTE nos outros 3.
  // =========================================================================
  for (const slot of C5_SLOTS) {
    if (slot in slotAssignments) {
      const num = slotAssignments[slot];
      const absentIndices = getAbsentGameIndices(slot);
      const absentSet = new Set(absentIndices);
      const presentIndices = getPresentGameIndices(slot);

      for (let gIndex = 0; gIndex < 5; gIndex++) {
        const game = safeGames[gIndex] || [];
        const containsNumber = game.includes(num);

        if (absentSet.has(gIndex)) {
          if (containsNumber) {
            errors.push(
              `Invariante I falhou: dezena ${num} atribuída ao slot '${slot}' deveria estar AUSENTE de J${gIndex + 1}, mas foi encontrada presente.`
            );
          }
        } else {
          if (!containsNumber) {
            errors.push(
              `Invariante I falhou: dezena ${num} atribuída ao slot '${slot}' deveria estar PRESENTE em J${gIndex + 1}, mas está ausente.`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    frequencies,
    intersections,
  };
}
