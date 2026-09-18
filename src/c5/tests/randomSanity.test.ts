/**
 * Teste estatístico de sanidade da randomização (Fisher-Yates).
 *
 * Avalia a distribuição de ocorrências no espaço produto {dezenas (1..25)} × {slots (1..25)}.
 * Garante que:
 * 1. Nenhuma posição seja fixa;
 * 2. Nenhum slot seja impossível para qualquer dezena (cobertura total de 25 × 25 = 625 pares);
 * 3. A dispersão observada seja compatível com permutação uniforme aleatória;
 * 4. O teste não gere falsos positivos devidos a flutuações normais de Poisson/Binomial.
 */
import { generateC5 } from "../generator.ts";
import { C5_SLOTS } from "../constants.ts";
import { createMulberry32 } from "../random.ts";

export interface SanityTestResult {
  passed: boolean;
  totalGenerations: number;
  expectedPerCell: number;
  minObserved: number;
  maxObserved: number;
  uncoveredCells: number;
  chiSquarePerNumber: number[];
  meanChiSquare: number;
  summary: string;
}

export function runRandomSanityTest(
  totalGenerations = 50_000,
  seed = 98765
): SanityTestResult {
  console.log(
    `=== INICIANDO TESTE DE SANIDADE DA RANDOMIZAÇÃO (${totalGenerations.toLocaleString()} GERAÇÕES) ===`
  );

  const rng = createMulberry32(seed);

  // Matriz 25 x 25: linhas = dezenas (0..24 representando 1..25), colunas = slots (0..24)
  const matrix: number[][] = Array.from({ length: 25 }, () =>
    new Array(25).fill(0)
  );

  for (let i = 0; i < totalGenerations; i++) {
    const gen = generateC5(rng);
    // Cada elemento da permutação foi atribuído ao slot correspondente em C5_SLOTS
    for (let slotIdx = 0; slotIdx < 25; slotIdx++) {
      const num = gen.permutation[slotIdx]; // 1..25
      matrix[num - 1][slotIdx]++;
    }
  }

  const expectedPerCell = totalGenerations / 25;
  let minObserved = Infinity;
  let maxObserved = -Infinity;
  let uncoveredCells = 0;

  // Cálculo de Chi-Quadrado para cada dezena ao longo dos 25 slots
  // Esperado por slot = totalGenerations / 25
  const chiSquarePerNumber: number[] = [];

  for (let numIdx = 0; numIdx < 25; numIdx++) {
    let chiSquare = 0;
    for (let slotIdx = 0; slotIdx < 25; slotIdx++) {
      const count = matrix[numIdx][slotIdx];
      if (count < minObserved) minObserved = count;
      if (count > maxObserved) maxObserved = count;
      if (count === 0) uncoveredCells++;

      const diff = count - expectedPerCell;
      chiSquare += (diff * diff) / expectedPerCell;
    }
    chiSquarePerNumber.push(chiSquare);
  }

  const meanChiSquare =
    chiSquarePerNumber.reduce((a, b) => a + b, 0) / chiSquarePerNumber.length;

  // Graus de liberdade = 24 por dezena. A média esperada do Chi-Quadrado é 24.
  // Limite razoável para teste de sanidade sem falsos alarmes:
  // - Cobertura estrita de 100% das 625 células (zero células vazias)
  // - Nenhuma célula com desvio desproporcional (ex: count deve estar confortavelmente acima de 0 e dentro de margem razoável)
  // - Chi-quadrado médio próximo a 24 (ex: entre 10 e 45)
  const hasZeroCell = uncoveredCells > 0;
  const reasonableRange =
    minObserved >= expectedPerCell * 0.5 &&
    maxObserved <= expectedPerCell * 1.5;
  const reasonableChiSquare = meanChiSquare < 45 && meanChiSquare > 10;

  const passed = !hasZeroCell && reasonableRange && reasonableChiSquare;

  console.log(`  Gerações analisadas: ${totalGenerations.toLocaleString()}`);
  console.log(`  Frequência esperada por par (dezena, slot): ${expectedPerCell.toFixed(1)}`);
  console.log(`  Frequência mínima observada: ${minObserved} (${((minObserved / expectedPerCell) * 100).toFixed(1)}% do esperado)`);
  console.log(`  Frequência máxima observada: ${maxObserved} (${((maxObserved / expectedPerCell) * 100).toFixed(1)}% do esperado)`);
  console.log(`  Células não cobertas (impossíveis): ${uncoveredCells} de 625`);
  console.log(`  Média do Chi-Quadrado (graus de liberdade = 24): ${meanChiSquare.toFixed(2)} (esperado ~24.0)`);
  console.log(`  Status da sanidade estatística: ${passed ? "APROVADO" : "REPROVADO"}\n`);

  return {
    passed,
    totalGenerations,
    expectedPerCell,
    minObserved,
    maxObserved,
    uncoveredCells,
    chiSquarePerNumber,
    meanChiSquare,
    summary: passed
      ? `Aprovado: todas as 625 células ativas, sem viés sistemático, Chi² médio ${meanChiSquare.toFixed(2)}`
      : `Reprovado: anomalia estatística detectada`,
  };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("randomSanity.test.ts")) {
  const res = runRandomSanityTest();
  if (!res.passed) {
    process.exit(1);
  }
}
