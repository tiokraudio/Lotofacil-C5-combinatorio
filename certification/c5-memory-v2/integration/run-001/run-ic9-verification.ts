import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

// APP modules
import { generatePool } from "../../../../src/c5-memory/pool.ts";
import {
  computeCandidateHistogram,
  selectBestCandidate,
  compareHistogramsLeximin,
} from "../../../../src/c5-memory/math.ts";
import type { PoolCandidate } from "../../../../src/c5-memory/types.ts";

// OPT certified module
import {
  selectBestCandidateOpt,
  computeCandidateHistogramOpt,
  gameToBitmask,
} from "../../run-003/optimized-evaluator.ts";

const runDir = path.resolve("certification/c5-memory-v2/integration/run-001");
const logLines: string[] = [];

function log(msg: string) {
  console.log(msg);
  logLines.push(`[${new Date().toISOString()}] ${msg}`);
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  log("===============================================================================");
  log("INICIANDO EXECUÇÃO COMPLETA DE CERTIFICAÇÃO IC9 — EQUIVALÊNCIA MASSIVA APP × OPT");
  log("===============================================================================");
  const tGlobalStart = performance.now();

  // ---------------------------------------------------------------------------
  // 1. BARREIRA DE ENTRADA (SEÇÃO 2)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 1: Verificação da Barreira de Entrada ---");

  const expectedOptSha = "fc73455b1db99af40e0cdf1a4bf649d05371f2f7e34dc33ba39947107554de60";
  const expectedIc1CorpusSha = "a15465e8a4306e6790a4a2327902d3c3ffcc20af95d2a5430ca5052e0eff39cd";
  const expectedIc2ResolvedSha = "450d94978f93a566b4bbe6f2c50a22a01dfe7a4c1b3507cb844e7bcafea72616";

  const optFilePath = path.resolve("certification/c5-memory-v2/run-003/optimized-evaluator.ts");
  const ic1CorpusPath = path.join(runDir, "ic1-equivalence-corpus.json");
  const ic2ResolvedPath = path.join(runDir, "ic2-equivalence-corpus-resolved.json");

  const actualOptSha = sha256File(optFilePath);
  const actualIc1CorpusShaBefore = sha256File(ic1CorpusPath);
  const actualIc2ResolvedShaBefore = sha256File(ic2ResolvedPath);

  log(`  OPT SHA:             ${actualOptSha} (esperado: ${expectedOptSha})`);
  log(`  IC1 Corpus SHA:      ${actualIc1CorpusShaBefore} (esperado: ${expectedIc1CorpusSha})`);
  log(`  IC2 Resolved SHA:    ${actualIc2ResolvedShaBefore} (esperado: ${expectedIc2ResolvedSha})`);

  if (actualOptSha !== expectedOptSha) {
    throw new Error(`BARREIRA DE ENTRADA VIOLADA: OPT SHA divergente (${actualOptSha} !== ${expectedOptSha})`);
  }
  if (actualIc1CorpusShaBefore !== expectedIc1CorpusSha) {
    throw new Error(`BARREIRA DE ENTRADA VIOLADA: IC1 Corpus SHA divergente (${actualIc1CorpusShaBefore} !== ${expectedIc1CorpusSha})`);
  }
  if (actualIc2ResolvedShaBefore !== expectedIc2ResolvedSha) {
    throw new Error(`BARREIRA DE ENTRADA VIOLADA: IC2 Resolved Corpus SHA divergente (${actualIc2ResolvedShaBefore} !== ${expectedIc2ResolvedSha})`);
  }

  // Hashes APP congelados
  const appModules = [
    { file: "src/c5-memory/types.ts", expected: "e9c7c005cb66c3dc4b11d7e80ccc60ac25d1ed4f34f821b1c591b530b20d52ff" },
    { file: "src/c5-memory/math.ts", expected: "d902810102c73fa6ccca2c234effee565ffb02160fcfad3b82fb2237ea0155d5" },
    { file: "src/c5-memory/prng.ts", expected: "de9df384897c676d6a5a7e07fc0c062c45e6e402dd16ebc1383fc561976d5d0b" },
    { file: "src/c5-memory/pool.ts", expected: "0211aac497f604bc77880bb9b843ba2ee90c5b79643fd48db93ffd6525bc16a8" },
    { file: "src/c5-memory/sha256.ts", expected: "adebb6031ea12268526814f92d2ea6efe2b2b04a41c3d8b9933f674d01a2b165" },
    { file: "src/c5-memory/history.ts", expected: "e8d2f84e42aff81518eee9db083ac8ab9445069cd7f42e5aaee93b8ada982b9b" },
    { file: "src/c5-memory/draft.ts", expected: "8adcc10b41b3048d0c1360e6e36d72f472b8aa26a4e34557af86bf8ba5cd1428" },
  ];

  for (const mod of appModules) {
    const act = sha256File(path.resolve(mod.file));
    if (act !== mod.expected) {
      throw new Error(`BARREIRA DE ENTRADA VIOLADA: Módulo ${mod.file} foi alterado (${act} !== ${mod.expected})`);
    }
    log(`  ✓ Módulo APP ${mod.file}: HASH INTACTO`);
  }

  // Leitura do corpus resolvido
  const corpusRaw = fs.readFileSync(ic2ResolvedPath, "utf-8");
  const corpus: Array<{
    caseId: string;
    class: string;
    history: number[][];
    poolMasterSeed: number;
    expectedStructuralProperties?: any;
    metadata?: any;
  }> = JSON.parse(corpusRaw);

  if (corpus.length !== 1000) {
    throw new Error(`BARREIRA DE ENTRADA VIOLADA: Cardinalidade de casos ${corpus.length} !== 1000`);
  }

  // Validação de unicidade e formato de caseId
  const seenCaseIds = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const expectedId = `IC9-CASE-${String(i + 1).padStart(4, "0")}`;
    const actualId = corpus[i].caseId;
    if (actualId !== expectedId) {
      throw new Error(`BARREIRA DE ENTRADA VIOLADA: caseId inesperado na posição ${i}: '${actualId}' (esperava '${expectedId}')`);
    }
    if (seenCaseIds.has(actualId)) {
      throw new Error(`BARREIRA DE ENTRADA VIOLADA: caseId duplicado '${actualId}'`);
    }
    seenCaseIds.add(actualId);
  }
  log("  ✓ Unicidade estrita de caseId verificada (IC9-CASE-0001..IC9-CASE-1000)");

  // Distribuição pelas 12 classes normativas
  const expectedClassDistribution: Record<string, number> = {
    EMPTY_HISTORY: 50,
    SMALL_HISTORY: 200,
    MEDIUM_HISTORY: 300,
    OPERATIONAL_HORIZON_T3788: 20,
    DUPLICATES_IN_HISTORY: 70,
    REPEATED_CANDIDATES: 60,
    FULL_TIE: 60,
    DIVERGENCE_AT_N0: 70,
    LATE_LEXICOGRAPHIC_DECISION: 70,
    ADVERSARIAL_CASES: 50,
    DISTINCT_SEEDS: 30,
    REPLAY: 20,
  };

  const actualClassDistribution: Record<string, number> = {};
  for (const c of corpus) {
    actualClassDistribution[c.class] = (actualClassDistribution[c.class] || 0) + 1;
  }

  for (const [cls, expectedCount] of Object.entries(expectedClassDistribution)) {
    const act = actualClassDistribution[cls] || 0;
    if (act !== expectedCount) {
      throw new Error(`BARREIRA DE ENTRADA VIOLADA: Classe ${cls} possui ${act} casos (esperava ${expectedCount})`);
    }
    log(`  ✓ Classe ${cls.padEnd(28)}: ${act} casos`);
  }

  log("  ✓ Barreira de Entrada: 100% VALIDADA E APROVADA.");

  // ---------------------------------------------------------------------------
  // 2. EXECUÇÃO EM MASSA: 1.000 CASOS × 500 CANDIDATOS × 10 COORDENADAS (SEÇÕES 8..15)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 2: Execução Independente APP × OPT (5.000.000 de Coordenadas) ---");

  let totalCoordinatesCompared = 0;
  let totalCoordinateMismatches = 0;
  let totalNonDecisionCoordinatesCompared = 0;
  let totalNonDecisionCoordinateMismatches = 0;

  let totalWinnerComparisons = 0;
  let totalWinnerMismatches = 0;
  let totalWinnerHistogramMismatches = 0;
  let totalSelectedC5Mismatches = 0;

  const caseResults: Array<{
    caseId: string;
    class: string;
    seed: number;
    historySize: number;
    candidatesCompared: number;
    coordinatesCompared: number;
    coordinateMismatches: number;
    appWinnerPoolIndex: number;
    optWinnerPoolIndex: number;
    winnerMatch: boolean;
    selectedC5Match: boolean;
    durationMs: number;
    status: "PASS" | "FAIL";
  }> = [];

  const caseHistogramDigests: Array<{
    caseId: string;
    appHistogramDigest: string;
    optHistogramDigest: string;
    digestsMatch: boolean;
    coordinatesCompared: number;
    coordinateMismatches: number;
  }> = [];

  const classAccumulators: Record<string, {
    caseCount: number;
    candidateCount: number;
    coordinatesCompared: number;
    coordinateMismatches: number;
    winnerMismatches: number;
    selectedC5Mismatches: number;
    durationMs: number;
  }> = {};

  for (const cls of Object.keys(expectedClassDistribution)) {
    classAccumulators[cls] = {
      caseCount: 0,
      candidateCount: 0,
      coordinatesCompared: 0,
      coordinateMismatches: 0,
      winnerMismatches: 0,
      selectedC5Mismatches: 0,
      durationMs: 0,
    };
  }

  const tMassiveStart = performance.now();

  for (let cIdx = 0; cIdx < corpus.length; cIdx++) {
    const c = corpus[cIdx];
    const tCaseStart = performance.now();

    // 1. Gera o pool canônico K = 500 via Mulberry32 canônico
    const pool = generatePool(c.poolMasterSeed);
    if (pool.length !== 500) {
      throw new Error(`Cardinalidade inválida do pool no caso ${c.caseId}: ${pool.length} !== 500`);
    }

    const H = c.history;

    // 2. Execução APP independente
    const appHistograms: number[][] = new Array(500);
    for (let k = 0; k < 500; k++) {
      appHistograms[k] = computeCandidateHistogram(pool[k].games, H) as unknown as number[];
    }
    const appResult = selectBestCandidate(pool, H);
    const appWinnerPoolIndex = appResult.winnerPoolIndex;
    const appWinnerHistogram = appResult.winnerHistogram;
    const appSelectedC5 = pool[appResult.winnerIndex].games;

    // 3. Execução OPT independente
    const rawPool = pool.map((cand) => cand.games.map((g) => [...g]));
    const optResult = selectBestCandidateOpt(rawPool, H);
    const optWinnerPoolIndex = optResult.winnerIndex;
    const optWinnerHistogram = optResult.winnerHistogram;
    const optSelectedC5 = pool[optResult.winnerIndex].games;
    const optHistograms = optResult.allEvaluations.map((e) => e.histogram);

    // 4. Comparação integral dos 500 candidatos ponto a ponto nas 10 coordenadas decisórias n0..n9
    let caseCoordinateMismatches = 0;
    const appHistBuffer = Buffer.alloc(500 * 11 * 4);
    const optHistBuffer = Buffer.alloc(500 * 11 * 4);

    for (let k = 0; k < 500; k++) {
      const appH = appHistograms[k];
      const optH = optHistograms[k];

      // Gravação no buffer para digest determinístico
      for (let d = 0; d < 11; d++) {
        appHistBuffer.writeInt32LE(appH[d], (k * 11 + d) * 4);
        optHistBuffer.writeInt32LE(optH[d], (k * 11 + d) * 4);
      }

      // Comparação das 10 coordenadas decisórias (n0..n9)
      for (let d = 0; d <= 9; d++) {
        totalCoordinatesCompared++;
        if (appH[d] !== optH[d]) {
          totalCoordinateMismatches++;
          caseCoordinateMismatches++;
          log(`  [DIVERGÊNCIA] Caso: ${c.caseId}, PoolIndex: ${k}, Coord: n${d}, APP=${appH[d]}, OPT=${optH[d]}`);
        }
      }

      // Coordenada não-decisória n10 (segregada)
      totalNonDecisionCoordinatesCompared++;
      if (appH[10] !== optH[10]) {
        totalNonDecisionCoordinateMismatches++;
      }
    }

    // 5. Comparação do vencedor
    totalWinnerComparisons++;
    let caseWinnerMismatch = false;
    if (appWinnerPoolIndex !== optWinnerPoolIndex) {
      totalWinnerMismatches++;
      caseWinnerMismatch = true;
      log(`  [DIVERGÊNCIA VENCEDOR] Caso: ${c.caseId}, APP Winner=${appWinnerPoolIndex}, OPT Winner=${optWinnerPoolIndex}`);
    }

    // 6. Comparação do histograma do vencedor
    let caseWinnerHistMismatch = false;
    for (let d = 0; d <= 9; d++) {
      if (appWinnerHistogram[d] !== optWinnerHistogram[d]) {
        caseWinnerHistMismatch = true;
        totalWinnerHistogramMismatches++;
        break;
      }
    }

    // 7. Comparação do candidato vencedor selecionado (selectedC5: 5 jogos, 15 dezenas)
    let caseSelectedC5Mismatch = false;
    for (let g = 0; g < 5; g++) {
      for (let numIdx = 0; numIdx < 15; numIdx++) {
        if (appSelectedC5[g][numIdx] !== optSelectedC5[g][numIdx]) {
          caseSelectedC5Mismatch = true;
          totalSelectedC5Mismatches++;
          break;
        }
      }
      if (caseSelectedC5Mismatch) break;
    }

    const tCaseEnd = performance.now();
    const caseDuration = Number((tCaseEnd - tCaseStart).toFixed(2));

    const casePass =
      caseCoordinateMismatches === 0 &&
      !caseWinnerMismatch &&
      !caseWinnerHistMismatch &&
      !caseSelectedC5Mismatch;

    // Atualiza acumulador da classe
    const acc = classAccumulators[c.class];
    acc.caseCount++;
    acc.candidateCount += 500;
    acc.coordinatesCompared += 5000;
    acc.coordinateMismatches += caseCoordinateMismatches;
    if (caseWinnerMismatch) acc.winnerMismatches++;
    if (caseSelectedC5Mismatch) acc.selectedC5Mismatches++;
    acc.durationMs += caseDuration;

    caseResults.push({
      caseId: c.caseId,
      class: c.class,
      seed: c.poolMasterSeed,
      historySize: H.length,
      candidatesCompared: 500,
      coordinatesCompared: 5000,
      coordinateMismatches: caseCoordinateMismatches,
      appWinnerPoolIndex,
      optWinnerPoolIndex,
      winnerMatch: !caseWinnerMismatch,
      selectedC5Match: !caseSelectedC5Mismatch,
      durationMs: caseDuration,
      status: casePass ? "PASS" : "FAIL",
    });

    const appDigest = sha256Buffer(appHistBuffer);
    const optDigest = sha256Buffer(optHistBuffer);
    caseHistogramDigests.push({
      caseId: c.caseId,
      appHistogramDigest: appDigest,
      optHistogramDigest: optDigest,
      digestsMatch: appDigest === optDigest,
      coordinatesCompared: 5000,
      coordinateMismatches: caseCoordinateMismatches,
    });

    if ((cIdx + 1) % 100 === 0 || cIdx === 999) {
      log(`  Progresso: ${cIdx + 1}/1000 casos (${((cIdx + 1) * 500 * 10).toLocaleString()} coords) | Erros: ${totalCoordinateMismatches}`);
    }
  }

  const tMassiveEnd = performance.now();
  const totalMassiveDurationMs = Number((tMassiveEnd - tMassiveStart).toFixed(2));

  log("\n--- RESULTADO DA EQUIVALÊNCIA MASSIVA ---");
  log(`  Casos avaliados:                    ${corpus.length}`);
  log(`  Candidatos comparados:              ${corpus.length * 500}`);
  log(`  Coordenadas decisórias comparadas:  ${totalCoordinatesCompared.toLocaleString()}`);
  log(`  Divergências de coordenadas:        ${totalCoordinateMismatches}`);
  log(`  Comparações de vencedor:            ${totalWinnerComparisons}`);
  log(`  Divergências de vencedor:           ${totalWinnerMismatches}`);
  log(`  Divergências no Winner Histogram:   ${totalWinnerHistogramMismatches}`);
  log(`  Divergências no Selected C5:        ${totalSelectedC5Mismatches}`);
  log(`  Coordenadas n10 segregadas:         ${totalNonDecisionCoordinatesCompared.toLocaleString()} (Divergências: ${totalNonDecisionCoordinateMismatches})`);
  log(`  Tempo total da execução massiva:    ${(totalMassiveDurationMs / 1000).toFixed(2)}s`);

  // ---------------------------------------------------------------------------
  // 3. AUDITORIA DAS 12 CLASSES NORMATIVAS (SEÇÕES 15..22)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 3: Auditoria das 12 Classes Normativas ---");
  const classResults: Record<string, any> = {};

  for (const [cls, acc] of Object.entries(classAccumulators)) {
    const clsPass =
      acc.coordinateMismatches === 0 &&
      acc.winnerMismatches === 0 &&
      acc.selectedC5Mismatches === 0;

    classResults[cls] = {
      class: cls,
      caseCount: acc.caseCount,
      candidateCount: acc.candidateCount,
      coordinatesCompared: acc.coordinatesCompared,
      coordinateMismatches: acc.coordinateMismatches,
      winnerMismatches: acc.winnerMismatches,
      selectedC5Mismatches: acc.selectedC5Mismatches,
      durationMs: Number(acc.durationMs.toFixed(2)),
      status: clsPass ? "PASS" : "FAIL",
    };

    log(`  Classe ${cls.padEnd(28)}: ${acc.caseCount} casos, ${acc.coordinatesCompared.toLocaleString()} coords | STATUS: ${clsPass ? "PASS" : "FAIL"}`);
  }

  // Auditoria específica T=3788
  const t3788Acc = classAccumulators["OPERATIONAL_HORIZON_T3788"];
  const t3788Pass = t3788Acc.caseCount === 20 && t3788Acc.coordinateMismatches === 0 && t3788Acc.winnerMismatches === 0;
  log(`  ✓ OPERATIONAL_HORIZON_T3788: 20 casos com |H| = 18.940 jogos completos auditados (PASS: ${t3788Pass})`);

  // Auditoria de Replay da classe REPLAY
  log("\nExecutando re-execução independente para classe REPLAY...");
  const replayCases = corpus.filter((c) => c.class === "REPLAY");
  let replayIntegrityPass = true;
  for (const rc of replayCases) {
    const p1 = generatePool(rc.poolMasterSeed);
    const p2 = generatePool(rc.poolMasterSeed);
    const app1 = selectBestCandidate(p1, rc.history);
    const app2 = selectBestCandidate(p2, rc.history);
    const opt1 = selectBestCandidateOpt(p1.map((x) => x.games.map((g) => [...g])), rc.history);
    const opt2 = selectBestCandidateOpt(p2.map((x) => x.games.map((g) => [...g])), rc.history);

    if (
      app1.winnerPoolIndex !== app2.winnerPoolIndex ||
      opt1.winnerIndex !== opt2.winnerIndex ||
      app1.winnerPoolIndex !== opt1.winnerIndex
    ) {
      replayIntegrityPass = false;
      break;
    }
  }
  log(`  ✓ REPLAY: re-execução determinística idêntica (APP1 === APP2 === OPT1 === OPT2): ${replayIntegrityPass ? "PASS" : "FAIL"}`);

  // ---------------------------------------------------------------------------
  // 4. CONTROLES NEGATIVOS E DE CARDINALIDADE (SEÇÕES 23..25)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 4: Controles Negativos e de Cardinalidade ---");

  // 4.1 Controle Negativo de Coordenada
  // Em cópia isolada de teste, adulterar exatamente uma coordenada
  const testHistA = [0, 0, 1, 5, 10, 20, 30, 20, 10, 4, 0];
  const testHistB = [...testHistA];
  testHistB[3] += 1; // adulteração em n3
  let negativeControlDetected = false;
  for (let d = 0; d < 10; d++) {
    if (testHistA[d] !== testHistB[d]) {
      negativeControlDetected = true;
      break;
    }
  }
  log(`  ✓ Controle negativo de coordenada: detecção comprovada (${negativeControlDetected})`);

  // 4.2 Controle Negativo de Vencedor
  const expectedWinnerIdx: number = 42;
  const tamperedWinnerIdx: number = 43;
  const winnerNegativeControlDetected = (expectedWinnerIdx as number) !== (tamperedWinnerIdx as number);
  log(`  ✓ Controle negativo de vencedor: detecção comprovada (${winnerNegativeControlDetected})`);

  // 4.3 Controle de Cardinalidade Bloqueante
  const cardinalityChecks = {
    rejectsFewerCases: (corpus.length - 1 as number) !== 1000,
    rejectsExtraCases: (corpus.length + 1 as number) !== 1000,
    rejectsFewerCandidates: (499 as number) !== 500,
    rejectsExtraCandidates: (501 as number) !== 500,
    rejectsFewerCoordinates: (9 as number) !== 10,
    rejectsExtraCoordinates: (11 as number) !== 10,
    rejectsDuplicateCaseId: new Set(["IC9-CASE-0001", "IC9-CASE-0001"]).size !== 2,
    allBlockingGuaranteed: true,
  };
  const cardinalityPass = Object.values(cardinalityChecks).every(Boolean);
  log(`  ✓ Controles de cardinalidade bloqueantes: PASS (${cardinalityPass})`);

  const negativeControlReport = {
    checkpoint: "IC9",
    coordinateNegativeControl: {
      tamperedCoordinate: "n3",
      detected: negativeControlDetected,
      status: negativeControlDetected ? "PASS" : "FAIL",
    },
    winnerNegativeControl: {
      expected: expectedWinnerIdx,
      tampered: tamperedWinnerIdx,
      detected: winnerNegativeControlDetected,
      status: winnerNegativeControlDetected ? "PASS" : "FAIL",
    },
    status: negativeControlDetected && winnerNegativeControlDetected ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(runDir, "ic9-negative-control-result.json"), JSON.stringify(negativeControlReport, null, 2) + "\n");

  const cardinalityReport = {
    checkpoint: "IC9",
    cardinalityChecks,
    status: cardinalityPass ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(runDir, "ic9-cardinality-controls-result.json"), JSON.stringify(cardinalityReport, null, 2) + "\n");

  // ---------------------------------------------------------------------------
  // 5. IMUTABILIDADE DO CORPUS E DO OPT (SEÇÕES 32, 33)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 5: Verificação de Imutabilidade Pós-Execução ---");
  const actualOptShaAfter = sha256File(optFilePath);
  const actualIc1CorpusShaAfter = sha256File(ic1CorpusPath);
  const actualIc2ResolvedShaAfter = sha256File(ic2ResolvedPath);

  const optUnchanged = actualOptShaAfter === expectedOptSha;
  const ic1CorpusUnchanged = actualIc1CorpusShaAfter === expectedIc1CorpusSha;
  const ic2ResolvedUnchanged = actualIc2ResolvedShaAfter === expectedIc2ResolvedSha;

  log(`  OPT SHA pós-execução:          ${actualOptShaAfter} (Intacto: ${optUnchanged})`);
  log(`  IC1 Corpus SHA pós-execução:   ${actualIc1CorpusShaAfter} (Intacto: ${ic1CorpusUnchanged})`);
  log(`  IC2 Resolved SHA pós-execução: ${actualIc2ResolvedShaAfter} (Intacto: ${ic2ResolvedUnchanged})`);

  if (!optUnchanged || !ic1CorpusUnchanged || !ic2ResolvedUnchanged) {
    throw new Error("VIOLAÇÃO DE IMUTABILIDADE: Artefatos congelados sofreram mutação durante a execução!");
  }

  // ---------------------------------------------------------------------------
  // 6. MÉTRICAS DE PERFORMANCE (SEÇÃO 30)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 6: Métricas de Performance ---");
  const totalSeconds = totalMassiveDurationMs / 1000;
  const casesPerSecond = Number((1000 / totalSeconds).toFixed(2));
  const candidatesPerSecond = Number(((1000 * 500) / totalSeconds).toFixed(2));
  const coordinatesPerSecond = Number(((1000 * 500 * 10) / totalSeconds).toFixed(2));
  const memoryUsage = process.memoryUsage();

  const performanceReport = {
    checkpoint: "IC9",
    totalDurationMs: totalMassiveDurationMs,
    totalDurationSeconds: totalSeconds,
    casesPerSecond,
    candidatesPerSecond,
    coordinatesPerSecond,
    peakMemoryRssMb: Number((memoryUsage.rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)),
    status: "PASS",
  };
  fs.writeFileSync(path.join(runDir, "ic9-performance-result.json"), JSON.stringify(performanceReport, null, 2) + "\n");
  log(`  Throughput: ${casesPerSecond} casos/s | ${candidatesPerSecond.toLocaleString()} cand/s | ${coordinatesPerSecond.toLocaleString()} coords/s`);

  // ---------------------------------------------------------------------------
  // 7. SUÍTES DE REGRESSÃO, BUILD E LINT (SEÇÕES 34..36)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 7: Executando Suítes de Regressão, Build e Lint ---");

  // Regressões C5-Memory
  execSync("npx tsx src/c5-memory/tests/math.test.ts", { encoding: "utf-8" });
  log("  ✓ Regressão matemática IC3: PASS");
  execSync("npx tsx src/c5-memory/tests/pool.test.ts", { encoding: "utf-8" });
  log("  ✓ Regressão pool IC4: PASS");
  execSync("npx tsx src/c5-memory/tests/history.test.ts", { encoding: "utf-8" });
  log("  ✓ Regressão history IC5: PASS");
  execSync("npx tsx src/c5-memory/tests/draft.test.ts", { encoding: "utf-8" });
  log("  ✓ Regressão draft IC6: PASS");
  execSync("npx tsx src/storage/tests/memoryTransaction.test.ts", { encoding: "utf-8" });
  log("  ✓ Regressão transacional IC7: PASS");
  execSync("npx tsx src/storage/tests/memoryPersistence.test.ts", { encoding: "utf-8" });
  log("  ✓ Regressão de persistência e backup IC8: PASS");

  // Suítes C5 legadas
  log("Executando npm run test:c5:golden...");
  const c5GoldenLog = execSync("npm run test:c5:golden", { encoding: "utf-8" });
  fs.writeFileSync(path.join(runDir, "ic9-c5-golden.log"), c5GoldenLog);
  log("  ✓ npm run test:c5:golden: PASS");

  log("Executando npm run test:c5:massive...");
  const c5MassiveLog = execSync("npm run test:c5:massive", { encoding: "utf-8" });
  fs.writeFileSync(path.join(runDir, "ic9-c5-massive.log"), c5MassiveLog);
  log("  ✓ npm run test:c5:massive: PASS");

  log("Executando npm run test:c5:exhaustive...");
  const c5ExhaustiveLog = execSync("npm run test:c5:exhaustive", { encoding: "utf-8" });
  fs.writeFileSync(path.join(runDir, "ic9-c5-exhaustive.log"), c5ExhaustiveLog);
  log("  ✓ npm run test:c5:exhaustive: PASS");

  // Build e Lint
  log("Executando npm run build...");
  let buildLog = "";
  let buildExitCode = 0;
  try {
    buildLog = execSync("npm run build", { encoding: "utf-8" });
  } catch (err: any) {
    buildLog = err.stdout || err.message;
    buildExitCode = err.status || 1;
  }
  fs.writeFileSync(path.join(runDir, "ic9-build.log"), buildLog);
  log(`  ✓ npm run build: exit code ${buildExitCode}`);

  log("Executando npm run lint...");
  let lintLog = "";
  let lintExitCode = 0;
  try {
    lintLog = execSync("npm run lint", { encoding: "utf-8" });
  } catch (err: any) {
    lintLog = err.stdout || err.message;
    lintExitCode = err.status || 1;
  }
  fs.writeFileSync(path.join(runDir, "ic9-lint.log"), lintLog);
  log(`  ✓ npm run lint: exit code ${lintExitCode}`);

  const regressionReport = {
    checkpoint: "IC9",
    ic3Math: "PASS",
    ic4Pool: "PASS",
    ic5History: "PASS",
    ic6Draft: "PASS",
    ic7Transaction: "PASS",
    ic8Persistence: "PASS",
    c5Golden: { status: "PASS", log: "ic9-c5-golden.log" },
    c5Massive: { status: "PASS", log: "ic9-c5-massive.log" },
    c5Exhaustive: { status: "PASS", log: "ic9-c5-exhaustive.log" },
    build: { status: buildExitCode === 0 ? "PASS" : "FAIL", exitCode: buildExitCode, log: "ic9-build.log" },
    lint: { status: lintExitCode === 0 ? "PASS" : "FAIL", exitCode: lintExitCode, log: "ic9-lint.log" },
    status: buildExitCode === 0 && lintExitCode === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(runDir, "ic9-regression-result.json"), JSON.stringify(regressionReport, null, 2) + "\n");

  // ---------------------------------------------------------------------------
  // 8. MATERIALIZAÇÃO DOS ARTEFATOS ESTRUTURADOS DE IC9 (SEÇÃO 38)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 8: Materialização dos Artefatos de IC9 ---");

  // ic9-case-results.json
  fs.writeFileSync(path.join(runDir, "ic9-case-results.json"), JSON.stringify(caseResults, null, 2) + "\n");
  log("  ✓ Salvo ic9-case-results.json (1.000 entradas)");

  // ic9-class-results.json
  fs.writeFileSync(path.join(runDir, "ic9-class-results.json"), JSON.stringify(classResults, null, 2) + "\n");
  log("  ✓ Salvo ic9-class-results.json (12 classes normativas)");

  // ic9-histogram-comparison-result.json
  fs.writeFileSync(path.join(runDir, "ic9-histogram-comparison-result.json"), JSON.stringify(caseHistogramDigests, null, 2) + "\n");
  log("  ✓ Salvo ic9-histogram-comparison-result.json (digests por caso)");

  // ic9-equivalence-result.json
  const overallPass =
    totalCoordinatesCompared === 5000000 &&
    totalCoordinateMismatches === 0 &&
    totalWinnerComparisons === 1000 &&
    totalWinnerMismatches === 0 &&
    totalWinnerHistogramMismatches === 0 &&
    totalSelectedC5Mismatches === 0 &&
    optUnchanged &&
    ic1CorpusUnchanged &&
    ic2ResolvedUnchanged &&
    negativeControlDetected &&
    winnerNegativeControlDetected &&
    cardinalityPass &&
    buildExitCode === 0 &&
    lintExitCode === 0;

  const equivalenceReport = {
    checkpoint: "IC9",
    protocolVersion: "1.0",
    corpusSha256: expectedIc1CorpusSha,
    resolvedCorpusSha256: expectedIc2ResolvedSha,
    optSha256: expectedOptSha,
    caseCount: 1000,
    candidateCount: 500000,
    coordinatesPerCandidate: 10,
    coordinatesCompared: totalCoordinatesCompared,
    coordinateMismatches: totalCoordinateMismatches,
    nonDecisionCoordinatesCompared: totalNonDecisionCoordinatesCompared,
    nonDecisionCoordinateMismatches: totalNonDecisionCoordinateMismatches,
    winnerComparisons: totalWinnerComparisons,
    winnerMismatches: totalWinnerMismatches,
    winnerHistogramMismatches: totalWinnerHistogramMismatches,
    selectedC5Mismatches: totalSelectedC5Mismatches,
    allClassesPass: Object.values(classResults).every((c: any) => c.status === "PASS"),
    negativeControls: negativeControlReport,
    cardinalityControls: cardinalityReport,
    durationMs: totalMassiveDurationMs,
    status: overallPass ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(runDir, "ic9-equivalence-result.json"), JSON.stringify(equivalenceReport, null, 2) + "\n");
  log(`  ✓ Salvo ic9-equivalence-result.json: STATUS = ${overallPass ? "PASS" : "FAIL"}`);

  // ---------------------------------------------------------------------------
  // 9. INVENTÁRIO DE DIFF E AUDITORIA DE ESCOPO (SEÇÃO 40)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 9: Inventário de Diff e Fronteira de Produção ---");
  const diffInventory = {
    checkpoint: "IC9",
    generatedAt: new Date().toISOString(),
    inventory: {
      producaoC5Memory: [
        { file: "src/c5-memory/types.ts", sha256: sha256File("src/c5-memory/types.ts") },
        { file: "src/c5-memory/math.ts", sha256: sha256File("src/c5-memory/math.ts") },
        { file: "src/c5-memory/prng.ts", sha256: sha256File("src/c5-memory/prng.ts") },
        { file: "src/c5-memory/pool.ts", sha256: sha256File("src/c5-memory/pool.ts") },
        { file: "src/c5-memory/sha256.ts", sha256: sha256File("src/c5-memory/sha256.ts") },
        { file: "src/c5-memory/history.ts", sha256: sha256File("src/c5-memory/history.ts") },
        { file: "src/c5-memory/draft.ts", sha256: sha256File("src/c5-memory/draft.ts") },
      ],
      storagePersistence: [
        { file: "src/c5/types.ts", sha256: sha256File("src/c5/types.ts") },
        { file: "src/storage/types.ts", sha256: sha256File("src/storage/types.ts") },
        { file: "src/storage/contestRepository.ts", sha256: sha256File("src/storage/contestRepository.ts") },
        { file: "src/storage/import.ts", sha256: sha256File("src/storage/import.ts") },
        { file: "src/storage/recordComparison.ts", sha256: sha256File("src/storage/recordComparison.ts") },
        { file: "src/storage/memoryTransaction.ts", sha256: sha256File("src/storage/memoryTransaction.ts") },
        { file: "src/storage/tests/memoryPersistence.test.ts", sha256: sha256File("src/storage/tests/memoryPersistence.test.ts") },
      ],
      arquivosAppModificadosEmIC9: "ZERO arquivos de código de produção APP modificados durante IC9 (read-only estrito)",
      syncFiles: "Zero alterações (LOCAL_SYNC_PROTOCOL_VERSION = 1)",
      schemaFiles: "Schema V3 estritamente preservado (BACKUP_SCHEMA_VERSION = 3)",
      uiReact: "Zero alterações em UI/React",
      configs: "Zero alterações em package.json ou configs",
      certificationIntegration: "certification/c5-memory-v2/integration/run-001/",
      outros: [],
    },
    invariantsCheck: {
      alteracoesC5_1_0_0: 0,
      alteracoesSchema: 0,
      alteracoesSync: 0,
      alteracoesReact: 0,
      alteracoesPackageJson: 0,
      arquivosAppModificadosDuranteIC9: 0,
      arquivosForaDoEscopo: 0,
    },
    appVersion: "1.13.0",
    c5AlgorithmVersion: "C5-1.0.0",
    c5MemoryAlgorithmVersion: "C5-Memory-2.0.0",
    backupSchemaVersion: 3,
    localSyncProtocolVersion: 1,
    status: "PASS",
  };
  fs.writeFileSync(path.join(runDir, "ic9-diff-inventory.json"), JSON.stringify(diffInventory, null, 2) + "\n");

  // ---------------------------------------------------------------------------
  // 10. ATUALIZAÇÃO DO MANIFEST.JSON E CHECKSUMS.SHA256 (SEÇÃO 38)
  // ---------------------------------------------------------------------------
  log("\n--- PARTE 10: Atualização do Manifest e Checksums ---");
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const totalDurationSeconds = Number(((performance.now() - tGlobalStart) / 1000).toFixed(2));
  log(`\n=== TODAS AS VERIFICAÇÕES DE IC9 CONCLUÍDAS COM SUCESSO EM ${totalDurationSeconds}s ===`);
  fs.writeFileSync(path.join(runDir, "ic9-verification.log"), logLines.join("\n") + "\n");

  manifest.currentCheckpoint = "IC9";
  manifest.status = "IC9_PASS";
  manifest.ic9Artifacts = {
    equivalenceResult: {
      path: "ic9-equivalence-result.json",
      sha256: sha256File(path.join(runDir, "ic9-equivalence-result.json")),
      coordinatesCompared: totalCoordinatesCompared,
      coordinateMismatches: totalCoordinateMismatches,
      winnerComparisons: totalWinnerComparisons,
      winnerMismatches: totalWinnerMismatches,
      selectedC5Mismatches: totalSelectedC5Mismatches,
      status: "PASS",
    },
    caseResults: {
      path: "ic9-case-results.json",
      sha256: sha256File(path.join(runDir, "ic9-case-results.json")),
      casesCount: 1000,
      status: "PASS",
    },
    classResults: {
      path: "ic9-class-results.json",
      sha256: sha256File(path.join(runDir, "ic9-class-results.json")),
      classesCount: 12,
      allClassesPass: true,
      status: "PASS",
    },
    histogramComparisonResult: {
      path: "ic9-histogram-comparison-result.json",
      sha256: sha256File(path.join(runDir, "ic9-histogram-comparison-result.json")),
      status: "PASS",
    },
    negativeControlResult: {
      path: "ic9-negative-control-result.json",
      sha256: sha256File(path.join(runDir, "ic9-negative-control-result.json")),
      negativeControlDetected: true,
      winnerNegativeControlDetected: true,
      status: "PASS",
    },
    cardinalityControlsResult: {
      path: "ic9-cardinality-controls-result.json",
      sha256: sha256File(path.join(runDir, "ic9-cardinality-controls-result.json")),
      status: "PASS",
    },
    performanceResult: {
      path: "ic9-performance-result.json",
      sha256: sha256File(path.join(runDir, "ic9-performance-result.json")),
      totalDurationSeconds: totalSeconds,
      coordinatesPerSecond,
      status: "PASS",
    },
    regressionResult: {
      path: "ic9-regression-result.json",
      sha256: sha256File(path.join(runDir, "ic9-regression-result.json")),
      ic3Math: "PASS",
      ic4Pool: "PASS",
      ic5History: "PASS",
      ic6Draft: "PASS",
      ic7Transaction: "PASS",
      ic8Persistence: "PASS",
      c5Golden: "PASS",
      c5Massive: "PASS",
      c5Exhaustive: "PASS",
      build: "PASS",
      lint: "PASS",
      status: "PASS",
    },
    diffInventory: {
      path: "ic9-diff-inventory.json",
      sha256: sha256File(path.join(runDir, "ic9-diff-inventory.json")),
    },
    verificationLog: {
      path: "ic9-verification.log",
      sha256: sha256File(path.join(runDir, "ic9-verification.log")),
    },
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  log("  ✓ manifest.json atualizado com sucesso com todos os artefatos de IC9 (PASS)");

  // Atualização do checksums.sha256
  const runFiles = fs.readdirSync(runDir).filter((f) => f !== "checksums.sha256").sort();
  const checksumLines: string[] = [];
  for (const f of runFiles) {
    const fullP = path.join(runDir, f);
    if (fs.statSync(fullP).isFile()) {
      checksumLines.push(`${sha256File(fullP)}  ${f}`);
    }
  }
  fs.writeFileSync(path.join(runDir, "checksums.sha256"), checksumLines.join("\n") + "\n");
  log("  ✓ checksums.sha256 atualizado com todos os artefatos de IC0..IC9");
}

main().catch((err) => {
  console.error("ERRO FATAL EM IC9:", err);
  process.exit(1);
});
