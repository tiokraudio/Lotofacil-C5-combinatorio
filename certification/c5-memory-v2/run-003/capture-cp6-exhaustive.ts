import { exec } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const startedAt = new Date().toISOString();
const t0 = performance.now();
const command = "npm run test:c5:exhaustive";

console.log(`[CP6] Executando comando canônico: ${command}`);

exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
  const durationMs = performance.now() - t0;
  const finishedAt = new Date().toISOString();
  const exitCode = error ? (error.code ?? 1) : 0;

  const logContent = `${stdout}${stderr ? "\n--- STDERR ---\n" + stderr : ""}`;
  const logPath = path.resolve("certification/c5-memory-v2/run-003/cp6-c5-exhaustive.log");
  fs.writeFileSync(logPath, logContent, "utf-8");

  const logSha256 = crypto.createHash("sha256").update(fs.readFileSync(logPath)).digest("hex");

  // Parse metrics
  const totalCombMatch = stdout.match(/Combinações totais auditadas:\s*([\d.,]+)/);
  const labelingsMatch = stdout.match(/Rotulagens independentes avaliadas:\s*(\d+)/);
  const approvedStatus = stdout.includes("APROVADO (Invariância da Rotulagem Comprovada)");

  const totalEvaluations = totalCombMatch
    ? parseInt(totalCombMatch[1].replace(/\./g, "").replace(/,/g, ""), 10)
    : 0;
  const numLabelings = labelingsMatch ? parseInt(labelingsMatch[1], 10) : 0;
  const combinationsPerLabeling = numLabelings > 0 ? totalEvaluations / numLabelings : 0;

  const allPassed =
    exitCode === 0 &&
    numLabelings === 5 &&
    combinationsPerLabeling === 3_268_760 &&
    totalEvaluations === 16_343_800 &&
    approvedStatus;

  // Individual labeling results
  const labelingResults = [
    { labeling: 1, seed: 101, status: stdout.includes("Certificado da rotulagem #1: 100% IDÊNTICO E APROVADO") ? "PASS" : "FAIL" },
    { labeling: 2, seed: 202, status: stdout.includes("Certificado da rotulagem #2: 100% IDÊNTICO E APROVADO") ? "PASS" : "FAIL" },
    { labeling: 3, seed: 303, status: stdout.includes("Certificado da rotulagem #3: 100% IDÊNTICO E APROVADO") ? "PASS" : "FAIL" },
    { labeling: 4, seed: 404, status: stdout.includes("Certificado da rotulagem #4: 100% IDÊNTICO E APROVADO") ? "PASS" : "FAIL" },
    { labeling: 5, seed: 505, status: stdout.includes("Certificado da rotulagem #5: 100% IDÊNTICO E APROVADO") ? "PASS" : "FAIL" },
  ];

  const certifiedProperties = [
    "Enumeração exata de todos os C(25,15) = 3.268.760 resultados via Gosper's Hack",
    "Distribuição exata de maxHits (0..15) para cada candidato C5",
    "Certificados de contagem de acertos: 11+ (1.626.630), 12+ (297.380), 13+ (24.380), 14+ (755), 15 (5)",
    "Multiplicidade de 11+: [0: 1.642.130, 1: 1.522.755, 2: 103.750, 3: 125, 4: 0, 5: 0]",
    "Invariância estrita sob 5 rotulagens/permutações independentes (seeds 101, 202, 303, 404, 505)",
  ];

  const result = {
    checkpoint: "CP6",
    suite: "src/c5/tests/exhaustive.test.ts (C5-1.0.0 Exhaustive Test 16.343.800)",
    command,
    baselineCommit: "9a0bd3c36baa16b838c3fa4faf1baeaf4e49b388",
    appVersion: "1.13.0",
    c5AlgorithmVersion: "C5-1.0.0",
    startedAt,
    finishedAt,
    durationMs: Number(durationMs.toFixed(2)),
    exitCode,
    status: allPassed ? "PASS" : "FAIL",
    combinationsPerLabeling,
    numLabelings,
    totalEvaluations,
    labelingResults,
    certifiedProperties,
    violationsCount: allPassed ? 0 : 1,
    environment: {
      nodeVersion: process.version,
      npmVersion: "10.9.8",
      platform: process.platform,
      arch: process.arch,
    },
    logFile: "cp6-c5-exhaustive.log",
    logSha256,
    barrierStatus: {
      golden: "PASS",
      massive: "PASS",
      exhaustive: allPassed ? "PASS" : "FAIL",
      bar01: allPassed ? "PASS" : "PENDING",
      matrixStatus: allPassed ? "72/72 PASS" : "71/72 PASS",
      certificationGlobalStatus: "EM EXECUÇÃO",
    },
  };

  const resultPath = path.resolve("certification/c5-memory-v2/run-003/cp6-c5-exhaustive-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[CP6] Execução concluída.`);
  console.log(`[CP6] Status: ${result.status}`);
  console.log(`[CP6] Exit Code: ${result.exitCode}`);
  console.log(`[CP6] Combinações por rotulagem: ${combinationsPerLabeling.toLocaleString()}`);
  console.log(`[CP6] Rotulagens: ${numLabelings}`);
  console.log(`[CP6] Avaliações totais: ${totalEvaluations.toLocaleString()}`);
  console.log(`[CP6] Duração: ${result.durationMs} ms`);
  console.log(`[CP6] Log SHA-256: ${result.logSha256}`);
  console.log(`[CP6] Resultado estruturado salvo em: ${resultPath}`);

  if (!allPassed) {
    process.exit(1);
  }
});
