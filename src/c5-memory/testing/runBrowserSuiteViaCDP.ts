/**
 * Executor CDP Direto para Chromium Real (RECERT-0.1 Item 2)
 * 
 * Conecta via Chrome DevTools Protocol nativo sobre WebSocket.
 * Aguarda a conclusão dos 22 testes em V8, Native IndexedDB e WebCrypto.
 */

import { spawn } from "node:child_process";

const CHROME_PATH = "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const PORT = 9222;
const TARGET_URL = "http://localhost:3000/recert01-browser-runner.html";

async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

async function run() {
  console.log("Iniciando Chromium Real (Headless New, No Sandbox)...");
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
    // 1. Aguarda endpoint HTTP do CDP responder
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
          try {
            const data = JSON.parse(ev.data);
            if (data.id === id) {
              ws.removeEventListener("message", handler);
              if (data.error) reject(new Error(data.error.message));
              else resolve(data.result);
            }
          } catch {}
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    // 2. Aguarda a execução dos 22 testes no navegador real
    console.log("Aguardando conclusão da suíte de 22 testes no V8 real...");
    let testResults: any = null;

    for (let attempts = 0; attempts < 30; attempts++) {
      await sleep(1000);
      const evalRes = await sendCommand("Runtime.evaluate", {
        expression: "window.__BROWSER_CERTIFICATION_RESULTS__",
        returnByValue: true,
      });

      if (evalRes?.result?.value) {
        testResults = evalRes.result.value;
        break;
      }
    }

    ws.close();

    if (!testResults) {
      throw new Error("Timeout: Os testes no navegador não concluíram em 30 segundos.");
    }

    console.log("\n=================================================================");
    console.log("=== RELATÓRIO OFICIAL DE EXECUÇÃO EM CHROMIUM REAL (V8 NATIVO) ===");
    console.log("=================================================================");
    console.log(`Navegador: ${testResults.browser}`);
    console.log(`Total de Testes: ${testResults.totalTests}`);
    console.log(`Testes Aprovados: ${testResults.testsPassed}`);
    console.log(`Testes Falhos: ${testResults.testsFailed}`);
    console.log(`Divergências Determinísticas: ${testResults.deterministicMismatches}`);
    console.log("-----------------------------------------------------------------");

    for (const r of testResults.results) {
      const icon = r.passed ? "✓ PASS" : "✗ FAIL";
      console.log(`[Item ${r.id.toString().padStart(2, "0")}] ${icon} — ${r.name}: ${r.details}`);
    }

    console.log("=================================================================\n");

    if (testResults.testsFailed > 0) {
      process.exit(1);
    }
  } finally {
    chromeProcess.kill("SIGTERM");
  }
}

run().catch(err => {
  console.error("ERRO NA EXECUÇÃO DO BROWSER REAL:", err);
  process.exit(1);
});
