import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { WorkerReport } from "./ref-opt-worker.ts";

export interface BatchReport {
  batchIndex: number;
  startGlobalIndex: number;
  totalComparisons: number;
  divergencesCount: number;
  firstDivergence: any | null;
  fullHistogramSubsampleCount: number;
  totalCandidateHistogramsCompared: number;
  distributionStats: {
    emptyHistory: number;
    smallHistory: number;
    mediumHistory: number;
    largeHistory: number;
    repeatedGamesInHistory: number;
    poolsWithInjectedTies: number;
  };
  durationSeconds: number;
  ratePerSecond: number;
  status: "PASS" | "FAIL";
}

export async function runBatch(
  batchIndex: number,
  batchSize = 20_000,
  masterSeed = 3307347972
): Promise<BatchReport> {
  console.log(`\n=== INICIANDO LOTE ${batchIndex + 1} / 5 (${batchSize.toLocaleString()} COMPARAÇÕES) ===`);
  const t0 = performance.now();
  const startGlobalIndex = batchIndex * batchSize;
  const numWorkers = 2;
  const perWorker = batchSize / numWorkers; // 10,000 per worker
  const subsamplePerWorker = 200; // 400 total per batch

  const workerPromises: Promise<WorkerReport>[] = [];

  for (let w = 0; w < numWorkers; w++) {
    const workerId = w;
    const count = perWorker;
    const startIdx = startGlobalIndex + w * perWorker;
    const workerSeed = (masterSeed + batchIndex * 10007 + w * 503) >>> 0;

    workerPromises.push(
      new Promise((resolve, reject) => {
        const cp = spawn(
          "node",
          [
            "--experimental-strip-types",
            "certification/c5-memory-v2/run-003/ref-opt-worker.ts",
          ],
          {
            env: {
              ...process.env,
              WORKER_ID: String(workerId),
              TOTAL_TO_RUN: String(count),
              START_INDEX: String(startIdx),
              SEED: String(workerSeed),
              SUBSAMPLE_LIMIT: String(subsamplePerWorker),
            },
            stdio: ["ignore", "pipe", "pipe"],
          }
        );

        let stdout = "";
        let stderr = "";
        cp.stdout.on("data", (chunk) => {
          const str = chunk.toString();
          stdout += str;
          const lines = str.split("\n").filter((l: string) => l.includes("Progresso:"));
          for (const line of lines) {
            console.log(`[Lote ${batchIndex + 1}] ${line}`);
          }
        });
        cp.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        cp.on("close", (code) => {
          if (code !== 0) {
            return reject(new Error(`Worker ${workerId} falhou com código ${code}: ${stderr}`));
          }
          try {
            const lastBraceOpen = stdout.lastIndexOf("{");
            const lastBraceClose = stdout.lastIndexOf("}");
            if (lastBraceOpen !== -1 && lastBraceClose > lastBraceOpen) {
              const parsed: WorkerReport = JSON.parse(stdout.substring(lastBraceOpen, lastBraceClose + 1));
              resolve(parsed);
            } else {
              reject(new Error(`Worker ${workerId} não retornou relatório JSON válido: ${stdout}`));
            }
          } catch (err: any) {
            reject(new Error(`Falha ao decodificar saída do worker ${workerId}: ${err.message}`));
          }
        });
      })
    );
  }

  const reports = await Promise.all(workerPromises);
  const totalDurationMs = performance.now() - t0;
  const durationSeconds = totalDurationMs / 1000;

  let totalDivergences = 0;
  let firstDivergence: any = null;
  let fullHistogramCount = 0;
  const aggStats = {
    emptyHistory: 0,
    smallHistory: 0,
    mediumHistory: 0,
    largeHistory: 0,
    repeatedGamesInHistory: 0,
    poolsWithInjectedTies: 0,
  };

  for (const r of reports) {
    totalDivergences += r.divergencesCount;
    if (!firstDivergence && r.firstDivergence) {
      firstDivergence = r.firstDivergence;
    }
    fullHistogramCount += r.fullHistogramComparisonsCount;
    aggStats.emptyHistory += r.distributionStats.emptyHistory;
    aggStats.smallHistory += r.distributionStats.smallHistory;
    aggStats.mediumHistory += r.distributionStats.mediumHistory;
    aggStats.largeHistory += r.distributionStats.largeHistory;
    aggStats.repeatedGamesInHistory += r.distributionStats.repeatedGamesInHistory;
    aggStats.poolsWithInjectedTies += r.distributionStats.poolsWithInjectedTies;
  }

  const result: BatchReport = {
    batchIndex,
    startGlobalIndex,
    totalComparisons: batchSize,
    divergencesCount: totalDivergences,
    firstDivergence,
    fullHistogramSubsampleCount: fullHistogramCount,
    totalCandidateHistogramsCompared: fullHistogramCount * 500,
    distributionStats: aggStats,
    durationSeconds: Number(durationSeconds.toFixed(2)),
    ratePerSecond: Number((batchSize / durationSeconds).toFixed(1)),
    status: totalDivergences === 0 ? "PASS" : "FAIL",
  };

  const outputPath = path.resolve(`certification/c5-memory-v2/run-003/batch-${batchIndex}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Lote ${batchIndex + 1} concluído em ${result.durationSeconds}s (${result.ratePerSecond} it/s) com ${result.divergencesCount} divergências.`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const batchIdx = parseInt(process.argv[2] || "0", 10);
  runBatch(batchIdx).then((r) => {
    if (r.status !== "PASS") process.exit(1);
  }).catch((err) => {
    console.error("Erro no lote:", err);
    process.exit(1);
  });
}
