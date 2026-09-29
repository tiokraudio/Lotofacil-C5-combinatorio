import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { buildCp8Corpus } from "./build-cp8-corpus.ts";
import {
  runReplayExecution,
  runHistoryPermutationTest,
  runPoolOrderSensitivityTest,
  runSerializationTest,
  runHiddenStateTest,
  runRefSanityTest,
  ReplayCaseResult,
} from "./execute-cp8-replay.ts";

export interface Cp8ConsolidatedReport {
  checkpoint: "CP8";
  suite: "Determinismo, Reprodutibilidade e Replay Canônico C5-Memory-2.0.0";
  baselineCommit: string;
  refShaBefore: string;
  refShaAfter: string;
  optShaBefore: string;
  optShaAfter: string;
  corpus: {
    rng: string;
    seed: number;
    totalCases: number;
    k: number;
    corpusSha256: string;
  };
  replays: {
    replayASha256: string;
    replayBSha256: string;
    replayReorderedSha256: string;
    comparisonAB: {
      casesCompared: number;
      divergencesCount: number;
      identical: boolean;
    };
    comparisonAReordered: {
      casesCompared: number;
      divergencesCount: number;
      identical: boolean;
    };
  };
  specializedTests: {
    historyPermutation: {
      casesTested: number;
      identicalCount: number;
      passed: boolean;
    };
    poolOrderSensitivity: {
      passed: boolean;
      details: string;
    };
    serializationReReading: {
      passed: boolean;
      details: string;
    };
    hiddenStateIndependence: {
      passed: boolean;
      details: string;
    };
    refSanity: {
      casesTested: number;
      matchesCount: number;
      passed: boolean;
    };
  };
  artifacts: {
    corpusFile: string;
    replayAFile: string;
    replayBFile: string;
    replayReorderedFile: string;
    logFile: string;
    logSha256: string;
    resultFile: string;
    resultSha256: string;
  };
  status: "PASS" | "FAIL";
}

export function runMasterCp8(): Cp8ConsolidatedReport {
  const logLines: string[] = [];
  function log(msg: string) {
    console.log(msg);
    logLines.push(msg);
  }

  log("===============================================================================");
  log("  CERTIFICAÇÃO C5-MEMORY-2.0.0 — EXECUÇÃO 003 — CP8: DETERMINISMO E REPLAY");
  log("===============================================================================");

  const REF_EXPECTED_SHA = "7d82c5f37bdae52c80c7a9851a2a52348151b554565888c2036dfe61a46311f9";
  const OPT_EXPECTED_SHA = "fc73455b1db99af40e0cdf1a4bf649d05371f2f7e34dc33ba39947107554de60";

  // Verificação inicial de integridade
  const refPath = path.resolve("certification/c5-memory-v2/run-003/reference-evaluator.ts");
  const optPath = path.resolve("certification/c5-memory-v2/run-003/optimized-evaluator.ts");
  const refShaBefore = crypto.createHash("sha256").update(fs.readFileSync(refPath)).digest("hex");
  const optShaBefore = crypto.createHash("sha256").update(fs.readFileSync(optPath)).digest("hex");

  if (refShaBefore !== REF_EXPECTED_SHA || optShaBefore !== OPT_EXPECTED_SHA) {
    throw new Error(`Hashes de entrada divergentes! REF=${refShaBefore}, OPT=${optShaBefore}`);
  }
  log(`✓ Integridade inicial confirmada: REF=${refShaBefore} | OPT=${optShaBefore}`);

  // 1. Geração do corpus determinístico
  log("\n--- 1. CONSTRUÇÃO E CONGELAMENTO DO CORPUS CP8 ---");
  const corpusFile = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  let corpusInfo: { corpusPath: string; corpusSha256: string; totalCases: number };
  if (fs.existsSync(corpusFile)) {
    log("Corpus CP8 já existente em disco. Verificando SHA-256...");
    const corpusBuf = fs.readFileSync(corpusFile);
    const corpusSha256 = crypto.createHash("sha256").update(corpusBuf).digest("hex");
    corpusInfo = { corpusPath: corpusFile, corpusSha256, totalCases: 1000 };
    log(`✓ Corpus verificado: 1000 casos | SHA-256=${corpusSha256}`);
  } else {
    corpusInfo = buildCp8Corpus(1000, 20260929);
    log(`✓ Corpus materializado: ${corpusInfo.totalCases} casos | SHA-256=${corpusInfo.corpusSha256}`);
  }

  // 2. Execução A
  log("\n--- 2. EXECUÇÃO A (MATERIALIZAÇÃO OFICIAL) ---");
  const execA = runReplayExecution("A");
  log(`✓ Replay A concluído: SHA-256=${execA.sha256}`);

  // 3. Execução B (em processo Node separado)
  log("\n--- 3. EXECUÇÃO B (PROCESSO NODE SEPARADO E LIMPO) ---");
  const subproc = spawnSync("npx", [
    "tsx",
    "certification/c5-memory-v2/run-003/execute-cp8-replay.ts",
    "B",
  ], { stdio: "inherit" });

  if (subproc.status !== 0) {
    throw new Error(`Execução B em processo filho falhou com status ${subproc.status}`);
  }

  const replayBPath = path.resolve("certification/c5-memory-v2/run-003/cp8-replay-b.json");
  const replayBSha = crypto.createHash("sha256").update(fs.readFileSync(replayBPath)).digest("hex");
  log(`✓ Replay B concluído em processo isolado: SHA-256=${replayBSha}`);

  // 4. Execução Reordered
  log("\n--- 4. EXECUÇÃO REORDERED (ORDEM INVERSA DOS CASOS) ---");
  const execReordered = runReplayExecution("REORDERED");
  log(`✓ Replay Reordered concluído: SHA-256=${execReordered.sha256}`);

  // 5. Comparação A × B
  log("\n--- 5. COMPARAÇÃO ESTRITA A × B (1.000 CASOS) ---");
  const resultsA: ReplayCaseResult[] = JSON.parse(fs.readFileSync(execA.outputPath, "utf-8"));
  const resultsB: ReplayCaseResult[] = JSON.parse(fs.readFileSync(replayBPath, "utf-8"));

  let divergencesAB = 0;
  for (let i = 0; i < resultsA.length; i++) {
    const a = resultsA[i];
    const b = resultsB[i];

    const matchCaseId = a.caseId === b.caseId;
    const matchInputHash = a.inputHash === b.inputHash;
    const matchWinner = a.winnerIndex === b.winnerIndex;
    const matchGames = JSON.stringify(a.winnerGames) === JSON.stringify(b.winnerGames);
    const matchHist = JSON.stringify(a.winnerHistogram) === JSON.stringify(b.winnerHistogram);

    if (!matchCaseId || !matchInputHash || !matchWinner || !matchGames || !matchHist) {
      divergencesAB++;
      log(`  [DIVERGÊNCIA A×B] Caso #${a.caseId}: A(${a.winnerIndex}) !== B(${b.winnerIndex})`);
    }
  }

  const identicalAB = divergencesAB === 0;
  log(`Comparação A × B: ${resultsA.length} casos | Divergências: ${divergencesAB} [${identicalAB ? "100% IDÊNTICO / PASS" : "FAIL"}]`);

  // 6. Comparação A × Reordered
  log("\n--- 6. COMPARAÇÃO ESTRITA A × REORDERED (1.000 CASOS) ---");
  const resultsReordered: ReplayCaseResult[] = JSON.parse(fs.readFileSync(execReordered.outputPath, "utf-8"));

  let divergencesReordered = 0;
  for (let i = 0; i < resultsA.length; i++) {
    const a = resultsA[i];
    const r = resultsReordered[i];

    const matchCaseId = a.caseId === r.caseId;
    const matchInputHash = a.inputHash === r.inputHash;
    const matchWinner = a.winnerIndex === r.winnerIndex;
    const matchGames = JSON.stringify(a.winnerGames) === JSON.stringify(r.winnerGames);
    const matchHist = JSON.stringify(a.winnerHistogram) === JSON.stringify(r.winnerHistogram);

    if (!matchCaseId || !matchInputHash || !matchWinner || !matchGames || !matchHist) {
      divergencesReordered++;
      log(`  [DIVERGÊNCIA A×Reordered] Caso #${a.caseId}: A(${a.winnerIndex}) !== Reordered(${r.winnerIndex})`);
    }
  }

  const identicalReordered = divergencesReordered === 0;
  log(`Comparação A × Reordered: ${resultsA.length} casos | Divergências: ${divergencesReordered} [${identicalReordered ? "100% IDÊNTICO / PASS" : "FAIL"}]`);

  // 7. Teste de Permutação de H (100 casos)
  log("\n--- 7. TESTE DE PERMUTAÇÃO DE H (100 CASOS) ---");
  const histPermTest = runHistoryPermutationTest(100);
  log(`Permutação de H: ${histPermTest.identicalCount} / ${histPermTest.casesTested} [${histPermTest.passed ? "PASS" : "FAIL"}]`);

  // 8. Teste de Sensibilidade à Ordem do Pool
  log("\n--- 8. TESTE DE SENSIBILIDADE À ORDEM DO POOL ---");
  const poolOrderTest = runPoolOrderSensitivityTest();
  log(`Ordem do pool: [${poolOrderTest.passed ? "PASS" : "FAIL"}] - ${poolOrderTest.details}`);

  // 9. Teste de Serialização e Releitura
  log("\n--- 9. TESTE DE SERIALIZAÇÃO E RELEITURA ---");
  const serialTest = runSerializationTest();
  log(`Serialização/releitura: [${serialTest.passed ? "PASS" : "FAIL"}] - ${serialTest.details}`);

  // 10. Teste contra Estado Oculto
  log("\n--- 10. TESTE CONTRA ESTADO OCULTO ---");
  const hiddenStateTest = runHiddenStateTest();
  log(`Estado oculto: [${hiddenStateTest.passed ? "PASS" : "FAIL"}] - ${hiddenStateTest.details}`);

  // 11. Sanidade REF × OPT (10 casos)
  log("\n--- 11. SANIDADE REF × OPT (10 CASOS) ---");
  const refSanity = runRefSanityTest(10);
  log(`Sanidade REF × OPT: ${refSanity.matchesCount} / ${refSanity.casesTested} [${refSanity.passed ? "PASS" : "FAIL"}]`);

  // 12. Recálculo pós-execução de REF e OPT
  const refShaAfter = crypto.createHash("sha256").update(fs.readFileSync(refPath)).digest("hex");
  const optShaAfter = crypto.createHash("sha256").update(fs.readFileSync(optPath)).digest("hex");
  const hashesIntact = refShaAfter === REF_EXPECTED_SHA && optShaAfter === OPT_EXPECTED_SHA;
  log(`\n--- 12. INTEGRIDADE FINAL DOS ARTEFATOS CONGELADOS ---`);
  log(`REF pós-execução: ${refShaAfter} [${refShaAfter === REF_EXPECTED_SHA ? "INTACTO" : "CORROMPIDO"}]`);
  log(`OPT pós-execução: ${optShaAfter} [${optShaAfter === OPT_EXPECTED_SHA ? "INTACTO" : "CORROMPIDO"}]`);

  const allPassed =
    identicalAB &&
    identicalReordered &&
    histPermTest.passed &&
    poolOrderTest.passed &&
    serialTest.passed &&
    hiddenStateTest.passed &&
    refSanity.passed &&
    hashesIntact;

  // Salvar Log
  const logPath = path.resolve("certification/c5-memory-v2/run-003/cp8-replay.log");
  fs.writeFileSync(logPath, logLines.join("\n") + "\n", "utf-8");
  const logSha256 = crypto.createHash("sha256").update(fs.readFileSync(logPath)).digest("hex");

  const report: Cp8ConsolidatedReport = {
    checkpoint: "CP8",
    suite: "Determinismo, Reprodutibilidade e Replay Canônico C5-Memory-2.0.0",
    baselineCommit: "9a0bd3c36baa16b838c3fa4faf1baeaf4e49b388",
    refShaBefore,
    refShaAfter,
    optShaBefore,
    optShaAfter,
    corpus: {
      rng: "Mulberry32",
      seed: 20260929,
      totalCases: corpusInfo.totalCases,
      k: 500,
      corpusSha256: corpusInfo.corpusSha256,
    },
    replays: {
      replayASha256: execA.sha256,
      replayBSha256: replayBSha,
      replayReorderedSha256: execReordered.sha256,
      comparisonAB: {
        casesCompared: resultsA.length,
        divergencesCount: divergencesAB,
        identical: identicalAB,
      },
      comparisonAReordered: {
        casesCompared: resultsA.length,
        divergencesCount: divergencesReordered,
        identical: identicalReordered,
      },
    },
    specializedTests: {
      historyPermutation: histPermTest,
      poolOrderSensitivity: poolOrderTest,
      serializationReReading: serialTest,
      hiddenStateIndependence: hiddenStateTest,
      refSanity,
    },
    artifacts: {
      corpusFile: "cp8-corpus.json",
      replayAFile: "cp8-replay-a.json",
      replayBFile: "cp8-replay-b.json",
      replayReorderedFile: "cp8-replay-reordered.json",
      logFile: "cp8-replay.log",
      logSha256,
      resultFile: "cp8-consolidated-result.json",
      resultSha256: "",
    },
    status: allPassed ? "PASS" : "FAIL",
  };

  const reportPath = path.resolve("certification/c5-memory-v2/run-003/cp8-consolidated-result.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  const reportSha256 = crypto.createHash("sha256").update(fs.readFileSync(reportPath)).digest("hex");
  report.artifacts.resultSha256 = reportSha256;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  log("\n===============================================================================");
  log(`  RESULTADO GERAL CP8: ${report.status}`);
  log(`  A × B: ${divergencesAB} divergências | A × Reordered: ${divergencesReordered} divergências`);
  log(`  Relatório salvo em: ${reportPath}`);
  log("===============================================================================\n");

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runMasterCp8();
  if (r.status !== "PASS") {
    process.exit(1);
  }
}
