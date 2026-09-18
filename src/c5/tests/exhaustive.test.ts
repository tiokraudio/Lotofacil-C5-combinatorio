/**
 * Teste exaustivo de certificação combinatória sobre o espaço amostral completo da Lotofácil:
 * C(25, 15) = 3.268.760 resultados possíveis.
 *
 * Avalia:
 * 1. Enumeração exata dos 3.268.760 resultados;
 * 2. Distribuição exata de maxHits (0..15);
 * 3. Certificados de contagem: 11+, 12+, 13+, 14+, 15;
 * 4. Multiplicidade de 11+ (número de jogos premiados simultaneamente);
 * 5. Invariância sob rotulagem: certificação idêntica em 5 gerações C₅ independentes.
 */
import { generateC5 } from "../generator.ts";
import { validateC5 } from "../validator.ts";
import { createMulberry32 } from "../random.ts";
import type { C5Generation } from "../types.ts";

/**
 * Hamming weight (popcount) otimizado de 32 bits para contagem de bits ativos.
 */
function popcount25(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export interface ExhaustiveAuditResult {
  totalResults: number;
  count11Plus: number;
  count12Plus: number;
  count13Plus: number;
  count14Plus: number;
  count15: number;
  prob11Plus: number;
  prob12Plus: number;
  prob13Plus: number;
  prob14Plus: number;
  prob15: number;
  multiplicity11: [number, number, number, number, number, number];
  maxHitsDistribution: number[];
  durationMs: number;
}

/**
 * Audita exaustivamente todos os 3.268.760 resultados possíveis contra uma geração C₅.
 */
export function auditExhaustive(generation: C5Generation): ExhaustiveAuditResult {
  // Valida a geração antes da auditoria
  const val = validateC5(generation);
  if (!val.valid) {
    throw new Error(`Geração inválida enviada para auditoria exaustiva: ${val.errors.join("; ")}`);
  }

  // Converte as 15 dezenas de cada jogo em uma máscara binária de 25 bits
  const gameMasks: [number, number, number, number, number] = [
    generation.games[0].reduce((acc, n) => acc | (1 << (n - 1)), 0),
    generation.games[1].reduce((acc, n) => acc | (1 << (n - 1)), 0),
    generation.games[2].reduce((acc, n) => acc | (1 << (n - 1)), 0),
    generation.games[3].reduce((acc, n) => acc | (1 << (n - 1)), 0),
    generation.games[4].reduce((acc, n) => acc | (1 << (n - 1)), 0),
  ];

  const m0 = gameMasks[0];
  const m1 = gameMasks[1];
  const m2 = gameMasks[2];
  const m3 = gameMasks[3];
  const m4 = gameMasks[4];

  let total = 0;
  let c11Plus = 0;
  let c12Plus = 0;
  let c13Plus = 0;
  let c14Plus = 0;
  let c15 = 0;

  const mult11: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const maxHitsDist = new Array(16).fill(0);

  const t0 = Date.now();

  // Gosper's Hack para iterar de forma estritamente uniforme por todas as C(25, 15) máscaras
  let x = (1 << 15) - 1;
  const limit = 1 << 25;

  while (x < limit) {
    total++;

    const h0 = popcount25(x & m0);
    const h1 = popcount25(x & m1);
    const h2 = popcount25(x & m2);
    const h3 = popcount25(x & m3);
    const h4 = popcount25(x & m4);

    let maxH = h0;
    if (h1 > maxH) maxH = h1;
    if (h2 > maxH) maxH = h2;
    if (h3 > maxH) maxH = h3;
    if (h4 > maxH) maxH = h4;

    maxHitsDist[maxH]++;

    if (maxH >= 11) c11Plus++;
    if (maxH >= 12) c12Plus++;
    if (maxH >= 13) c13Plus++;
    if (maxH >= 14) c14Plus++;
    if (maxH === 15) c15++;

    let num11PlusGames = 0;
    if (h0 >= 11) num11PlusGames++;
    if (h1 >= 11) num11PlusGames++;
    if (h2 >= 11) num11PlusGames++;
    if (h3 >= 11) num11PlusGames++;
    if (h4 >= 11) num11PlusGames++;

    mult11[num11PlusGames]++;

    // Próxima combinação com exatamente 15 bits ativos
    const c = x & -x;
    const r = (x + c) | 0;
    x = (((((r ^ x) >>> 2) / c) | 0) | r) | 0;
  }

  const durationMs = Date.now() - t0;

  return {
    totalResults: total,
    count11Plus: c11Plus,
    count12Plus: c12Plus,
    count13Plus: c13Plus,
    count14Plus: c14Plus,
    count15: c15,
    prob11Plus: c11Plus / total,
    prob12Plus: c12Plus / total,
    prob13Plus: c13Plus / total,
    prob14Plus: c14Plus / total,
    prob15: c15 / total,
    multiplicity11: mult11,
    maxHitsDistribution: maxHitsDist,
    durationMs,
  };
}

export function runExhaustiveTests(seedList = [101, 202, 303, 404, 505]): boolean {
  console.log(
    `=== INICIANDO CERTIFICAÇÃO EXAUSTIVA C(25, 15) = 3.268.760 COMBINAÇÕES EM ${seedList.length} ROTULAGENS INDEPENDENTES ===\n`
  );

  const EXPECTED_TOTAL = 3_268_760;
  const EXPECTED_11_PLUS = 1_626_630;
  const EXPECTED_12_PLUS = 297_380;
  const EXPECTED_13_PLUS = 24_380;
  const EXPECTED_14_PLUS = 755;
  const EXPECTED_15 = 5;

  const EXPECTED_MULTIPLICITY = [1_642_130, 1_522_755, 103_750, 125, 0, 0];
  const EXPECTED_MAX_HITS_DIST = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 45_190, 1_596_940, 1_329_250, 273_000, 23_625, 750, 5,
  ];

  let allPassed = true;

  for (let idx = 0; idx < seedList.length; idx++) {
    const seed = seedList[idx];
    console.log(`[Rotulagem #${idx + 1} / ${seedList.length}] Seed: ${seed}`);

    const gen = generateC5(createMulberry32(seed));
    const audit = auditExhaustive(gen);

    const matchesTotal = audit.totalResults === EXPECTED_TOTAL;
    const matches11Plus = audit.count11Plus === EXPECTED_11_PLUS;
    const matches12Plus = audit.count12Plus === EXPECTED_12_PLUS;
    const matches13Plus = audit.count13Plus === EXPECTED_13_PLUS;
    const matches14Plus = audit.count14Plus === EXPECTED_14_PLUS;
    const matches15 = audit.count15 === EXPECTED_15;

    const matchesMult = audit.multiplicity11.every((v, i) => v === EXPECTED_MULTIPLICITY[i]);
    const multSum = audit.multiplicity11.reduce((a, b) => a + b, 0);
    const mult11Sum = audit.multiplicity11[1] + audit.multiplicity11[2] + audit.multiplicity11[3];
    const matchesMultConsistency = multSum === EXPECTED_TOTAL && mult11Sum === EXPECTED_11_PLUS;

    const matchesDist = audit.maxHitsDistribution.every((v, i) => v === EXPECTED_MAX_HITS_DIST[i]);

    const roundPassed =
      matchesTotal &&
      matches11Plus &&
      matches12Plus &&
      matches13Plus &&
      matches14Plus &&
      matches15 &&
      matchesMult &&
      matchesMultConsistency &&
      matchesDist;

    if (!roundPassed) {
      allPassed = false;
      console.error(`  ✗ [FALHA NA ROTULAGEM #${idx + 1} (Seed ${seed})]:`);
      console.error(`    Total: ${audit.totalResults} (esperado: ${EXPECTED_TOTAL})`);
      console.error(`    11+: ${audit.count11Plus} (esperado: ${EXPECTED_11_PLUS})`);
      console.error(`    12+: ${audit.count12Plus} (esperado: ${EXPECTED_12_PLUS})`);
      console.error(`    13+: ${audit.count13Plus} (esperado: ${EXPECTED_13_PLUS})`);
      console.error(`    14+: ${audit.count14Plus} (esperado: ${EXPECTED_14_PLUS})`);
      console.error(`    15:  ${audit.count15} (esperado: ${EXPECTED_15})`);
      console.error(`    Multiplicidade: [${audit.multiplicity11.join(", ")}]`);
      break;
    }

    console.log(
      `  ✓ Total Resultados: ${audit.totalResults.toLocaleString()} | Tempo: ${audit.durationMs} ms (${Math.round((audit.totalResults / (audit.durationMs || 1)) * 1000).toLocaleString()} comb/s)`
    );
    console.log(
      `  ✓ 11+: ${audit.count11Plus.toLocaleString()} (P = ${(audit.prob11Plus * 100).toFixed(4)}%) | ` +
        `12+: ${audit.count12Plus.toLocaleString()} (P = ${(audit.prob12Plus * 100).toFixed(4)}%)`
    );
    console.log(
      `  ✓ 13+: ${audit.count13Plus.toLocaleString()} (P = ${(audit.prob13Plus * 100).toFixed(4)}%) | ` +
        `14+: ${audit.count14Plus.toLocaleString()} (P = ${(audit.prob14Plus * 100).toFixed(4)}%) | ` +
        `15: ${audit.count15} (P = ${(audit.prob15 * 100).toFixed(6)}%)`
    );
    console.log(
      `  ✓ Multiplicidade 11+: [0: ${audit.multiplicity11[0].toLocaleString()}, 1: ${audit.multiplicity11[1].toLocaleString()}, 2: ${audit.multiplicity11[2].toLocaleString()}, 3: ${audit.multiplicity11[3].toLocaleString()}, 4: ${audit.multiplicity11[4]}, 5: ${audit.multiplicity11[5]}]`
    );
    console.log(
      `  ✓ Distribuição maxHits (9..15): 9 -> ${audit.maxHitsDistribution[9].toLocaleString()}, 10 -> ${audit.maxHitsDistribution[10].toLocaleString()}, 11 -> ${audit.maxHitsDistribution[11].toLocaleString()}, 12 -> ${audit.maxHitsDistribution[12].toLocaleString()}, 13 -> ${audit.maxHitsDistribution[13].toLocaleString()}, 14 -> ${audit.maxHitsDistribution[14]}, 15 -> ${audit.maxHitsDistribution[15]}`
    );
    console.log(`  ✓ Certificado da rotulagem #${idx + 1}: 100% IDÊNTICO E APROVADO\n`);
  }

  console.log("=== RESULTADO GERAL DA CERTIFICAÇÃO EXAUSTIVA ===");
  console.log(`  Rotulagens independentes avaliadas: ${seedList.length}`);
  console.log(`  Combinações totais auditadas: ${(seedList.length * EXPECTED_TOTAL).toLocaleString()}`);
  console.log(`  Status: ${allPassed ? "APROVADO (Invariância da Rotulagem Comprovada)" : "REPROVADO"}\n`);

  return allPassed;
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("exhaustive.test.ts")) {
  const ok = runExhaustiveTests();
  if (!ok) {
    process.exit(1);
  }
}
