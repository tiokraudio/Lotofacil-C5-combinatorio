/**
 * Executor CDP para Validação em Chromium Real (IndexedDB Nativo, WebCrypto, Atomicidade)
 * 
 * Lança o Chromium real de teste instalado pelo Playwright, conecta via CDP
 * e executa a suíte de persistência real e atomicidade.
 */

import { spawn } from "node:child_process";

const CHROME_PATH = "/ms-playwright/chromium-1248/chrome-linux64/chrome";
const PORT = 9222;
const TARGET_URL = "http://localhost:3000/validate-real-indexeddb-30.html";

async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

async function runBrowserTest() {
  console.log("Iniciando Chromium Real (Headless New, No Sandbox)...");
  console.log(`Binário: ${CHROME_PATH}`);
  console.log(`URL Alvo: ${TARGET_URL}`);

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
      ws.onerror = err => reject(err);
    });

    let msgId = 1;
    function sendCommand(method: string, params: any = {}): Promise<any> {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        const handler = (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data.toString());
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

    // Ativa Runtime para capturar console logs do navegador
    await sendCommand("Runtime.enable");

    ws.addEventListener("message", (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data.toString());
        if (data.method === "Runtime.consoleAPICalled") {
          const args = data.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ");
          console.log(`[BROWSER CONSOLE] ${args}`);
        }
      } catch {}
    });

    // 2. Aguarda a execução dos testes no IndexedDB real
    console.log("Aguardando conclusão dos testes no IndexedDB real...");
    let testResults: any = null;

    for (let attempts = 0; attempts < 40; attempts++) {
      await sleep(1000);
      const evalRes = await sendCommand("Runtime.evaluate", {
        expression: "window.__REAL_INDEXEDDB_RESULTS__",
        returnByValue: true,
      });

      if (evalRes?.result?.value) {
        testResults = evalRes.result.value;
        break;
      }
    }

    if (!testResults) {
      throw new Error("Tempo limite excedido aguardando resultados do Chromium Real.");
    }

    console.log("\n================================================================================");
    console.log("RELATÓRIO RECEBIDO DO CHROMIUM REAL (V8 / Native IndexedDB / WebCrypto)");
    console.log("================================================================================");
    console.log(`Database Engine: ${testResults.databaseEngine}`);
    console.log(`User Agent: ${testResults.userAgent}`);
    console.log(`Todos os testes passaram: ${testResults.allChecksPassed}`);
    console.log("\n--- DETALHES DO CICLO DE PERSISTÊNCIA (10 PASSOS) ---");
    console.log(`• Passo 1 (Banco limpo): ${testResults.persistenceCycle.step1_databaseDeleted}`);
    console.log(`• Passo 2 (IndexedDB aberto): ${testResults.persistenceCycle.step2_databaseOpened}`);
    console.log(`• Passo 3 (5 Jogos gerados): ${testResults.persistenceCycle.step3_fiveGamesGenerated.length} jogos, Algoritmo: ${testResults.persistenceCycle.step3_draftAlgorithm}`);
    console.log(`  Perfil Leximin: [${testResults.persistenceCycle.step3_leximinProfile.join(", ")}]`);
    console.log(`• Passo 4 (Congelamento atômico): status="${testResults.persistenceCycle.step4_frozenStatus}"`);
    console.log(`• Passo 5 (SHA-256 antes): ${testResults.persistenceCycle.step5_shaBefore}`);
    console.log(`• Passo 6 (Contexto fechado e reaberto): ${testResults.persistenceCycle.step6_databaseClosedAndReopened}`);
    console.log(`• Passo 8 (5 Jogos recuperados do disco): ${testResults.persistenceCycle.step8_fiveGamesRetrieved.length} jogos`);
    testResults.persistenceCycle.step8_fiveGamesRetrieved.forEach((g: number[], i: number) => {
      console.log(`    Jogo ${i + 1}: [${g.map(n => String(n).padStart(2, "0")).join(", ")}]`);
    });
    console.log(`• Passo 9 (SHA-256 após reabertura): ${testResults.persistenceCycle.step9_shaAfter}`);
    console.log(`  SHA-256 Recalculado (WebCrypto):   ${testResults.persistenceCycle.step9_shaRecalculatedWebCrypto}`);
    console.log(`  SHA-256 Recalculado (Sync):        ${testResults.persistenceCycle.step9_shaRecalculatedSync}`);
    console.log(`• Passo 10 (Hashes idênticos): ${testResults.persistenceCycle.step10_shaEqual}`);
    console.log(`  Jogos 100% idênticos: ${testResults.persistenceCycle.step10_gamesIdentical}`);
    console.log(`  Histórico H no disco: ${testResults.persistenceCycle.step10_historyGamesCount} jogos, Revisão: #${testResults.persistenceCycle.step10_historyRevision}`);

    console.log("\n--- DETALHES DA VALIDAÇÃO DE ATOMICIDADE ---");
    console.log(`• Falha simulada: ${testResults.atomicityValidation.failureSimulated}`);
    console.log(`• Transação abortada via tx.abort(): ${testResults.atomicityValidation.transactionAborted}`);
    console.log(`• Mensagem de aborto: "${testResults.atomicityValidation.abortErrorMessage}"`);
    console.log(`• Concurso alvo 3821 ficou congelado isoladamente? ${testResults.atomicityValidation.targetContestFrozen ? "SIM (ERRO)" : "NÃO (CORRETO)"}`);
    console.log(`• Estado do concurso alvo: ${testResults.atomicityValidation.targetContestStateAfterAbort}`);
    console.log(`• Jogos em H após abort: ${testResults.atomicityValidation.historyGamesCountAfterAbort} (mantido original: ${testResults.atomicityValidation.initialGamesCount})`);
    console.log(`• Revisão de H após abort: #${testResults.atomicityValidation.historyRevisionAfterAbort} (mantida original: #${testResults.atomicityValidation.initialRevision})`);
    console.log(`• Concurso anterior 3820 intacto: ${testResults.atomicityValidation.previousContestIntact}`);
    console.log(`• Atomicidade preservada: ${testResults.atomicityValidation.atomicityPreserved}`);

    console.log("\n--- DETALHES DA CONSULTA REAL À CAIXA ---");
    console.log(`• Horário da tentativa: ${testResults.officialCaixaQuery.attemptedAt}`);
    console.log(`• Endpoint Primário (Caixa): ${testResults.officialCaixaQuery.primaryEndpoint}`);
    console.log(`  Status HTTP: ${testResults.officialCaixaQuery.primaryStatus}`);
    console.log(`  Origem: ${testResults.officialCaixaQuery.primaryOrigin}`);
    console.log(`  Concurso Apurado: #${testResults.officialCaixaQuery.primaryContestNumber}`);
    console.log(`  Data do Sorteio: ${testResults.officialCaixaQuery.primaryDrawDate}`);
    if (testResults.officialCaixaQuery.primaryDrawnNumbers) {
      console.log(`  Dezenas: [${testResults.officialCaixaQuery.primaryDrawnNumbers.join(", ")}]`);
    }
    console.log(`• Endpoint Secundário (Espelho): ${testResults.officialCaixaQuery.secondaryEndpoint}`);
    console.log(`  Status HTTP: ${testResults.officialCaixaQuery.secondaryStatus}`);
    console.log(`  Concurso Retornado: #${testResults.officialCaixaQuery.secondaryContestNumber}`);
    console.log(`• Modo Offline Separado Validado:`);
    console.log(`  Gerou 5 jogos offline: ${testResults.officialCaixaQuery.offlineFallbackVerified.generatedFiveGames}`);
    console.log(`  Exclusão histórica completa (false): ${testResults.officialCaixaQuery.offlineFallbackVerified.isHistoricalExclusionComplete}`);
    console.log(`  Status da Cobertura: ${testResults.officialCaixaQuery.offlineFallbackVerified.updateVerificationStatus}`);
    console.log(`  Aviso registrado: "${testResults.officialCaixaQuery.offlineFallbackVerified.limitationNotice}"`);

    ws.close();
    chromeProcess.kill("SIGTERM");

    if (!testResults.allChecksPassed) {
      console.error("\nFALHA: Nem todos os critérios foram atendidos!");
      process.exit(1);
    }

    console.log("\nSUCESSO: Validação com IndexedDB Real, Atomicidade e Consulta Caixa concluída com êxito!");
    process.exit(0);
  } catch (err: any) {
    console.error("Erro fatal na execução do Chromium:", err);
    try {
      chromeProcess.kill("SIGKILL");
    } catch {}
    process.exit(1);
  }
}

runBrowserTest();
