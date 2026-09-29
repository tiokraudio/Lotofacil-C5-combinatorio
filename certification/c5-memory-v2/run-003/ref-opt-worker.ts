import { selectBestCandidate } from "./reference-evaluator.ts";
import { selectBestCandidateOpt } from "./optimized-evaluator.ts";

// Deterministic Mulberry32 PRNG
export function createMulberry32(seed: number) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate valid 15-number game out of 1..25
export function generateSeededGame(rng: () => number): number[] {
  const pool = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25
  ];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, 15).sort((a, b) => a - b);
}

export interface WorkerReport {
  workerId: number;
  comparisonsExecuted: number;
  divergencesCount: number;
  firstDivergence: any | null;
  fullHistogramComparisonsCount: number;
  distributionStats: {
    emptyHistory: number;
    smallHistory: number;
    mediumHistory: number;
    largeHistory: number;
    repeatedGamesInHistory: number;
    poolsWithInjectedTies: number;
  };
  durationMs: number;
}

export async function runWorker(
  workerId: number,
  totalToRun: number,
  startGlobalIndex: number,
  seed: number,
  subsampleLimit: number,
  progressCallback?: (done: number) => void
): Promise<WorkerReport> {
  const t0 = performance.now();
  const rng = createMulberry32(seed);

  // Pre-generate a master pool of candidate C5 blocks (each block = 5 games)
  // to avoid spending seconds in Fisher-Yates inside the comparison loop
  const MASTER_POOL_SIZE = 1200;
  const masterCandidates: number[][][] = new Array(MASTER_POOL_SIZE);
  for (let i = 0; i < MASTER_POOL_SIZE; i++) {
    const games: number[][] = new Array(5);
    for (let g = 0; g < 5; g++) {
      games[g] = generateSeededGame(rng);
    }
    masterCandidates[i] = games;
  }

  let divergencesCount = 0;
  let firstDivergence: any | null = null;
  let fullHistogramComparisonsCount = 0;

  const distributionStats = {
    emptyHistory: 0,
    smallHistory: 0,
    mediumHistory: 0,
    largeHistory: 0,
    repeatedGamesInHistory: 0,
    poolsWithInjectedTies: 0,
  };

  const poolBuffer: number[][][] = new Array(500);

  for (let iter = 0; iter < totalToRun; iter++) {
    const globalIdx = startGlobalIndex + iter;

    // 1. Determine history size based on frozen distribution
    const distType = iter % 100;
    let hSize = 0;
    if (distType < 5) {
      // 5% Empty history
      hSize = 0;
      distributionStats.emptyHistory++;
    } else if (distType < 40) {
      // 35% Small history (1..3)
      hSize = 1 + (iter % 3);
      distributionStats.smallHistory++;
    } else if (distType < 80) {
      // 40% Medium history (4..8)
      hSize = 4 + (iter % 5);
      distributionStats.mediumHistory++;
    } else {
      // 20% Large history (9..16)
      hSize = 9 + (iter % 8);
      distributionStats.largeHistory++;
    }

    // 2. Build history H
    const H: number[][] = new Array(hSize);
    for (let h = 0; h < hSize; h++) {
      const srcCand = Math.floor(rng() * MASTER_POOL_SIZE);
      const srcGame = Math.floor(rng() * 5);
      H[h] = masterCandidates[srcCand][srcGame];
    }

    // In 5% of cases, duplicate a game in H
    if (hSize >= 2 && (iter % 20 === 0)) {
      H[1] = H[0];
      distributionStats.repeatedGamesInHistory++;
    }

    // 3. Assemble canonical K=500 pool
    const offset = Math.floor(rng() * (MASTER_POOL_SIZE - 500));
    for (let p = 0; p < 500; p++) {
      poolBuffer[p] = masterCandidates[offset + p];
    }

    // In 5% of cases, inject a duplicate candidate to test tie-breaking
    if (iter % 20 === 1) {
      poolBuffer[10] = poolBuffer[0]; // Candidate 10 is identical to Candidate 0
      distributionStats.poolsWithInjectedTies++;
    }

    // 4. Execute REF
    const refResult = selectBestCandidate(poolBuffer, H);

    // 5. Execute OPT
    const optResult = selectBestCandidateOpt(poolBuffer, H);

    // 6. Compare Winners
    if (refResult.winnerIndex !== optResult.winnerIndex) {
      divergencesCount++;
      if (!firstDivergence) {
        firstDivergence = {
          iteration: globalIdx,
          type: "WINNER_MISMATCH",
          refWinner: refResult.winnerIndex,
          optWinner: optResult.winnerIndex,
          refWinnerHist: refResult.winnerHistogram,
          optWinnerHist: optResult.winnerHistogram,
          hSize,
        };
      }
    }

    // 7. Compare Winner Histogram
    for (let d = 0; d <= 10; d++) {
      if (refResult.winnerHistogram[d] !== optResult.winnerHistogram[d]) {
        divergencesCount++;
        if (!firstDivergence) {
          firstDivergence = {
            iteration: globalIdx,
            type: "WINNER_HISTOGRAM_MISMATCH",
            refWinnerHist: refResult.winnerHistogram,
            optWinnerHist: optResult.winnerHistogram,
            hSize,
          };
        }
      }
    }

    // 8. Full Histogram Comparison for Subsample
    if (iter < subsampleLimit) {
      fullHistogramComparisonsCount++;
      for (let c = 0; c < 500; c++) {
        const refHist = refResult.allEvaluations[c].histogram;
        const optHist = optResult.allEvaluations[c].histogram;
        for (let d = 0; d <= 10; d++) {
          if (refHist[d] !== optHist[d]) {
            divergencesCount++;
            if (!firstDivergence) {
              firstDivergence = {
                iteration: globalIdx,
                type: "CANDIDATE_HISTOGRAM_MISMATCH",
                candidateIndex: c,
                refHist,
                optHist,
                hSize,
              };
            }
          }
        }
      }
    }

    if (progressCallback && (iter + 1) % 10000 === 0) {
      progressCallback(iter + 1);
    }
  }

  const durationMs = performance.now() - t0;
  return {
    workerId,
    comparisonsExecuted: totalToRun,
    divergencesCount,
    firstDivergence,
    fullHistogramComparisonsCount,
    distributionStats,
    durationMs,
  };
}

// Support execution via child process IPC or CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const workerId = parseInt(process.env.WORKER_ID || "0", 10);
  const totalToRun = parseInt(process.env.TOTAL_TO_RUN || "50000", 10);
  const startGlobalIndex = parseInt(process.env.START_INDEX || "0", 10);
  const seed = parseInt(process.env.SEED || "3307347972", 10);
  const subsampleLimit = parseInt(process.env.SUBSAMPLE_LIMIT || "1000", 10);

  console.log(`Worker ${workerId} iniciando: ${totalToRun} comparações (seed: ${seed})...`);
  runWorker(
    workerId,
    totalToRun,
    startGlobalIndex,
    seed,
    subsampleLimit,
    (done) => {
      console.log(`  [Worker ${workerId}] Progresso: ${done} / ${totalToRun}`);
    }
  ).then((report) => {
    console.log(`Worker ${workerId} finalizado em ${(report.durationMs / 1000).toFixed(1)}s com ${report.divergencesCount} divergências.`);
    if (process.send) {
      process.send(report);
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  }).catch((err) => {
    console.error(`Erro no worker ${workerId}:`, err);
    process.exit(1);
  });
}
