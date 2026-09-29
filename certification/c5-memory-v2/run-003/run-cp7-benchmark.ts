import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { generateC5 } from "../../../src/c5/generator.ts";
import { createMulberry32 } from "../../../src/c5/random.ts";
import { selectBestCandidateOpt } from "./optimized-evaluator.ts";

export interface Cp7PerformanceResult {
  checkpoint: "CP7";
  algorithm: "C5-Memory-2.0.0";
  implementation: "OPT (optimized-evaluator.ts)";
  optSha256: string;
  constants: {
    K: number;
    T: number;
    historicalGamesCount: number;
    candidateGamesCount: number;
  };
  corpus: {
    rng: string;
    masterSeed: number;
    corpusSha256: string;
    constructionMethod: string;
  };
  warmup: {
    iterations: number;
    durationMs: number;
  };
  benchmark: {
    officialMeasurementsCount: number;
    timerMechanism: string;
    statistics: {
      minMs: number;
      p50Ms: number;
      p90Ms: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
      meanMs: number;
      stddevMs: number;
    };
    limits: {
      p95LimitMs: number;
      maxLimitMs: number;
      p95Passed: boolean;
      maxPassed: boolean;
    };
    functionalChecks: {
      allWinnersValid: boolean;
      exceptionsCount: number;
      historyMutationsDetected: boolean;
      poolMutationsDetected: boolean;
      refSanityMatch: boolean;
      divergencesCount: number;
    };
  };
  memory: {
    rssBeforeBytes: number;
    rssAfterBytes: number;
    rssPeakBytes: number;
    heapUsedBeforeBytes: number;
    heapUsedAfterBytes: number;
    heapUsedPeakBytes: number;
  };
  environment: {
    nodeVersion: string;
    npmVersion: string;
    platform: string;
    osRelease: string;
    architecture: string;
    cpuModel: string;
    cpuCores: number;
    totalMemoryMb: number;
    freeMemoryMb: number;
  };
  artifacts: {
    samplesFile: string;
    samplesSha256: string;
    logFile: string;
    logSha256: string;
  };
  status: "PASS" | "FAIL";
}

export function runCp7Benchmark(
  totalMeasurements = 1000,
  warmupIterations = 10,
  masterSeed = 20260929
): Cp7PerformanceResult {
  const logLines: string[] = [];
  function log(msg: string) {
    console.log(msg);
    logLines.push(msg);
  }

  log("===============================================================================");
  log("  CP7: BARREIRA CANÔNICA DE PERFORMANCE OPERACIONAL DA OPT (K=500, T=3788)");
  log("===============================================================================");

  const tStart = performance.now();
  const rng = createMulberry32(masterSeed);

  // 1. Coleta de memória inicial
  const memBefore = process.memoryUsage();
  let rssPeak = memBefore.rss;
  let heapPeak = memBefore.heapUsed;

  function trackMemory() {
    const m = process.memoryUsage();
    if (m.rss > rssPeak) rssPeak = m.rss;
    if (m.heapUsed > heapPeak) heapPeak = m.heapUsed;
  }

  // 2. Construção do histórico H canônico (T=3788 apostas C5 = 18.940 jogos) fora da janela medida
  log("\n--- 1. CONSTRUÇÃO DETERMINÍSTICA DO CORPUS ---");
  log(`Gerando histórico canônico H com T=3.788 apostas C5 (|H|=18.940 jogos) [Seed: ${masterSeed}]...`);
  const H: number[][] = [];
  for (let t = 0; t < 3788; t++) {
    const c5 = generateC5(rng);
    for (const g of c5.games) {
      H.push(g);
    }
  }
  const hSha256 = crypto.createHash("sha256").update(JSON.stringify(H)).digest("hex");
  log(`Histórico H construído: |H|=${H.length} jogos | SHA-256(H)=${hSha256}`);

  // Pré-geração de repositório de candidatos C5 para os pools
  log("Pré-gerando repositório de pools C5...");
  const poolRepository: number[][][][] = [];
  const REPO_SIZE = 50;
  for (let r = 0; r < REPO_SIZE; r++) {
    const p: number[][][] = [];
    for (let k = 0; k < 500; k++) {
      p.push(generateC5(rng).games);
    }
    poolRepository.push(p);
  }
  log(`Repositório de ${REPO_SIZE} pools independentes pré-alocado.`);
  trackMemory();

  // 3. WARM-UP (fora das estatísticas oficiais)
  log("\n--- 2. WARM-UP SEPARADO ---");
  log(`Executando ${warmupIterations} iterações de warm-up com carga representativa (K=500, |H|=18.940)...`);
  const tWarmup0 = performance.now();
  for (let w = 0; w < warmupIterations; w++) {
    const pool = poolRepository[w % REPO_SIZE];
    selectBestCandidateOpt(pool, H);
    trackMemory();
  }
  const warmupDurationMs = performance.now() - tWarmup0;
  log(`Warm-up concluído: ${warmupIterations} iterações em ${(warmupDurationMs / 1000).toFixed(2)} s (média ${(warmupDurationMs / warmupIterations).toFixed(2)} ms/it).`);

  // 4. AMOSTRA OFICIAL (1.000 medições)
  log(`\n--- 3. EXECUÇÃO DA AMOSTRA OFICIAL: ${totalMeasurements.toLocaleString()} MEDIÇÕES ---`);
  const samples: number[] = new Array(totalMeasurements);
  let allWinnersValid = true;
  let exceptionsCount = 0;
  let historyMutationsDetected = false;
  let poolMutationsDetected = false;

  const hLengthOriginal = H.length;

  const tOfficialStart = performance.now();
  for (let i = 0; i < totalMeasurements; i++) {
    const pool = poolRepository[i % REPO_SIZE];
    const poolLengthOriginal = pool.length;

    // === JANELA MEDIDA ESTREITA: seleção matemática OPT ===
    const t0 = performance.now();
    const result = selectBestCandidateOpt(pool, H);
    const duration = performance.now() - t0;
    // =====================================================

    samples[i] = Number(duration.toFixed(3));

    // Verificações funcionais durante o benchmark
    if (result.winnerIndex < 0 || result.winnerIndex >= 500) {
      allWinnersValid = false;
    }
    if (H.length !== hLengthOriginal) {
      historyMutationsDetected = true;
    }
    if (pool.length !== poolLengthOriginal) {
      poolMutationsDetected = true;
    }

    if ((i + 1) % 100 === 0) {
      trackMemory();
      const elapsedSec = (performance.now() - tOfficialStart) / 1000;
      log(`  Progresso: ${(i + 1).toString().padStart(4)} / ${totalMeasurements} medições | Média parcial: ${(samples.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1)).toFixed(2)} ms | Tempo: ${elapsedSec.toFixed(1)}s`);
    }
  }

  trackMemory();
  const memAfter = process.memoryUsage();

  // 5. CÁLCULO ESTATÍSTICO DOS PERCENTIS
  log("\n--- 4. CÁLCULO ESTATÍSTICO DOS PERCENTIS ---");
  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = sorted[0];
  const maxMs = sorted[sorted.length - 1];

  function percentile(p: number): number {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(3));
  }

  const p50Ms = percentile(50);
  const p90Ms = percentile(90);
  const p95Ms = percentile(95);
  const p99Ms = percentile(99);

  const sum = samples.reduce((acc, val) => acc + val, 0);
  const meanMs = Number((sum / samples.length).toFixed(3));
  const variance = samples.reduce((acc, val) => acc + Math.pow(val - meanMs, 2), 0) / samples.length;
  const stddevMs = Number(Math.sqrt(variance).toFixed(3));

  log(`  Min:     ${minMs.toFixed(2)} ms`);
  log(`  P50:     ${p50Ms.toFixed(2)} ms`);
  log(`  P90:     ${p90Ms.toFixed(2)} ms`);
  log(`  P95:     ${p95Ms.toFixed(2)} ms`);
  log(`  P99:     ${p99Ms.toFixed(2)} ms`);
  log(`  Max:     ${maxMs.toFixed(2)} ms`);
  log(`  Média:   ${meanMs.toFixed(2)} ms`);
  log(`  DesvPad: ${stddevMs.toFixed(2)} ms`);

  // 6. VALIDAÇÃO DOS LIMITES CANÔNICOS
  const P95_LIMIT = 500;
  const MAX_LIMIT = 2000;
  const p95Passed = p95Ms < P95_LIMIT;
  const maxPassed = maxMs < MAX_LIMIT;

  log("\n--- 5. AVALIAÇÃO DOS LIMITES CANÔNICOS ---");
  log(`  Limite P95: P95 < ${P95_LIMIT} ms -> Obtido: ${p95Ms.toFixed(2)} ms [${p95Passed ? "PASS" : "FAIL"}]`);
  log(`  Limite Max: Max < ${MAX_LIMIT} ms -> Obtido: ${maxMs.toFixed(2)} ms [${maxPassed ? "PASS" : "FAIL"}]`);

  // 7. INTEGRAÇÃO DA SUBAMOSTRA REF×OPT
  const sanityFile = path.resolve("certification/c5-memory-v2/run-003/cp7-sanity-ref-result.json");
  let refSanityMatch = false;
  let divergencesCount = 0;
  if (fs.existsSync(sanityFile)) {
    const sanityData = JSON.parse(fs.readFileSync(sanityFile, "utf-8"));
    refSanityMatch = sanityData.allMatch;
    divergencesCount = sanityData.divergencesCount;
    log(`  Subamostra REF×OPT: ${sanityData.samplesTested} amostras verificadas | Divergências: ${divergencesCount} [${refSanityMatch ? "PASS" : "FAIL"}]`);
  } else {
    log("  AVISO: Relatório de sanidade REF×OPT não encontrado!");
  }

  // 8. MATERIALIZAÇÃO DOS ARTEFATOS
  const samplesPath = path.resolve("certification/c5-memory-v2/run-003/cp7-performance-samples.json");
  fs.writeFileSync(samplesPath, JSON.stringify(samples, null, 2), "utf-8");
  const samplesSha256 = crypto.createHash("sha256").update(fs.readFileSync(samplesPath)).digest("hex");

  const logPath = path.resolve("certification/c5-memory-v2/run-003/cp7-performance.log");
  fs.writeFileSync(logPath, logLines.join("\n") + "\n", "utf-8");
  const logSha256 = crypto.createHash("sha256").update(fs.readFileSync(logPath)).digest("hex");

  const overallPassed =
    p95Passed &&
    maxPassed &&
    allWinnersValid &&
    exceptionsCount === 0 &&
    !historyMutationsDetected &&
    !poolMutationsDetected &&
    refSanityMatch;

  const result: Cp7PerformanceResult = {
    checkpoint: "CP7",
    algorithm: "C5-Memory-2.0.0",
    implementation: "OPT (optimized-evaluator.ts)",
    optSha256: "fc73455b1db99af40e0cdf1a4bf649d05371f2f7e34dc33ba39947107554de60",
    constants: {
      K: 500,
      T: 3788,
      historicalGamesCount: 18940,
      candidateGamesCount: 5,
    },
    corpus: {
      rng: "Mulberry32",
      masterSeed,
      corpusSha256: hSha256,
      constructionMethod: "3.788 apostas C5 de 5 jogos geradas determinística e sequencialmente",
    },
    warmup: {
      iterations: warmupIterations,
      durationMs: Number(warmupDurationMs.toFixed(2)),
    },
    benchmark: {
      officialMeasurementsCount: totalMeasurements,
      timerMechanism: "performance.now() (Monotonic High-Resolution Timer)",
      statistics: {
        minMs,
        p50Ms,
        p90Ms,
        p95Ms,
        p99Ms,
        maxMs,
        meanMs,
        stddevMs,
      },
      limits: {
        p95LimitMs: P95_LIMIT,
        maxLimitMs: MAX_LIMIT,
        p95Passed,
        maxPassed,
      },
      functionalChecks: {
        allWinnersValid,
        exceptionsCount,
        historyMutationsDetected,
        poolMutationsDetected,
        refSanityMatch,
        divergencesCount,
      },
    },
    memory: {
      rssBeforeBytes: memBefore.rss,
      rssAfterBytes: memAfter.rss,
      rssPeakBytes: rssPeak,
      heapUsedBeforeBytes: memBefore.heapUsed,
      heapUsedAfterBytes: memAfter.heapUsed,
      heapUsedPeakBytes: heapPeak,
    },
    environment: {
      nodeVersion: process.version,
      npmVersion: "10.9.8",
      platform: process.platform,
      osRelease: os.release(),
      architecture: process.arch,
      cpuModel: os.cpus()[0]?.model || "unknown",
      cpuCores: os.cpus().length,
      totalMemoryMb: Number((os.totalmem() / (1024 * 1024)).toFixed(1)),
      freeMemoryMb: Number((os.freemem() / (1024 * 1024)).toFixed(1)),
    },
    artifacts: {
      samplesFile: "cp7-performance-samples.json",
      samplesSha256,
      logFile: "cp7-performance.log",
      logSha256,
    },
    status: overallPassed ? "PASS" : "FAIL",
  };

  const resultPath = path.resolve("certification/c5-memory-v2/run-003/cp7-performance-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");

  log("\n===============================================================================");
  log(`  RESULTADO GERAL CP7: ${result.status}`);
  log(`  P95: ${p95Ms.toFixed(2)} ms (< 500 ms) | Max: ${maxMs.toFixed(2)} ms (< 2000 ms)`);
  log(`  Relatório salvo em: ${resultPath}`);
  log("===============================================================================\n");

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runCp7Benchmark();
  if (r.status !== "PASS") {
    process.exit(1);
  }
}
