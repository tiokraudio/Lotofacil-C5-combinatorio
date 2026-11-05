/**
 * C5-Memory 3.0 — Verificação Operacional: Sincronização e Persistência da Base Histórica
 * Caso Real: Concurso 3821
 * 
 * Executa os 6 testes obrigatórios:
 * Teste A: Persistência da Conferência (gravação imediata em STORE_OFFICIAL_DRAWS)
 * Teste B: Sobrevivência à Reinicialização (close/open da conexão DB e persistência de 3821)
 * Teste C: Sincronização Incremental (busca, persistência e releitura direta de confirmação)
 * Teste D: Inicialização do Gerador (concurso 3822 exibe 3.821 concursos, não 3.816)
 * Teste E: Exclusão Histórica com 3821 (rejeição de jogo idêntico em qualquer ordem de dezenas)
 * Teste F: Persistência entre Telas (consistência de cobertura entre Gerador, Conferência e Histórico)
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
} from "../src/c5-memory/application/uiService";
import {
  loadOfficialDrawsFromStorage,
  getOfficialDrawsCoverageStatus,
  getAllOfficialLotofacilDraws,
  isGameIdenticalToAnyOfficialDraw,
  syncMissingOfficialDraws,
  OfficialLotofacilDrawRecord,
} from "../src/c5-memory/officialDraws";
import {
  getAllStoredOfficialDraws,
  getStoredOfficialDraw,
  STORE_OFFICIAL_DRAWS,
  STORE_CONTESTS,
} from "../src/storage/db";
import { syncSha256 } from "../src/c5-memory/sha256";
import { formatGameCanonical } from "../src/c5-memory/history";

// Dados Oficiais Reais do Concurso 3821 da Lotofácil (Caixa)
const CONTEST_3821_NUM = 3821;
const CONTEST_3821_DATE = "2026-11-04";
const CONTEST_3821_DRAWN_NUMBERS = [1, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 19, 21, 23, 25];

async function runVerification() {
  console.log("================================================================================");
  console.log("C5-MEMORY 3.0 — VALIDAÇÃO DE SINCRONIZAÇÃO E PERSISTÊNCIA (CASO REAL 3821)");
  console.log("================================================================================\n");

  const db = await openAppDB();

  // --------------------------------------------------------------------------
  // Preparação: Criar e congelar aposta para o concurso 3821
  // --------------------------------------------------------------------------
  console.log(">> Preparando Concurso 3821 (FROZEN)...");
  const draft3821 = await generateMemoryDraftUI(CONTEST_3821_NUM);
  const frozen3821 = await confirmMemoryDraftUI(CONTEST_3821_NUM, draft3821);
  console.log(`✓ Concurso 3821 congelado com sucesso (SHA-256: ${frozen3821.frozenPayload?.sha256})`);

  // Mock fetch para a API da Caixa retornando o resultado oficial de 3821
  const mockCaixaFetch: typeof fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("lotofacil/3821") || (url.includes("servicebus2.caixa.gov.br") && url.endsWith("3821"))) {
      return new Response(
        JSON.stringify({
          numero: 3821,
          dataApuracao: "04/11/2026",
          dezenasSorteadasOrdemSorteio: CONTEST_3821_DRAWN_NUMBERS.map(n => String(n).padStart(2, "0")),
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
    }

    if (url.endsWith("lotofacil") || url.endsWith("latest")) {
      return new Response(
        JSON.stringify({
          numero: 3821,
          dataApuracao: "04/11/2026",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({}), { status: 404 });
  };

  // --------------------------------------------------------------------------
  // TESTE A: Persistência da Conferência em STORE_OFFICIAL_DRAWS
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE A — Persistência da Conferência em STORE_OFFICIAL_DRAWS");
  console.log("--------------------------------------------------------------------------------");
  
  const scoreResult = await fetchAndScoreOfficialContestUI(CONTEST_3821_NUM, {
    customFetch: mockCaixaFetch,
  });
  console.log(`Status da conferência: ${scoreResult.record.status} / ${scoreResult.record.financialStatus}`);
  console.log(`Dezenas oficiais homologadas: ${scoreResult.record.officialResult?.join(", ")}`);

  // Consulta direta em STORE_OFFICIAL_DRAWS
  const draw3821 = await getStoredOfficialDraw(CONTEST_3821_NUM, db);
  if (!draw3821) {
    throw new Error("TESTE A FALHOU: Concurso 3821 NÃO foi encontrado em STORE_OFFICIAL_DRAWS!");
  }

  const draw3821Hash = syncSha256(
    `${draw3821.contestNumber}:${draw3821.drawDate}:${draw3821.drawnNumbers.join(",")}`
  );

  console.log("\n[EVIDÊNCIA TESTE A] Registro persistido em STORE_OFFICIAL_DRAWS:");
  console.log(`  - Número do Concurso: #${draw3821.contestNumber}`);
  console.log(`  - Data do Sorteio: ${draw3821.drawDate}`);
  console.log(`  - Dezenas Oficiais: ${draw3821.drawnNumbers.join(", ")}`);
  console.log(`  - Fonte Registrada: ${draw3821.source}`);
  console.log(`  - Hash SHA-256 Canônico: ${draw3821Hash}`);
  console.log("✓ TESTE A APROVADO: Concurso 3821 gravado imediatamente em STORE_OFFICIAL_DRAWS.");

  // --------------------------------------------------------------------------
  // TESTE B: Sobrevivência à Reinicialização do Banco de Dados
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE B — Sobrevivência à Reinicialização do Banco de Dados");
  console.log("--------------------------------------------------------------------------------");
  
  console.log("Fechando conexão ativa do banco de dados (db.close())...");
  db.close();

  console.log("Abrindo conexão completamente nova...");
  const freshDb = await openAppDB();

  const storedAfterReopen = await getAllStoredOfficialDraws(freshDb);
  const found3821 = storedAfterReopen.find(d => d.contestNumber === CONTEST_3821_NUM);
  
  if (!found3821) {
    throw new Error("TESTE B FALHOU: Concurso 3821 desapareceu após reabrir a conexão do banco!");
  }

  // Carrega e valida cobertura com a nova conexão
  await loadOfficialDrawsFromStorage(freshDb);
  const covAfterReopen = getOfficialDrawsCoverageStatus();

  console.log(`Total de sorteios em STORE_OFFICIAL_DRAWS: ${storedAfterReopen.length}`);
  console.log(`Total consolidado na base histórica: ${covAfterReopen.totalLoaded}`);
  console.log(`Último concurso na base: #${covAfterReopen.lastContest}`);

  if (covAfterReopen.totalLoaded !== 3821 || covAfterReopen.lastContest !== 3821) {
    throw new Error(
      `TESTE B FALHOU: Cobertura divergente! Esperado 3821 concursos carregados, obtido ${covAfterReopen.totalLoaded}.`
    );
  }

  console.log("✓ TESTE B APROVADO: Concurso 3821 sobreviveu intacto à reabertura da conexão (3.821 concursos).");

  // --------------------------------------------------------------------------
  // TESTE C: Sincronização Incremental com Releitura e Validação
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE C — Sincronização Incremental com Releitura Direta do IndexedDB");
  console.log("--------------------------------------------------------------------------------");

  const syncResult = await syncMissingOfficialDraws(freshDb, mockCaixaFetch);
  console.log(`Resultado da Sincronização:`, {
    success: syncResult.success,
    syncedCount: syncResult.syncedCount,
    lastContest: syncResult.lastContest,
    isCoverageUpToDate: syncResult.isCoverageUpToDate,
    isCompleteHistoricalCoverage: syncResult.isCompleteHistoricalCoverage,
  });

  if (!syncResult.success) {
    throw new Error(`TESTE C FALHOU: syncMissingOfficialDraws retornou falha: ${syncResult.reason}`);
  }

  // Reler diretamente do banco para comprovar que STORE_OFFICIAL_DRAWS contém 3821
  const directRead = await getAllStoredOfficialDraws(freshDb);
  const has3821Direct = directRead.some(d => d.contestNumber === 3821);
  if (!has3821Direct) {
    throw new Error("TESTE C FALHOU: Releitura direta de STORE_OFFICIAL_DRAWS não contém 3821!");
  }

  console.log("✓ TESTE C APROVADO: Sincronização incremental com persistência comprovada via releitura direta.");

  // --------------------------------------------------------------------------
  // TESTE D: Inicialização do Gerador para o Concurso 3822
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE D — Inicialização do Gerador para o Concurso 3822");
  console.log("--------------------------------------------------------------------------------");

  const covUI = await getOfficialHistoricalCoverageUI();
  console.log(`Status reportado pelo Gerador:`);
  console.log(`  - Concursos Carregados: ${covUI.totalLoaded}`);
  console.log(`  - Primeiro Concurso: #${covUI.firstContest}`);
  console.log(`  - Último Concurso: #${covUI.lastContest}`);
  console.log(`  - Status de Atualização: ${covUI.updateVerificationStatus}`);
  console.log(`  - Cobertura Completa Confirmada: ${covUI.isCompleteHistoricalCoverage}`);

  if (covUI.totalLoaded === 3816 || covUI.lastContest === 3816) {
    throw new Error("TESTE D FALHOU: Gerador está exibindo 3.816 concursos ao invés da contagem real 3.821!");
  }
  if (covUI.totalLoaded !== 3821 || covUI.lastContest !== 3821) {
    throw new Error(`TESTE D FALHOU: Esperado 3.821 concursos, obtido ${covUI.totalLoaded} (último: ${covUI.lastContest}).`);
  }

  console.log("✓ TESTE D APROVADO: Gerador inicializa com contagem real 3.821 (cobertura 1 ao 3821).");

  // --------------------------------------------------------------------------
  // TESTE E: Exclusão Histórica com o 3821 (Filtro Anti-Duplicatas e Invariância de Ordem)
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE E — Exclusão Histórica com o 3821 (Filtro Anti-Duplicatas)");
  console.log("--------------------------------------------------------------------------------");

  const allOfficial = getAllOfficialLotofacilDraws();
  console.log(`Total de combinações oficiais na Base A: ${allOfficial.length}`);

  // Teste 1: Jogo idêntico em ordem canônica
  const gameIdenticalCanonical = [...CONTEST_3821_DRAWN_NUMBERS];
  const isRejectedCanonical = isGameIdenticalToAnyOfficialDraw(gameIdenticalCanonical, allOfficial);
  console.log(`Combinação idêntica (ordem canônica) rejeitada: ${isRejectedCanonical}`);
  if (!isRejectedCanonical) {
    throw new Error("TESTE E FALHOU: Jogo idêntico ao concurso 3821 NÃO foi rejeitado pela Base A!");
  }

  // Teste 2: Jogo idêntico com dezenas embaralhadas/invertidas
  const gameIdenticalPermuted = [...CONTEST_3821_DRAWN_NUMBERS].reverse();
  const isRejectedPermuted = isGameIdenticalToAnyOfficialDraw(gameIdenticalPermuted, allOfficial);
  console.log(`Combinação idêntica (ordem invertida) rejeitada: ${isRejectedPermuted}`);
  if (!isRejectedPermuted) {
    throw new Error("TESTE E FALHOU: Invariância de ordem violada! Jogo com dezenas invertidas não foi rejeitado!");
  }

  // Teste 3: Jogo ligeiramente diferente (14 dezenas em comum, 1 diferente)
  // Troca a dezena 25 pela 2
  const game14Matches = [1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 19, 21, 23];
  const isRejected14 = isGameIdenticalToAnyOfficialDraw(game14Matches, allOfficial);
  console.log(`Combinação distinta com 14 acertos rejeitada: ${isRejected14} (esperado: false)`);
  if (isRejected14) {
    throw new Error("TESTE E FALHOU: Jogo distinto de 14 acertos foi indevidamente rejeitado como duplicata!");
  }

  console.log("✓ TESTE E APROVADO: Filtro anti-duplicatas rejeita o 3821 com estrita invariância de ordem.");

  // --------------------------------------------------------------------------
  // TESTE F: Consistência de Persistência entre Telas
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TESTE F — Consistência de Persistência entre Telas");
  console.log("--------------------------------------------------------------------------------");

  // 1. Tela Histórico: lê todos os registros
  const historyRecords = await getAllContestRecordsUI();
  const contest3821InHistory = historyRecords.find(r => r.contestNumber === 3821);
  if (!contest3821InHistory || contest3821InHistory.status !== "COMPLETED") {
    throw new Error("TESTE F FALHOU: Concurso 3821 não encontrado com status COMPLETED no histórico!");
  }
  console.log(`Tela Histórico: Concurso 3821 presente com status COMPLETED.`);

  // 2. Tela Gerador: gera draft 3822
  console.log("Tela Gerador: Gerando prévia para Concurso 3822...");
  const draft3822 = await generateMemoryDraftUI(3822);
  console.log(`Prévia 3822 gerada com sucesso! Pool Index: ${draft3822.poolIndex}`);
  console.log(`Cobertura oficial associada ao draft 3822:`, {
    totalLoaded: draft3822.officialCoverage?.totalLoaded,
    lastContest: draft3822.officialCoverage?.lastContest,
  });

  if (draft3822.officialCoverage?.totalLoaded !== 3821) {
    throw new Error(`TESTE F FALHOU: Draft 3822 possui totalLoaded = ${draft3822.officialCoverage?.totalLoaded}, esperado 3821.`);
  }

  // 3. Tela Conferência: verifica dados
  const covConf = await getOfficialHistoricalCoverageUI();
  if (covConf.totalLoaded !== 3821 || covConf.lastContest !== 3821) {
    throw new Error(`TESTE F FALHOU: Tela Conferência exibe cobertura inconsistente (${covConf.totalLoaded}).`);
  }
  console.log(`Tela Conferência: Cobertura confirmada (${covConf.totalLoaded} concursos, 1 ao ${covConf.lastContest}).`);

  console.log("✓ TESTE F APROVADO: Cobertura histórica idêntica e consistente em todas as telas.");

  console.log("\n================================================================================");
  console.log("TODOS OS 6 TESTES OBRIGATÓRIOS FORAM EXECUTADOS E APROVADOS COM SUCESSO!");
  console.log("================================================================================");
}

runVerification().catch(err => {
  console.error("ERRO FATAL NA VALIDAÇÃO:", err);
  process.exit(1);
});
