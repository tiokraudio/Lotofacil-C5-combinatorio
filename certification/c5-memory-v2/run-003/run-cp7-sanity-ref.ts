import fs from "fs";
import path from "path";
import crypto from "crypto";
import { generateC5 } from "../../../src/c5/generator.ts";
import { createMulberry32 } from "../../../src/c5/random.ts";
import { selectBestCandidate } from "./reference-evaluator.ts";
import { selectBestCandidateOpt } from "./optimized-evaluator.ts";

export interface SanityRefResult {
  corpusSeed: number;
  corpusSha256: string;
  totalHistoricalGames: number;
  poolSize: number;
  samplesTested: number;
  results: Array<{
    sampleIndex: number;
    refWinner: number;
    optWinner: number;
    refDurationMs: number;
    optDurationMs: number;
    winnerMatch: boolean;
    histogramsMatch: boolean;
  }>;
  divergencesCount: number;
  allMatch: boolean;
  durationMs: number;
}

export function runSanityCheck(): SanityRefResult {
  console.log("=== INICIANDO SUBAMOSTRA DE SANIDADE REF × OPT NO HORIZONTE MÁXIMO (|H|=18.940) ===");
  const tStart = performance.now();
  const CORPUS_SEED = 20260929;
  const rng = createMulberry32(CORPUS_SEED);

  // 1. Construção do histórico H canônico (T=3788 apostas C5 = 18.940 jogos)
  console.log("Gerando histórico H determinístico (T=3.788, |H|=18.940)...");
  const H: number[][] = [];
  for (let t = 0; t < 3788; t++) {
    const c5 = generateC5(rng);
    for (const g of c5.games) {
      H.push(g);
    }
  }

  // Hash do histórico determinístico para comprovação de corpus congelado
  const hSha = crypto.createHash("sha256").update(JSON.stringify(H)).digest("hex");
  console.log(`Histórico gerado: |H|=${H.length} jogos | SHA-256(H)=${hSha}`);

  // Testar 2 amostras com pools independentes de K=500
  const sampleIndices = [0, 500];
  const results: SanityRefResult["results"] = [];
  let divergencesCount = 0;

  for (const sIdx of sampleIndices) {
    console.log(`\nAvaliando subamostra determinística #${sIdx} (K=500)...`);
    const pool: number[][][] = [];
    for (let k = 0; k < 500; k++) {
      pool.push(generateC5(rng).games);
    }

    // Clonar para verificar se houve mutação
    const hLenBefore = H.length;
    const poolLenBefore = pool.length;

    // Execução REF
    console.log("  Executando REF...");
    const tRef0 = performance.now();
    const refRes = selectBestCandidate(pool, H);
    const tRef = performance.now() - tRef0;
    console.log(`  REF concluída em ${(tRef / 1000).toFixed(2)} s | Vencedor: ${refRes.winnerIndex}`);

    // Execução OPT
    console.log("  Executando OPT...");
    const tOpt0 = performance.now();
    const optRes = selectBestCandidateOpt(pool, H);
    const tOpt = performance.now() - tOpt0;
    console.log(`  OPT concluída em ${tOpt.toFixed(2)} ms | Vencedor: ${optRes.winnerIndex}`);

    // Verificação de mutação
    if (H.length !== hLenBefore || pool.length !== poolLenBefore) {
      throw new Error(`Mutação indevida detectada em H ou Pool na amostra ${sIdx}!`);
    }

    const winnerMatch = refRes.winnerIndex === optRes.winnerIndex;
    const histogramsMatch = JSON.stringify(refRes.winnerHistogram) === JSON.stringify(optRes.winnerHistogram);

    if (!winnerMatch || !histogramsMatch) {
      divergencesCount++;
      console.error(`  [DIVERGÊNCIA] REF(${refRes.winnerIndex}) !== OPT(${optRes.winnerIndex})`);
    } else {
      console.log(`  ✓ Vencedor e histograma idênticos: índice ${refRes.winnerIndex}`);
    }

    results.push({
      sampleIndex: sIdx,
      refWinner: refRes.winnerIndex,
      optWinner: optRes.winnerIndex,
      refDurationMs: Number(tRef.toFixed(2)),
      optDurationMs: Number(tOpt.toFixed(2)),
      winnerMatch,
      histogramsMatch,
    });
  }

  const durationMs = performance.now() - tStart;
  const sanityReport: SanityRefResult = {
    corpusSeed: CORPUS_SEED,
    corpusSha256: hSha,
    totalHistoricalGames: H.length,
    poolSize: 500,
    samplesTested: sampleIndices.length,
    results,
    divergencesCount,
    allMatch: divergencesCount === 0,
    durationMs: Number(durationMs.toFixed(2)),
  };

  const outputPath = path.resolve("certification/c5-memory-v2/run-003/cp7-sanity-ref-result.json");
  fs.writeFileSync(outputPath, JSON.stringify(sanityReport, null, 2), "utf-8");
  console.log(`\nSubamostra concluída em ${(durationMs / 1000).toFixed(1)}s. Divergências: ${divergencesCount}`);
  console.log(`Relatório salvo em: ${outputPath}`);

  return sanityReport;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runSanityCheck();
  if (!r.allMatch) process.exit(1);
}
