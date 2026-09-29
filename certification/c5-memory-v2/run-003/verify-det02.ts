import fs from "fs";
import path from "path";
import {
  calculateJohnsonDistance,
  computeCandidateHistogram,
  compareHistogramsLeximin,
  selectBestCandidate,
} from "./reference-evaluator.ts";
import {
  gameToBitmask,
  calculateJohnsonDistanceOpt,
  computeCandidateHistogramOpt,
  compareHistogramsOpt,
  selectBestCandidateOpt,
} from "./optimized-evaluator.ts";

export interface Det02Report {
  passed: boolean;
  totalChecks: number;
  checksPassed: number;
  divergencesCount: number;
  details: {
    johnsonDistanceEquivalence: number;
    leximinVectorsEvaluated: number;
    controlVectorsEvaluated: number;
    boundaryCasesEvaluated: number;
  };
  durationMs: number;
}

export function runDet02Verification(): Det02Report {
  const t0 = performance.now();
  let totalChecks = 0;
  let checksPassed = 0;
  let divergencesCount = 0;

  function assertEqual(actual: any, expected: any, desc: string) {
    totalChecks++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      checksPassed++;
    } else {
      divergencesCount++;
      console.error(`[DET02 FALHA] ${desc}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
    }
  }

  // 1. Carregar Golden Vectors de CP1
  const goldenPath = path.resolve("certification/c5-memory-v2/run-003/golden-vectors.json");
  const goldenData = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));

  let johnsonDistanceEquivalence = 0;
  let leximinVectorsEvaluated = 0;
  let controlVectorsEvaluated = 0;

  // 2. Verificar equivalência de Distância Johnson em todos os vetores de Johnson (d=0..10, simetria)
  for (const jVec of goldenData.johnsonVectors) {
    const dRef = calculateJohnsonDistance(jVec.gameA, jVec.gameB);
    const maskA = gameToBitmask(jVec.gameA);
    const maskB = gameToBitmask(jVec.gameB);
    const dOpt = calculateJohnsonDistanceOpt(maskA, maskB);

    assertEqual(dOpt, dRef, `Distância Johnson REF vs OPT para ${jVec.id}`);
    assertEqual(dOpt, jVec.expectedDistance, `Distância Johnson OPT vs Expected para ${jVec.id}`);

    // Simetria na OPT
    const dOptSym = calculateJohnsonDistanceOpt(maskB, maskA);
    assertEqual(dOptSym, dOpt, `Simetria da Distância Johnson OPT para ${jVec.id}`);
    johnsonDistanceEquivalence++;
  }

  // 3. Verificar equivalência em todos os 10 vetores Leximin (divergência em n0..n9)
  for (const vec of goldenData.leximinVectors) {
    const pool = vec.candidates;
    const H = vec.historicalGames;

    // REF execution
    const refResult = selectBestCandidate(pool, H);

    // OPT execution
    const optResult = selectBestCandidateOpt(pool, H);

    // Vencedor idêntico
    assertEqual(optResult.winnerIndex, refResult.winnerIndex, `Vencedor ${vec.id} REF vs OPT`);
    assertEqual(optResult.winnerIndex, vec.expectedWinnerIndex, `Vencedor ${vec.id} OPT vs Expected`);

    // Histograma do vencedor idêntico
    assertEqual(optResult.winnerHistogram, refResult.winnerHistogram, `Histograma do vencedor ${vec.id} REF vs OPT`);
    assertEqual(optResult.winnerHistogram, vec.expectedHistograms[vec.expectedWinnerIndex], `Histograma vencedor ${vec.id} OPT vs Expected`);

    // Histogramas de todos os candidatos do pool
    for (let c = 0; c < pool.length; c++) {
      const hRef = refResult.allEvaluations[c].histogram;
      const hOpt = optResult.allEvaluations[c].histogram;
      assertEqual(hOpt, hRef, `Histograma candidato ${c} em ${vec.id} REF vs OPT`);
      assertEqual(hOpt, vec.expectedHistograms[c], `Histograma candidato ${c} em ${vec.id} OPT vs Expected`);
    }

    // Comparador leximin nos candidatos 0 e 1
    const compRef = compareHistogramsLeximin(
      refResult.allEvaluations[0].histogram,
      refResult.allEvaluations[1].histogram
    );
    const compOpt = compareHistogramsOpt(
      optResult.allEvaluations[0].histogram,
      optResult.allEvaluations[1].histogram
    );
    assertEqual(compOpt.result, compRef.result, `Resultado comparador ${vec.id} [0 vs 1]`);
    assertEqual(compOpt.decidingCoordinate, compRef.decidingCoordinate, `Coordenada decisória ${vec.id} [0 vs 1]`);
    assertEqual(compOpt.decidingCoordinate, vec.expectedDecidingCoord, `Coordenada decisória ${vec.id} OPT vs Expected`);

    leximinVectorsEvaluated++;
  }

  // 4. Verificar equivalência nos vetores de Controle
  for (const ctrl of goldenData.controlVectors) {
    if (ctrl.candidates && ctrl.historicalGames) {
      const refResult = selectBestCandidate(ctrl.candidates, ctrl.historicalGames);
      const optResult = selectBestCandidateOpt(ctrl.candidates, ctrl.historicalGames);

      assertEqual(optResult.winnerIndex, refResult.winnerIndex, `Controle ${ctrl.id} Vencedor REF vs OPT`);
      if (ctrl.expectedWinnerIndex !== undefined) {
        assertEqual(optResult.winnerIndex, ctrl.expectedWinnerIndex, `Controle ${ctrl.id} Vencedor OPT vs Expected`);
      }
      assertEqual(optResult.winnerHistogram, refResult.winnerHistogram, `Controle ${ctrl.id} Histograma REF vs OPT`);

      for (let c = 0; c < ctrl.candidates.length; c++) {
        const hRef = refResult.allEvaluations[c].histogram;
        const hOpt = optResult.allEvaluations[c].histogram;
        assertEqual(hOpt, hRef, `Controle ${ctrl.id} Histograma cand ${c} REF vs OPT`);
      }
      controlVectorsEvaluated++;
    } else if (ctrl.candidate && ctrl.historicalGamesOrder1 && ctrl.historicalGamesOrder2) {
      // Caso de permutação de histórico
      const ref1 = selectBestCandidate([ctrl.candidate], ctrl.historicalGamesOrder1);
      const ref2 = selectBestCandidate([ctrl.candidate], ctrl.historicalGamesOrder2);
      const opt1 = selectBestCandidateOpt([ctrl.candidate], ctrl.historicalGamesOrder1);
      const opt2 = selectBestCandidateOpt([ctrl.candidate], ctrl.historicalGamesOrder2);

      assertEqual(opt1.winnerHistogram, ref1.winnerHistogram, `Controle ${ctrl.id} Ordem 1 REF vs OPT`);
      assertEqual(opt2.winnerHistogram, ref2.winnerHistogram, `Controle ${ctrl.id} Ordem 2 REF vs OPT`);
      assertEqual(opt1.winnerHistogram, opt2.winnerHistogram, `Controle ${ctrl.id} Invariância à permutação de H em OPT`);
      controlVectorsEvaluated++;
    }
  }

  // 5. Casos determinísticos de borda adicionais
  let boundaryCasesEvaluated = 0;

  // Borda 1: Pool com histórico vazio e múltiplos candidatos (desempate por índice 0)
  {
    const candA = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19],
    ];
    const candB = [
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20],
    ];
    const rRef = selectBestCandidate([candA, candB], []);
    const rOpt = selectBestCandidateOpt([candA, candB], []);
    assertEqual(rOpt.winnerIndex, rRef.winnerIndex, "Borda: Vencedor H vazio REF vs OPT");
    assertEqual(rOpt.winnerIndex, 0, "Borda: Vencedor H vazio desempate índice 0");
    assertEqual(rOpt.winnerHistogram, new Array(11).fill(0), "Borda: Histograma H vazio todos zeros");
    boundaryCasesEvaluated++;
  }

  // Borda 2: Empate integral quádruplo
  {
    const cand = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19],
    ];
    const H = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]];
    const rRef = selectBestCandidate([cand, cand, cand, cand], H);
    const rOpt = selectBestCandidateOpt([cand, cand, cand, cand], H);
    assertEqual(rOpt.winnerIndex, 0, "Borda: Empate quádruplo escolhe índice 0");
    assertEqual(rOpt.winnerIndex, rRef.winnerIndex, "Borda: Empate quádruplo REF vs OPT");
    assertEqual(rOpt.winnerHistogram, rRef.winnerHistogram, "Borda: Histograma empate quádruplo");
    boundaryCasesEvaluated++;
  }

  // Borda 3: Desempate com repetição no meio (candidatos 1 e 3 idênticos, ambos melhores que 0 e 2)
  {
    const badCand = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // n0 = 1
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19],
    ];
    const goodCand = [
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], // n0 = 0
      [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      [9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      [8, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      [7, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
    ];
    const H = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]];
    // pool: [0: bad, 1: good, 2: bad, 3: good]
    const rRef = selectBestCandidate([badCand, goodCand, badCand, goodCand], H);
    const rOpt = selectBestCandidateOpt([badCand, goodCand, badCand, goodCand], H);
    assertEqual(rOpt.winnerIndex, 1, "Borda: Menor índice entre empatados (1 vs 3)");
    assertEqual(rOpt.winnerIndex, rRef.winnerIndex, "Borda: Menor índice REF vs OPT");
    boundaryCasesEvaluated++;
  }

  const durationMs = performance.now() - t0;
  return {
    passed: divergencesCount === 0,
    totalChecks,
    checksPassed,
    divergencesCount,
    details: {
      johnsonDistanceEquivalence,
      leximinVectorsEvaluated,
      controlVectorsEvaluated,
      boundaryCasesEvaluated,
    },
    durationMs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("=== INICIANDO VERIFICAÇÃO DET02: EQUIVALÊNCIA DETERMINÍSTICA REF x OPT ===");
  const rep = runDet02Verification();
  console.log(`DET02 Resultado: ${rep.passed ? "PASS" : "FAIL"}`);
  console.log(`Checks Totais: ${rep.totalChecks}`);
  console.log(`Checks Aprovados: ${rep.checksPassed}`);
  console.log(`Divergências: ${rep.divergencesCount}`);
  console.log(`Duração: ${rep.durationMs.toFixed(2)} ms`);
  console.log("Detalhes:", rep.details);
  if (!rep.passed) process.exit(1);
}
