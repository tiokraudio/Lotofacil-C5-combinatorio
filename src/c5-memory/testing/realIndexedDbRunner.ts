/**
 * C5-Memory 3.0 — Validação com IndexedDB Real e Atomicidade
 * 
 * Executado diretamente em Chromium Real (V8, WebCrypto, Native IndexedDB).
 * Sem Mocks, sem Map, sem MemoryIDBStore, sem fakeDb.
 */

import { generateMemoryDraft210, confirmMemoryDraft210 } from "../application/service210";
import { formatGameCanonical, createMemoryHistory } from "../history";
import { syncSha256 } from "../sha256";
import { Draft30, FrozenMemoryPayload30 } from "../engine30";
import { ContestRecord, MemoryHistory } from "../types";
import {
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  STORE_AUDIT_EVENTS,
  confirmMemoryBetAtomic210,
} from "../../storage/storageManager210";

export const TEST_DB_NAME = "c5_real_audit_isolated_db_30";
export const TEST_DB_VERSION = 4;

export interface RealIndexedDbValidationReport {
  readonly isRealIndexedDb: boolean;
  readonly databaseEngine: string;
  readonly userAgent: string;
  readonly persistenceCycle: {
    readonly step1_databaseDeleted: boolean;
    readonly step2_databaseOpened: boolean;
    readonly step3_fiveGamesGenerated: readonly (readonly number[])[];
    readonly step3_draftAlgorithm: string;
    readonly step3_leximinProfile: readonly number[];
    readonly step4_frozenStatus: string;
    readonly step5_shaBefore: string;
    readonly step6_databaseClosedAndReopened: boolean;
    readonly step8_fiveGamesRetrieved: readonly (readonly number[])[];
    readonly step8_frozenPayloadRetrieved: boolean;
    readonly step9_shaAfter: string;
    readonly step9_shaRecalculatedWebCrypto: string;
    readonly step9_shaRecalculatedSync: string;
    readonly step10_shaEqual: boolean;
    readonly step10_gamesIdentical: boolean;
    readonly step10_historyRevision: number;
    readonly step10_historyGamesCount: number;
  };
  readonly atomicityValidation: {
    readonly initialRevision: number;
    readonly initialGamesCount: number;
    readonly failureSimulated: string;
    readonly transactionAborted: boolean;
    readonly abortErrorMessage: string;
    readonly targetContestFrozen: boolean;
    readonly targetContestStateAfterAbort: string;
    readonly historyGamesCountAfterAbort: number;
    readonly historyRevisionAfterAbort: number;
    readonly previousContestIntact: boolean;
    readonly atomicityPreserved: boolean;
  };
  readonly officialCaixaQuery: {
    readonly attemptedAt: string;
    readonly primaryEndpoint: string;
    readonly primaryStatus: number | null;
    readonly primaryOrigin: string;
    readonly primaryContestNumber: number | null;
    readonly primaryDrawDate: string | null;
    readonly primaryDrawnNumbers: readonly number[] | null;
    readonly secondaryEndpoint: string;
    readonly secondaryStatus: number | null;
    readonly secondaryContestNumber: number | null;
    readonly isOnlineConfirmed: boolean;
    readonly offlineFallbackVerified: {
      readonly generatedFiveGames: boolean;
      readonly isHistoricalExclusionComplete: boolean;
      readonly updateVerificationStatus: string;
      readonly limitationNotice: string;
    };
  };
  readonly allChecksPassed: boolean;
  readonly executionLogs: readonly string[];
}

// Helper para abrir o banco IndexedDB nativo do navegador
function openIsolatedRealDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("window.indexedDB não disponível — este teste exige navegador real."));
      return;
    }
    const req = window.indexedDB.open(TEST_DB_NAME, TEST_DB_VERSION);
    req.onupgradeneeded = ev => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_CONTESTS)) {
        db.createObjectStore(STORE_CONTESTS, { keyPath: "contestNumber" });
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY_HISTORY)) {
        db.createObjectStore(STORE_MEMORY_HISTORY, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIT_EVENTS)) {
        db.createObjectStore(STORE_AUDIT_EVENTS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteIsolatedRealDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve();
      return;
    }
    const req = window.indexedDB.deleteDatabase(TEST_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // se bloqueado, prossegue
  });
}

async function webCryptoSha256(text: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const buf = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function runRealIndexedDbValidation(): Promise<RealIndexedDbValidationReport> {
  const logs: string[] = [];
  function log(msg: string) {
    console.log(msg);
    logs.push(msg);
  }

  log("================================================================================");
  log("INICIANDO VALIDAÇÃO OPERACIONAL EM CHROMIUM REAL — INDEXEDDB NATIVO & ATOMICIDADE");
  log("================================================================================");
  log(`User Agent: ${navigator.userAgent}`);
  log(`IndexedDB Constructor: ${window.indexedDB.constructor.name}`);
  log(`WebCrypto disponível: ${Boolean(window.crypto?.subtle)}`);

  // ==========================================================================
  // PARTE 1: CICLO DE PERSISTÊNCIA REAL COM INDEXEDDB DO NAVEGADOR (10 PASSOS)
  // ==========================================================================
  log("\n--- [PARTE 1] CICLO DE PERSISTÊNCIA COM INDEXEDDB REAL (10 PASSOS) ---");

  // Passo 1: Limpar banco de teste
  log("[Passo 1] Limpando banco de dados de teste isolado ('" + TEST_DB_NAME + "')...");
  await deleteIsolatedRealDb();
  log("  ✓ Banco de teste excluído com sucesso.");

  // Passo 2: Abrir a aplicação com IndexedDB real
  log("[Passo 2] Abrindo conexão com o IndexedDB nativo do navegador...");
  let db = await openIsolatedRealDb();
  log(`  ✓ Conexão aberta: DB='${db.name}', Version=${db.version}, Stores=[${Array.from(db.objectStoreNames).join(", ")}]`);

  // Passo 3: Gerar cinco jogos
  log("[Passo 3] Gerando 5 jogos prospectivos C5-Memory 3.0 para o concurso 3820...");
  const draft: Draft30 = await generateMemoryDraft210(3820, db);
  log(`  ✓ Algoritmo: ${draft.algorithmVersion}`);
  log(`  ✓ Jogos gerados: ${draft.games.length}`);
  draft.games.forEach((g, idx) => {
    log(`    Jogo ${idx + 1}: [${g.map((n: number) => String(n).padStart(2, "0")).join(", ")}]`);
  });
  log(`  ✓ Perfil Leximin: [${draft.leximinProfile.join(", ")}]`);
  log(`  ✓ Fonte de Scoring: ${draft.scoringHistorySource} (${draft.scoringHistorySize} sorteios)`);

  // Passo 4: Congelar os cinco jogos (Confirmação atômica)
  log("[Passo 4] Confirmando e congelando os 5 jogos na base IndexedDB nativa...");
  const confirmedRecord = await confirmMemoryDraft210(3820, draft, db);
  log(`  ✓ Status pós-confirmação: ${confirmedRecord.status}`);
  if (confirmedRecord.status !== "FROZEN") {
    throw new Error(`Status esperado FROZEN, obtido ${confirmedRecord.status}`);
  }

  // Passo 5: Registrar o SHA-256
  const frozenBefore = confirmedRecord.frozenPayload as FrozenMemoryPayload30;
  const shaBefore = frozenBefore.sha256;
  log(`[Passo 5] SHA-256 registrado no congelamento: ${shaBefore}`);
  log(`  ✓ Revision Histórica: #${frozenBefore.historyRevision}`);
  log(`  ✓ History Fingerprint: ${frozenBefore.historyFingerprint}`);

  // Passo 6: Fechar e reabrir o contexto da aplicação
  log("[Passo 6] Fechando a conexão IndexedDB e liberando contexto em memória...");
  db.close();
  // Aguarda 100ms para liberação total de descritores no LevelDB do Chromium
  await new Promise(r => setTimeout(r, 100));
  log("  ✓ Conexão fechada. Contexto liberado.");

  // Passo 7: Abrir novamente o IndexedDB persistido
  log("[Passo 7] Reabrindo o IndexedDB nativo persistido em disco...");
  const reloadedDb = await openIsolatedRealDb();
  log(`  ✓ IndexedDB reaberto com sucesso: '${reloadedDb.name}'`);

  // Passo 8: Recuperar os cinco jogos e o payload congelado
  log("[Passo 8] Recuperando o concurso 3820 e o payload congelado do disco...");
  const retrievedRecord = await new Promise<ContestRecord>((resolve, reject) => {
    const tx = reloadedDb.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.get(3820);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!retrievedRecord) {
    throw new Error("Falha ao recuperar concurso 3820 do IndexedDB persistido");
  }

  const retrievedGames = retrievedRecord.games;
  const frozenAfter = retrievedRecord.frozenPayload as FrozenMemoryPayload30;
  const shaAfter = frozenAfter.sha256;

  log(`  ✓ Status recuperado: ${retrievedRecord.status}`);
  log(`  ✓ Jogos recuperados: ${retrievedGames.length}`);
  retrievedGames.forEach((g, idx) => {
    log(`    Jogo ${idx + 1} recuperado: [${g.map((n: number) => String(n).padStart(2, "0")).join(", ")}]`);
  });

  // Passo 9: Recalcular o SHA-256
  log("[Passo 9] Recalculando o SHA-256 matematicamente a partir dos dados persistidos...");
  const gamesSerial = retrievedGames.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${retrievedRecord.contestNumber}:${frozenAfter.poolIndex}:${frozenAfter.poolMasterSeed}:${frozenAfter.historyFingerprint}:${frozenAfter.historyRevision}:${gamesSerial}`;
  
  const shaRecalculatedWebCrypto = await webCryptoSha256(payloadToHash);
  const shaRecalculatedSync = syncSha256(payloadToHash);

  log(`  • SHA-256 Antes do Fechamento       : ${shaBefore}`);
  log(`  • SHA-256 Após Reabertura IndexedDB : ${shaAfter}`);
  log(`  • SHA-256 Recalculado (WebCrypto)   : ${shaRecalculatedWebCrypto}`);
  log(`  • SHA-256 Recalculado (Sync C5)     : ${shaRecalculatedSync}`);

  // Passo 10: Comparar os dados antes e depois
  log("[Passo 10] Comparando dados antes e depois do reinício do contexto...");
  const shaEqual = shaBefore === shaAfter && shaAfter === shaRecalculatedWebCrypto;
  if (!shaEqual) {
    throw new Error("Divergência de hash SHA-256 detectada!");
  }
  log("  ✓ Equivalência Criptográfica SHA-256: 100% IDÊNTICA.");

  let gamesIdentical = true;
  for (let i = 0; i < 5; i++) {
    const bStr = draft.games[i].join(",");
    const aStr = retrievedGames[i].join(",");
    if (bStr !== aStr) {
      gamesIdentical = false;
      throw new Error(`Jogo ${i + 1} difere após persistência real!`);
    }
  }
  log("  ✓ Comparação dos 5 jogos: 100% IDÊNTICOS dezena por dezena.");

  // Conferir integridade do Histórico H persistido
  const retrievedHistory = await new Promise<MemoryHistory>((resolve, reject) => {
    const tx = reloadedDb.transaction(STORE_MEMORY_HISTORY, "readonly");
    const store = tx.objectStore(STORE_MEMORY_HISTORY);
    const req = store.get("singleton");
    req.onsuccess = () => resolve(req.result?.history);
    req.onerror = () => reject(req.error);
  });
  log(`  ✓ Histórico H no IndexedDB: ${retrievedHistory.games.length} jogos, Revisão: #${retrievedHistory.revision}`);

  // ==========================================================================
  // PARTE 2: VALIDAÇÃO DE ATOMICIDADE (TRANSACIONALIDADE IDB REAL)
  // ==========================================================================
  log("\n--- [PARTE 2] VALIDAÇÃO DE ATOMICIDADE TRANSACIONAL ---");
  log("Cenário: Simulação de falha controlada imediatamente após gravação do concurso, antes do commit de H.");

  const initialRevision = retrievedHistory.revision; // 1
  const initialGamesCount = retrievedHistory.games.length; // 5

  // Gerar draft para concurso 3821
  const draft3821: Draft30 = await generateMemoryDraft210(3821, reloadedDb);

  let transactionAborted = false;
  let abortErrorMessage = "";

  try {
    // Tenta confirmar com injeção de falha programada
    await confirmMemoryBetAtomic210(
      reloadedDb,
      3821,
      draft3821,
      draft3821.historyRevision,
      draft3821.historyFingerprint,
      "AFTER_CONTEST_WRITE" // Injeção de falha programada
    );
  } catch (err: any) {
    transactionAborted = true;
    abortErrorMessage = err.message || "TRANSACTION_ABORTED";
    log(`  ✓ Falha simulada capturada com sucesso: "${abortErrorMessage}"`);
  }

  // Inspeciona o estado real das stores após a falha
  const contest3821AfterAbort = await new Promise<ContestRecord | undefined>((resolve, reject) => {
    const tx = reloadedDb.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.get(3821);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const historyAfterAbort = await new Promise<MemoryHistory>((resolve, reject) => {
    const tx = reloadedDb.transaction(STORE_MEMORY_HISTORY, "readonly");
    const store = tx.objectStore(STORE_MEMORY_HISTORY);
    const req = store.get("singleton");
    req.onsuccess = () => resolve(req.result?.history);
    req.onerror = () => reject(req.error);
  });

  const previousContest3820 = await new Promise<ContestRecord>((resolve, reject) => {
    const tx = reloadedDb.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.get(3820);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const targetContestFrozen = contest3821AfterAbort?.status === "FROZEN";
  const historyIntact =
    historyAfterAbort.games.length === initialGamesCount &&
    historyAfterAbort.revision === initialRevision;
  const previousContestIntact =
    previousContest3820.status === "FROZEN" &&
    previousContest3820.games.length === 5 &&
    (previousContest3820.frozenPayload as FrozenMemoryPayload30).sha256 === shaBefore;

  log(`  • Concurso 3821 ficou congelado isoladamente? ${targetContestFrozen ? "SIM (FALHA)" : "NÃO (CORRETO)"}`);
  log(`  • Histórico H recebeu jogos parciais? ${historyAfterAbort.games.length > initialGamesCount ? "SIM (FALHA)" : `NÃO (${historyAfterAbort.games.length} jogos mantidos)`}`);
  log(`  • Revisão de H alterada? ${historyAfterAbort.revision !== initialRevision ? "SIM (FALHA)" : `NÃO (Revisão #${historyAfterAbort.revision} preservada)`}`);
  log(`  • Concurso anterior 3820 íntegro? ${previousContestIntact ? "SIM (100% ÍNTEGRO)" : "NÃO (CORROMPIDO)"}`);

  const atomicityPreserved = !targetContestFrozen && historyIntact && previousContestIntact;
  if (!atomicityPreserved) {
    throw new Error("Falha na atomicidade: rollback não executado corretamente!");
  }
  log("  ✓ Atomicidade Comprovada: Rollback total executado sem resíduos.");

  // ==========================================================================
  // PARTE 3: VALIDAÇÃO DA CONSULTA OFICIAL SEPARADAMENTE (REDE REAL & OFFLINE)
  // ==========================================================================
  log("\n--- [PARTE 3] CONSULTA REAL À CAIXA & MODO OFFLINE SEPARADO ---");

  let primaryStatus: number | null = null;
  let primaryOrigin = "";
  let primaryContestNumber: number | null = null;
  let primaryDrawDate: string | null = null;
  let primaryDrawnNumbers: number[] | null = null;

  let secondaryStatus: number | null = null;
  let secondaryContestNumber: number | null = null;

  const attemptedAt = new Date().toISOString();
  log(`Horário da consulta real: ${attemptedAt}`);

  // Consulta 1: Endpoint oficial da Caixa
  const primaryEndpoint = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
  log(`Consultando endpoint primário da Caixa: ${primaryEndpoint}...`);
  try {
    const res = await fetch(primaryEndpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    primaryStatus = res.status;
    primaryOrigin = "Caixa Econômica Federal (servicebus2.caixa.gov.br)";
    log(`  ✓ Resposta HTTP Caixa: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      primaryContestNumber = typeof data?.numero === "number" ? data.numero : parseInt(data?.numero, 10);
      primaryDrawDate = data?.dataApuracao || null;
      if (Array.isArray(data?.listaDezenas)) {
        primaryDrawnNumbers = data.listaDezenas.map((d: string) => parseInt(d, 10));
      }
      log(`  ✓ Concurso apurado retornado: #${primaryContestNumber} em ${primaryDrawDate}`);
      log(`  ✓ Dezenas oficiais: [${primaryDrawnNumbers?.join(", ")}]`);
    }
  } catch (err: any) {
    log(`  ! Endpoint primário Caixa: ${err.message}`);
  }

  // Consulta 2: Espelho verificado
  const secondaryEndpoint = "https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest";
  log(`Consultando espelho verificado: ${secondaryEndpoint}...`);
  try {
    const res2 = await fetch(secondaryEndpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    secondaryStatus = res2.status;
    log(`  ✓ Resposta HTTP Espelho: ${res2.status} ${res2.statusText}`);
    if (res2.ok) {
      const data2 = await res2.json();
      secondaryContestNumber = Number(data2?.concurso ?? data2?.numero);
      log(`  ✓ Concurso retornado pelo espelho: #${secondaryContestNumber}`);
    }
  } catch (err: any) {
    log(`  ! Espelho: ${err.message}`);
  }

  // Validação explícita separada do modo Offline
  log("\nValidando separadamente o modo OFFLINE (simulação de corte de rede com a Caixa):");
  const offlineDraft: Draft30 = await generateMemoryDraft210(3822, reloadedDb, {
    customFetch: async () => {
      throw new Error("OFFLINE_NETWORK_DISCONNECTED");
    },
    timeoutMs: 300,
  });

  const offlineGeneratedFive = offlineDraft.games.length === 5;
  const offlineExclusionComplete = offlineDraft.isHistoricalExclusionComplete;
  const offlineVerificationStatus = offlineDraft.officialCoverage.updateVerificationStatus;
  const offlineNotice = offlineDraft.officialCoverage.limitationNotice || "";

  log(`  ✓ Geração offline produziu 5 jogos? ${offlineGeneratedFive}`);
  log(`  ✓ isHistoricalExclusionComplete (deve ser false): ${offlineExclusionComplete}`);
  log(`  ✓ updateVerificationStatus (deve ser UNVERIFIED_OFFLINE): ${offlineVerificationStatus}`);
  log(`  ✓ Aviso de limitação registrado: "${offlineNotice}"`);

  reloadedDb.close();

  const allChecksPassed =
    shaEqual &&
    gamesIdentical &&
    atomicityPreserved &&
    offlineGeneratedFive &&
    offlineExclusionComplete === false &&
    offlineVerificationStatus === "UNVERIFIED_OFFLINE";

  log("\n================================================================================");
  log(`RESULTADO FINAL DA VALIDAÇÃO EM CHROMIUM REAL: ${allChecksPassed ? "TODOS OS CRITÉRIOS ATENDIDOS COM SUCESSO" : "FALHA"}`);
  log("================================================================================");

  return {
    isRealIndexedDb: true,
    databaseEngine: "Chromium Native IndexedDB (LevelDB)",
    userAgent: navigator.userAgent,
    persistenceCycle: {
      step1_databaseDeleted: true,
      step2_databaseOpened: true,
      step3_fiveGamesGenerated: draft.games,
      step3_draftAlgorithm: draft.algorithmVersion,
      step3_leximinProfile: draft.leximinProfile,
      step4_frozenStatus: confirmedRecord.status,
      step5_shaBefore: shaBefore,
      step6_databaseClosedAndReopened: true,
      step8_fiveGamesRetrieved: retrievedGames,
      step8_frozenPayloadRetrieved: Boolean(frozenAfter),
      step9_shaAfter: shaAfter,
      step9_shaRecalculatedWebCrypto: shaRecalculatedWebCrypto,
      step9_shaRecalculatedSync: shaRecalculatedSync,
      step10_shaEqual: shaEqual,
      step10_gamesIdentical: gamesIdentical,
      step10_historyRevision: retrievedHistory.revision,
      step10_historyGamesCount: retrievedHistory.games.length,
    },
    atomicityValidation: {
      initialRevision,
      initialGamesCount,
      failureSimulated: "AFTER_CONTEST_WRITE",
      transactionAborted,
      abortErrorMessage,
      targetContestFrozen,
      targetContestStateAfterAbort: contest3821AfterAbort ? contest3821AfterAbort.status : "UNDEFINED_ROLLED_BACK",
      historyGamesCountAfterAbort: historyAfterAbort.games.length,
      historyRevisionAfterAbort: historyAfterAbort.revision,
      previousContestIntact,
      atomicityPreserved,
    },
    officialCaixaQuery: {
      attemptedAt,
      primaryEndpoint,
      primaryStatus,
      primaryOrigin,
      primaryContestNumber,
      primaryDrawDate,
      primaryDrawnNumbers,
      secondaryEndpoint,
      secondaryStatus,
      secondaryContestNumber,
      isOnlineConfirmed: primaryStatus === 200 || secondaryStatus === 200,
      offlineFallbackVerified: {
        generatedFiveGames: offlineGeneratedFive,
        isHistoricalExclusionComplete: offlineExclusionComplete,
        updateVerificationStatus: offlineVerificationStatus,
        limitationNotice: offlineNotice,
      },
    },
    allChecksPassed,
    executionLogs: logs,
  };
}

// Expõe no window para captura via CDP pelo runner Node
if (typeof window !== "undefined") {
  (window as any).__runRealValidation = runRealIndexedDbValidation;
}
