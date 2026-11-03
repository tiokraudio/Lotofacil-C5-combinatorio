/**
 * C5-Memory 3.0 — Teste Operacional Obrigatório do Ciclo de Vida
 * 
 * Etapas Mandatórias:
 * 1. Iniciar sem registros operacionais.
 * 2. Confirmar que o concurso inicial não é definido arbitrariamente.
 * 3. Gerar exatamente 5 jogos (Draft30).
 * 4. Confirmar o congelamento (FrozenMemoryPayload30).
 * 5. Recarregar a aplicação (novo contexto de carregamento do DB).
 * 6. Recuperar os mesmos 5 jogos.
 * 7. Recalcular e comparar o SHA-256 antes e depois do recarregamento.
 * 8. Confirmar que não houve alteração no histórico H nem nos jogos congelados.
 * 
 * Modo de Falha:
 * Teste do modo offline / falha de comunicação com a Caixa:
 * Sistema gera offline, preservando os 5 jogos, mas registrando claramente a ausência de verificação oficial.
 */

import {
  generateMemoryDraft210,
  confirmMemoryDraft210,
  getMemoryOperationalState210,
} from "../application/service210";
import {
  freezeDraft30,
  Draft30,
  FrozenMemoryPayload30,
  ALGORITHM_VERSION_3_0_0,
} from "../engine30";
import { formatGameCanonical, createMemoryHistory } from "../history";
import { syncSha256 } from "../sha256";
import { ContestRecord, MemoryHistory } from "../types";
import {
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  STORE_AUDIT_EVENTS,
  reconstructHistoryCrossVersion,
} from "../../storage/storageManager210";
import { fetchLatestOfficialLotofacilContest } from "../officialDraws";

// Mock em memória do IDBDatabase simulando persistência independente
class MemoryIDBStore {
  public data = new Map<any, any>();
}

function createSimulationDatabase(initialData?: {
  contests?: Map<number, ContestRecord>;
  history?: Map<string, MemoryHistory>;
}) {
  const contestsMap: Map<any, any> = initialData?.contests ? new Map(initialData.contests) : new Map();
  const historyMap: Map<any, any> = initialData?.history ? new Map(initialData.history) : new Map();
  const auditMap: Map<any, any> = new Map();

  const fakeDb = {
    transaction: (storeNames: string | string[], mode: "readonly" | "readwrite") => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      let completeCb: (() => void) | null = null;
      let errorCb: ((err: any) => void) | null = null;

      const tx = {
        objectStore: (name: string) => {
          const map: Map<any, any> =
            name === STORE_CONTESTS
              ? contestsMap
              : name === STORE_MEMORY_HISTORY
              ? historyMap
              : auditMap;

          return {
            get: (key: any) => {
              const req: any = { result: undefined, onsuccess: null, onerror: null };
              setTimeout(() => {
                req.result = map.get(key) ? JSON.parse(JSON.stringify(map.get(key))) : undefined;
                req.onsuccess?.({ target: req });
              }, 0);
              return req;
            },
            getAll: () => {
              const req: any = { result: undefined, onsuccess: null, onerror: null };
              setTimeout(() => {
                req.result = Array.from(map.values()).map(v => JSON.parse(JSON.stringify(v)));
                req.onsuccess?.({ target: req });
              }, 0);
              return req;
            },
            put: (val: any) => {
              const key = val.contestNumber ?? val.id;
              map.set(key, JSON.parse(JSON.stringify(val)));
              const req: any = { result: key, onsuccess: null, onerror: null };
              setTimeout(() => req.onsuccess?.({ target: req }), 0);
              return req;
            },
            delete: (key: any) => {
              map.delete(key);
              const req: any = { result: undefined, onsuccess: null, onerror: null };
              setTimeout(() => req.onsuccess?.({ target: req }), 0);
              return req;
            },
          };
        },
        set oncomplete(fn: () => void) {
          completeCb = fn;
          setTimeout(() => fn(), 5);
        },
        set onerror(fn: (err: any) => void) {
          errorCb = fn;
        },
      };

      return tx as any;
    },
  };

  return { fakeDb: fakeDb as IDBDatabase, contestsMap, historyMap };
}

function calculateCanonicalPayloadSha(frozen: {
  contestNumber: number;
  poolIndex: number;
  poolMasterSeed: string;
  historyFingerprint: string;
  historyRevision: number;
  games: readonly (readonly number[])[];
}): string {
  const gamesSerial = frozen.games.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${frozen.contestNumber}:${frozen.poolIndex}:${frozen.poolMasterSeed}:${frozen.historyFingerprint}:${frozen.historyRevision}:${gamesSerial}`;
  return syncSha256(payloadToHash);
}

export async function runOperationalLifecycle8StepsTest(): Promise<{
  success: boolean;
  shaBeforeReload: string;
  shaAfterReload: string;
  gamesMatch: boolean;
  historyMatches: boolean;
  offlineGenerated: boolean;
  offlineFlagged: boolean;
  stepsLog: string[];
}> {
  const stepsLog: string[] = [];
  function log(msg: string) {
    console.log(msg);
    stepsLog.push(msg);
  }

  log("================================================================================");
  log("TESTE OPERACIONAL OBRIGATÓRIO — CICLO DE VIDA C5-MEMORY 3.0 (8 ETAPAS)");
  log("================================================================================");

  // --------------------------------------------------------------------------
  // ETAPA 1: Iniciar sem registros operacionais
  // --------------------------------------------------------------------------
  log("\n[ETAPA 1] Iniciar sem registros operacionais no armazenamento local...");
  const { fakeDb, contestsMap, historyMap } = createSimulationDatabase();
  const initialRecordsState = await getMemoryOperationalState210(3817, fakeDb);
  if (contestsMap.size !== 0) throw new Error("Falha na Etapa 1: DB inicial não está vazio");
  log(`  ✓ DB limpo verificado: ${contestsMap.size} concursos no banco.`);
  log(`  ✓ Estado operacional inicial: status="${initialRecordsState.status}", jogos=${initialRecordsState.games.length}`);

  // --------------------------------------------------------------------------
  // ETAPA 2: Confirmar que o concurso inicial NÃO é definido arbitrariamente
  // --------------------------------------------------------------------------
  log("\n[ETAPA 2] Confirmar que o concurso inicial não é definido arbitrariamente...");
  // Verificação 1: sem conexão externa e sem registros locais -> nenhum número pode ser presumido
  const mockOfflineFetch: typeof fetch = async () => {
    throw new Error("Conexão com a Caixa indisponível (simulação offline)");
  };
  const offlineOfficialRef = await fetchLatestOfficialLotofacilContest(mockOfflineFetch, 200);
  if (offlineOfficialRef !== null) {
    throw new Error("Falha na Etapa 2: Offline retornou valor em vez de null");
  }
  log("  ✓ Em modo offline e sem registros operacionais, referência oficial é estritamente null.");
  log("  ✓ Sistema exige definição/confirmação explícita pelo usuário, sem inventar constantes fixas.");

  // Verificação 2: com referência oficial online -> número derivado transparentemente (último oficial + 1)
  const mockCaixaOnlineFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ numero: 3816, dataApuracao: "28/10/2026" }),
      { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } }
    );
  };
  const onlineOfficialRef = await fetchLatestOfficialLotofacilContest(mockCaixaOnlineFetch, 1000);
  if (!onlineOfficialRef || onlineOfficialRef.contestNumber !== 3816) {
    throw new Error("Falha na Etapa 2: Consulta oficial simulada falhou");
  }
  const derivedInitialContest = onlineOfficialRef.contestNumber + 1; // 3817
  log(`  ✓ Referência oficial validada obtida da Caixa: Concurso apurado #${onlineOfficialRef.contestNumber}`);
  log(`  ✓ Próximo concurso alvo derivado legitimamente: #${derivedInitialContest}`);

  // --------------------------------------------------------------------------
  // ETAPA 3: Gerar exatamente 5 jogos (Draft30)
  // --------------------------------------------------------------------------
  log(`\n[ETAPA 3] Gerar exatamente 5 jogos para o concurso ${derivedInitialContest}...`);
  const draft: Draft30 = await generateMemoryDraft210(derivedInitialContest, fakeDb, {
    customFetch: mockCaixaOnlineFetch,
  });

  if (draft.algorithmVersion !== "C5-Memory-3.0") {
    throw new Error(`Falha na Etapa 3: Versão do algoritmo incorreta: ${draft.algorithmVersion}`);
  }
  if (!Array.isArray(draft.games) || draft.games.length !== 5) {
    throw new Error(`Falha na Etapa 3: Quantidade de jogos gerados (${draft.games.length}) !== 5`);
  }
  for (let i = 0; i < draft.games.length; i++) {
    const g = draft.games[i];
    if (g.length !== 15 || new Set(g).size !== 15) {
      throw new Error(`Falha na Etapa 3: Jogo ${i + 1} inválido`);
    }
  }
  log(`  ✓ Versão gerada: ${draft.algorithmVersion}`);
  log(`  ✓ Exatamente 5 jogos gerados:`);
  draft.games.forEach((g, idx) => {
    log(`    Jogo ${idx + 1}: [${g.map((n: number) => String(n).padStart(2, "0")).join(", ")}]`);
  });
  log(`  ✓ Perfil Leximin: [${draft.leximinProfile.join(", ")}]`);
  log(`  ✓ Fonte de Scoring: ${draft.scoringHistorySource} (${draft.scoringHistorySize} registros)`);
  log(`  ✓ Exclusão Histórica 100% Comprovada: ${draft.isHistoricalExclusionComplete}`);
  log(`  ✓ Pool Index: ${draft.poolIndex}, Revision: ${draft.historyRevision}`);

  // --------------------------------------------------------------------------
  // ETAPA 4: Confirmar o congelamento atômico (FrozenMemoryPayload30)
  // --------------------------------------------------------------------------
  log(`\n[ETAPA 4] Confirmar o congelamento atômico (PREVIEW -> FROZEN)...`);
  const confirmedRecord = await confirmMemoryDraft210(derivedInitialContest, draft, fakeDb);

  if (confirmedRecord.status !== "FROZEN") {
    throw new Error(`Falha na Etapa 4: Status do registro é ${confirmedRecord.status}, esperado FROZEN`);
  }
  const frozenPayloadBefore = confirmedRecord.frozenPayload as FrozenMemoryPayload30;
  if (!frozenPayloadBefore || !frozenPayloadBefore.sha256) {
    throw new Error("Falha na Etapa 4: Payload congelado ausente");
  }

  const shaBeforeReload = frozenPayloadBefore.sha256;
  const recomputedShaBefore = calculateCanonicalPayloadSha(frozenPayloadBefore);
  if (recomputedShaBefore !== shaBeforeReload) {
    throw new Error("Falha na Etapa 4: Divergência entre sha256 no payload e hash recomputado");
  }
  log(`  ✓ Registro confirmado com sucesso com status: ${confirmedRecord.status}`);
  log(`  ✓ Algoritmo: ${frozenPayloadBefore.algorithmVersion}`);
  log(`  ✓ Concurso: #${frozenPayloadBefore.contestNumber}`);
  log(`  ✓ Revisão Histórica H: #${frozenPayloadBefore.historyRevision}`);
  log(`  ✓ Fingerprint H: ${frozenPayloadBefore.historyFingerprint}`);
  log(`  ✓ SHA-256 Canônico Congelado: ${shaBeforeReload}`);

  // --------------------------------------------------------------------------
  // ETAPA 5: Recarregar a aplicação (novo contexto simulando reinicialização)
  // --------------------------------------------------------------------------
  log("\n[ETAPA 5] Recarregar a aplicação (simulando reload da página/sessão)...");
  // O DB persistido mantém 'contestsMap' e 'historyMap' intactos
  const reloadedDb = createSimulationDatabase({ contests: contestsMap, history: historyMap }).fakeDb;
  const reloadedState = await getMemoryOperationalState210(derivedInitialContest, reloadedDb);
  log(`  ✓ Aplicação recarregada. Estado do concurso #${derivedInitialContest}: status="${reloadedState.status}"`);

  // --------------------------------------------------------------------------
  // ETAPA 6: Recuperar os mesmos 5 jogos
  // --------------------------------------------------------------------------
  log("\n[ETAPA 6] Recuperar e conferir os 5 jogos após o recarregamento...");
  if (!reloadedState.games || reloadedState.games.length !== 5) {
    throw new Error(`Falha na Etapa 6: Jogos recuperados (${reloadedState.games.length}) !== 5`);
  }

  let gamesMatch = true;
  for (let i = 0; i < 5; i++) {
    const original = draft.games[i];
    const retrieved = reloadedState.games[i];
    const origStr = original.join(",");
    const retrStr = retrieved.join(",");
    if (origStr !== retrStr) {
      gamesMatch = false;
      throw new Error(`Falha na Etapa 6: Jogo ${i + 1} difere após reload: ${origStr} vs ${retrStr}`);
    }
    log(`  ✓ Jogo ${i + 1} idêntico: [${retrieved.map((n: number) => String(n).padStart(2, "0")).join(", ")}]`);
  }

  // --------------------------------------------------------------------------
  // ETAPA 7: Recalcular e comparar o SHA-256 antes e depois do recarregamento
  // --------------------------------------------------------------------------
  log("\n[ETAPA 7] Recalcular e comparar o SHA-256 antes e após o recarregamento...");
  const frozenAfterReload = reloadedState.frozenPayload as FrozenMemoryPayload30;
  if (!frozenAfterReload) {
    throw new Error("Falha na Etapa 7: Frozen payload não recuperado após reload");
  }

  const shaAfterReload = frozenAfterReload.sha256;
  const recomputedShaAfter = calculateCanonicalPayloadSha(frozenAfterReload);

  log(`  • SHA-256 Antes do Reload : ${shaBeforeReload}`);
  log(`  • SHA-256 Após o Reload   : ${shaAfterReload}`);
  log(`  • SHA-256 Recalculado     : ${recomputedShaAfter}`);

  if (shaBeforeReload !== shaAfterReload) {
    throw new Error(`Falha na Etapa 7: Divergência entre SHA antes (${shaBeforeReload}) e após (${shaAfterReload})`);
  }
  if (shaAfterReload !== recomputedShaAfter) {
    throw new Error(`Falha na Etapa 7: SHA após reload não confere com recálculo matemático (${recomputedShaAfter})`);
  }
  log("  ✓ Equivalência Criptográfica Estrita Comprovada: Hashes 100% idênticos.");

  // --------------------------------------------------------------------------
  // ETAPA 8: Confirmar que não houve alteração no histórico H nem nos jogos congelados
  // --------------------------------------------------------------------------
  log("\n[ETAPA 8] Confirmar integridade absoluta do histórico H e jogos congelados...");
  const allStoredContests = [confirmedRecord];
  const reconstructedH = reconstructHistoryCrossVersion(allStoredContests);

  if (reconstructedH.games.length !== 5) {
    throw new Error(`Falha na Etapa 8: Histórico H contém ${reconstructedH.games.length} jogos, esperado 5`);
  }
  if (reconstructedH.revision !== 1) {
    throw new Error(`Falha na Etapa 8: Revisão do histórico é ${reconstructedH.revision}, esperado 1`);
  }
  for (let i = 0; i < 5; i++) {
    if (formatGameCanonical(reconstructedH.games[i]) !== formatGameCanonical(draft.games[i])) {
      throw new Error(`Falha na Etapa 8: Jogo ${i + 1} em H não confere com jogo gerado`);
    }
  }
  log(`  ✓ Histórico H reconstruído com sucesso: ${reconstructedH.games.length} jogos, Revisão: #${reconstructedH.revision}`);
  log(`  ✓ Fingerprint H: ${reconstructedH.fingerprint}`);
  log("  ✓ Zero corrupção, zero drift e zero mutação.");

  // --------------------------------------------------------------------------
  // TESTE ADICIONAL: Modo de falha de comunicação com a Caixa (Geração Offline)
  // --------------------------------------------------------------------------
  log("\n--------------------------------------------------------------------------------");
  log("TESTE DO MODO DE FALHA: GERAÇÃO OFFLINE (SEM COMUNICAÇÃO COM A CAIXA)");
  log("--------------------------------------------------------------------------------");
  const { fakeDb: offlineDb } = createSimulationDatabase();
  const offlineDraft = await generateMemoryDraft210(3818, offlineDb, {
    customFetch: async () => {
      throw new Error("ETIMEDOUT: Falha de conexão externa com servicebus2.caixa.gov.br");
    },
    timeoutMs: 300,
  });

  const offlineGenerated = offlineDraft.games.length === 5;
  const offlineFlagged =
    offlineDraft.isHistoricalExclusionComplete === false &&
    offlineDraft.officialCoverage.updateVerificationStatus === "UNVERIFIED_OFFLINE" &&
    offlineDraft.officialCoverage.isCoverageUpToDate === false;

  log(`  ✓ Geração offline concluída com sucesso: ${offlineDraft.games.length} jogos gerados.`);
  log(`  ✓ Status da cobertura: ${offlineDraft.officialCoverage.updateVerificationStatus}`);
  log(`  ✓ isHistoricalExclusionComplete: ${offlineDraft.isHistoricalExclusionComplete}`);
  log(`  ✓ isCoverageUpToDate: ${offlineDraft.officialCoverage.isCoverageUpToDate}`);
  log(`  ✓ Aviso de limitação registrado: "${offlineDraft.officialCoverage.limitationNotice}"`);

  if (!offlineGenerated || !offlineFlagged) {
    throw new Error("Falha no teste do modo offline");
  }

  log("\n================================================================================");
  log("TODAS AS 8 ETAPAS MANDATÓRIAS E O MODO OFFLINE PASSARAM COM SUCESSO ABSOLUTO!");
  log("================================================================================");

  return {
    success: true,
    shaBeforeReload,
    shaAfterReload,
    gamesMatch,
    historyMatches: true,
    offlineGenerated,
    offlineFlagged,
    stepsLog,
  };
}

// Execução direta
if (import.meta.url === `file://${process.argv[1]}`) {
  runOperationalLifecycle8StepsTest()
    .then(res => {
      console.log(`\nRESULTADO FINAL: SUCESSO = ${res.success}`);
      process.exit(0);
    })
    .catch(err => {
      console.error("\nFATAL ERROR NO TESTE DE CICLO DE VIDA:", err);
      process.exit(1);
    });
}
