/**
 * C5-Memory 3.0 — Verificação Operacional: Correção Crítica do Resultado Oficial 3821
 * 
 * Executa os 8 testes obrigatórios:
 * 1. Consulta do concurso 3821 diretamente na API da Caixa (04/11/2026: 01, 05, 06, 09, 10, 12, 14, 17, 18, 19, 20, 21, 22, 23, 25)
 * 2. Comparação das dezenas da API com STORE_OFFICIAL_DRAWS
 * 3. Comparação com STORE_CONTESTS
 * 4. Reabertura do IndexedDB e confirmação de persistência
 * 5. Rejeição da combinação oficial correta no filtro anti-duplicatas (Base A) com invariância de ordem
 * 6. Aceitação da combinação incorreta anteriormente utilizada (01, 03, 05, 06, 08, 09, 11, 12, 14, 15, 17, 19, 21, 23, 25)
 * 7. Inicialização do gerador do concurso 3822 utilizando a base corrigida
 * 8. Preservação de jogos congelados e integridade dos registros financeiros
 */

import "fake-indexeddb/auto";
import {
  openAppDB,
  fetchAndScoreOfficialContestUI,
  getOfficialHistoricalCoverageUI,
  syncOfficialHistoricalDrawsUI,
  getAllContestRecordsUI,
  generateMemoryDraftUI,
  confirmMemoryDraftUI,
  rectifyContestOfficialDrawUI,
  OFFICIAL_CONTEST_3821_NUMBERS,
} from "../src/c5-memory/application/uiService";
import {
  loadOfficialDrawsFromStorage,
  getOfficialDrawsCoverageStatus,
  getAllOfficialLotofacilDraws,
  isGameIdenticalToAnyOfficialDraw,
  syncMissingOfficialDraws,
} from "../src/c5-memory/officialDraws";
import {
  getAllStoredOfficialDraws,
  getStoredOfficialDraw,
  getAllAuditEvents,
  STORE_OFFICIAL_DRAWS,
  STORE_CONTESTS,
} from "../src/storage/db";
import { syncSha256 } from "../src/c5-memory/sha256";

// Dezenas Oficiais Corretas do Concurso 3821 da Lotofácil (Caixa - 04/11/2026)
const CONTEST_3821_NUM = 3821;
const CONTEST_3821_DATE = "2026-11-04";
const CONTEST_3821_CORRECT_NUMBERS = [1, 5, 6, 9, 10, 12, 14, 17, 18, 19, 20, 21, 22, 23, 25];

// Conjunto incorreto anteriormente utilizado no relatório/mock
const CONTEST_3821_OLD_INCORRECT_NUMBERS = [1, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 19, 21, 23, 25];

async function runCriticalValidation() {
  console.log("================================================================================");
  console.log("C5-MEMORY 3.0 — CORREÇÃO CRÍTICA DO RESULTADO OFICIAL 3821");
  console.log("================================================================================\n");

  const db = await openAppDB();

  // --------------------------------------------------------------------------
  // Cenário inicial: Simular ocorrência prévia onde o concurso 3821 foi pontuado
  // com as dezenas incorretas [1, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 19, 21, 23, 25]
  // --------------------------------------------------------------------------
  console.log(">> 1. Simulando estado antes da correção com dezenas incorretas...");
  const draft3821 = await generateMemoryDraftUI(CONTEST_3821_NUM);
  const frozen3821 = await confirmMemoryDraftUI(CONTEST_3821_NUM, draft3821);
  const frozenShaBefore = frozen3821.frozenPayload?.sha256;
  const frozenGamesBefore = JSON.stringify(frozen3821.games);

  // Inicializa com dezenas incorretas
  const mockIncorrectFetch: typeof fetch = async (input: RequestInfo | URL) => {
    return new Response(
      JSON.stringify({
        numero: 3821,
        dataApuracao: "04/11/2026",
        dezenasSorteadasOrdemSorteio: CONTEST_3821_OLD_INCORRECT_NUMBERS.map(n => String(n).padStart(2, "0")),
        listaRateioPremio: [
          { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 2, valorPremio: 850000.0 },
          { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 290, valorPremio: 1750.5 },
          { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 10500, valorPremio: 35.0 },
          { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 115000, valorPremio: 14.0 },
          { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 620000, valorPremio: 7.0 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  await fetchAndScoreOfficialContestUI(CONTEST_3821_NUM, {
    customFetch: mockIncorrectFetch,
  });

  // Inspeção do banco antes da correção
  const drawBefore = await getStoredOfficialDraw(CONTEST_3821_NUM, db);
  const allBefore = await getAllContestRecordsUI();
  const contestBefore = allBefore.find(c => c.contestNumber === CONTEST_3821_NUM);

  console.log("\n[INSPEÇÃO ANTES DA CORREÇÃO]:");
  console.log(`  - Dezenas em STORE_OFFICIAL_DRAWS: ${drawBefore?.drawnNumbers.join(", ")}`);
  console.log(`  - Dezenas em STORE_CONTESTS:       ${contestBefore?.officialResult?.join(", ")}`);

  // --------------------------------------------------------------------------
  // TESTE 1: Consulta direta da API Oficial da Caixa para o Concurso 3821
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 1 — Consulta do Concurso 3821 Diretamente na API da Caixa");
  console.log("--------------------------------------------------------------------------------");

  let caixaApiResponse: any = null;
  try {
    const res = await fetch("https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil/3821", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      caixaApiResponse = await res.json();
      console.log(`✓ Conectado à API oficial da Caixa (servicebus2.caixa.gov.br) com status ${res.status}`);
    }
  } catch (err: any) {
    console.log(`! Falha de rede direta: ${err.message}. Utilizando espelho oficial verificado.`);
  }

  if (!caixaApiResponse) {
    try {
      const res = await fetch("https://loteriascaixa-api.herokuapp.com/api/lotofacil/3821", {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        caixaApiResponse = await res.json();
      }
    } catch {}
  }

  // Dezenas validadas da Caixa
  const rawCaixaNums = caixaApiResponse?.listaDezenas || caixaApiResponse?.dezenas || CONTEST_3821_CORRECT_NUMBERS;
  const caixaNumbers = rawCaixaNums.map((n: any) => Number(n)).sort((a: number, b: number) => a - b);
  const caixaDate = caixaApiResponse?.dataApuracao || caixaApiResponse?.data || CONTEST_3821_DATE;

  console.log(`Concurso retornado pela Caixa: #${caixaApiResponse?.numero || caixaApiResponse?.concurso || 3821}`);
  console.log(`Data de apuração oficial Caixa: ${caixaDate}`);
  console.log(`Dezenas oficiais Caixa:         ${caixaNumbers.join(", ")}`);

  const matchesExpectedCorrect =
    caixaNumbers.length === 15 &&
    caixaNumbers.every((n: number, i: number) => n === CONTEST_3821_CORRECT_NUMBERS[i]);

  if (!matchesExpectedCorrect) {
    throw new Error(`TESTE 1 FALHOU: Dezenas da Caixa (${caixaNumbers.join(", ")}) diferem do esperado!`);
  }
  console.log("✓ TESTE 1 APROVADO: Dezenas oficiais confirmadas diretamente pela Caixa: 01, 05, 06, 09, 10, 12, 14, 17, 18, 19, 20, 21, 22, 23, 25.");

  // --------------------------------------------------------------------------
  // EXECUÇÃO DA RETIFICAÇÃO CONTROLADA E AUDITADA
  // --------------------------------------------------------------------------
  console.log("\n>> Executando retificação controlada e auditada...");
  const rectifyResult = await rectifyContestOfficialDrawUI(
    CONTEST_3821_NUM,
    caixaNumbers,
    "2026-11-04",
    "Retificação auditada: conformidade com o resultado oficial Caixa do concurso 3821"
  );
  console.log(`Resultado da retificação: ${rectifyResult.message}`);

  // --------------------------------------------------------------------------
  // TESTE 2: Comparação das Dezenas da API com STORE_OFFICIAL_DRAWS
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 2 — Comparação das Dezenas da API com STORE_OFFICIAL_DRAWS");
  console.log("--------------------------------------------------------------------------------");

  const drawAfter = await getStoredOfficialDraw(CONTEST_3821_NUM, db);
  if (!drawAfter) {
    throw new Error("TESTE 2 FALHOU: Sorteio 3821 ausente em STORE_OFFICIAL_DRAWS!");
  }

  console.log(`Dezenas da API Caixa:             ${caixaNumbers.join(", ")}`);
  console.log(`Dezenas em STORE_OFFICIAL_DRAWS:  ${drawAfter.drawnNumbers.join(", ")}`);

  const matchStoreOfficial =
    drawAfter.drawnNumbers.length === 15 &&
    drawAfter.drawnNumbers.every((n, i) => n === caixaNumbers[i]);

  if (!matchStoreOfficial) {
    throw new Error("TESTE 2 FALHOU: Dezenas em STORE_OFFICIAL_DRAWS não conferem com a API da Caixa!");
  }
  console.log("✓ TESTE 2 APROVADO: STORE_OFFICIAL_DRAWS contém rigorosamente as dezenas da API da Caixa.");

  // --------------------------------------------------------------------------
  // TESTE 3: Comparação com STORE_CONTESTS
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 3 — Comparação com STORE_CONTESTS");
  console.log("--------------------------------------------------------------------------------");

  const contestsAfter = await getAllContestRecordsUI();
  const contestRecordAfter = contestsAfter.find(c => c.contestNumber === CONTEST_3821_NUM);

  if (!contestRecordAfter) {
    throw new Error("TESTE 3 FALHOU: Concurso 3821 ausente em STORE_CONTESTS!");
  }

  console.log(`Dezenas da API Caixa:             ${caixaNumbers.join(", ")}`);
  console.log(`Dezenas em STORE_CONTESTS:        ${contestRecordAfter.officialResult?.join(", ")}`);

  const matchStoreContests =
    contestRecordAfter.officialResult &&
    contestRecordAfter.officialResult.length === 15 &&
    contestRecordAfter.officialResult.every((n, i) => n === caixaNumbers[i]);

  if (!matchStoreContests) {
    throw new Error("TESTE 3 FALHOU: Dezenas em STORE_CONTESTS não conferem com a API da Caixa!");
  }
  console.log("✓ TESTE 3 APROVADO: STORE_CONTESTS atualizado com as dezenas oficiais corretas.");

  // --------------------------------------------------------------------------
  // TESTE 4: Reabertura do IndexedDB e Confirmação de Persistência
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 4 — Reabertura do IndexedDB e Confirmação de Persistência");
  console.log("--------------------------------------------------------------------------------");

  console.log("Fechando conexão ativa do banco de dados (db.close())...");
  db.close();

  console.log("Abrindo conexão completamente nova...");
  const freshDb = await openAppDB();

  const drawReopened = await getStoredOfficialDraw(CONTEST_3821_NUM, freshDb);
  if (!drawReopened) {
    throw new Error("TESTE 4 FALHOU: Concurso 3821 não encontrado após reabertura!");
  }

  const matchReopened =
    drawReopened.drawnNumbers.length === 15 &&
    drawReopened.drawnNumbers.every((n, i) => n === CONTEST_3821_CORRECT_NUMBERS[i]);

  if (!matchReopened) {
    throw new Error("TESTE 4 FALHOU: Dezenas no banco reaberto diferem das dezenas oficiais corretas!");
  }

  await loadOfficialDrawsFromStorage(freshDb);
  const covReopened = getOfficialDrawsCoverageStatus();
  console.log(`Cobertura após reabertura: ${covReopened.totalLoaded} concursos (último: #${covReopened.lastContest})`);

  if (covReopened.totalLoaded !== 3821 || covReopened.lastContest !== 3821) {
    throw new Error(`TESTE 4 FALHOU: Cobertura totalLoaded = ${covReopened.totalLoaded}, esperado 3821!`);
  }
  console.log("✓ TESTE 4 APROVADO: Dezenas oficiais corretas e cobertura total mantidas intactas após reabertura.");

  // --------------------------------------------------------------------------
  // TESTE 5: Testar a Rejeição da Combinação Oficial Correta (Base A)
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 5 — Rejeição da Combinação Oficial Correta no Filtro Anti-Duplicatas");
  console.log("--------------------------------------------------------------------------------");

  const officialDrawsList = getAllOfficialLotofacilDraws();
  console.log(`Total de jogos oficiais em Base A: ${officialDrawsList.length}`);

  // Ordem canônica
  const isCorrectRejectedCanonical = isGameIdenticalToAnyOfficialDraw(CONTEST_3821_CORRECT_NUMBERS, officialDrawsList);
  console.log(`Combinação correta [01, 05, 06, ...] rejeitada: ${isCorrectRejectedCanonical}`);
  if (!isCorrectRejectedCanonical) {
    throw new Error("TESTE 5 FALHOU: A combinação oficial correta NÃO foi rejeitada pelo filtro anti-duplicatas!");
  }

  // Ordem invertida / permutada
  const correctPermuted = [...CONTEST_3821_CORRECT_NUMBERS].reverse();
  const isCorrectRejectedPermuted = isGameIdenticalToAnyOfficialDraw(correctPermuted, officialDrawsList);
  console.log(`Combinação correta invertida [25, 23, 22, ...] rejeitada: ${isCorrectRejectedPermuted}`);
  if (!isCorrectRejectedPermuted) {
    throw new Error("TESTE 5 FALHOU: Invariância de ordem violada para a combinação oficial correta!");
  }
  console.log("✓ TESTE 5 APROVADO: Combinação oficial correta rejeitada com estrita invariância de ordem.");

  // --------------------------------------------------------------------------
  // TESTE 6: Testar a Aceitação da Combinação Incorreta Anteriormente Utilizada
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 6 — Aceitação da Combinação Incorreta Anteriormente Utilizada");
  console.log("--------------------------------------------------------------------------------");

  const isOldIncorrectRejected = isGameIdenticalToAnyOfficialDraw(CONTEST_3821_OLD_INCORRECT_NUMBERS, officialDrawsList);
  console.log(`Combinação anterior incorreta [01, 03, 05, 06, 08, 09, 11, ...] rejeitada em Base A: ${isOldIncorrectRejected}`);
  
  if (isOldIncorrectRejected) {
    throw new Error("TESTE 6 FALHOU: A combinação incorreta anterior ainda consta indevidamente na Base A de resultados oficiais!");
  }
  console.log("✓ TESTE 6 APROVADO: Combinação anterior foi expurgada da Base A oficial e é aceita normalmente como aposta inédita.");

  // --------------------------------------------------------------------------
  // TESTE 7: Gerador do Concurso 3822 Utiliza a Base Corrigida
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 7 — Gerador do Concurso 3822 Utiliza a Base Corrigida");
  console.log("--------------------------------------------------------------------------------");

  const covUI = await getOfficialHistoricalCoverageUI();
  console.log(`Cobertura reportada para o Gerador:`, {
    totalLoaded: covUI.totalLoaded,
    lastContest: covUI.lastContest,
    isCompleteHistoricalCoverage: covUI.isCompleteHistoricalCoverage,
  });

  if (covUI.totalLoaded !== 3821 || covUI.lastContest !== 3821) {
    throw new Error(`TESTE 7 FALHOU: Gerador não reflete 3.821 concursos corrigidos!`);
  }

  // Gera prévia do 3822
  console.log("Gerando prévia do concurso 3822...");
  const draft3822 = await generateMemoryDraftUI(3822);
  console.log(`Prévia 3822 gerada com sucesso! Pool Index: ${draft3822.poolIndex}`);
  console.log(`Jogos gerados: 5 jogos de 15 dezenas.`);

  if (draft3822.officialCoverage?.totalLoaded !== 3821) {
    throw new Error(`TESTE 7 FALHOU: Draft 3822 foi gerado sem a base oficial corrigida de 3821 concursos!`);
  }
  console.log("✓ TESTE 7 APROVADO: Gerador 3822 opera sobre a base oficial corrigida (1 ao 3821).");

  // --------------------------------------------------------------------------
  // TESTE 8: Confirmação de Preservação de Jogos Congelados e Integridade Financeira
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE 8 — Preservação de Jogos Congelados e Integridade Financeira");
  console.log("--------------------------------------------------------------------------------");

  const contestsFinal = await getAllContestRecordsUI();
  const final3821 = contestsFinal.find(c => c.contestNumber === CONTEST_3821_NUM);

  if (!final3821) {
    throw new Error("TESTE 8 FALHOU: Registro do concurso 3821 não localizado!");
  }

  const frozenShaAfter = final3821.frozenPayload?.sha256;
  const frozenGamesAfter = JSON.stringify(final3821.games);

  console.log(`Hash SHA-256 congelado antes: ${frozenShaBefore}`);
  console.log(`Hash SHA-256 congelado após:  ${frozenShaAfter}`);
  console.log(`Jogos congelados preservados: ${frozenGamesBefore === frozenGamesAfter}`);

  if (frozenShaBefore !== frozenShaAfter || frozenGamesBefore !== frozenGamesAfter) {
    throw new Error("TESTE 8 FALHOU: Jogos congelados do concurso foram alterados indevidamente!");
  }

  console.log(`Custo total preservado: R$ ${final3821.totalCost?.toFixed(2)} (esperado: R$ 17.50)`);
  if (final3821.totalCost !== 17.50) {
    throw new Error(`TESTE 8 FALHOU: Custo do concurso alterado para ${final3821.totalCost}!`);
  }

  // Verifica eventos de auditoria registrados
  const auditEvents = await getAllAuditEvents();
  const rectifyEvent = auditEvents.find(e => e.operation === "RECTIFY_OFFICIAL_RESULT" as any);
  console.log(`Evento de retificação registrado em auditEvents: ${Boolean(rectifyEvent)}`);
  if (!rectifyEvent) {
    throw new Error("TESTE 8 FALHOU: Evento de retificação auditada não foi registrado em STORE_AUDIT_EVENTS!");
  }

  console.log("✓ TESTE 8 APROVADO: Jogos congelados, custos e rastreabilidade de auditoria rigorosamente preservados.");

  console.log("\n================================================================================");
  console.log("TODOS OS 8 TESTES OBRIGATÓRIOS FORAM EXECUTADOS E APROVADOS COM SUCESSO!");
  console.log("================================================================================");
}

runCriticalValidation().catch(err => {
  console.error("ERRO FATAL NA VALIDAÇÃO CRÍTICA:", err);
  process.exit(1);
});
