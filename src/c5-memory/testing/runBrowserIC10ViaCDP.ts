/**
 * Executa a Suíte Oficial do Checkpoint IC10 em Chromium Real via CDP
 * Ordem Executiva IC10 — Definitive Longitudinal Research
 */

import { spawn } from "node:child_process";

const CHROME_PATH = "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const PORT = 9222;
const TARGET_URL = "http://localhost:3000/recert10-browser-runner-ic10.html";

async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

async function run() {
  console.log("Iniciando Chromium Real para testes da Pesquisa Definitiva IC10...");

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
      ws.onerror = err => reject(err);
    });

    let msgId = 1;
    function sendCommand(method: string, params: any = {}): Promise<any> {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        const handler = (evt: MessageEvent) => {
          const data = JSON.parse(evt.data.toString());
          if (data.id === id) {
            ws.removeEventListener("message", handler);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCommand("Runtime.enable");

    // Aguarda execução dos testes no navegador
    let testResults: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const evalRes = await sendCommand("Runtime.evaluate", {
        expression: "window.__IC10_BROWSER_RESULTS__",
        returnByValue: true,
      });
      if (evalRes.result && evalRes.result.value) {
        testResults = evalRes.result.value;
        break;
      }
    }

    if (!testResults) {
      throw new Error("Timeout aguardando window.__IC10_BROWSER_RESULTS__ no Chromium.");
    }

    console.log("\n--- RESULTADOS DOS ENSAIOS IC10 NO CHROMIUM REAL ---");
    for (const r of testResults.results) {
      console.log(`[${r.passed ? "PASS" : "FAIL"}] #${r.id} ${r.name}: ${r.details}`);
    }

    ws.close();
    chromeProcess.kill();

    if (!testResults.allPassed) {
      console.error("\n❌ FALHA: Nem todos os testes passaram no Chromium Real.");
      process.exit(1);
    }

    console.log("\n✅ SUCESSO: Todos os testes IC10 passaram no Chromium Real via CDP!");
    process.exit(0);
  } catch (err) {
    console.error("Erro durante execução CDP do IC10:", err);
    chromeProcess.kill();
    process.exit(1);
  }
}

run();
