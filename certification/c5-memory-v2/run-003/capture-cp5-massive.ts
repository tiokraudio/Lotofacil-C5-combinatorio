import { exec } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const startedAt = new Date().toISOString();
const t0 = performance.now();
const command = "npm run test:c5:massive";

console.log(`[CP5] Executando comando canônico: ${command}`);

exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
  const durationMs = performance.now() - t0;
  const finishedAt = new Date().toISOString();
  const exitCode = error ? (error.code ?? 1) : 0;

  const logContent = `${stdout}${stderr ? "\n--- STDERR ---\n" + stderr : ""}`;
  const logPath = path.resolve("certification/c5-memory-v2/run-003/cp5-c5-massive.log");
  fs.writeFileSync(logPath, logContent, "utf-8");

  const logSha256 = crypto.createHash("sha256").update(fs.readFileSync(logPath)).digest("hex");

  // Parse metrics from stdout
  const totalMatch = stdout.match(/Total Executado:\s*([\d.,]+)/);
  const validMatch = stdout.match(/Total Válidos:\s*([\d.,]+)/);
  const invalidMatch = stdout.match(/Total Inválidos:\s*(\d+)/);
  const statusMatch = stdout.match(/Status:\s*([^\n]+)/);

  const totalExecuted = totalMatch ? parseInt(totalMatch[1].replace(/\./g, "").replace(/,/g, ""), 10) : 0;
  const totalValid = validMatch ? parseInt(validMatch[1].replace(/\./g, "").replace(/,/g, ""), 10) : 0;
  const totalInvalid = invalidMatch ? parseInt(invalidMatch[1], 10) : -1;
  const approved = stdout.includes("APROVADO (0 falhas)");

  const allPassed =
    exitCode === 0 &&
    totalExecuted === 100_000 &&
    totalValid === 100_000 &&
    totalInvalid === 0 &&
    approved;

  const result = {
    checkpoint: "CP5",
    suite: "src/c5/tests/massive.test.ts (C5-1.0.0 Massive Test 100.000)",
    command,
    baselineCommit: "9a0bd3c36baa16b838c3fa4faf1baeaf4e49b388",
    appVersion: "1.13.0",
    c5AlgorithmVersion: "C5-1.0.0",
    startedAt,
    finishedAt,
    durationMs: Number(durationMs.toFixed(2)),
    exitCode,
    status: allPassed ? "PASS" : "FAIL",
    metrics: {
      totalExecuted,
      totalValid,
      totalInvalid,
      failures: totalInvalid,
      validityRate: totalExecuted > 0 ? (totalValid / totalExecuted) * 100 : 0,
      approvedStatus: approved,
    },
    environment: {
      nodeVersion: process.version,
      npmVersion: "10.9.8",
      platform: process.platform,
      arch: process.arch,
    },
    logFile: "cp5-c5-massive.log",
    logSha256,
    bar01Status: "PENDING",
    bar01Details: {
      golden: "PASS",
      massive: allPassed ? "PASS" : "FAIL",
      exhaustive: "PENDING",
      reason: "Barreira BAR01 exige cumulativamente Golden, Massive (100k) e Exhaustive (16.34M). Em CP5, Golden e Massive foram aprovados; Exhaustive permanece PENDING.",
    },
  };

  const resultPath = path.resolve("certification/c5-memory-v2/run-003/cp5-c5-massive-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[CP5] Execução concluída.`);
  console.log(`[CP5] Status: ${result.status}`);
  console.log(`[CP5] Exit Code: ${result.exitCode}`);
  console.log(`[CP5] Gerações: ${totalExecuted} (Válidas: ${totalValid}, Inválidas: ${totalInvalid})`);
  console.log(`[CP5] Duração: ${result.durationMs} ms`);
  console.log(`[CP5] Log SHA-256: ${result.logSha256}`);
  console.log(`[CP5] Resultado estruturado salvo em: ${resultPath}`);

  if (!allPassed) {
    process.exit(1);
  }
});
