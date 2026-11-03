/**
 * C5-Memory 3.0 — Suíte Canônica de Validação e Homologação Funcional
 * 
 * Verificações Mandatórias (Itens 1 a 10):
 * 1. Geração de exatamente 5 jogos (cada um com 15 dezenas estritamente crescentes em [1..25]).
 * 2. Rejeição de jogos iguais a concursos oficiais anteriores de múltiplos períodos históricos (2003, 2013, 2022, 2026).
 * 3. Rejeição de combinações repetidas no histórico de apostas do usuário (H_gen).
 * 4. Bloqueio e aviso explícito de limitação quando a base oficial estiver incompleta ou parcial.
 * 5. Validação rigorosa da origem e integridade dos dados históricos oficiais (3.816 concursos, data e 15 dezenas).
 * 6. Uso efetivo do mesmo motor e da mesma base pela camada de aplicação operacional.
 * 7. Persistência correta e atômica do histórico H (atualizado com os 5 jogos após confirmação).
 * 8. Funcionamento dos critérios MAX-LEXIMIN e distância combinatória de Johnson (15 - |A ∩ B|).
 * 9. Ausência absoluta de dados demonstrativos e fixtures nos registros operacionais.
 * 10. Conferência de resultados e integridade financeira com quarentena estrita de valores não verificados.
 */

import { C5Game, MemoryHistory, ContestRecord } from "../types";
import {
  ALGORITHM_VERSION_3_0_0,
  generateC5Draft30,
  freezeDraft30,
  selectBestStructuralCandidate30MaxLeximin,
  derivePoolMasterSeed30,
} from "../engine30";
import {
  getAllOfficialLotofacilDraws,
  getOfficialDrawsCoverageStatus,
  validateOfficialDrawRecord,
  findMatchingOfficialDraw,
  isGameIdenticalToAnyOfficialDraw,
  isGameIdenticalToAnyPreviousGame,
  OfficialDrawsCoverageStatus,
  evaluateOfficialDraws,
  computeCanonicalDrawsSha256,
  fetchLatestOfficialLotofacilContest,
  setVerifiedLatestOfficialReference,
  resetOfficialDrawsCache,
  LatestOfficialContestReference,
} from "../officialDraws";
import {
  distanceBetweenGames,
  isValidLotofacilGame,
  computeLeximinProfile,
  compareLeximin,
} from "../math";
import { isStructuralC5 } from "../structuralC5";
import { createMemoryHistory, formatGameCanonical } from "../history";
import {
  reconstructHistoryCrossVersion,
  confirmMemoryBetAtomic210,
  scoreContestAtomic210,
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  STORE_AUDIT_EVENTS,
} from "../../storage/storageManager210";
import {
  buildC5Dashboard,
  buildC5MonthlyReport,
} from "../analytics/c5Analytics";
import { generateMemoryDraft210 } from "../application/service210";

/**
 * Mock IDB com ciclo de microtasks idêntico ao IndexedDB padrão W3C
 */
function createTestMockIDB(
  initialContests: Record<number, ContestRecord> = {},
  initialHistory?: MemoryHistory
) {
  const contestData = new Map<any, any>();
  for (const [k, v] of Object.entries(initialContests)) {
    contestData.set(Number(k), JSON.parse(JSON.stringify(v)));
  }
  const historyData = new Map<any, any>();
  if (initialHistory) {
    historyData.set("singleton", { id: "singleton", history: JSON.parse(JSON.stringify(initialHistory)) });
  }
  const auditData = new Map<any, any>();

  const db = {
    transaction: (storeNames: string[] | string, mode: "readonly" | "readwrite" = "readonly") => {
      let activeOps = 0;
      let isAborted = false;
      let isCompleted = false;

      const tx: any = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort: () => {
          isAborted = true;
          if (tx.onabort) tx.onabort();
        },
        objectStore: (name: string) => {
          const map: Map<any, any> =
            name === STORE_CONTESTS
              ? contestData
              : name === STORE_MEMORY_HISTORY
              ? historyData
              : auditData;

          return {
            get: (key: any) => {
              activeOps++;
              const req: any = { onsuccess: null, onerror: null, result: undefined };
              queueMicrotask(() => {
                if (isAborted) return;
                req.result = map.get(key) ? JSON.parse(JSON.stringify(map.get(key))) : undefined;
                if (req.onsuccess) req.onsuccess();
                activeOps--;
                checkCompletion();
              });
              return req;
            },
            getAll: () => {
              activeOps++;
              const req: any = { onsuccess: null, onerror: null, result: undefined };
              queueMicrotask(() => {
                if (isAborted) return;
                req.result = Array.from(map.values()).map(v => JSON.parse(JSON.stringify(v)));
                if (req.onsuccess) req.onsuccess();
                activeOps--;
                checkCompletion();
              });
              return req;
            },
            put: (val: any) => {
              activeOps++;
              const req: any = { onsuccess: null, onerror: null, result: undefined };
              queueMicrotask(() => {
                if (isAborted) return;
                const k = val.contestNumber !== undefined ? val.contestNumber : val.id !== undefined ? val.id : "singleton";
                map.set(k, JSON.parse(JSON.stringify(val)));
                req.result = k;
                if (req.onsuccess) req.onsuccess();
                activeOps--;
                checkCompletion();
              });
              return req;
            },
          };
        },
      };

      function checkCompletion() {
        queueMicrotask(() => {
          if (!isAborted && !isCompleted && activeOps === 0) {
            isCompleted = true;
            if (tx.oncomplete) tx.oncomplete();
          }
        });
      }

      return tx;
    },
  } as unknown as IDBDatabase;

  return { db, contestData, historyData, auditData };
}

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`ASSERTION_FAILED: ${msg}`);
  }
}

export async function runC5Memory30ValidationSuite(): Promise<{
  passed: number;
  failed: number;
  details: string[];
}> {
  const details: string[] = [];
  let passed = 0;
  let failed = 0;

  function recordSuccess(name: string) {
    passed++;
    details.push(`[PASS] ${name}`);
    console.log(`  ✓ ${name}`);
  }

  function recordFailure(name: string, error: any) {
    failed++;
    const errMsg = error?.message || String(error);
    details.push(`[FAIL] ${name} -> ${errMsg}`);
    console.error(`  ✗ ${name}: ${errMsg}`);
  }

  console.log("=== INICIANDO VALIDAÇÃO CANÔNICA C5-MEMORY 3.0 ===");

  // Carrega base oficial integral
  const allOfficial = getAllOfficialLotofacilDraws();
  const coverage = getOfficialDrawsCoverageStatus();

  // -------------------------------------------------------------
  // TESTE 1: Geração de exatamente 5 jogos (15 dezenas estritamente crescentes em [1..25])
  // -------------------------------------------------------------
  try {
    const emptyHistory = createMemoryHistory([], 0);
    const draft = generateC5Draft30(3501, emptyHistory, allOfficial);

    assert(draft.games.length === 5, "Draft deve conter exatamente 5 jogos");
    assert(draft.algorithmVersion === ALGORITHM_VERSION_3_0_0, "Versão do algoritmo deve ser C5-Memory-3.0");

    for (let i = 0; i < 5; i++) {
      const g = draft.games[i];
      assert(isValidLotofacilGame(g), `Jogo ${i + 1} deve ser um jogo válido da Lotofácil (15 dezenas crescentes [1..25])`);
      assert(g.length === 15, `Jogo ${i + 1} deve conter exatamente 15 números`);
    }

    assert(isStructuralC5(draft.games), "Os 5 jogos devem cumprir rigorosamente o isomorfismo estrutural C5");
    recordSuccess("1. Geração de exatamente 5 jogos válidos de 15 dezenas com estrutura C5");
  } catch (err) {
    recordFailure("1. Geração de exatamente 5 jogos", err);
  }

  // -------------------------------------------------------------
  // TESTE 2: Identificação de duplicatas contra concursos oficiais de diferentes períodos históricos
  // -------------------------------------------------------------
  try {
    // Período 1: Concurso 1 (29/09/2003 - Criação da Lotofácil)
    const draw1 = allOfficial[0];
    assert(isValidLotofacilGame(draw1), "Concurso 1 deve ser válido");
    const match1 = findMatchingOfficialDraw(draw1);
    assert(match1.isMatched === true && match1.contestNumber === 1, "Deve identificar duplicata exata do Concurso 1 (2003)");
    assert(isGameIdenticalToAnyOfficialDraw(draw1, allOfficial), "Detector de duplicata oficial deve confirmar");

    // Período 2: Concurso 1000 (02/01/2014 - Década intermediária)
    const draw1000 = allOfficial[999];
    const match1000 = findMatchingOfficialDraw(draw1000);
    assert(match1000.isMatched === true && match1000.contestNumber === 1000, "Deve identificar duplicata exata do Concurso 1000");

    // Período 3: Concurso 2500 (22/04/2022 - Era moderna)
    const draw2500 = allOfficial[2499];
    const match2500 = findMatchingOfficialDraw(draw2500);
    assert(match2500.isMatched === true && match2500.contestNumber === 2500, "Deve identificar duplicata exata do Concurso 2500");

    // Período 4: Concurso 3816 (28/10/2026 - Concurso mais recente carregado)
    const draw3816 = allOfficial[allOfficial.length - 1];
    const match3816 = findMatchingOfficialDraw(draw3816);
    assert(match3816.isMatched === true && match3816.contestNumber === 3816, "Deve identificar duplicata exata do Concurso 3816 (2026)");

    // Teste 2.2: O motor 3.0 gera jogos que NUNCA coincidem com nenhum dos 3.816 concursos oficiais
    const draft = generateC5Draft30(3817, createMemoryHistory([], 0), allOfficial);
    for (const g of draft.games) {
      assert(
        !isGameIdenticalToAnyOfficialDraw(g, allOfficial),
        `Jogo gerado não pode ser idêntico a nenhum sorteio oficial anterior: ${formatGameCanonical(g)}`
      );
    }

    recordSuccess("2. Identificação de duplicatas contra concursos oficiais de múltiplos períodos históricos (2003 a 2026)");
  } catch (err) {
    recordFailure("2. Identificação de duplicatas contra concursos oficiais", err);
  }

  // -------------------------------------------------------------
  // TESTE 3: Rejeição de combinações repetidas no histórico do usuário (H_gen)
  // -------------------------------------------------------------
  try {
    const draft1 = generateC5Draft30(3501, createMemoryHistory([], 0), allOfficial);
    const historyAfterDraft1 = createMemoryHistory(draft1.games, 1);

    // Teste 3.1: Detector de jogos repetidos em H_gen
    const testGame = draft1.games[0];
    assert(
      isGameIdenticalToAnyPreviousGame(testGame, historyAfterDraft1.games),
      "isGameIdenticalToAnyPreviousGame deve detectar jogo já existente em H"
    );

    // Teste 3.2: Nova geração para concurso 3502 nunca repete nenhum jogo de draft1
    const draft2 = generateC5Draft30(3502, historyAfterDraft1, allOfficial);
    for (const g2 of draft2.games) {
      assert(
        !isGameIdenticalToAnyPreviousGame(g2, historyAfterDraft1.games),
        `Jogo do concurso 3502 não pode ser repetido de H: ${formatGameCanonical(g2)}`
      );
    }

    recordSuccess("3. Rejeição de combinações repetidas no histórico do usuário (H_gen)");
  } catch (err) {
    recordFailure("3. Rejeição de combinações repetidas no histórico do usuário", err);
  }

  // -------------------------------------------------------------
  // TESTE 4: Validação estrita de integridade integral, rejeição de registros inválidos/duplicados, datas impossíveis e verificação dinâmica
  // -------------------------------------------------------------
  try {
    // 4.1 Validação de existência real da data no calendário Gregoriano (além de formato ISO)
    const validLeapDate = { contestNumber: 1, drawDate: "2024-02-29", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] };
    assert(validateOfficialDrawRecord(validLeapDate).valid === true, "29/02 em ano bissexto (2024) deve ser válido");

    const impossibleDateFeb30 = { contestNumber: 1, drawDate: "2024-02-30", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] };
    assert(validateOfficialDrawRecord(impossibleDateFeb30).valid === false, "30 de fevereiro deve ser rejeitado como data impossível");

    const impossibleDateNonLeapFeb29 = { contestNumber: 1, drawDate: "2023-02-29", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] };
    assert(validateOfficialDrawRecord(impossibleDateNonLeapFeb29).valid === false, "29 de fevereiro em ano comum (2023) deve ser rejeitado como data impossível");

    const impossibleDateApr31 = { contestNumber: 1, drawDate: "2026-04-31", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] };
    assert(validateOfficialDrawRecord(impossibleDateApr31).valid === false, "31 de abril deve ser rejeitado como data impossível (abril possui 30 dias)");

    const impossibleDateNov31 = { contestNumber: 1, drawDate: "2026-11-31", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] };
    assert(validateOfficialDrawRecord(impossibleDateNov31).valid === false, "31 de novembro deve ser rejeitado como data impossível (novembro possui 30 dias)");

    // 4.2 Rejeição integral de registros inválidos (sem descarte silencioso; hash não calculado)
    const rawWithInvalidRecord = {
      source: "Teste Rejeição Integral",
      retrievedAt: new Date().toISOString(),
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      draws: [
        { contestNumber: 1, drawDate: "2024-01-01", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
        { contestNumber: 2, drawDate: "2024-01-02", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, // Inválido: apenas 14 dezenas
        { contestNumber: 3, drawDate: "2024-01-03", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
      ],
    };
    const evalInvalid = evaluateOfficialDraws(rawWithInvalidRecord, { expectedLastContest: 3 });
    assert(evalInvalid.draws.length === 0, "Base com registro inválido deve ter todos os sorteios rejeitados (sem descarte silencioso)");
    assert(evalInvalid.coverage.updateVerificationStatus === "INTEGRITY_COMPROMISED", "Status de verificação deve ser INTEGRITY_COMPROMISED");
    assert(evalInvalid.coverage.computedSha256 === "", "Hash SHA-256 NÃO deve ser calculado se houver registro inválido");
    assert(evalInvalid.coverage.isCryptographicallyVerified === false, "isCryptographicallyVerified deve ser FALSE");
    assert(evalInvalid.coverage.isCompleteHistoricalCoverage === false, "isCompleteHistoricalCoverage deve ser FALSE");
    assert(
      evalInvalid.coverage.limitationNotice !== undefined &&
      evalInvalid.coverage.limitationNotice.includes("Registro de sorteio inválido"),
      "Notificação deve detalhar a razão da rejeição integral por registro inválido"
    );

    // 4.3 Rejeição integral de concurso duplicado (sem descarte silencioso; hash não calculado)
    const rawWithDuplicateContest = {
      source: "Teste Concurso Duplicado",
      retrievedAt: new Date().toISOString(),
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      draws: [
        { contestNumber: 1, drawDate: "2024-01-01", drawnNumbers: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
        { contestNumber: 2, drawDate: "2024-01-02", drawnNumbers: [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] },
        { contestNumber: 1, drawDate: "2024-01-03", drawnNumbers: [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, // Concurso 1 duplicado
      ],
    };
    const evalDuplicate = evaluateOfficialDraws(rawWithDuplicateContest, { expectedLastContest: 2 });
    assert(evalDuplicate.draws.length === 0, "Base com concurso duplicado deve ter integridade rejeitada");
    assert(evalDuplicate.coverage.updateVerificationStatus === "INTEGRITY_COMPROMISED", "Status deve ser INTEGRITY_COMPROMISED para concurso duplicado");
    assert(evalDuplicate.coverage.computedSha256 === "", "Hash SHA-256 NÃO deve ser calculado para base com concurso duplicado");
    assert(evalDuplicate.coverage.isCompleteHistoricalCoverage === false, "isCompleteHistoricalCoverage deve ser FALSE para concurso duplicado");
    assert(
      evalDuplicate.coverage.limitationNotice !== undefined &&
      evalDuplicate.coverage.limitationNotice.includes("Concurso duplicado detectado"),
      "Notificação deve informar expressamente o concurso duplicado detectado"
    );

    // 4.4 Identificação dinâmica do último concurso esperado e preservação da geração offline
    // Caso: Sem conexão ou confirmação da Caixa (ambiente offline padrão)
    const rawValidSample = {
      source: "Teste Base Offline",
      retrievedAt: new Date().toISOString(),
      draws: allOfficial.slice(0, 10).map((g, i) => ({
        contestNumber: i + 1,
        drawDate: "2024-01-01",
        drawnNumbers: g,
      })),
    };
    (rawValidSample as any).sha256 = computeCanonicalDrawsSha256(rawValidSample.draws);

    // Avaliação offline sem passar expectedLastContest ou verifiedReference
    const evalOffline = evaluateOfficialDraws(rawValidSample);
    assert(evalOffline.coverage.expectedLastContest === null, "Concurso esperado deve ser null quando offline sem confirmação");
    assert(evalOffline.coverage.updateVerificationStatus === "UNVERIFIED_OFFLINE", "Status deve ser UNVERIFIED_OFFLINE sem confirmação da Caixa");
    assert(evalOffline.coverage.isCoverageUpToDate === false, "isCoverageUpToDate não pode ser TRUE sem confirmação");
    assert(evalOffline.coverage.isCompleteHistoricalCoverage === false, "isCompleteHistoricalCoverage deve ser FALSE sem confirmação");
    assert(
      evalOffline.coverage.limitationNotice !== undefined &&
      evalOffline.coverage.limitationNotice.includes("Atualização não pôde ser verificada"),
      "Aviso deve explicitar que a atualização não pôde ser verificada"
    );

    // Preservação da geração offline com aviso explícito
    const draftOffline = generateC5Draft30(
      3503,
      createMemoryHistory([], 0),
      allOfficial.slice(0, 10),
      evalOffline.coverage
    );
    assert(draftOffline.games.length === 5, "Geração offline deve produzir os 5 jogos normalmente");
    assert(draftOffline.isHistoricalExclusionComplete === false, "Geração offline deve registrar exclusão histórica não comprovada sem confirmação");
    assert(draftOffline.officialCoverage.updateVerificationStatus === "UNVERIFIED_OFFLINE", "Draft deve preservar status UNVERIFIED_OFFLINE");

    // Caso: Com referência confirmada onde a base está desatualizada frente à Caixa
    const outdatedReference: LatestOfficialContestReference = {
      contestNumber: 3820,
      drawDate: "2026-11-02",
      retrievedAt: new Date().toISOString(),
      source: "Caixa Econômica Federal — Portal Oficial",
    };
    const evalWithOutdatedRef = evaluateOfficialDraws(rawValidSample, { verifiedReference: outdatedReference });
    assert(evalWithOutdatedRef.coverage.updateVerificationStatus === "OUTDATED", "Status deve ser OUTDATED quando base for menor que a referência");
    assert(evalWithOutdatedRef.coverage.isCompleteHistoricalCoverage === false, "Cobertura não pode ser completa quando desatualizada");
    assert(
      evalWithOutdatedRef.coverage.limitationNotice !== undefined &&
      evalWithOutdatedRef.coverage.limitationNotice.includes("desatualizada"),
      "Notificação deve detalhar que a base está desatualizada em relação à Caixa"
    );

    // Caso: Com referência confirmada onde a base alcança a Caixa
    const confirmedReference: LatestOfficialContestReference = {
      contestNumber: 10,
      drawDate: "2024-01-10",
      retrievedAt: new Date().toISOString(),
      source: "Caixa Econômica Federal — Portal Oficial",
    };
    const evalWithConfirmedRef = evaluateOfficialDraws(rawValidSample, { verifiedReference: confirmedReference });
    assert(evalWithConfirmedRef.coverage.updateVerificationStatus === "CONFIRMED_UP_TO_DATE", "Status deve ser CONFIRMED_UP_TO_DATE");
    assert(evalWithConfirmedRef.coverage.isCoverageUpToDate === true, "isCoverageUpToDate deve ser TRUE");
    assert(evalWithConfirmedRef.coverage.isCompleteHistoricalCoverage === true, "isCompleteHistoricalCoverage deve ser TRUE quando confirmada");

    // 4.5 Teste do helper fetchLatestOfficialLotofacilContest (mock sucesso e mock falha)
    const mockSuccessFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ numero: 3816, dataApuracao: "28/10/2026" }), { status: 200, statusText: "OK" });

    const refFetched = await fetchLatestOfficialLotofacilContest(mockSuccessFetch);
    assert(refFetched !== null, "fetchLatestOfficialLotofacilContest deve retornar referência válida quando online");
    assert(refFetched?.contestNumber === 3816, "Número retornado pelo mock deve ser 3816");

    const mockFailureFetch: typeof fetch = async () => {
      throw new Error("Network timeout or offline");
    };
    const refFailed = await fetchLatestOfficialLotofacilContest(mockFailureFetch);
    assert(refFailed === null, "fetchLatestOfficialLotofacilContest deve retornar null com segurança em caso de falha de rede");

    // 4.6 Hash divergente ou ausente
    const rawTamperedHash = {
      source: "Teste Hash Divergente",
      retrievedAt: new Date().toISOString(),
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      draws: allOfficial.slice(0, 10).map((g, i) => ({
        contestNumber: i + 1,
        drawDate: "2024-01-01",
        drawnNumbers: g,
      })),
    };
    const evalTampered = evaluateOfficialDraws(rawTamperedHash, { expectedLastContest: 10 });
    assert(evalTampered.coverage.isCryptographicallyVerified === false, "isCryptographicallyVerified deve ser FALSE quando hash diverge");
    assert(evalTampered.coverage.isCompleteHistoricalCoverage === false, "isCompleteHistoricalCoverage deve ser FALSE quando hash diverge");

    recordSuccess("4. Bloqueio e aviso explícito para base desatualizada, registros inválidos, duplicados, datas impossíveis e hash divergente");
  } catch (err) {
    recordFailure("4. Validação estrita de integridade e atualização", err);
  }

  // -------------------------------------------------------------
  // TESTE 5: Validação da origem, procedência e integridade da base integral válida
  // -------------------------------------------------------------
  try {
    // 5.1 Base integral de produção (3.816 concursos)
    assert(allOfficial.length >= 3816, `Base deve conter 3.816 concursos (carregados: ${allOfficial.length})`);

    // 5.2 Validação da base de produção em modo offline (sem confirmação)
    resetOfficialDrawsCache();
    const offlineProdCoverage = getOfficialDrawsCoverageStatus();
    assert(offlineProdCoverage.firstContest === 1, "Primeiro concurso deve ser o número 1");
    assert(offlineProdCoverage.lastContest === 3816, "Último concurso deve ser o número 3816");
    assert(offlineProdCoverage.expectedLastContest === null, "Sem confirmação externa, expectedLastContest deve ser null");
    assert(offlineProdCoverage.updateVerificationStatus === "UNVERIFIED_OFFLINE", "Sem confirmação externa, status deve ser UNVERIFIED_OFFLINE");
    assert(offlineProdCoverage.isCoverageUpToDate === false, "Sem confirmação externa, isCoverageUpToDate deve ser false");
    assert(offlineProdCoverage.isCompleteHistoricalCoverage === false, "Sem confirmação externa, não se declara completa");
    assert(offlineProdCoverage.isCryptographicallyVerified === true, "Integridade criptográfica SHA-256 da base física deve ser válida");
    assert(offlineProdCoverage.declaredSha256 === offlineProdCoverage.computedSha256, "Hash declarado deve coincidir com o computado");

    // 5.3 Validação da base de produção com confirmação ativa da Caixa
    const verifiedRef3816: LatestOfficialContestReference = {
      contestNumber: 3816,
      drawDate: "2026-10-28",
      retrievedAt: new Date().toISOString(),
      source: "Caixa Econômica Federal — Portal Oficial de Loterias",
    };
    setVerifiedLatestOfficialReference(verifiedRef3816);
    const confirmedProdCoverage = getOfficialDrawsCoverageStatus();

    assert(confirmedProdCoverage.expectedLastContest === 3816, "Concurso confirmado deve ser 3816");
    assert(confirmedProdCoverage.updateVerificationStatus === "CONFIRMED_UP_TO_DATE", "Status deve ser CONFIRMED_UP_TO_DATE");
    assert(confirmedProdCoverage.isCoverageUpToDate === true, "isCoverageUpToDate deve ser true quando confirmada");
    assert(confirmedProdCoverage.isCompleteHistoricalCoverage === true, "A base integral confirmada deve ter cobertura completa comprovada");
    assert(confirmedProdCoverage.firstDrawDate === "2003-09-29", "Primeiro sorteio deve ser 29/09/2003");
    assert(confirmedProdCoverage.lastDrawDate === "2026-10-28", "Último sorteio deve ser 28/10/2026");

    // 5.4 Procedência honesta: não declara certificação autônoma da Caixa por si só
    assert(confirmedProdCoverage.provenanceNotice !== undefined && confirmedProdCoverage.provenanceNotice.length > 0, "Deve conter nota explícita de procedência");
    assert(confirmedProdCoverage.source.includes("Caixa Econômica Federal"), "Fonte informada deve ser registrada");

    recordSuccess("5. Validação rigorosa da base integral válida, integridade SHA-256 e procedência declarada");
  } catch (err) {
    recordFailure("5. Validação da origem e integridade dos dados históricos", err);
  }

  // -------------------------------------------------------------
  // TESTE 6: Integração operacional da verificação dinâmica no fluxo real de geração (service210)
  // -------------------------------------------------------------
  try {
    // 6.1 Fluxo com consulta dinâmica confirmada (mock Caixa contest 3816)
    let fetchCallsCount = 0;
    const mockSuccess3816: typeof fetch = async () => {
      fetchCallsCount++;
      return new Response(
        JSON.stringify({ numero: 3816, dataApuracao: "28/10/2026" }),
        { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } }
      );
    };

    const { db: dbConfirmed } = createTestMockIDB({}, createMemoryHistory([], 0));
    const draftConfirmed = await generateMemoryDraft210(3505, dbConfirmed, {
      customFetch: mockSuccess3816,
    });

    assert(fetchCallsCount >= 1, "Fluxo real de geração deve invocar a consulta dinâmica");
    assert(draftConfirmed.games.length === 5, "Draft confirmado deve conter exatamente 5 jogos");
    assert(draftConfirmed.isHistoricalExclusionComplete === true, "Draft confirmado deve ter exclusão completa comprovada");
    assert(draftConfirmed.officialCoverage.updateVerificationStatus === "CONFIRMED_UP_TO_DATE", "Status deve ser CONFIRMED_UP_TO_DATE");
    assert(draftConfirmed.officialCoverage.expectedLastContest === 3816, "expectedLastContest deve ser 3816");
    assert(draftConfirmed.officialCoverage.isCoverageUpToDate === true, "isCoverageUpToDate deve ser TRUE");

    // 6.2 Fluxo quando a consulta falha ou excede timeout (preserva offline com UNVERIFIED_OFFLINE)
    const mockFailureFetch: typeof fetch = async () => {
      throw new Error("Network connection failed / timeout");
    };

    const { db: dbOffline } = createTestMockIDB({}, createMemoryHistory([], 0));
    const draftOffline = await generateMemoryDraft210(3506, dbOffline, {
      customFetch: mockFailureFetch,
      timeoutMs: 500,
    });

    assert(draftOffline.games.length === 5, "Draft offline deve continuar gerando exatamente 5 jogos");
    assert(draftOffline.isHistoricalExclusionComplete === false, "Draft offline não pode ter selo de exclusão completa");
    assert(draftOffline.officialCoverage.updateVerificationStatus === "UNVERIFIED_OFFLINE", "Status deve ser UNVERIFIED_OFFLINE em falha de consulta");
    assert(draftOffline.officialCoverage.isCoverageUpToDate === false, "isCoverageUpToDate deve ser FALSE no modo offline");
    assert(
      draftOffline.officialCoverage.limitationNotice !== undefined &&
      draftOffline.officialCoverage.limitationNotice.includes("Atualização não pôde ser verificada"),
      "Deve conter aviso explícito de atualização não verificada"
    );

    // 6.3 Fluxo diante de referência divergente superior (Caixa = 3820, base local = 3816)
    const mockDivergentHigh: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ numero: 3820, dataApuracao: "02/11/2026" }),
        { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } }
      );
    };

    const { db: dbDivergentHigh } = createTestMockIDB({}, createMemoryHistory([], 0));
    const draftDivergentHigh = await generateMemoryDraft210(3507, dbDivergentHigh, {
      customFetch: mockDivergentHigh,
    });

    assert(draftDivergentHigh.games.length === 5, "Draft com divergência superior deve conter exatamente 5 jogos");
    assert(draftDivergentHigh.isHistoricalExclusionComplete === false, "Divergência superior não pode ter cobertura integral");
    assert(draftDivergentHigh.officialCoverage.updateVerificationStatus === "OUTDATED", "Status deve ser OUTDATED para referência superior");
    assert(draftDivergentHigh.officialCoverage.isCoverageUpToDate === false, "isCoverageUpToDate deve ser FALSE quando desatualizada");
    assert(
      draftDivergentHigh.officialCoverage.limitationNotice !== undefined &&
      draftDivergentHigh.officialCoverage.limitationNotice.includes("desatualizada"),
      "Notificação deve informar que a base está desatualizada frente à Caixa"
    );

    // 6.4 Fluxo diante de referência divergente inferior (Caixa = 3810, base local = 3816)
    const mockDivergentLow: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ numero: 3810, dataApuracao: "20/10/2026" }),
        { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } }
      );
    };

    const { db: dbDivergentLow } = createTestMockIDB({}, createMemoryHistory([], 0));
    const draftDivergentLow = await generateMemoryDraft210(3508, dbDivergentLow, {
      customFetch: mockDivergentLow,
    });

    assert(draftDivergentLow.games.length === 5, "Draft com divergência inferior deve conter exatamente 5 jogos");
    assert(draftDivergentLow.isHistoricalExclusionComplete === false, "Divergência inferior não pode ter cobertura integral");
    assert(draftDivergentLow.officialCoverage.isCoverageUpToDate === false, "isCoverageUpToDate deve ser FALSE em caso de divergência");
    assert(
      draftDivergentLow.officialCoverage.limitationNotice !== undefined &&
      draftDivergentLow.officialCoverage.limitationNotice.includes("Divergência"),
      "Notificação deve sinalizar expressamente a divergência"
    );

    recordSuccess("6. Integração operacional da verificação dinâmica com confirmação, fallback offline, bloqueio de divergência e garantia de 5 jogos");
  } catch (err) {
    recordFailure("6. Integração operacional da verificação dinâmica no fluxo de geração", err);
  }

  // -------------------------------------------------------------
  // TESTE 7: Persistência correta e atômica do histórico H
  // -------------------------------------------------------------
  try {
    const initialHist = createMemoryHistory([], 0);
    const { db } = createTestMockIDB({}, initialHist);

    const draft = generateC5Draft30(3506, initialHist, allOfficial);

    const result = await confirmMemoryBetAtomic210(
      db,
      3506,
      draft as any,
      initialHist.revision,
      initialHist.fingerprint
    );

    assert(result.record.status === "FROZEN", "Registro confirmado deve estar FROZEN");
    assert(result.record.algorithmVersion === ALGORITHM_VERSION_3_0_0, "Versão deve ser C5-Memory-3.0");
    assert(result.updatedHistory.games.length === 5, "H deve ter sido atualizado com exatamente 5 jogos");
    assert(result.updatedHistory.revision === 1, "Revisão de H deve ter sido incrementada para 1");
    assert(result.record.frozenPayload?.sha256.length === 64, "Hash SHA-256 canônico deve ter 64 caracteres hex");

    recordSuccess("7. Persistência correta e atômica do histórico H");
  } catch (err) {
    recordFailure("7. Persistência correta do histórico", err);
  }

  // -------------------------------------------------------------
  // TESTE 8: Critérios MAX-LEXIMIN e distância de Johnson
  // -------------------------------------------------------------
  try {
    const gA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const gB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]; // d = 1
    const gC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20]; // d = 5

    assert(distanceBetweenGames(gA, gB) === 1, "Distância de Johnson gA e gB = 15 - 14 = 1");
    assert(distanceBetweenGames(gA, gC) === 5, "Distância de Johnson gA e gC = 15 - 10 = 5");

    const profB = computeLeximinProfile([gB], [gA]);
    const profC = computeLeximinProfile([gC], [gA]);

    assert(profB[0] === 1, "Distância mínima de gB ao histórico {gA} é 1");
    assert(profC[0] === 5, "Distância mínima de gC ao histórico {gA} é 5");
    assert(compareLeximin(profC, profB) > 0, "MAX-LEXIMIN prefere perfil com maior distância mínima ([5] > [1])");

    recordSuccess("8. Critérios MAX-LEXIMIN e distância de Johnson validados");
  } catch (err) {
    recordFailure("8. Critérios MAX-LEXIMIN e distância de Johnson", err);
  }

  // -------------------------------------------------------------
  // TESTE 9: Ausência de dados demonstrativos e fixtures nos registros operacionais
  // -------------------------------------------------------------
  try {
    const demoRecord: ContestRecord = {
      contestNumber: 9999,
      contestDate: "2026-01-01",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: [],
      totalCost: 17.50,
      totalPrize: 100.00,
      isDemo: true,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    };

    const fixtureRecord: ContestRecord = {
      contestNumber: 9998,
      contestDate: "2026-01-02",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.1.0",
      games: [],
      totalCost: 15.00,
      totalPrize: 36.00,
      isFixture: true,
      createdAt: "2026-01-02T10:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    };

    const realRecord: ContestRecord = {
      contestNumber: 3501,
      contestDate: "2026-10-29",
      status: "COMPLETED",
      algorithmVersion: ALGORITHM_VERSION_3_0_0,
      games: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
      totalCost: 17.50,
      totalPrize: 0,
      createdAt: "2026-10-29T10:00:00.000Z",
      updatedAt: "2026-10-29T10:00:00.000Z",
    };

    const allContests = [demoRecord, fixtureRecord, realRecord];

    const hist = reconstructHistoryCrossVersion(allContests);
    assert(hist.games.length === 1, "H reconstruído só deve conter jogos do concurso real");
    assert(hist.revision === 1, "Revisão deve ser 1");

    const dashboard = buildC5Dashboard(allContests);
    assert(dashboard.totalCost === 17.50, "Total gasto no dashboard deve ignorar demo e fixtures");
    assert(dashboard.scoredContests === 0, "Sem concurso apurado completo com resultado");

    recordSuccess("9. Exclusão absoluta de registros demo e fixture da operação real");
  } catch (err) {
    recordFailure("9. Ausência de dados demonstrativos", err);
  }

  // -------------------------------------------------------------
  // TESTE 10: Conferência financeira com segregação estrita de valores em quarentena
  // -------------------------------------------------------------
  try {
    const valid5Games: C5Game[] = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21, 22, 23, 24],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20, 25],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 17, 25],
    ];

    const testRecord: ContestRecord = {
      contestNumber: 3502,
      contestDate: "2026-10-29",
      status: "COMPLETED",
      algorithmVersion: ALGORITHM_VERSION_3_0_0,
      games: valid5Games,
      officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      gameHits: [15, 11, 10, 13, 12],
      bestHits: 15,
      totalCost: 17.50,
      totalPrize: 7.00 + 14.00 + 35.00,
      officialConfirmedPrize: 56.00,
      manualInformedPrize: 1500000.00,
      prizeBreakdown: {
        "15": {
          count: 1,
          unitValue: 1500000.00,
          totalValue: 1500000.00,
          isVariableRateio: true,
          pendingRateio: true,
          confirmationSource: "MANUAL_ENTRY",
          operatorId: "AUDITOR_TEST",
        },
      },
      hasPendingVariableRateio: true,
      financialStatus: "PENDING_HOMOLOGATION",
      resultSource: "MANUAL_CONFERENCE",
      resultConfirmed: true,
      resultConfirmedBy: "CONFERENTE_AUDIT",
      resultConfirmedAt: "2026-10-29T20:00:00.000Z",
      createdAt: "2026-10-29T10:00:00.000Z",
      updatedAt: "2026-10-29T10:00:00.000Z",
    };

    // Estado 1: PENDING_HOMOLOGATION (Quarentena: zero contaminação nos prêmios oficiais confirmados)
    const reportPending = buildC5MonthlyReport([testRecord], 2026, 10);
    assert(reportPending.totalCost === 17.50, "Despesas totais = R$ 17,50");
    assert(
      reportPending.officialTotalPrize === 0,
      "Em PENDING_HOMOLOGATION, prêmios confirmados oficiais devem ser estritamente R$ 0,00"
    );
    assert(
      reportPending.manualInformedPrize === 1500000.00,
      "Valor não verificado fica devidamente segregado em quarentena como manualInformedPrize"
    );

    // Estado 2: HOMOLOGATED (Comprovação humana válida: prêmios fixos estatutários confirmados)
    const homologatedRecord: ContestRecord = {
      ...testRecord,
      financialStatus: "HOMOLOGATED",
    };
    const reportHomologated = buildC5MonthlyReport([homologatedRecord], 2026, 10);
    assert(
      reportHomologated.officialTotalPrize === 56.00,
      "Quando HOMOLOGATED, prêmios fixos oficiais são confirmados (7 + 14 + 35 = 56,00)"
    );
    assert(
      reportHomologated.hasPendingVariableRateio === true,
      "Faixa 15 permanece corretamente identificada como rateio variável pendente"
    );

    recordSuccess("10. Conferência financeira com segregação estrita de valores em quarentena");
  } catch (err) {
    recordFailure("10. Conferência de resultados e financeiros", err);
  }

  console.log(`\n=== RESUMO: ${passed} PASSOU, ${failed} FALHOU ===\n`);

  return { passed, failed, details };
}

// Execução direta via CLI se chamado via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  runC5Memory30ValidationSuite()
    .then(res => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch(err => {
      console.error("FATAL ERROR IN SUITE:", err);
      process.exit(1);
    });
}
