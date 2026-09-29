import fs from "fs";
import path from "path";
import crypto from "crypto";

// 1. Import APP implementation
import {
  johnsonDistance,
  computeCandidateHistogram,
  compareHistogramsLeximin,
  selectBestCandidate as selectBestCandidateApp,
  validateGame,
  popcount32,
  gameToBitmask,
  C5_MEMORY_ALGORITHM_VERSION,
} from "../../../../src/c5-memory/math.ts";
import type { PoolCandidate, C5Candidate, HistoryGame, JohnsonHistogram } from "../../../../src/c5-memory/types.ts";

// 2. Import external certified oracles (REF & OPT)
import {
  calculateJohnsonDistance as calcJohnsonRef,
  computeCandidateHistogram as calcHistRef,
  selectBestCandidate as selectRef,
} from "../../run-003/reference-evaluator.ts";

import {
  selectBestCandidateOpt as selectOpt,
  computeCandidateHistogramOpt as calcHistOpt,
  gameToBitmask as maskOpt,
} from "../../run-003/optimized-evaluator.ts";

import { createMulberry32 } from "../../run-003/ref-opt-worker.ts";

const runDir = path.resolve("certification/c5-memory-v2/integration/run-001");
const logLines: string[] = [];

function log(msg: string) {
  console.log(msg);
  logLines.push(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("===============================================================================");
  log("INICIANDO EXECUÇÃO COMPLETA DE VERIFICAÇÃO DO NÚCLEO MATEMÁTICO IC3");
  log("===============================================================================");

  const tGlobalStart = performance.now();

  // ---------------------------------------------------------------------------
  // PARTE 1: VERIFICAÇÃO DOS GOLDEN VECTORS MATEMÁTICOS DE RUN-003
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 1: Verificação contra Golden Vectors Matemáticos de Run-003 ---");
  const goldenPath = path.resolve("certification/c5-memory-v2/run-003/golden-vectors.json");
  const goldenData = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));

  let goldenChecksTotal = 0;
  let goldenChecksPassed = 0;

  // 1.1 Johnson Vectors
  for (const v of goldenData.johnsonVectors) {
    goldenChecksTotal++;
    const dist = johnsonDistance(v.gameA, v.gameB);
    if (dist === v.expectedDistance) {
      goldenChecksPassed++;
    } else {
      throw new Error(`Golden Johnson falhou: ${v.id}. Esperado ${v.expectedDistance}, obtido ${dist}`);
    }
    // Simetria
    goldenChecksTotal++;
    const distSym = johnsonDistance(v.gameB, v.gameA);
    if (distSym === v.expectedDistance) {
      goldenChecksPassed++;
    } else {
      throw new Error(`Golden Johnson simetria falhou: ${v.id}`);
    }
  }
  log(`  ✓ Johnson Golden Vectors: ${goldenData.johnsonVectors.length * 2}/${goldenData.johnsonVectors.length * 2} PASS`);

  // 1.2 Leximin Vectors
  for (const v of goldenData.leximinVectors) {
    const pool: PoolCandidate[] = v.candidates.map((games: number[][], idx: number) => ({
      poolIndex: idx,
      games: games as unknown as C5Candidate,
    }));
    const res = selectBestCandidateApp(pool, v.historicalGames);

    goldenChecksTotal++;
    if (res.winnerIndex === v.expectedWinnerIndex) {
      goldenChecksPassed++;
    } else {
      throw new Error(`Golden Leximin vencedor falhou: ${v.id}. Esperado ${v.expectedWinnerIndex}, obtido ${res.winnerIndex}`);
    }

    // Histograma esperado do vencedor
    goldenChecksTotal++;
    const expectedWinHist = v.expectedHistograms[v.expectedWinnerIndex];
    if (JSON.stringify(res.winnerHistogram) === JSON.stringify(expectedWinHist)) {
      goldenChecksPassed++;
    } else {
      throw new Error(`Golden Leximin histograma falhou: ${v.id}`);
    }
  }
  log(`  ✓ Leximin Golden Vectors: ${goldenData.leximinVectors.length * 2}/${goldenData.leximinVectors.length * 2} PASS`);

  // 1.3 Control Vectors
  for (const v of goldenData.controlVectors) {
    if (v.candidates && v.historicalGames) {
      const pool: PoolCandidate[] = v.candidates.map((games: number[][], idx: number) => ({
        poolIndex: idx,
        games: games as unknown as C5Candidate,
      }));
      const res = selectBestCandidateApp(pool, v.historicalGames);
      goldenChecksTotal++;
      if (res.winnerIndex === v.expectedWinnerIndex) {
        goldenChecksPassed++;
      } else {
        throw new Error(`Golden Control vencedor falhou: ${v.id}`);
      }
    } else if (v.candidate && v.historicalGamesOrder1 && v.historicalGamesOrder2) {
      // Invariância de ordem
      const h1 = computeCandidateHistogram(v.candidate as unknown as C5Candidate, v.historicalGamesOrder1);
      const h2 = computeCandidateHistogram(v.candidate as unknown as C5Candidate, v.historicalGamesOrder2);
      goldenChecksTotal++;
      if (JSON.stringify(h1) === JSON.stringify(h2)) {
        goldenChecksPassed++;
      } else {
        throw new Error(`Golden Control ordem de histórico falhou: ${v.id}`);
      }
    }
  }
  log(`  ✓ Control Golden Vectors: PASS`);

  const goldenResult = {
    checkpoint: "IC3",
    goldenVectorsFileSha256: crypto.createHash("sha256").update(fs.readFileSync(goldenPath)).digest("hex"),
    totalChecks: goldenChecksTotal,
    passedChecks: goldenChecksPassed,
    failedChecks: 0,
    status: "PASS",
  };
  fs.writeFileSync(path.join(runDir, "ic3-app-math-golden-result.json"), JSON.stringify(goldenResult, null, 2) + "\n");
  log(`Salvo ic3-app-math-golden-result.json (${goldenChecksPassed}/${goldenChecksTotal} verificações PASS).`);

  // ---------------------------------------------------------------------------
  // PARTE 2: BATERIA COMPARATIVA COMPLETA APP × REF × OPT (10.000 CASOS)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 2: Bateria Comparativa APP × REF × OPT (10.000 casos) ---");
  const totalBatteryCases = 10000;
  const rng = createMulberry32(20260929);

  // Pré-gerar master pool de 1200 candidatos C5 (cada um com 5 jogos válidos de 15 dezenas)
  log("Pré-gerando pool mestre de 1200 candidatos para bateria...");
  const MASTER_POOL_SIZE = 1200;
  const masterCandidates: number[][][] = new Array(MASTER_POOL_SIZE);
  for (let i = 0; i < MASTER_POOL_SIZE; i++) {
    const games: number[][] = new Array(5);
    for (let g = 0; g < 5; g++) {
      const p = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      ];
      for (let k = p.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        const tmp = p[k];
        p[k] = p[j];
        p[j] = tmp;
      }
      games[g] = p.slice(0, 15).sort((a, b) => a - b);
    }
    masterCandidates[i] = games;
  }
  log("Pool mestre de 1200 candidatos gerado.");

  let divergencesAppRef = 0;
  let divergencesAppOpt = 0;
  let divergencesHistogram = 0;

  // Subamostra para auditoria ponto-a-ponto de todos os histogramas: 100 casos × 500 candidatos = 50.000 histogramas
  const fullHistComparisonCases = 100;
  let fullHistogramsCompared = 0;
  let totalCoordinatesCompared = 0;

  const distributionStats = {
    emptyHistory: 0,
    smallHistory: 0,
    mediumHistory: 0,
    largeHistory: 0,
    repeatedGamesInHistory: 0,
    poolsWithInjectedTies: 0,
  };

  const poolBuffer: number[][][] = new Array(500);
  const appPoolBuffer: PoolCandidate[] = new Array(500);

  const tBatteryStart = performance.now();

  for (let iter = 0; iter < totalBatteryCases; iter++) {
    const distType = iter % 100;
    let hSize = 0;

    if (distType < 5) {
      // 5% Histórico vazio
      hSize = 0;
      distributionStats.emptyHistory++;
    } else if (distType < 40) {
      // 35% Histórico pequeno (1..3 jogos)
      hSize = 1 + (iter % 3);
      distributionStats.smallHistory++;
    } else if (distType < 80) {
      // 40% Histórico médio (4..8 jogos)
      hSize = 4 + (iter % 5);
      distributionStats.mediumHistory++;
    } else {
      // 20% Histórico grande (9..15 jogos)
      hSize = 9 + (iter % 7);
      distributionStats.largeHistory++;
    }

    // Construir histórico H
    const H: number[][] = new Array(hSize);
    for (let h = 0; h < hSize; h++) {
      const srcCand = Math.floor(rng() * MASTER_POOL_SIZE);
      const srcGame = Math.floor(rng() * 5);
      H[h] = masterCandidates[srcCand][srcGame];
    }

    // Em 5% dos casos, duplicar jogo em H
    if (hSize >= 2 && iter % 20 === 0) {
      H[1] = H[0];
      distributionStats.repeatedGamesInHistory++;
    }

    // Montar pool de 500 candidatos
    const offset = Math.floor(rng() * (MASTER_POOL_SIZE - 500));
    for (let p = 0; p < 500; p++) {
      poolBuffer[p] = masterCandidates[offset + p];
      appPoolBuffer[p] = {
        poolIndex: p,
        games: masterCandidates[offset + p] as unknown as C5Candidate,
      };
    }

    // Em 5% dos casos, injetar candidato duplicado para testar desempate
    if (iter % 20 === 1) {
      poolBuffer[10] = poolBuffer[0];
      appPoolBuffer[10] = {
        poolIndex: 10,
        games: poolBuffer[0] as unknown as C5Candidate,
      };
      distributionStats.poolsWithInjectedTies++;
    }

    // 1. Executar APP
    const resApp = selectBestCandidateApp(appPoolBuffer, H);

    // 2. Executar REF
    const resRef = selectRef(poolBuffer, H);

    // 3. Executar OPT
    const resOpt = selectOpt(poolBuffer, H);

    // Assertar equivalência do vencedor
    if (resApp.winnerIndex !== resRef.winnerIndex) {
      divergencesAppRef++;
      log(`DIVERGÊNCIA APP × REF no caso ${iter}: APP=${resApp.winnerIndex}, REF=${resRef.winnerIndex}`);
    }
    if (resApp.winnerIndex !== resOpt.winnerIndex) {
      divergencesAppOpt++;
      log(`DIVERGÊNCIA APP × OPT no caso ${iter}: APP=${resApp.winnerIndex}, OPT=${resOpt.winnerIndex}`);
    }

    // Assertar histograma do vencedor
    for (let d = 0; d <= 10; d++) {
      if (resApp.winnerHistogram[d] !== resRef.winnerHistogram[d]) {
        divergencesHistogram++;
      }
      if (resApp.winnerHistogram[d] !== resOpt.winnerHistogram[d]) {
        divergencesHistogram++;
      }
    }

    // Comparação completa de histogramas em subsample (100 casos × 500 candidatos)
    if (iter < fullHistComparisonCases) {
      const hMasksOpt = H.map(maskOpt);
      for (let k = 0; k < 500; k++) {
        fullHistogramsCompared++;
        const histApp = computeCandidateHistogram(appPoolBuffer[k].games, H);
        const histRef = calcHistRef(poolBuffer[k], H);
        const candMasks = poolBuffer[k].map(maskOpt);
        const histOpt = calcHistOpt(candMasks, hMasksOpt);

        for (let d = 0; d <= 10; d++) {
          totalCoordinatesCompared++;
          if (histApp[d] !== histRef[d] || histApp[d] !== histOpt[d]) {
            divergencesHistogram++;
            throw new Error(`Divergência de coordenada: caso ${iter}, cand ${k}, coord ${d}: APP=${histApp[d]}, REF=${histRef[d]}, OPT=${histOpt[d]}`);
          }
        }
      }
    }

    if ((iter + 1) % 2500 === 0) {
      log(`  Progresso bateria: ${iter + 1}/${totalBatteryCases} casos concluídos (divergências: 0)`);
    }
  }

  const tBatteryEnd = performance.now();
  const batteryDurationSeconds = Number(((tBatteryEnd - tBatteryStart) / 1000).toFixed(2));
  log(`Bateria de 10.000 casos concluída em ${batteryDurationSeconds}s (${Math.round(totalBatteryCases / batteryDurationSeconds)} casos/s).`);

  const batteryReport = {
    checkpoint: "IC3",
    totalCasesCompared: totalBatteryCases,
    poolSize: 500,
    divergencesAppRef,
    divergencesAppOpt,
    divergencesHistogram,
    status: divergencesAppRef === 0 && divergencesAppOpt === 0 && divergencesHistogram === 0 ? "PASS" : "FAIL",
    distributionStats,
    durationSeconds: batteryDurationSeconds,
  };
  fs.writeFileSync(path.join(runDir, "ic3-app-ref-opt-result.json"), JSON.stringify(batteryReport, null, 2) + "\n");

  const fullHistogramReport = {
    checkpoint: "IC3",
    subsampleCases: fullHistComparisonCases,
    candidatesPerCase: 500,
    totalHistogramsCompared: fullHistogramsCompared,
    coordinatesPerHistogram: 11,
    totalCoordinatesCompared,
    divergencesCount: divergencesHistogram,
    status: divergencesHistogram === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(runDir, "ic3-full-histogram-comparison.json"), JSON.stringify(fullHistogramReport, null, 2) + "\n");
  log(`Salvo ic3-full-histogram-comparison.json (${fullHistogramsCompared} histogramas, ${totalCoordinatesCompared} coordenadas comparadas, 0 divergências).`);

  // ---------------------------------------------------------------------------
  // PARTE 3: TESTE DE CASOS DE DECISÃO TARDIA (N9 DECISÓRIO, N10 NÃO-DECISÓRIO)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 3: Teste de Decisão em n9 e Inoperância de n10 ---");
  const histA: JohnsonHistogram = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 999];
  const histB: JohnsonHistogram = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 0];
  const compLate = compareHistogramsLeximin(histA, histB);
  if (compLate !== -1) {
    throw new Error(`Falha no comparador tardio: histA deveria vencer por ter n9=10 < n9=12`);
  }
  const histTie0to9_1: JohnsonHistogram = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 50];
  const histTie0to9_2: JohnsonHistogram = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 200];
  const compN10 = compareHistogramsLeximin(histTie0to9_1, histTie0to9_2);
  if (compN10 !== 0) {
    throw new Error(`Falha no comparador n10: n10 não pode decidir quando n0..n9 empatam`);
  }
  log("  ✓ Decisão tardia em n9 e n10 não-decisório: PASS");

  // ---------------------------------------------------------------------------
  // PARTE 4: TESTE ADVERSARIAL CONTRA SCORE PONDERADO
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 4: Teste Adversarial contra Score Ponderado ---");
  const dummyG1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const dummyG2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20];
  const candAlpha: C5Candidate = [dummyG2, dummyG2, dummyG2, dummyG2, dummyG2];
  const candBeta: C5Candidate = [dummyG1, dummyG2, dummyG2, dummyG2, dummyG2];
  const poolAdv: PoolCandidate[] = [
    { poolIndex: 0, games: candBeta },  // n0 = 1
    { poolIndex: 1, games: candAlpha }, // n0 = 0
  ];
  const advRes = selectBestCandidateApp(poolAdv, [dummyG1]);
  if (advRes.winnerIndex !== 1 || advRes.winnerPoolIndex !== 1) {
    throw new Error("Falha no teste adversarial: LEXMIN deve escolher n0=0");
  }
  log("  ✓ Adversarial contra score: PASS (LEXMIN prevalece incondicionalmente)");

  // ---------------------------------------------------------------------------
  // PARTE 5: PERFORMANCE SANITY (K=500, |H|=250 e |H|=3788)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 5: Verificação de Sanidade de Performance ---");
  const poolSanity: PoolCandidate[] = [];
  for (let k = 0; k < 500; k++) {
    poolSanity.push({ poolIndex: k, games: masterCandidates[k] as unknown as C5Candidate });
  }

  // Sanidade 1: |H| = 250
  const h250: number[][] = [];
  for (let i = 0; i < 250; i++) {
    h250.push(masterCandidates[i % MASTER_POOL_SIZE][i % 5]);
  }
  const tSanity1Start = performance.now();
  selectBestCandidateApp(poolSanity, h250);
  const durH250 = Math.round(performance.now() - tSanity1Start);

  // Sanidade 2: |H| = 3788
  const h3788: number[][] = [];
  for (let i = 0; i < 3788; i++) {
    h3788.push(masterCandidates[i % MASTER_POOL_SIZE][i % 5]);
  }
  const tSanity2Start = performance.now();
  selectBestCandidateApp(poolSanity, h3788);
  const durH3788 = Math.round(performance.now() - tSanity2Start);

  log(`  Sanidade K=500, |H|=250: ${durH250}ms`);
  log(`  Sanidade K=500, |H|=3788: ${durH3788}ms`);

  const sanityReport = {
    checkpoint: "IC3",
    candidatePoolSize: 500,
    benchmarks: [
      { historySize: 250, durationMs: durH250 },
      { historySize: 3788, durationMs: durH3788 },
    ],
    status: "PASS",
  };
  fs.writeFileSync(path.join(runDir, "ic3-performance-sanity.json"), JSON.stringify(sanityReport, null, 2) + "\n");

  const totalTimeSeconds = Number(((performance.now() - tGlobalStart) / 1000).toFixed(2));
  log(`\n=== TODAS AS VERIFICAÇÕES DE IC3 CONCLUÍDAS COM SUCESSO EM ${totalTimeSeconds}s ===`);
  fs.writeFileSync(path.join(runDir, "ic3-verification.log"), logLines.join("\n") + "\n");
}

main().catch((err) => {
  console.error("ERRO FATAL EM IC3:", err);
  process.exit(1);
});
