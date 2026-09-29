import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

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

log("=== INICIANDO VALIDAÇÃO INDEPENDENTE DOS ARTEFATOS IC1 ===");

const runDir = path.resolve("certification/c5-memory-v2/integration/run-001");
const goldenPath = path.join(runDir, "ic1-golden-vectors.json");
const corpusPath = path.join(runDir, "ic1-equivalence-corpus.json");
const manifestCorpusPath = path.join(runDir, "ic1-equivalence-corpus-manifest.json");

// 1. AUDITORIA DOS GOLDEN VECTORS
log("--- 1. Auditando ic1-golden-vectors.json ---");
assertStrict(fs.existsSync(goldenPath), "ic1-golden-vectors.json existe");
const goldenContent = fs.readFileSync(goldenPath, "utf-8");
const goldenVectors = JSON.parse(goldenContent);
assertStrict(Array.isArray(goldenVectors), "Golden vectors é um array JSON");
assertStrict(goldenVectors.length === 18, `Exatamente 18 Golden vectors encontrados (obtido: ${goldenVectors.length})`);

const expectedIds = Array.from({ length: 18 }, (_, i) => `GV-I${String(i + 1).padStart(2, "0")}`);
const actualIds = goldenVectors.map((v: any) => v.goldenId);
assertStrict(
  JSON.stringify(actualIds) === JSON.stringify(expectedIds),
  "IDs de Golden vectors são estritamente GV-I01 .. GV-I18 em ordem"
);

// Verificar campos mandatórios e não-tautologia
for (const g of goldenVectors) {
  assertStrict(typeof g.goldenId === "string" && g.goldenId.length > 0, `${g.goldenId}: goldenId válido`);
  assertStrict(typeof g.normativeSource === "string" && g.normativeSource.length > 0, `${g.goldenId}: normativeSource presente`);
  assertStrict(typeof g.description === "string" && g.description.length > 0, `${g.goldenId}: description presente`);
  assertStrict(typeof g.inputs === "object" && g.inputs !== null, `${g.goldenId}: inputs é um objeto`);
  assertStrict(typeof g.preconditions === "object" && g.preconditions !== null, `${g.goldenId}: preconditions é um objeto`);
  assertStrict(typeof g.expected === "object" && g.expected !== null, `${g.goldenId}: expected é um objeto`);
  assertStrict(Array.isArray(g.invariants) && g.invariants.length > 0, `${g.goldenId}: invariants não-vazio`);
  assertStrict(Array.isArray(g.negativeAssertions) && g.negativeAssertions.length > 0, `${g.goldenId}: negativeAssertions não-vazio`);
  assertStrict(typeof g.evidenceType === "string" && g.evidenceType.length > 0, `${g.goldenId}: evidenceType presente`);

  const expectedStr = JSON.stringify(g.expected).toLowerCase();
  assertStrict(
    !expectedStr.includes("implementation behaves correctly") &&
    !expectedStr.includes("correct behavior") &&
    !expectedStr.includes("works as expected"),
    `${g.goldenId}: expected não é tautológico`
  );
}

// Verificar cálculos criptográficos em GV-I02 e GV-I03
const gv02 = goldenVectors.find((v: any) => v.goldenId === "GV-I02");
const sha02 = crypto.createHash("sha256").update(gv02.expected.canonicalPreimage).digest("hex");
assertStrict(sha02 === gv02.expected.expectedDigest, "GV-I02: digest computado independentemente confere com expectedDigest");

const gv03 = goldenVectors.find((v: any) => v.goldenId === "GV-I03");
const sha03 = crypto.createHash("sha256").update(gv03.expected.canonicalPreimage).digest("hex");
assertStrict(sha03 === gv03.expected.expectedDigest, "GV-I03: digest computado independentemente confere com expectedDigest");

// Verificar GV-I17 (poolIndex desempate)
const gv17 = goldenVectors.find((v: any) => v.goldenId === "GV-I17");
assertStrict(gv17.expected.winnerIndex === 14, "GV-I17: candidato vencedor é poolIndex = 14");
assertStrict(gv17.expected.tieBreakerRule === "MIN_POOL_INDEX", "GV-I17: regra de desempate é MIN_POOL_INDEX");

// 2. AUDITORIA DO CORPUS OFICIAL IC9
log("--- 2. Auditando ic1-equivalence-corpus.json e manifesto ---");
assertStrict(fs.existsSync(corpusPath), "ic1-equivalence-corpus.json existe");
assertStrict(fs.existsSync(manifestCorpusPath), "ic1-equivalence-corpus-manifest.json existe");

const corpusManifest = JSON.parse(fs.readFileSync(manifestCorpusPath, "utf-8"));
assertStrict(corpusManifest.totalCases === 1000, "Manifesto declara totalCases = 1000");
assertStrict(corpusManifest.ic9ProofDimensions.totalCoordinateEvaluations === 5000000, "Manifesto declara 5.000.000 de avaliações em IC9");
assertStrict(corpusManifest.ic9ProofDimensions.toleratedDivergences === 0, "Manifesto declara zero tolerância a divergências");

log("Carregando corpus para auditoria estrutural e de integridade dos jogos...");
const corpusCases = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
assertStrict(Array.isArray(corpusCases), "Corpus é um array JSON");
assertStrict(corpusCases.length === 1000, `Corpus contém exatamente 1000 casos (obtido: ${corpusCases.length})`);

const seenCaseIds = new Set<string>();
const classCounts: Record<string, number> = {};
let totalGamesAudited = 0;
let invalidGamesCount = 0;

for (let i = 0; i < corpusCases.length; i++) {
  const c = corpusCases[i];
  assertStrict(typeof c.caseId === "string", `Caso ${i}: caseId é string`);
  assertStrict(!seenCaseIds.has(c.caseId), `Caso ${i}: caseId único (${c.caseId})`);
  seenCaseIds.add(c.caseId);

  const expectedCaseId = `IC9-CASE-${String(i + 1).padStart(4, "0")}`;
  assertStrict(c.caseId === expectedCaseId, `Caso ${i}: caseId ordenado sequencialmente (${c.caseId} === ${expectedCaseId})`);

  classCounts[c.class] = (classCounts[c.class] || 0) + 1;
  assertStrict(Array.isArray(c.history), `${c.caseId}: history é um array`);
  assertStrict(typeof c.poolMasterSeed === "number", `${c.caseId}: poolMasterSeed é number`);
  assertStrict(typeof c.poolInputContract === "object", `${c.caseId}: poolInputContract é objeto`);
  assertStrict(c.poolInputContract.poolSize === 500, `${c.caseId}: poolSize = 500`);
  assertStrict(c.poolInputContract.status === "PENDING_IC2_PRNG_CONTRACT", `${c.caseId}: PRNG status dependente de IC2`);

  // Validar jogos concretos em history
  for (const game of c.history) {
    totalGamesAudited++;
    if (!Array.isArray(game) || game.length !== 15) {
      invalidGamesCount++;
      continue;
    }
    let prev = 0;
    for (const num of game) {
      if (typeof num !== "number" || num < 1 || num > 25 || num <= prev) {
        invalidGamesCount++;
        break;
      }
      prev = num;
    }
  }
}

assertStrict(invalidGamesCount === 0, `Todos os jogos concretos auditados são válidos 15/25 ordenados (total auditados: ${totalGamesAudited}, inválidos: ${invalidGamesCount})`);
assertStrict(seenCaseIds.size === 1000, "1000 caseIds estritamente únicos");

// Verificar correspondência entre manifesto e corpus
for (const [cls, count] of Object.entries(corpusManifest.distributionByClass)) {
  assertStrict(
    classCounts[cls] === count,
    `Distribuição da classe ${cls}: declarada ${count} === materializada ${classCounts[cls]}`
  );
}

// Verificar especificamente T=3788
const t3788Count = classCounts["OPERATIONAL_HORIZON_T3788"] || 0;
assertStrict(t3788Count === 20, `Casos T=3788: 20 materializados (obtido: ${t3788Count})`);
const t3788First = corpusCases.find((c: any) => c.caseId === "IC9-CASE-0551");
assertStrict(t3788First.history.length === 18940, "IC9-CASE-0551 possui exatamente 18.940 jogos (|H| para T=3788)");

// 3. AUDITORIA DE ISOLAMENTO E NÃO CONTAMINAÇÃO DO RUNTIME
log("--- 3. Auditando isolamento e integridade do código ---");
const grepCertificationInSrc = execSync("grep -rn 'certification' src/ || true").toString().trim();
assertStrict(grepCertificationInSrc === "", "Zero referências a certification/ dentro de src/");

const gitDiffOutsideCertification = execSync("git diff 9a0bd3c36baa16b838c3fa4faf1baeaf4e49b388 HEAD -- . ':!certification'").toString().trim();
assertStrict(gitDiffOutsideCertification === "", "Zero diferenças de produção contra o baseline");

const gitStatusOutsideCertification = execSync("git status --porcelain ':!certification'").toString().trim();
assertStrict(gitStatusOutsideCertification === "", "Zero arquivos de produção modificados ou não-rastreados no working tree");

const durationMs = Math.round(performance.now() - t0);
const finishedAt = new Date().toISOString();

// 4. PERSISTIR LOG E RESULTADO
const verificationResult = {
  checkpoint: "IC1",
  status: "PASS",
  startedAt,
  finishedAt,
  durationMs,
  totalAssertionsChecked: assertionCount,
  goldenVectorsCount: goldenVectors.length,
  corpusCasesCount: corpusCases.length,
  totalGamesAudited,
  invalidGamesCount,
  uniqueCaseIdsCount: seenCaseIds.size,
  t3788CasesCount: t3788Count,
  productionFilesModified: 0,
  zeroAppOptResultsObserved: true,
  zeroAppImplementationCreated: true
};

const resultPath = path.join(runDir, "ic1-verification-result.json");
fs.writeFileSync(resultPath, JSON.stringify(verificationResult, null, 2) + "\n");

const logPath = path.join(runDir, "ic1-verification.log");
fs.writeFileSync(logPath, logLines.join("\n") + "\n");

log(`=== VALIDAÇÃO IC1 CONCLUÍDA COM SUCESSO: ${assertionCount} ASSERÇÕES VERIFICADAS (STATUS: PASS) ===`);
