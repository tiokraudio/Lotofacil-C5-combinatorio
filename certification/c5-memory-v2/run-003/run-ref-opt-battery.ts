import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { WorkerReport } from "./ref-opt-worker.ts";

export interface RefOptBatteryReport {
  totalComparisons: number;
  candidatePoolSize: number;
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
  workers: WorkerReport[];
  status: "PASS" | "FAIL";
}

export async function runBattery(
  totalCount = 100_000,
  numWorkers = 2,
  masterSeed = 3307347972
): Promise<RefOptBatteryReport> {
  console.log(`\n=== INICIANDO BATERIA REF × OPT: ${totalCount.toLocaleString()} COMPARAÇÕES INDEPENDENTES ===`);
  console.log(`Configuração: ${numWorkers} workers em paralelo, Pool K=500, Seed Master: ${masterSeed}`);

  const t0 = performance.now();
  const perWorker = Math.floor(totalCount / numWorkers);
  const subsamplePerWorker = 1000; // Total 2000 subsample iterations with full 500-candidate histogram checks

  const workerPromises: Promise<WorkerReport>[] = [];

  for (let w = 0; w < numWorkers; w++) {
    const workerId = w;
    const count = (w === numWorkers - 1) ? (totalCount - perWorker * (numWorkers - 1)) : perWorker;
    const startIdx = w * perWorker;
    const workerSeed = (masterSeed + w * 10007) >>> 0;

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
          // Mostra progresso vindo dos workers
          const lines = str.split("\n").filter((l: string) => l.includes("Progresso:"));
          for (const line of lines) {
            console.log(line);
          }
        });
        cp.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        cp.on("close", (code) => {
          if (code !== 0) {
            return reject(new Error(`Worker ${workerId} falhou com código ${code}: ${stderr}`));
          }
          // Extrair JSON report da saída
          try {
            const jsonStart = stdout.indexOf("{\n  \"workerId\":");
            if (jsonStart !== -1) {
              const parsed: WorkerReport = JSON.parse(stdout.slice(jsonStart));
              resolve(parsed);
            } else {
              // Tenta parsear último bloco {...}
              const lastBraceOpen = stdout.lastIndexOf("{");
              const lastBraceClose = stdout.lastIndexOf("}");
              if (lastBraceOpen !== -1 && lastBraceClose > lastBraceOpen) {
                const parsed: WorkerReport = JSON.parse(stdout.substring(lastBraceOpen, lastBraceClose + 1));
                resolve(parsed);
              } else {
                reject(new Error(`Worker ${workerId} não retornou relatório JSON válido: ${stdout}`));
              }
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

  // Agrega estatísticas
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

  const totalCandidateHistogramsCompared = fullHistogramCount * 500;
  const ratePerSecond = totalCount / durationSeconds;

  const result: RefOptBatteryReport = {
    totalComparisons: totalCount,
    candidatePoolSize: 500,
    divergencesCount: totalDivergences,
    firstDivergence,
    fullHistogramSubsampleCount: fullHistogramCount,
    totalCandidateHistogramsCompared,
    distributionStats: aggStats,
    durationSeconds: Number(durationSeconds.toFixed(2)),
    ratePerSecond: Number(ratePerSecond.toFixed(1)),
    workers: reports,
    status: totalDivergences === 0 ? "PASS" : "FAIL",
  };

  const outputPath = path.resolve("certification/c5-memory-v2/run-003/ref-opt-100k-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`\n=== BATERIA REF × OPT CONCLUÍDA ===`);
  console.log(`Status: ${result.status}`);
  console.log(`Comparações executadas: ${result.totalComparisons.toLocaleString()}`);
  console.log(`Divergências detectadas: ${result.divergencesCount}`);
  console.log(`Subamostra com verificação integral de 500 candidatos: ${result.fullHistogramSubsampleCount.toLocaleString()}`);
  console.log(`Histogramas individuais comparados no subsample: ${result.totalCandidateHistogramsCompared.toLocaleString()}`);
  console.log(`Distribuição de Históricos:`);
  console.log(`  - Histórico vazio (0 jogos): ${aggStats.emptyHistory.toLocaleString()}`);
  console.log(`  - Histórico pequeno (1..3 jogos): ${aggStats.smallHistory.toLocaleString()}`);
  console.log(`  - Histórico médio (4..8 jogos): ${aggStats.mediumHistory.toLocaleString()}`);
  console.log(`  - Histórico grande (9..16 jogos): ${aggStats.largeHistory.toLocaleString()}`);
  console.log(`  - Casos com jogos repetidos em H: ${aggStats.repeatedGamesInHistory.toLocaleString()}`);
  console.log(`  - Casos com empates induzidos no Pool: ${aggStats.poolsWithInjectedTies.toLocaleString()}`);
  console.log(`Tempo total: ${result.durationSeconds} s (${(result.durationSeconds / 60).toFixed(1)} min)`);
  console.log(`Throughput: ${result.ratePerSecond} it/s`);
  console.log(`Relatório salvo em: ${outputPath}`);

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const total = parseInt(process.env.TOTAL_RUNS || "100000", 10);
  const workers = parseInt(process.env.NUM_WORKERS || "2", 10);
  runBattery(total, workers).then((r) => {
    if (r.status !== "PASS") {
      process.exit(1);
    }
  }).catch((err) => {
    console.error("Erro na execução da bateria:", err);
    process.exit(1);
  });
}
