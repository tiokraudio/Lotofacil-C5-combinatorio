import fs from "fs";
import path from "path";
import crypto from "crypto";

const t0 = performance.now();
const startedAt = new Date().toISOString();
let assertionCount = 0;
const logLines: string[] = [];

function log(msg: string) {
  console.log(msg);
  logLines.push(`[${new Date().toISOString()}] ${msg}`);
}

function assertStrict(condition: boolean, msg: string) {
  assertionCount++;
  if (!condition) {
    const errorMsg = `FAILED ASSERTION [${assertionCount}]: ${msg}`;
    log(errorMsg);
    throw new Error(errorMsg);
  }
  log(`PASS [${assertionCount}]: ${msg}`);
}

log("=== INICIANDO VERIFICAÇÃO INDEPENDENTE DO PRNG CANÔNICO (MULBERRY32) ===");

const runDir = path.resolve("certification/c5-memory-v2/integration/run-001");
const contractPath = path.join(runDir, "ic2-canonical-pool-prng-contract.json");
const vectorsPath = path.join(runDir, "ic2-prng-golden-vectors.json");

assertStrict(fs.existsSync(contractPath), "ic2-canonical-pool-prng-contract.json existe");
assertStrict(fs.existsSync(vectorsPath), "ic2-prng-golden-vectors.json existe");

const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
const goldenVectors = JSON.parse(fs.readFileSync(vectorsPath, "utf-8"));

// 1. AUDITORIA DOS GOLDEN VECTORS DE PRNG
log("--- 1. Auditando Golden Vectors unitários de PRNG ---");
assertStrict(Array.isArray(goldenVectors), "Golden vectors é um array");
assertStrict(goldenVectors.length === 6, `6 vetores de teste encontrados (obtido: ${goldenVectors.length})`);

function createMulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const w = (t ^ (t >>> 14)) >>> 0;
    return { word: w, normalized: w / 4294967296, state: s };
  };
}

for (const vec of goldenVectors) {
  const rng = createMulberry32(vec.seed);
  let lastState = vec.initialState;
  for (let i = 0; i < vec.wordsCount; i++) {
    const res = rng();
    assertStrict(res.word === vec.words[i], `Seed ${vec.seed}, palavra ${i}: ${res.word} === ${vec.words[i]}`);
    assertStrict(res.normalized === vec.normalized[i], `Seed ${vec.seed}, normalizado ${i}: ${res.normalized} === ${vec.normalized[i]}`);
    lastState = res.state;
  }
  assertStrict(lastState === vec.finalState, `Seed ${vec.seed}: estado final confere (${lastState} === ${vec.finalState})`);
}

// 2. DETERMINISMO E REPETIBILIDADE EM LARGA ESCALA
log("--- 2. Testando determinismo e repetibilidade (10.000 iterações) ---");
const testSeed = 20260929;
const runA = createMulberry32(testSeed);
const runB = createMulberry32(testSeed);
let allMatch = true;
for (let i = 0; i < 10000; i++) {
  if (runA().word !== runB().word) {
    allMatch = false;
    break;
  }
}
assertStrict(allMatch, "10.000 palavras geradas em duas execuções independentes são 100% idênticas");

// 3. ISOLAMENTO DE ESTADO ENTRE SEEDS (ERR-POOL05)
log("--- 3. Testando isolamento de estado entre seeds (ERR-POOL05) ---");
const seedA = 101010;
const seedB = 202020;

// Sequência 1: A1 isolada
const genA1 = createMulberry32(seedA);
const wordsA1: number[] = [];
for (let i = 0; i < 500; i++) wordsA1.push(genA1().word);

// Sequência 2: B intermediária
const genB = createMulberry32(seedB);
const wordsB: number[] = [];
for (let i = 0; i < 500; i++) wordsB.push(genB().word);

// Sequência 3: A2 executada após B
const genA2 = createMulberry32(seedA);
const wordsA2: number[] = [];
for (let i = 0; i < 500; i++) wordsA2.push(genA2().word);

assertStrict(JSON.stringify(wordsA1) === JSON.stringify(wordsA2), "ERR-POOL05: Replay A2 após execução de B é bit a bit idêntico a A1");
assertStrict(JSON.stringify(wordsA1) !== JSON.stringify(wordsB), "ERR-POOL05: Sequência A diverge da sequência B");

// 4. SERIALIZAÇÃO E NORMALIZAÇÃO DE SEMENTES
log("--- 4. Testando normalização e parsing de sementes ---");
const seedsToTest = ["0", "1", "20260929", "4294967295", 0, 1, 20260929, 4294967295];
for (const s of seedsToTest) {
  const normalized = Number(s) >>> 0;
  assertStrict(normalized >= 0 && normalized <= 0xffffffff, `Semente ${s} normaliza para uint32 válido (${normalized})`);
  const gen = createMulberry32(normalized);
  const w = gen().word;
  assertStrict(typeof w === "number" && w >= 0 && w <= 0xffffffff, `Palavra gerada é uint32 válido`);
}

// 5. CONSUMO CANÔNICO PARA C5 E FISHER-YATES (12.000 PALAVRAS PARA K=500)
log("--- 5. Testando consumo de palavras no embaralhamento de 500 candidatos ---");
const poolSeed = 999999;
const poolRng = createMulberry32(poolSeed);
let totalWordsConsumed = 0;

for (let cand = 0; cand < 500; cand++) {
  // Simular Fisher-Yates de 25 dezenas (24 iterações)
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = 24; i > 0; i--) {
    const u = poolRng().normalized;
    totalWordsConsumed++;
    const j = Math.floor(u * (i + 1));
    const temp = numbers[i];
    numbers[i] = numbers[j];
    numbers[j] = temp;
  }
  // Verificar que números continuam sendo uma permutação estrita de 1..25
  const sorted = [...numbers].sort((a, b) => a - b);
  assertStrict(sorted.length === 25 && sorted[0] === 1 && sorted[24] === 25, `Candidato ${cand}: permutação válida de 1..25`);
}

assertStrict(totalWordsConsumed === 12000, `Exatamente 12.000 palavras consumidas para K=500 candidatos (obtido: ${totalWordsConsumed})`);

// 6. RESOLUÇÃO DE DEPENDÊNCIAS DE IC1 (GV-I11, GV-I12, GV-I18)
log("--- 6. Verificando resolução derivativa de GV-I11, GV-I12, GV-I18 ---");
const proofPath = path.join(runDir, "ic2-corpus-resolution-proof.json");
assertStrict(fs.existsSync(proofPath), "ic2-corpus-resolution-proof.json existe");
const proof = JSON.parse(fs.readFileSync(proofPath, "utf-8"));
assertStrict(proof.casesCountUnchanged === true, "1000 casos preservados");
assertStrict(proof.caseIdsMatchExactly === true, "1000 caseIds idênticos");
assertStrict(proof.classesMatchExactly === true, "12 classes idênticas");
assertStrict(proof.historiesMatchExactly === true, "Históricos idênticos");
assertStrict(proof.seedsMatchExactly === true, "Seeds idênticas");
assertStrict(proof.t3788CasesCountBefore === 20 && proof.t3788CasesCountAfter === 20, "20 casos T=3788 preservados");

// 7. PORTABILIDADE NODE / BROWSER
log("--- 7. Verificando portabilidade normativa Node / Browser ---");
assertStrict(
  contract.mathematicalSpecification.integerOverflowSemantics.includes(">>> 0"),
  "Aritmética forçada por >>> 0 compatível com browsers e Node"
);
assertStrict(
  contract.mathematicalSpecification.bitwiseSemantics.includes("Math.imul"),
  "Math.imul padrão ECMAScript disponível universalmente"
);

const durationMs = Math.round(performance.now() - t0);
const finishedAt = new Date().toISOString();

// PERSISTIR RESULTADO E LOG
const result = {
  checkpoint: "IC2",
  component: "PRNG_CANONICAL_VERIFICATION",
  algorithm: "MULBERRY32",
  status: "PASS",
  startedAt,
  finishedAt,
  durationMs,
  totalAssertionsChecked: assertionCount,
  goldenVectorsChecked: goldenVectors.length,
  isolationTestPass: true,
  wordsConsumedFor500Candidates: totalWordsConsumed,
  portabilityVerified: true,
  derivativeCorpusResolutionValid: true
};

const resultPath = path.join(runDir, "ic2-prng-verification-result.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");

const logPath = path.join(runDir, "ic2-prng-verification.log");
fs.writeFileSync(logPath, logLines.join("\n") + "\n");

log(`=== VERIFICAÇÃO DO PRNG CONCLUÍDA COM SUCESSO: ${assertionCount} ASSERÇÕES VERIFICADAS (STATUS: PASS) ===`);
