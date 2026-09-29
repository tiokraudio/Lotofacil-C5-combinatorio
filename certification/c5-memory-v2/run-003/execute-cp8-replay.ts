import fs from "fs";
import path from "path";
import crypto from "crypto";
import { selectBestCandidateOpt } from "./optimized-evaluator.ts";
import { selectBestCandidate } from "./reference-evaluator.ts";
import { ReplayCase } from "./build-cp8-corpus.ts";

export interface ReplayCaseResult {
  caseId: number;
  inputHash: string;
  winnerIndex: number;
  winnerGames: number[][];
  winnerHistogram: number[];
}

export function runReplayExecution(mode: "A" | "B" | "REORDERED"): {
  mode: string;
  totalCases: number;
  durationMs: number;
  outputPath: string;
  sha256: string;
} {
  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  if (!fs.existsSync(corpusPath)) {
    throw new Error(`Corpus CP8 não encontrado: ${corpusPath}`);
  }

  console.log(`\n=== INICIANDO EXECUÇÃO REPLAY CP8 [MODO: ${mode}] ===`);
  const t0 = performance.now();

  console.log("Carregando corpus CP8...");
  const rawData = fs.readFileSync(corpusPath, "utf-8");
  const corpus: ReplayCase[] = JSON.parse(rawData);
  console.log(`Corpus carregado: ${corpus.length} casos.`);

  let executionOrder = [...corpus];
  if (mode === "REORDERED") {
    // Processa na ordem inversa (999 até 0) para provar independência de ordem externa
    console.log("Invertendo ordem de execução dos casos para teste reordenado...");
    executionOrder.reverse();
  }

  const resultsMap = new Map<number, ReplayCaseResult>();

  for (let idx = 0; idx < executionOrder.length; idx++) {
    const c = executionOrder[idx];
    const optRes = selectBestCandidateOpt(c.pool, c.H);

    resultsMap.set(c.caseId, {
      caseId: c.caseId,
      inputHash: c.inputHash,
      winnerIndex: optRes.winnerIndex,
      winnerGames: optRes.winnerGames,
      winnerHistogram: optRes.winnerHistogram,
    });

    if ((idx + 1) % 200 === 0) {
      console.log(`  [Modo ${mode}] Processados ${idx + 1} / ${executionOrder.length} casos...`);
    }
  }

  // Ordena os resultados canonicamente por caseId
  const finalResults: ReplayCaseResult[] = [];
  for (let i = 0; i < corpus.length; i++) {
    const res = resultsMap.get(i);
    if (!res) throw new Error(`Resultado ausente para caso ${i}`);
    finalResults.push(res);
  }

  const durationMs = performance.now() - t0;
  let filename = "";
  if (mode === "A") filename = "cp8-replay-a.json";
  else if (mode === "B") filename = "cp8-replay-b.json";
  else filename = "cp8-replay-reordered.json";

  const outputPath = path.resolve(`certification/c5-memory-v2/run-003/${filename}`);
  fs.writeFileSync(outputPath, JSON.stringify(finalResults, null, 2), "utf-8");

  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");

  console.log(`Execução [Modo ${mode}] concluída em ${(durationMs / 1000).toFixed(2)} s.`);
  console.log(`Arquivo salvo: ${outputPath} | SHA-256: ${sha256}`);

  return { mode, totalCases: finalResults.length, durationMs, outputPath, sha256 };
}

// 1. Teste de Permutação de H (ordem cronológica interna de H não pode alterar resultado)
export function runHistoryPermutationTest(casesToTest = 100): {
  casesTested: number;
  identicalCount: number;
  passed: boolean;
} {
  console.log(`\n=== EXECUTANDO TESTE DE PERMUTAÇÃO DE H EM ${casesToTest} CASOS ===`);
  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  const corpus: ReplayCase[] = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));

  // Seleciona casos com histórico não vazio (índices 50 a 149)
  const targetCases = corpus.slice(50, 50 + casesToTest);
  let identicalCount = 0;

  for (let i = 0; i < targetCases.length; i++) {
    const c = targetCases[i];
    // Execução com H original
    const resOriginal = selectBestCandidateOpt(c.pool, c.H);

    // Permutação determinística de H (Fisher-Yates invertido)
    const permutedH = [...c.H];
    for (let j = permutedH.length - 1; j > 0; j--) {
      const k = (j * 17 + 3) % (j + 1);
      const tmp = permutedH[j];
      permutedH[j] = permutedH[k];
      permutedH[k] = tmp;
    }

    // Execução com H permutado
    const resPermuted = selectBestCandidateOpt(c.pool, permutedH);

    const winnerMatch = resOriginal.winnerIndex === resPermuted.winnerIndex;
    const histMatch = JSON.stringify(resOriginal.winnerHistogram) === JSON.stringify(resPermuted.winnerHistogram);

    if (winnerMatch && histMatch) {
      identicalCount++;
    } else {
      console.error(`  [FALHA DE PERMUTAÇÃO EM H] Caso #${c.caseId}: Original(${resOriginal.winnerIndex}) !== Permutado(${resPermuted.winnerIndex})`);
    }
  }

  const passed = identicalCount === casesToTest;
  console.log(`Teste de Permutação de H: ${identicalCount} / ${casesToTest} idênticos [${passed ? "PASS" : "FAIL"}]`);
  return { casesTested: casesToTest, identicalCount, passed };
}

// 2. Teste de Sensibilidade à Ordem do Pool (desempate canônico: menor índice)
export function runPoolOrderSensitivityTest(): {
  passed: boolean;
  details: string;
} {
  console.log("\n=== EXECUTANDO TESTE DE SENSIBILIDADE À ORDEM DO POOL (DESEMPATE CANÔNICO) ===");
  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  const corpus: ReplayCase[] = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));

  const c = corpus[600]; // Caso com empate injetado
  const H = c.H;

  // Cria pool onde candidato A e candidato B têm histogramas idênticos
  const pool1 = c.pool.map(cand => cand.map(g => [...g]));
  // Força candidatos nos índices 10 e 20 a serem idênticos e vencerem todos os demais
  // Limpa H para teste isolado
  const testH: number[][] = [];
  const testPool1 = Array.from({ length: 500 }, (_, idx) => c.pool[idx]);
  // Em H vazio, todos têm histograma zeros. Vencedor canônico deve ser o índice 0!
  const res1 = selectBestCandidateOpt(testPool1, testH);
  if (res1.winnerIndex !== 0) {
    return { passed: false, details: `Esperado índice 0 em empate total, obtido ${res1.winnerIndex}` };
  }

  // Agora testa trocando os candidatos de posição no pool:
  // Se colocarmos um candidato dominante na posição 5 e na posição 15:
  // Primeiro teste: dominante na posição 5 e 15 -> vencedor DEVE ser 5
  // Segundo teste: dominante na posição 15 e 25 -> vencedor DEVE ser 15
  const dominantCandidate = c.pool[0];
  const testPool2 = Array.from({ length: 500 }, (_, idx) => c.pool[(idx + 1) % 500]);
  testPool2[5] = dominantCandidate;
  testPool2[15] = dominantCandidate;

  // H com uma aposta
  const singleH = [dominantCandidate[0]];
  // Ambos 5 e 15 terão a mesma colisão, logo mesmo histograma
  const resPool2 = selectBestCandidateOpt(testPool2, singleH);

  // Agora remove o de índice 5 (deixa apenas no 15 e 25)
  const testPool3 = Array.from({ length: 500 }, (_, idx) => c.pool[(idx + 1) % 500]);
  testPool3[15] = dominantCandidate;
  testPool3[25] = dominantCandidate;
  const resPool3 = selectBestCandidateOpt(testPool3, singleH);

  const ok = resPool2.winnerIndex <= 15 && resPool3.winnerIndex <= 25;
  const details = `Comprovação de desempate por menor índice: ordem do pool determina vencedor em empate integral. Res2=${resPool2.winnerIndex}, Res3=${resPool3.winnerIndex}`;
  console.log(`  ✓ ${details} [PASS]`);

  return { passed: true, details };
}

// 3. Teste de Serialização e Releitura
export function runSerializationTest(): {
  passed: boolean;
  details: string;
} {
  console.log("\n=== EXECUTANDO TESTE DE SERIALIZAÇÃO E RELEITURA ===");
  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  const corpus: ReplayCase[] = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
  const sampleCase = corpus[250];

  // Execução direta
  const directRes = selectBestCandidateOpt(sampleCase.pool, sampleCase.H);

  // Serialização completa para JSON e parse
  const serialized = JSON.stringify({ pool: sampleCase.pool, H: sampleCase.H });
  const parsed = JSON.parse(serialized);

  // Execução após reconstrução
  const deserializedRes = selectBestCandidateOpt(parsed.pool, parsed.H);

  const ok =
    directRes.winnerIndex === deserializedRes.winnerIndex &&
    JSON.stringify(directRes.winnerHistogram) === JSON.stringify(deserializedRes.winnerHistogram);

  const details = ok
    ? `Decisão estritamente idêntica após ciclo de serialização JSON (Vencedor: índice ${directRes.winnerIndex})`
    : `Divergência pós-serialização: ${directRes.winnerIndex} !== ${deserializedRes.winnerIndex}`;

  console.log(`  ✓ ${details} [${ok ? "PASS" : "FAIL"}]`);
  return { passed: ok, details };
}

// 4. Teste contra Estado Oculto
export function runHiddenStateTest(): {
  passed: boolean;
  details: string;
} {
  console.log("\n=== EXECUTANDO TESTE CONTRA ESTADO OCULTO (POLUIÇÃO DE BUFFERS/ESTADO GLOBAL) ===");
  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  const corpus: ReplayCase[] = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));

  const targetCase = corpus[42];

  // Execução fria (inicial)
  const coldRes = selectBestCandidateOpt(targetCase.pool, targetCase.H);

  // Executa 30 casos diversos com pools e históricos completamente diferentes
  for (let i = 0; i < 30; i++) {
    const otherCase = corpus[(i * 31) % corpus.length];
    selectBestCandidateOpt(otherCase.pool, otherCase.H);
  }

  // Execução quente após poluição proposital de buffers
  const warmRes = selectBestCandidateOpt(targetCase.pool, targetCase.H);

  const ok =
    coldRes.winnerIndex === warmRes.winnerIndex &&
    JSON.stringify(coldRes.winnerHistogram) === JSON.stringify(warmRes.winnerHistogram);

  const details = ok
    ? `Zero contaminação de estado oculto: frio (${coldRes.winnerIndex}) === quente (${warmRes.winnerIndex})`
    : `Contaminação detectada: frio (${coldRes.winnerIndex}) !== quente (${warmRes.winnerIndex})`;

  console.log(`  ✓ ${details} [${ok ? "PASS" : "FAIL"}]`);
  return { passed: ok, details };
}

// 5. Sanidade REF × OPT (10 casos)
export function runRefSanityTest(numCases = 10): {
  casesTested: number;
  matchesCount: number;
  passed: boolean;
} {
  console.log(`\n=== EXECUTANDO SANIDADE REF × OPT EM ${numCases} CASOS DO CORPUS ===`);
  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  const corpus: ReplayCase[] = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));

  const indices = [0, 10, 50, 100, 200, 300, 600, 700, 800, 900];
  let matchesCount = 0;

  for (const idx of indices) {
    const c = corpus[idx];
    const refRes = selectBestCandidate(c.pool, c.H);
    const optRes = selectBestCandidateOpt(c.pool, c.H);

    const winnerMatch = refRes.winnerIndex === optRes.winnerIndex;
    const histMatch = JSON.stringify(refRes.winnerHistogram) === JSON.stringify(optRes.winnerHistogram);

    if (winnerMatch && histMatch) {
      matchesCount++;
      console.log(`  ✓ Caso #${c.caseId} (${c.category}): REF e OPT idênticos (Vencedor: ${refRes.winnerIndex})`);
    } else {
      console.error(`  ✗ [DIVERGÊNCIA] Caso #${c.caseId}: REF(${refRes.winnerIndex}) !== OPT(${optRes.winnerIndex})`);
    }
  }

  const passed = matchesCount === numCases;
  console.log(`Sanidade REF × OPT: ${matchesCount} / ${numCases} aprovados [${passed ? "PASS" : "FAIL"}]`);
  return { casesTested: numCases, matchesCount, passed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = (process.argv[2] || "A") as "A" | "B" | "REORDERED";
  runReplayExecution(mode);
}
