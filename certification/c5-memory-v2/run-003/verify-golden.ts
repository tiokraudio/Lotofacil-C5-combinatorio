import fs from "fs";
import path from "path";
import { validateC5 } from "../../../src/c5/validator.ts";

interface JohnsonVector {
  id: string;
  gameA: number[];
  gameB: number[];
  expectedDistance: number;
  description: string;
}

interface LeximinVector {
  id: string;
  targetCoord: string;
  description: string;
  isC5Admissible: boolean;
  c5Generations?: any[];
  candidates: number[][][];
  historicalGames: number[][];
  expectedHistograms: number[][];
  expectedWinnerIndex: number;
  expectedDecidingCoord: number;
  justification: string;
}

interface ControlVector {
  id: string;
  description: string;
  candidates?: number[][][];
  candidate?: number[][];
  historicalGames?: number[][];
  historicalGamesOrder1?: number[][];
  historicalGamesOrder2?: number[][];
  expectedHistograms?: number[][];
  expectedHistogram1?: number[];
  expectedHistogram2?: number[];
  expectedWinnerIndex?: number;
  expectedDecidingCoord?: number;
  sumEquation?: string;
  proof?: string;
  justification: string;
}

interface GoldenDataset {
  metadata: any;
  johnsonVectors: JohnsonVector[];
  leximinVectors: LeximinVector[];
  controlVectors: ControlVector[];
}

// 1. Independent pure distance function
function calcJohnsonDistance(g1: number[], g2: number[]): number {
  const set2 = new Set(g2);
  let intersectionCount = 0;
  for (const num of g1) {
    if (set2.has(num)) intersectionCount++;
  }
  return 15 - intersectionCount;
}

// 2. Independent pure histogram calculation
function calcHistogram(candidateGames: number[][], historyGames: number[][]): number[] {
  const hist = new Array(11).fill(0);
  for (const g of candidateGames) {
    for (const h of historyGames) {
      const d = calcJohnsonDistance(g, h);
      hist[d]++;
    }
  }
  return hist;
}

// 3. Independent MAX-LEXIMIN comparator
function compareLeximinPure(h1: number[], h2: number[]): { winner: number; decidingCoord: number } {
  for (let i = 0; i <= 9; i++) {
    if (h1[i] < h2[i]) return { winner: 0, decidingCoord: i };
    if (h1[i] > h2[i]) return { winner: 1, decidingCoord: i };
  }
  return { winner: 0, decidingCoord: -1 }; // Tie broken by lower index
}

// 4. Validate game structure: exactly 15 distinct numbers in 1..25
function validateGame(game: number[], label: string): void {
  if (!Array.isArray(game)) throw new Error(`${label}: jogo não é array`);
  if (game.length !== 15) throw new Error(`${label}: jogo possui ${game.length} dezenas (esperado 15)`);
  const set = new Set(game);
  if (set.size !== 15) throw new Error(`${label}: jogo contém dezenas duplicadas`);
  for (const n of game) {
    if (!Number.isInteger(n) || n < 1 || n > 25) {
      throw new Error(`${label}: dezena inválida ${n} fora do intervalo [1..25]`);
    }
  }
}

export function runGoldenVerification(): {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  details: {
    johnsonPassed: number;
    leximinPassed: number;
    controlsPassed: number;
    totalGamesValidated: number;
  };
} {
  console.log("===============================================================================");
  console.log("INICIANDO VERIFICAÇÃO INDEPENDENTE DE GOLDEN VECTORS — RUN-003 (CP1)");
  console.log("===============================================================================");

  const jsonPath = path.resolve("certification/c5-memory-v2/run-003/golden-vectors.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Arquivo não encontrado: ${jsonPath}`);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  const data: GoldenDataset = JSON.parse(raw);

  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;
  let totalGamesValidated = 0;

  function assertCheck(cond: boolean, code: string, msg: string): void {
    totalChecks++;
    if (cond) {
      passedChecks++;
      console.log(`  ✓ [PASS] ${code}: ${msg}`);
    } else {
      failedChecks++;
      console.error(`  ✗ [FAIL] ${code}: ${msg}`);
      throw new Error(`Assertion failed: ${code} - ${msg}`);
    }
  }

  // --- PARTE 1: DISTÂNCIAS JOHNSON ---
  console.log("\n--- 1. DISTÂNCIAS JOHNSON (d=0, 1, 2, 3, 4, 10 e Simetria) ---");
  let johnsonPassed = 0;
  for (const v of data.johnsonVectors) {
    validateGame(v.gameA, `${v.id}.gameA`);
    validateGame(v.gameB, `${v.id}.gameB`);
    totalGamesValidated += 2;

    const recalculatedDist = calcJohnsonDistance(v.gameA, v.gameB);
    assertCheck(
      recalculatedDist === v.expectedDistance,
      v.id,
      `${v.description} -> recalculado: ${recalculatedDist}, esperado: ${v.expectedDistance}`
    );
    johnsonPassed++;
  }

  // Symmetry explicit check
  const symA = data.johnsonVectors[3].gameA;
  const symB = data.johnsonVectors[3].gameB;
  assertCheck(
    calcJohnsonDistance(symA, symB) === calcJohnsonDistance(symB, symA),
    "JD_SYM_CHECK",
    "Simetria Johnson rigorosa recalculada: dJ(A,B) === dJ(B,A)"
  );

  // --- PARTE 2: MAX-LEXIMIN DIVERGÊNCIAS (n0..n9) ---
  console.log("\n--- 2. MAX-LEXIMIN DIVERGÊNCIAS (n0 até n9) ---");
  let leximinPassed = 0;
  for (const v of data.leximinVectors) {
    // 1. Validate all historical games
    for (let hi = 0; hi < v.historicalGames.length; hi++) {
      validateGame(v.historicalGames[hi], `${v.id}.historicalGames[${hi}]`);
      totalGamesValidated++;
    }

    // 2. Validate all candidates
    for (let ci = 0; ci < v.candidates.length; ci++) {
      const cand = v.candidates[ci];
      assertCheck(cand.length === 5, `${v.id}.cand[${ci}].len`, "Candidato possui exatamente 5 jogos");
      for (let gi = 0; gi < cand.length; gi++) {
        validateGame(cand[gi], `${v.id}.cand[${ci}].game[${gi}]`);
        totalGamesValidated++;
      }
    }

    // 3. Recalculate histograms from raw games
    const h0 = calcHistogram(v.candidates[0], v.historicalGames);
    const h1 = calcHistogram(v.candidates[1], v.historicalGames);

    // Verify declared histograms match dynamically recalculated ones
    assertCheck(
      JSON.stringify(h0) === JSON.stringify(v.expectedHistograms[0]),
      `${v.id}.hist0`,
      `Histograma 0 recalculado coincide com o esperado: [${h0.join(", ")}]`
    );
    assertCheck(
      JSON.stringify(h1) === JSON.stringify(v.expectedHistograms[1]),
      `${v.id}.hist1`,
      `Histograma 1 recalculado coincide com o esperado: [${h1.join(", ")}]`
    );

    // 4. Verify sum(nd) = 5 * |H|
    const sum0 = h0.reduce((a, b) => a + b, 0);
    const sum1 = h1.reduce((a, b) => a + b, 0);
    const expectedSum = 5 * v.historicalGames.length;
    assertCheck(
      sum0 === expectedSum && sum1 === expectedSum,
      `${v.id}.sum`,
      `Identidade sum(nd) = 5*|H| verificada: sum0=${sum0}, sum1=${sum1}, 5*|H|=${expectedSum}`
    );

    // 5. Verify equality prior to deciding coordinate
    const targetCoordNum = parseInt(v.targetCoord.replace("n", ""), 10);
    let coordsPriorMatch = true;
    for (let c = 0; c < targetCoordNum; c++) {
      if (h0[c] !== h1[c]) {
        coordsPriorMatch = false;
        break;
      }
    }
    assertCheck(
      coordsPriorMatch,
      `${v.id}.priorCoords`,
      `Todas as coordenadas anteriores a n${targetCoordNum} coincidem exatamente`
    );

    // 6. Verify strictly differing coordinate at targetCoord
    assertCheck(
      h0[targetCoordNum] !== h1[targetCoordNum],
      `${v.id}.diffCoord`,
      `Primeira divergência decisória ocorre em n${targetCoordNum}: h0[${targetCoordNum}]=${h0[targetCoordNum]} vs h1[${targetCoordNum}]=${h1[targetCoordNum]}`
    );

    // 7. Verify winner
    const decision = compareLeximinPure(h0, h1);
    assertCheck(
      decision.winner === v.expectedWinnerIndex && decision.decidingCoord === v.expectedDecidingCoord,
      `${v.id}.winner`,
      `Vencedor LEXMIN puro é candidato ${decision.winner} (esperado: ${v.expectedWinnerIndex}) decidindo em n${decision.decidingCoord}`
    );

    // 8. If marked C5 admissible, verify C5 validity
    if (v.isC5Admissible && v.c5Generations) {
      for (let gi = 0; gi < v.c5Generations.length; gi++) {
        const valRes = validateC5(v.c5Generations[gi]);
        assertCheck(
          valRes.valid === true,
          `${v.id}.c5Validation[${gi}]`,
          `Geração C5 candidata [${gi}] cumpre todas as invariantes canônicas C5-1.0.0`
        );
      }
    }

    leximinPassed++;
  }

  // --- PARTE 3: CONTROLES ---
  console.log("\n--- 3. CONTROLES E INVARIANTES ESTRUTURAIS ---");
  let controlsPassed = 0;
  for (const v of data.controlVectors) {
    if (v.candidates && v.historicalGames) {
      for (const h of v.historicalGames) {
        validateGame(h, `${v.id}.hist`);
        totalGamesValidated++;
      }
      for (const cand of v.candidates) {
        assertCheck(cand.length === 5, `${v.id}.len`, "Candidato tem 5 jogos");
        for (const g of cand) {
          validateGame(g, `${v.id}.game`);
          totalGamesValidated++;
        }
      }

      const recHistograms = v.candidates.map((cand) => calcHistogram(cand, v.historicalGames!));
      for (let ci = 0; ci < recHistograms.length; ci++) {
        assertCheck(
          JSON.stringify(recHistograms[ci]) === JSON.stringify(v.expectedHistograms![ci]),
          `${v.id}.hist[${ci}]`,
          `Histograma recalculado coincide: [${recHistograms[ci].join(", ")}]`
        );
        const sum = recHistograms[ci].reduce((a, b) => a + b, 0);
        assertCheck(
          sum === 5 * v.historicalGames.length,
          `${v.id}.sum[${ci}]`,
          `Soma dos componentes = 5*|H| (${sum})`
        );
      }

      // Check comparison between candidate 0 and candidate 1
      const comp = compareLeximinPure(recHistograms[0], recHistograms[1]);
      assertCheck(
        comp.winner === v.expectedWinnerIndex && comp.decidingCoord === v.expectedDecidingCoord,
        `${v.id}.decision`,
        `Decisão: vencedor=${comp.winner}, coordenada=${comp.decidingCoord} (${v.justification})`
      );
    } else if (v.candidate && v.historicalGamesOrder1 && v.historicalGamesOrder2) {
      // Invariance under permutation of H
      for (const g of v.candidate) {
        validateGame(g, `${v.id}.cand`);
        totalGamesValidated++;
      }
      for (const h of v.historicalGamesOrder1) {
        validateGame(h, `${v.id}.h1`);
        totalGamesValidated++;
      }
      for (const h of v.historicalGamesOrder2) {
        validateGame(h, `${v.id}.h2`);
        totalGamesValidated++;
      }

      const hRec1 = calcHistogram(v.candidate, v.historicalGamesOrder1);
      const hRec2 = calcHistogram(v.candidate, v.historicalGamesOrder2);
      assertCheck(
        JSON.stringify(hRec1) === JSON.stringify(hRec2),
        `${v.id}.permInvariance`,
        "Histograma é estritamente invariante sob permutação da ordem dos jogos históricos em H"
      );
    }
    controlsPassed++;
  }

  // --- PARTE 4: DEMONSTRAÇÃO FORMAL DA REGRA n9/n10 ---
  console.log("\n--- 4. PROVA FORMAL DA IDENTIDADE n10 E REGRA DE DECISÃO ---");
  {
    // Provamos que em qualquer histórico H e qualquer conjunto de candidatos de 5 jogos:
    // sum_{d=0..10} n_d = 5 * |H|
    // Logo: n_10 = 5*|H| - sum_{d=0..9} n_d
    // Se dois candidatos empatam em n0..n9, a soma parcial é idêntica, logo n_10 é matematicamente idêntico.
    // Portanto n_10 nunca pode divergir sem que alguma coordenada n0..n9 já tenha divergido.
    // E como a busca por divergência ocorre de n0 até n9, a primeira divergência sempre ocorre em n_k (k <= 9).
    const testH = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]];
    const n9Vector = data.leximinVectors.find((v) => v.id === "LEX_N9")!;
    const hA = calcHistogram(n9Vector.candidates[0], testH);
    const hB = calcHistogram(n9Vector.candidates[1], testH);

    assertCheck(
      hA.slice(0, 9).every((val, idx) => val === hB[idx]),
      "N9_PROOF_COORDS",
      "n0..n8 são exatamente idênticos no vetor LEX_N9"
    );
    assertCheck(
      hA[9] !== hB[9],
      "N9_PROOF_DIFF",
      `n9 diverge concretamente: n9(A)=${hA[9]} vs n9(B)=${hB[9]}`
    );
    assertCheck(
      hA[9] < hB[9] && hA[10] > hB[10] && hA[9] + hA[10] === hB[9] + hB[10],
      "N9_PROOF_SUM",
      "Compensação exata em n10 decorrente de sum(nd) = 5|H| comprovada"
    );
  }

  console.log("\n===============================================================================");
  console.log(`RELATÓRIO DE VERIFICAÇÃO GOLDEN VECTORS CP1:`);
  console.log(`- Total de assertions/checks executados: ${totalChecks}`);
  console.log(`- Total de aprovações: ${passedChecks}`);
  console.log(`- Total de falhas: ${failedChecks}`);
  console.log(`- Total de jogos individuais validados (15 dezenas em 1..25): ${totalGamesValidated}`);
  console.log(`- Vetores Johnson validados: ${johnsonPassed}`);
  console.log(`- Vetores LEXMIN n0..n9 validados: ${leximinPassed}`);
  console.log(`- Vetores de controle validados: ${controlsPassed}`);
  console.log("===============================================================================\n");

  return {
    totalChecks,
    passedChecks,
    failedChecks,
    details: {
      johnsonPassed,
      leximinPassed,
      controlsPassed,
      totalGamesValidated
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runGoldenVerification();
  if (result.failedChecks > 0) {
    process.exit(1);
  }
}
