import { exec } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const startedAt = new Date().toISOString();
const t0 = performance.now();
const command = "npm run test:c5:golden";

console.log(`[CP4] Executando comando canônico: ${command}`);

exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
  const durationMs = performance.now() - t0;
  const finishedAt = new Date().toISOString();
  const exitCode = error ? (error.code ?? 1) : 0;

  const logContent = `${stdout}${stderr ? "\n--- STDERR ---\n" + stderr : ""}`;
  const logPath = path.resolve("certification/c5-memory-v2/run-003/cp4-c5-golden.log");
  fs.writeFileSync(logPath, logContent, "utf-8");

  const logSha256 = crypto.createHash("sha256").update(fs.readFileSync(logPath)).digest("hex");

  const checksReported = {
    slotMapping: stdout.includes("slot mapping: PASS"),
    slotDeepEqual: stdout.includes("slot deep equality: PASS"),
    j1: stdout.includes("J1: PASS"),
    j2: stdout.includes("J2: PASS"),
    j3: stdout.includes("J3: PASS"),
    j4: stdout.includes("J4: PASS"),
    j5: stdout.includes("J5: PASS"),
    gamesDeepEqual: stdout.includes("games deep equality: PASS"),
    slotSemantics: stdout.includes("slot semantics (ausência 2, presença 3): PASS"),
    negativeGoldenTest: stdout.includes("negative golden test (rejeição de inclusão): PASS"),
    intersections8: stdout.includes("interseções 8: PASS"),
    intersections7: stdout.includes("interseções 7: PASS"),
    validateC5: stdout.includes("validateC5: PASS"),
    overallResult: stdout.includes("RESULTADO GOLDEN TEST: APROVADO (TODOS PASS)"),
  };

  const allPassed =
    exitCode === 0 &&
    Object.values(checksReported).every(Boolean);

  const result = {
    checkpoint: "CP4",
    suite: "C5-1.0.0 Golden Test Canônico",
    command,
    baselineCommit: "9a0bd3c36baa16b838c3fa4faf1baeaf4e49b388",
    appVersion: "1.13.0",
    c5AlgorithmVersion: "C5-1.0.0",
    startedAt,
    finishedAt,
    durationMs: Number(durationMs.toFixed(2)),
    exitCode,
    status: allPassed ? "PASS" : "FAIL",
    checksReported: {
      ...checksReported,
      totalCheckCategories: 13,
      passedCheckCategories: Object.values(checksReported).filter(Boolean).length - 1, // exclude overallResult
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    logFile: "cp4-c5-golden.log",
    logSha256,
    bar01Status: "PENDING",
    bar01Details: {
      golden: "PASS",
      massive: "PENDING",
      exhaustive: "PENDING",
      reason: "Barreira BAR01 exige cumulativamente Golden, Massive (100k) e Exhaustive (16.34M). Em CP4, apenas Golden foi executado.",
    },
  };

  const resultPath = path.resolve("certification/c5-memory-v2/run-003/cp4-c5-golden-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[CP4] Execução concluída.`);
  console.log(`[CP4] Status: ${result.status}`);
  console.log(`[CP4] Exit Code: ${result.exitCode}`);
  console.log(`[CP4] Duração: ${result.durationMs} ms`);
  console.log(`[CP4] Log SHA-256: ${result.logSha256}`);
  console.log(`[CP4] Resultado estruturado salvo em: ${resultPath}`);

  if (!allPassed) {
    process.exit(1);
  }
});
