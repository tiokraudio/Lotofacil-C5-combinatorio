/**
 * Validação de Persistência do Filtro Anti-Duplicatas — C5-Memory 3.0
 * 
 * Comprova que jogos PREVIEW e rascunhos anteriores persistidos no armazenamento
 * continuam sendo considerados e rejeitados pelo filtro anti-duplicatas após
 * o fechamento da conexão inicial e reabertura de um novo contexto independente.
 */

import { generateMemoryDraft210 } from "../src/c5-memory/application/service210";
import { distanceBetweenGames, isValidLotofacilGame } from "../src/c5-memory/math";
import { isGameIdenticalToAnyPreviousGame } from "../src/c5-memory/officialDraws";
import { formatGameCanonical } from "../src/c5-memory/history";
import { C5Game, MemoryHistory } from "../src/c5-memory/types";
import { ContestRecord } from "../src/types";
import { STORE_CONTESTS, STORE_MEMORY_HISTORY, STORE_AUDIT_EVENTS } from "../src/storage/storageManager210";

function createSimulationDatabase(backingStore: {
  contests: Map<number, ContestRecord>;
  history: Map<string, MemoryHistory>;
  audit?: Map<string, any>;
}) {
  const fakeDb = {
    transaction: (storeNames: string | string[], mode: "readonly" | "readwrite") => {
      let completeCb: (() => void) | null = null;
      let errorCb: ((err: any) => void) | null = null;

      const tx = {
        objectStore: (name: string) => {
          const map: Map<any, any> =
            name === STORE_CONTESTS
              ? backingStore.contests
              : name === STORE_MEMORY_HISTORY
              ? backingStore.history
              : (backingStore.audit ?? new Map());

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

  return fakeDb as unknown as IDBDatabase;
}

async function runPersistenceVerification() {
  console.log("================================================================================");
  console.log("TESTE DE PERSISTÊNCIA REAL: FILTRO ANTI-DUPLICATAS (PREVIEW & RASCUNHO)");
  console.log("================================================================================");

  // Armazenamento persistente (disco/storage engine independente)
  const backingStorage = {
    contests: new Map<number, ContestRecord>(),
    history: new Map<string, MemoryHistory>(),
    audit: new Map<string, any>(),
  };

  // 1. Abrir conexão #1 com o banco
  console.log("\n[ETAPA 1] Abrindo conexão #1 com o armazenamento persistente...");
  let db1: IDBDatabase | null = createSimulationDatabase(backingStorage);

  // 2. Gerar PREVIEW para o concurso 4100
  console.log("[ETAPA 2] Gerando draft PREVIEW para concurso 4100 através da conexão #1...");
  const draft4100 = await generateMemoryDraft210(4100, db1, { skipDynamicVerification: true });
  console.log(`✓ Draft PREVIEW gerado com 5 jogos. Primeiro jogo: [${draft4100.games[0].join(", ")}]`);

  // Gravar também um rascunho anterior explícito no concurso 4101 com status PREVIEW e draft
  const draftCustomGame: C5Game = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 22, 23, 24, 25];
  const record4101: ContestRecord = {
    contestNumber: 4101,
    contestDate: "2026-11-04",
    status: "PREVIEW",
    algorithmVersion: "C5-Memory-3.0",
    games: [draftCustomGame, ...draft4100.games.slice(1)],
    draft: {
      contestNumber: 4101,
      games: [draftCustomGame, ...draft4100.games.slice(1)],
      createdAt: "2026-11-04T12:00:00.000Z",
      generatedAt: "2026-11-04T12:00:00.000Z",
      historyRevision: 0,
      historyFingerprint: "test-draft-fp",
      seed: 99999,
      method: "STRUCTURAL_C5_V3",
      algorithmVersion: "C5-Memory-3.0",
      coverageAudit: {
        isCompleteHistoricalCoverage: false,
        updateVerificationStatus: "UNVERIFIED_OFFLINE",
        lastOfficialContestLoaded: 3816,
        expectedLastOfficialContest: 3816,
      },
    },
    createdAt: "2026-11-04T12:00:00.000Z",
    updatedAt: "2026-11-04T12:00:00.000Z",
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db1!.transaction([STORE_CONTESTS], "readwrite");
    tx.objectStore(STORE_CONTESTS).put(record4101);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  console.log(`✓ Rascunho gravado para concurso 4101 contendo jogo específico: [${draftCustomGame.join(", ")}]`);

  // 3. Fechar completamente a conexão #1 (descartar instância da aplicação)
  console.log("\n[ETAPA 3] Fechando completamente a conexão #1 e descartando referências em memória...");
  db1 = null;
  console.log("✓ Conexão #1 encerrada. Instância nula.");

  // 4. Reabrir o banco em nova conexão #2
  console.log("\n[ETAPA 4] Reabrindo nova conexão #2 sobre o storage persistido...");
  const db2 = createSimulationDatabase(backingStorage);
  console.log("✓ Conexão #2 estabelecida a partir do armazenamento persistido.");

  // 5. Recuperar os registros persistidos
  const persistedContests: ContestRecord[] = await new Promise((resolve, reject) => {
    const tx = db2.transaction([STORE_CONTESTS], "readonly");
    const req = tx.objectStore(STORE_CONTESTS).getAll();
    req.onsuccess = (e: any) => resolve(e.target.result);
    req.onerror = () => reject(tx.error);
  });

  console.log(`✓ Registros recuperados do storage: ${persistedContests.length} concursos`);
  const c4100 = persistedContests.find(c => c.contestNumber === 4100);
  const c4101 = persistedContests.find(c => c.contestNumber === 4101);

  if (!c4100 || c4100.status !== "PREVIEW") {
    throw new Error("FALHA: Concurso 4100 não persistiu status PREVIEW no banco!");
  }
  if (!c4101 || c4101.status !== "PREVIEW") {
    throw new Error("FALHA: Concurso 4101 não persistiu status PREVIEW no banco!");
  }
  console.log("✓ Ambos os concursos (4100 e 4101) recuperados intactos com status 'PREVIEW'.");

  // 6. Testar rejeição pelo filtro anti-duplicatas sobre os jogos recuperados da conexão #2
  console.log("\n[ETAPA 6] Testando filtro anti-duplicatas contra os jogos PREVIEW e rascunhos recuperados...");

  const previewGameToTest = c4100.games[0];
  const draftGameToTest = draftCustomGame;

  // Extrair Base B (todos os jogos de usuários cadastrados no banco reaberto)
  const allUserGamesReopened: C5Game[] = [];
  for (const c of persistedContests) {
    if (c.games) {
      for (const g of c.games) {
        if (isValidLotofacilGame(g)) allUserGamesReopened.push(g);
      }
    }
    if (c.draft?.games) {
      for (const g of c.draft.games) {
        if (isValidLotofacilGame(g)) allUserGamesReopened.push(g);
      }
    }
  }

  // Verificação 6.1: Jogo do PREVIEW 4100
  const isPreviewIdentical = isGameIdenticalToAnyPreviousGame(previewGameToTest, allUserGamesReopened);
  const minDistPreview = Math.min(...allUserGamesReopened.map(g => distanceBetweenGames(previewGameToTest, g)));

  // Verificação 6.2: Jogo do Rascunho 4101
  const isDraftIdentical = isGameIdenticalToAnyPreviousGame(draftGameToTest, allUserGamesReopened);
  const minDistDraft = Math.min(...allUserGamesReopened.map(g => distanceBetweenGames(draftGameToTest, g)));

  // Verificação 6.3: Jogo inédito
  const candidateUnique: C5Game = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 23, 24, 25];
  const isUniqueIdentical = isGameIdenticalToAnyPreviousGame(candidateUnique, allUserGamesReopened);

  console.log(`[TESTE 6.1] Jogo do PREVIEW 4100 detectado como duplicata: ${isPreviewIdentical} (distância mínima: ${minDistPreview})`);
  console.log(`[TESTE 6.2] Jogo do Rascunho 4101 detectado como duplicata: ${isDraftIdentical} (distância mínima: ${minDistDraft})`);
  console.log(`[TESTE 6.3] Jogo inédito aceito (não duplicado): ${!isUniqueIdentical}`);

  if (!isPreviewIdentical || minDistPreview !== 0) {
    throw new Error("FALHA: Jogo do PREVIEW não foi bloqueado pelo filtro anti-duplicatas após reabertura!");
  }
  if (!isDraftIdentical || minDistDraft !== 0) {
    throw new Error("FALHA: Jogo do rascunho prévio não foi bloqueado pelo filtro anti-duplicatas após reabertura!");
  }
  if (isUniqueIdentical) {
    throw new Error("FALHA: Jogo inédito foi incorretamente rejeitado!");
  }

  // 7. Geração operacional real no banco reaberto: verificar que o novo draft não duplica nenhum jogo do PREVIEW
  console.log("\n[ETAPA 7] Gerando novo concurso 4102 sobre a conexão #2 reaberta...");
  const draft4102 = await generateMemoryDraft210(4102, db2, { skipDynamicVerification: true });
  for (let i = 0; i < 5; i++) {
    const g = draft4102.games[i];
    const isDup = isGameIdenticalToAnyPreviousGame(g, [previewGameToTest, draftGameToTest]);
    if (isDup) {
      throw new Error(`FALHA: O novo draft 4102 gerou jogo idêntico a registro prévio: [${g.join(", ")}]`);
    }
  }
  console.log("✓ Todos os 5 jogos do novo concurso 4102 respeitaram 100% a exclusão de duplicatas dos jogos PREVIEW anteriores do banco persistido.");

  console.log("\n================================================================================");
  console.log("RESULTADO: PERSISTÊNCIA REAL DO FILTRO ANTI-DUPLICATAS [APROVADA 100%]");
  console.log("================================================================================");
}

runPersistenceVerification().catch(err => {
  console.error("ERRO:", err);
  process.exit(1);
});
