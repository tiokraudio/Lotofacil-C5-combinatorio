/**
 * TESTE DETERMINÍSTICO DO GOLDEN STANDARD CANÔNICO C₅ (PROMPT 09 - SEÇÃO 19)
 *
 * Valida a permutação identidade [1..25] mapeada estritamente sobre a arquitetura
 * canônica C₅, conferindo a atribuição exata de cada um dos 25 slots, a composição
 * exata dos 5 jogos J1..J5, as 10 interseções nomeadas (8 e 7) e a aprovação integral
 * no validador formal de invariantes validateC5().
 */
import { C5_SLOTS } from "../constants.ts";
import { buildC5FromPermutation } from "../canonicalBuilder.ts";
import { validateC5 } from "../validator.ts";
import type { C5Generation } from "../types.ts";

export { buildC5FromPermutation };

export interface GoldenTestResults {
  slotMapping: boolean;
  slotDeepEqual: boolean;
  j1: boolean;
  j2: boolean;
  j3: boolean;
  j4: boolean;
  j5: boolean;
  gamesDeepEqual: boolean;
  slotSemantics: boolean;
  negativeGoldenFailedAsExpected: boolean;
  intersections8: boolean;
  intersections7: boolean;
  validateC5: boolean;
  allPassed: boolean;
}

/**
 * Constrói uma geração propositalmente errônea que interpreta o par do slot
 * como INCLUSÃO em vez de AUSÊNCIA (anti-padrão a ser rejeitado).
 */
export function buildInvertedInclusionGeneration(permutation: number[]): C5Generation {
  const slotAssignments: Record<string, number> = {};
  for (let i = 0; i < C5_SLOTS.length; i++) {
    const slot = C5_SLOTS[i];
    slotAssignments[slot] = permutation[i];
  }

  const rawGames: [number[], number[], number[], number[], number[]] = [
    [], [], [], [], []
  ];

  for (const slot of C5_SLOTS) {
    const num = slotAssignments[slot];
    // Interpretação errônea: usa o par de ausência como par de inclusão
    const g1 = Number.parseInt(slot[0], 10) - 1;
    const g2 = Number.parseInt(slot[1], 10) - 1;
    rawGames[g1].push(num);
    rawGames[g2].push(num);
  }

  const games: [number[], number[], number[], number[], number[]] = [
    [...rawGames[0]].sort((a, b) => a - b),
    [...rawGames[1]].sort((a, b) => a - b),
    [...rawGames[2]].sort((a, b) => a - b),
    [...rawGames[3]].sort((a, b) => a - b),
    [...rawGames[4]].sort((a, b) => a - b),
  ];

  return { permutation, slotAssignments, games };
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function intersectionSize(a: number[], b: number[]): number {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x)).length;
}

export function runNegativeGoldenTest(): boolean {
  console.log("--- Executando Negative Golden Test (Slot interpretado como Inclusão) ---");
  const identityPermutation = Array.from({ length: 25 }, (_, i) => i + 1);
  const badGen = buildInvertedInclusionGeneration(identityPermutation);

  const val = validateC5(badGen);
  const failedAsExpected = !val.valid && val.errors.length > 0;

  if (failedAsExpected) {
    console.log("  ✓ [PASS] Negative Golden Test rejeitado com sucesso pelo validador!");
    console.log(`    Erros detectados: ${val.errors.length} (ex: ${val.errors[0]})`);
  } else {
    console.error("  ✗ [FAIL] Negative Golden Test foi indevidamente APROVADO!");
  }

  return failedAsExpected;
}

export function runGoldenTest(): GoldenTestResults {
  console.log("=== EXECUTANDO GOLDEN TEST CANÔNICO C₅ (PERMUTAÇÃO IDENTIDADE) ===");

  // 1. Permutação identidade [1..25]
  const identityPermutation = Array.from({ length: 25 }, (_, i) => i + 1);
  const gen = buildC5FromPermutation(identityPermutation);

  // 2. Verificação de Slot Mapping Canônico Obrigatório
  const expectedSlots: Record<string, number> = {
    "12a": 1, "12b": 2, "12c": 3,
    "23a": 4, "23b": 5, "23c": 6,
    "34a": 7, "34b": 8, "34c": 9,
    "45a": 10, "45b": 11, "45c": 12,
    "51a": 13, "51b": 14, "51c": 15,
    "13a": 16, "13b": 17,
    "14a": 18, "14b": 19,
    "24a": 20, "24b": 21,
    "25a": 22, "25b": 23,
    "35a": 24, "35b": 25,
  };

  let slotMappingPassed = true;
  for (const [slot, expectedNum] of Object.entries(expectedSlots)) {
    if (gen.slotAssignments[slot] !== expectedNum) {
      console.error(`  ✗ Falha no slot ${slot}: esperado ${expectedNum}, obtido ${gen.slotAssignments[slot]}`);
      slotMappingPassed = false;
    }
  }

  // Deep equality estrita dos slotAssignments
  const slotDeepEqual = JSON.stringify(gen.slotAssignments) === JSON.stringify(expectedSlots);

  // 3. Jogos Obrigatórios
  const expectedJ1 = [4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25];
  const expectedJ2 = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 25];
  const expectedJ3 = [1, 2, 3, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23];
  const expectedJ4 = [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 22, 23, 24, 25];
  const expectedJ5 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21];

  const j1Passed = arraysEqual(gen.games[0], expectedJ1);
  const j2Passed = arraysEqual(gen.games[1], expectedJ2);
  const j3Passed = arraysEqual(gen.games[2], expectedJ3);
  const j4Passed = arraysEqual(gen.games[3], expectedJ4);
  const j5Passed = arraysEqual(gen.games[4], expectedJ5);

  const gamesDeepEqual =
    JSON.stringify(gen.games) ===
    JSON.stringify([expectedJ1, expectedJ2, expectedJ3, expectedJ4, expectedJ5]);

  // 4. Testes Unitários Explícitos da Semântica de Slot (Ausência nos 2 jogos, Presença nos outros 3)
  const slotSemanticsChecks = [
    { slot: "12a", absent: [1, 2], present: [3, 4, 5] },
    { slot: "23a", absent: [2, 3], present: [1, 4, 5] },
    { slot: "34a", absent: [3, 4], present: [1, 2, 5] },
    { slot: "45a", absent: [4, 5], present: [1, 2, 3] },
    { slot: "51a", absent: [5, 1], present: [2, 3, 4] },
    { slot: "13a", absent: [1, 3], present: [2, 4, 5] },
    { slot: "14a", absent: [1, 4], present: [2, 3, 5] },
    { slot: "24a", absent: [2, 4], present: [1, 3, 5] },
    { slot: "25a", absent: [2, 5], present: [1, 3, 4] },
    { slot: "35a", absent: [3, 5], present: [1, 2, 4] },
  ];

  let slotSemanticsPassed = true;
  for (const { slot, absent, present } of slotSemanticsChecks) {
    const num = gen.slotAssignments[slot];
    for (const g of absent) {
      if (gen.games[g - 1].includes(num)) {
        console.error(`  ✗ Semântica violada: número ${num} do slot ${slot} presente em J${g} (deveria ser ausente)`);
        slotSemanticsPassed = false;
      }
    }
    for (const g of present) {
      if (!gen.games[g - 1].includes(num)) {
        console.error(`  ✗ Semântica violada: número ${num} do slot ${slot} ausente em J${g} (deveria ser presente)`);
        slotSemanticsPassed = false;
      }
    }
  }

  // 5. Interseções Nomeadas Obrigatórias (5 de tamanho 8 e 5 de tamanho 7)
  const inter12 = intersectionSize(gen.games[0], gen.games[1]);
  const inter23 = intersectionSize(gen.games[1], gen.games[2]);
  const inter34 = intersectionSize(gen.games[2], gen.games[3]);
  const inter45 = intersectionSize(gen.games[3], gen.games[4]);
  const inter51 = intersectionSize(gen.games[4], gen.games[0]);

  const intersections8Passed =
    inter12 === 8 && inter23 === 8 && inter34 === 8 && inter45 === 8 && inter51 === 8;

  const inter13 = intersectionSize(gen.games[0], gen.games[2]);
  const inter14 = intersectionSize(gen.games[0], gen.games[3]);
  const inter24 = intersectionSize(gen.games[1], gen.games[3]);
  const inter25 = intersectionSize(gen.games[1], gen.games[4]);
  const inter35 = intersectionSize(gen.games[2], gen.games[4]);

  const intersections7Passed =
    inter13 === 7 && inter14 === 7 && inter24 === 7 && inter25 === 7 && inter35 === 7;

  // 6. Validação Formal C5
  const valResult = validateC5(gen);
  const validatePassed = valResult.valid && valResult.errors.length === 0;

  // 7. Negative Golden Test
  const negativePassed = runNegativeGoldenTest();

  console.log(`  slot mapping: ${slotMappingPassed ? "PASS" : "FAIL"}`);
  console.log(`  slot deep equality: ${slotDeepEqual ? "PASS" : "FAIL"}`);
  console.log(`  J1: ${j1Passed ? "PASS" : "FAIL"}`);
  console.log(`  J2: ${j2Passed ? "PASS" : "FAIL"}`);
  console.log(`  J3: ${j3Passed ? "PASS" : "FAIL"}`);
  console.log(`  J4: ${j4Passed ? "PASS" : "FAIL"}`);
  console.log(`  J5: ${j5Passed ? "PASS" : "FAIL"}`);
  console.log(`  games deep equality: ${gamesDeepEqual ? "PASS" : "FAIL"}`);
  console.log(`  slot semantics (ausência 2, presença 3): ${slotSemanticsPassed ? "PASS" : "FAIL"}`);
  console.log(`  negative golden test (rejeição de inclusão): ${negativePassed ? "PASS" : "FAIL"}`);
  console.log(`  interseções 8: ${intersections8Passed ? "PASS" : "FAIL"} (J1∩J2=${inter12}, J2∩J3=${inter23}, J3∩J4=${inter34}, J4∩J5=${inter45}, J5∩J1=${inter51})`);
  console.log(`  interseções 7: ${intersections7Passed ? "PASS" : "FAIL"} (J1∩J3=${inter13}, J1∩J4=${inter14}, J2∩J4=${inter24}, J2∩J5=${inter25}, J3∩J5=${inter35})`);
  console.log(`  validateC5: ${validatePassed ? "PASS" : "FAIL"}`);

  const allPassed =
    slotMappingPassed &&
    slotDeepEqual &&
    j1Passed &&
    j2Passed &&
    j3Passed &&
    j4Passed &&
    j5Passed &&
    gamesDeepEqual &&
    slotSemanticsPassed &&
    negativePassed &&
    intersections8Passed &&
    intersections7Passed &&
    validatePassed;

  console.log(`=== RESULTADO GOLDEN TEST: ${allPassed ? "APROVADO (TODOS PASS)" : "FALHOU"} ===\n`);

  return {
    slotMapping: slotMappingPassed,
    slotDeepEqual,
    j1: j1Passed,
    j2: j2Passed,
    j3: j3Passed,
    j4: j4Passed,
    j5: j5Passed,
    gamesDeepEqual,
    slotSemantics: slotSemanticsPassed,
    negativeGoldenFailedAsExpected: negativePassed,
    intersections8: intersections8Passed,
    intersections7: intersections7Passed,
    validateC5: validatePassed,
    allPassed,
  };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("golden.test.ts")) {
  const res = runGoldenTest();
  if (!res.allPassed) {
    process.exit(1);
  }
}
