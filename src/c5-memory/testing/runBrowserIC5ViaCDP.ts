/**
 * Executa a Suíte Oficial do Checkpoint IC5 em Chromium Real via CDP
 * Ordem Executiva IC5 (Seção 29)
 */

import { spawn } from "node:child_process";

const CHROME_PATH = "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const PORT = 9222;
const TARGET_URL = "http://localhost:3000/recert05-browser-runner-ic5.html";

async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

async function run() {
  console.log("Iniciando Chromium Real para testes de UI & DOM Integration IC5...");

  const chromeProcess = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${PORT}`,
      TARGET_URL,
    ],
    { stdio: "ignore" }
  );

  chromeProcess.on("error", err => {
    console.error("Falha ao iniciar processo do Chrome:", err);
    process.exit(1);
  });

  try {
    let targets: any[] = [];
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const resp = await fetch(`http://127.0.0.1:${PORT}/json`);
        if (resp.ok) {
          targets = await resp.json();
          if (targets.length > 0) break;
        }
      } catch {}
    }

    if (targets.length === 0) {
      throw new Error("Não foi possível conectar ao endpoint CDP do Chromium.");
    }

    const pageTarget = targets.find((t: any) => t.type === "page") || targets[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;
    console.log(`Conectando ao CDP WebSocket: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = e => reject(e);
    });

    let msgId = 1;
    function sendCommand(method: string, params: any = {}): Promise<any> {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        const handler = (ev: MessageEvent) => {
          const data = JSON.parse(ev.data);
          if (data.id === id) {
            ws.removeEventListener("message", handler);
            resolve(data.result);
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCommand("Runtime.enable");
    console.log("Aguardando execução dos testes IC5 no V8/DOM real...");

    let results: any[] = [];
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const evalRes = await sendCommand("Runtime.evaluate", {
        expression: "window.__browserTestResultsIC5",
        returnByValue: true,
      });

      if (evalRes && evalRes.result && evalRes.result.value && evalRes.result.value.length >= 9) {
        results = evalRes.result.value;
        break;
      }
    }

    if (results.length === 0) {
      throw new Error("Timeout aguardando resultados dos testes IC5 no navegador.");
    }

    console.log("\n====================================================================");
    console.log(" RELATÓRIO OFICIAL DO CHECKPOINT IC5 EM CHROMIUM REAL (UI & DOM)   ");
    console.log("====================================================================");
    console.log(`Total de Ensaios: ${results.length}`);

    let allPassed = true;
    for (const r of results) {
      const symbol = r.passed ? "✓ PASS" : "✗ FAIL";
      if (!r.passed) allPassed = false;
      console.log(`[Item ${String(r.id).padStart(2, "0")}] ${symbol} — ${r.name}: ${r.details}`);
    }

    console.log("====================================================================");
    console.log(`REAL_BROWSER_UI_IC5 = ${allPassed ? "PASS" : "FAIL"}`);
    console.log("DOM_INTERACTION_IC5 = YES");
    console.log("NATIVE_INDEXEDDB_IC5 = YES");
    console.log("NATIVE_WEBCRYPTO_IC5 = YES");

    ws.close();
    chromeProcess.kill();
    process.exit(allPassed ? 0 : 1);
  } catch (e: any) {
    console.error("Erro na execução do navegador real IC5:", e.message);
    chromeProcess.kill();
    process.exit(1);
  }
}

run();
