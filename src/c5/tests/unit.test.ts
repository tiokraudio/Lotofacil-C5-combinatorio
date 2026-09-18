/**
 * Bateria de testes unitários obrigatórios (positivos e negativos)
 * para o validador e gerador da arquitetura C₅.
 */
import { generateC5 } from "../generator.ts";
import { validateC5 } from "../validator.ts";
import { createMulberry32 } from "../random.ts";
import { runGoldenTest } from "./golden.test.ts";
import type { C5Generation } from "../types.ts";

function deepCloneGeneration(gen: C5Generation): C5Generation {
  return {
    permutation: [...gen.permutation],
    slotAssignments: { ...gen.slotAssignments },
    games: [
      [...gen.games[0]],
      [...gen.games[1]],
      [...gen.games[2]],
      [...gen.games[3]],
      [...gen.games[4]],
    ],
  };
}

export function runUnitTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  console.log("=== INICIANDO BATERIA DE TESTES UNITÁRIOS OBRIGATÓRIOS (13 CASOS) ===");

  const seed = 12345;
  const validGen = generateC5(createMulberry32(seed));

  // 1. Geração válida
  {
    const result = validateC5(validGen);
    assert(
      result.valid && result.errors.length === 0,
      "1. Geração válida aprovada com 0 erros",
      result.errors.join("; ")
    );
  }

  // 2. Jogo com 14 dezenas
  {
    const corrupt = deepCloneGeneration(validGen);
    corrupt.games[0].pop(); // agora possui 14 dezenas
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante B falhou")),
      "2. Jogo com 14 dezenas rejeitado por Invariante B"
    );
  }

  // 3. Jogo com 16 dezenas
  {
    const corrupt = deepCloneGeneration(validGen);
    // Adiciona uma dezena extra (por exemplo, 25 ou qualquer disponível)
    corrupt.games[1].push(99);
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante B falhou")),
      "3. Jogo com 16 dezenas rejeitado por Invariante B"
    );
  }

  // 4. Dezena duplicada dentro de um jogo
  {
    const corrupt = deepCloneGeneration(validGen);
    // Substitui a segunda dezena pela primeira, mantendo 15 dezenas no array mas com duplicata
    corrupt.games[0][1] = corrupt.games[0][0];
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante D falhou")),
      "4. Dezena duplicada dentro de um jogo rejeitada por Invariante D"
    );
  }

  // 5. Dezena fora de 1..25
  {
    const corrupt = deepCloneGeneration(validGen);
    corrupt.games[2][0] = 26; // Fora do domínio
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante C falhou")),
      "5. Dezena fora do domínio 1..25 rejeitada por Invariante C"
    );
  }

  // 6. Frequência global diferente de 3
  {
    const corrupt = deepCloneGeneration(validGen);
    // Em J1, remove uma dezena X e coloca uma dezena Y que já está no jogo J2
    // garantindo que não duplicamos em J1, mas alteramos a frequência global
    // Ex: trocar a dezena corrupt.games[0][0] por uma de outro jogo
    const absentInJ1 = corrupt.permutation.find(
      (n) => !corrupt.games[0].includes(n)
    )!;
    corrupt.games[0][0] = absentInJ1;
    // Isso faz absentInJ1 ter frequência 4 e a dezena anterior ter frequência 2
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante E falhou")),
      "6. Frequência global diferente de 3 rejeitada por Invariante E"
    );
  }

  // 7. Interseção incorreta
  {
    const corrupt = deepCloneGeneration(validGen);
    // Modifica sutilmente a composição entre jogos para alterar tamanho de interseção
    // sem necessariamente quebrar os tamanhos de cada jogo:
    // Troca um elemento exclusivo de J1 e J2
    const n1 = corrupt.games[0][0];
    const n2 = corrupt.games[1][0];
    corrupt.games[0][0] = n2;
    corrupt.games[1][0] = n1;
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante F falhou")),
      "7. Distribuição de interseção incorreta rejeitada por Invariante F"
    );
  }

  // 8. Permutação duplicada
  {
    const corrupt = deepCloneGeneration(validGen);
    corrupt.permutation[1] = corrupt.permutation[0];
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante G falhou")),
      "8. Permutação com elementos duplicados rejeitada por Invariante G"
    );
  }

  // 9. Permutação faltando dezena
  {
    const corrupt = deepCloneGeneration(validGen);
    corrupt.permutation.pop();
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante G falhou")),
      "9. Permutação com comprimento incompleto rejeitada por Invariante G"
    );
  }

  // 10. Slot faltando
  {
    const corrupt = deepCloneGeneration(validGen);
    delete corrupt.slotAssignments["12a"];
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante H falhou")),
      "10. Slot canônico ausente rejeitado por Invariante H"
    );
  }

  // 11. Slot desconhecido
  {
    const corrupt = deepCloneGeneration(validGen);
    corrupt.slotAssignments["99z"] = 1;
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante H falhou")),
      "11. Slot desconhecido nas atribuições rejeitado por Invariante H"
    );
  }

  // 12. Mesma dezena atribuída a dois slots
  {
    const corrupt = deepCloneGeneration(validGen);
    corrupt.slotAssignments["12b"] = corrupt.slotAssignments["12a"];
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante H falhou")),
      "12. Mesma dezena atribuída a dois slots rejeitada por Invariante H"
    );
  }

  // 13. Incoerência entre slot e jogos
  {
    const corrupt = deepCloneGeneration(validGen);
    // Pega o número no slot '12a', que por definição DEVE estar AUSENTE em J1 e J2
    const num = corrupt.slotAssignments["12a"];
    // Força a presença dele em J1 substituindo um número existente
    const oldNum = corrupt.games[0][0];
    corrupt.games[0][0] = num;
    const result = validateC5(corrupt);
    assert(
      !result.valid &&
        result.errors.some((e) => e.includes("Invariante I falhou")),
      "13. Incoerência entre slot e jogos rejeitada por Invariante I"
    );
  }

  // 14. Golden Test Canônico (Permutação Identidade, Slots, J1..J5, Interseções 8 e 7)
  {
    const goldenRes = runGoldenTest();
    assert(goldenRes.allPassed, "14. Golden Test Canônico C5 (Identidade, Slots, J1..J5 e Interseções)");
  }

  console.log(
    `=== FIM DOS TESTES UNITÁRIOS: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

// Se executado diretamente via tsx/node
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("unit.test.ts")) {
  const { failed } = runUnitTests();
  if (failed > 0) {
    process.exit(1);
  }
}
