/**
 * Serviço de Integração UI da Application Layer (UI Boundary Service)
 * Ordem Executiva IC5
 * 
 * Fornece a fronteira única e exclusiva entre os componentes React e a Application Layer (service210).
 * Impede que a UI importe diretamente:
 * - Núcleo C5 matemático (structuralC5, engine210, math, pool, prng)
 * - Módulos de persistência interna (db, memoryTransaction, storageManager210)
 * - Analytics como entrada de seleção
 */

import { ContestRecord, MemoryHistory, C5Game } from "../types";
import {
  generateMemoryDraft210,
  confirmMemoryDraft210,
  discardMemoryDraft210,
  getMemoryOperationalState210,
  getMemoryAuditDetails210,
  scoreContestOperation210,
  validateOfficialLotofacilResult,
  OperationalStateDTO210,
  AuditDetailsDTO210,
} from "./service210";
import { Draft210 } from "../engine210";
import {
  buildC5Dashboard,
  buildC5MonthlyReport,
  isContestPendingVariableRateio,
  isContestPendingProvisionalRateio,
} from "../analytics/c5Analytics";

export type { Draft210, OperationalStateDTO210, AuditDetailsDTO210 };
export {
  buildC5Dashboard,
  buildC5MonthlyReport,
  validateOfficialLotofacilResult,
  isContestPendingVariableRateio,
  isContestPendingProvisionalRateio,
};

import {
  DB_NAME,
  DB_VERSION,
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  STORE_AUDIT_EVENTS,
} from "../../storage/db";

let dbInstance: IDBDatabase | null = null;

export function openAppDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não disponível no ambiente atual."));
      return;
    }
    if (dbInstance) {
      try {
        // Testa se a conexão ainda está ativa
        dbInstance.transaction(STORE_CONTESTS, "readonly");
        resolve(dbInstance);
        return;
      } catch {
        dbInstance = null;
      }
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
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

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * 1. AVAILABLE -> PREVIEW
 * Gera um Draft 2.1.0 estrutural através da Application Layer homologada.
 */
export async function generateMemoryDraftUI(contestNumber: number): Promise<Draft210> {
  const db = await openAppDB();
  return generateMemoryDraft210(contestNumber, db);
}

/**
 * 2. PREVIEW -> FROZEN
 * Confirmação atômica através da Application Layer homologada.
 */
export async function confirmMemoryDraftUI(
  contestNumber: number,
  draft: Draft210
): Promise<ContestRecord> {
  const db = await openAppDB();
  return confirmMemoryDraft210(contestNumber, draft, db);
}

/**
 * 3. PREVIEW -> AVAILABLE
 * Descarte seguro da prévia com zero efeitos residuais.
 */
export async function discardMemoryDraftUI(contestNumber: number): Promise<void> {
  const db = await openAppDB();
  return discardMemoryDraft210(contestNumber, db);
}

/**
 * 4. Consulta do Estado Operacional
 * Reconstruído dinamicamente a partir da fonte canônica 'contests'.
 */
export async function getMemoryOperationalStateUI(
  contestNumber: number
): Promise<OperationalStateDTO210> {
  const db = await openAppDB();
  return getMemoryOperationalState210(contestNumber, db);
}

/**
 * 5. Detalhes de Auditoria Criptográfica
 * Estritamente read-only, sem efeitos colaterais no estado do banco.
 */
export async function getMemoryAuditDetailsUI(
  contestNumber: number
): Promise<AuditDetailsDTO210> {
  const db = await openAppDB();
  return getMemoryAuditDetails210(contestNumber, db);
}

import { ScoreContestOptions } from "../../storage/storageManager210";
import { ResultSource } from "../types";

export interface OfficialLotofacilResultData {
  readonly contestNumber: number;
  readonly drawDate: string;
  readonly drawnNumbers: readonly number[];
  readonly prizeValues: Record<number, number>;
  readonly source: ResultSource;
  readonly fetchedAt: string;
  readonly isIntermediarySource: boolean;
  readonly sourceDescription: string;
}

/**
  * Busca resultado da Lotofácil em APIs públicas intermediárias com fallback
  * 
  * Invariantes de Auditoria:
  * - Respostas de api.guidi.dev.br ou loteriascaixa-api são classificadas estritamente como API_TERCEIROS.
  * - Não classifica APIs intermediárias como oficiais da Caixa (API_CAIXA).
  * - Retorna apenas prêmios fixos homologados (11, 12, 13). Rateios de 14 e 15 NUNCA são presumidos de APIs terceiras.
  */
export async function fetchOfficialLotofacilResult(
  contestNumber: number
): Promise<OfficialLotofacilResultData> {
  if (!Number.isInteger(contestNumber) || contestNumber <= 0) {
    throw new Error(`Número de concurso inválido: ${contestNumber}`);
  }

  // Tentativa 1: loteriascaixa-api (fonte intermediária)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`https://loteriascaixa-api.herokuapp.com/api/lotofacil/${contestNumber}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const returnedContest = Number(data.concurso ?? data.numero);
        // Impede que resposta de outro concurso seja aceita
        if (returnedContest && returnedContest !== contestNumber) {
          throw new Error(`Concurso retornado (${returnedContest}) difere do solicitado (${contestNumber})`);
        }

        if (data && Array.isArray(data.dezenas) && data.dezenas.length === 15) {
          const nums = data.dezenas
            .map((d: string | number) => Number(d))
            .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 25)
            .sort((a: number, b: number) => a - b);

          if (nums.length === 15 && new Set(nums).size === 15) {
            // Apenas prêmios fixos estatutários Caixa
            const prizes: Record<number, number> = { 11: 7.0, 12: 14.0, 13: 35.0 };
            return {
              contestNumber,
              drawDate: data.data || new Date().toISOString().split("T")[0],
              drawnNumbers: nums,
              prizeValues: prizes,
              source: "API_TERCEIROS",
              fetchedAt: new Date().toISOString(),
              isIntermediarySource: true,
              sourceDescription: "API Loterias Caixa (Heroku - Fonte Intermediária Terceira)",
            };
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fallback para próxima fonte
  }

  // Tentativa 2: api.guidi.dev.br (fonte intermediária de terceiros)
  try {
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), 4000);
    try {
      const res2 = await fetch(`https://api.guidi.dev.br/loteria/lotofacil/${contestNumber}`, {
        signal: controller2.signal,
      });
      if (res2.ok) {
        const data2 = await res2.json();
        const returnedContest2 = Number(data2.concurso ?? data2.numero);
        if (returnedContest2 && returnedContest2 !== contestNumber) {
          throw new Error(`Concurso retornado (${returnedContest2}) difere do solicitado (${contestNumber})`);
        }

        const rawDezenas = data2.dezenas || data2.listaDezenas;
        if (Array.isArray(rawDezenas) && rawDezenas.length === 15) {
          const nums = rawDezenas
            .map((d: string | number) => Number(d))
            .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 25)
            .sort((a: number, b: number) => a - b);

          if (nums.length === 15 && new Set(nums).size === 15) {
            // Apenas prêmios fixos estatutários Caixa
            const prizes: Record<number, number> = { 11: 7.0, 12: 14.0, 13: 35.0 };
            return {
              contestNumber,
              drawDate: data2.dataApuracao || data2.data || new Date().toISOString().split("T")[0],
              drawnNumbers: nums,
              prizeValues: prizes,
              source: "API_TERCEIROS",
              fetchedAt: new Date().toISOString(),
              isIntermediarySource: true,
              sourceDescription: "API Guidi (Fonte Intermediária Terceira)",
            };
          }
        }
      }
    } finally {
      clearTimeout(timer2);
    }
  } catch {
    // Fallback final
  }

  throw new Error(
    `Resultado do concurso ${contestNumber} não localizado online ou serviço temporariamente indisponível. Utilize a conferência manual segura.`
  );
}

/**
 * 6. FROZEN -> COMPLETED (Apuração Oficial)
 * Realizada estritamente através da operação atômica de scoring da Application Layer.
 */
export async function scoreContestOperationUI(
  contestNumber: number,
  officialResult: readonly number[],
  options?: ScoreContestOptions
): Promise<ContestRecord> {
  const db = await openAppDB();
  return scoreContestOperation210(contestNumber, officialResult, db, options);
}

/**
 * 7. Leitura Canônica de Todos os Concursos
 */
export async function getAllContestRecordsUI(): Promise<ContestRecord[]> {
  const db = await openAppDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Definição canônica dos dados demonstrativos sintéticos (Opt-in).
 * Concursos 3501 a 3504 estritamente etiquetados com isDemo: true e regras financeiras oficiais.
 */
export const DEMO_CONTEST_NUMBERS = [3501, 3502, 3503, 3504] as const;

export const DEMO_CONTESTS_DATA = [
  {
    contestNumber: 3501,
    contestDate: "2026-10-01",
    status: "COMPLETED" as const,
    games: [
      [1, 2, 4, 5, 7, 9, 11, 13, 14, 16, 18, 19, 21, 23, 25],
      [2, 3, 5, 6, 8, 10, 11, 12, 15, 17, 18, 20, 22, 24, 25],
      [1, 3, 4, 6, 7, 9, 10, 13, 15, 16, 17, 19, 21, 22, 24],
      [2, 4, 5, 8, 9, 11, 12, 14, 15, 18, 20, 21, 23, 24, 25],
      [1, 2, 3, 6, 7, 8, 10, 12, 13, 16, 17, 19, 20, 22, 25],
    ],
    officialResult: [1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 16, 18, 19, 21, 25],
  },
  {
    contestNumber: 3502,
    contestDate: "2026-10-02",
    status: "COMPLETED" as const,
    games: [
      [1, 3, 5, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 23, 25],
      [2, 4, 6, 7, 9, 11, 12, 14, 15, 17, 19, 21, 22, 24, 25],
      [1, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 25],
      [3, 4, 5, 7, 8, 10, 12, 13, 16, 18, 19, 21, 22, 24, 25],
      [1, 2, 5, 6, 8, 10, 11, 14, 15, 16, 19, 20, 21, 23, 24],
    ],
    officialResult: [1, 3, 5, 6, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 25],
  },
  {
    contestNumber: 3503,
    contestDate: "2026-10-03",
    status: "COMPLETED" as const,
    games: [
      [2, 3, 4, 6, 8, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24],
      [1, 4, 5, 7, 8, 10, 11, 13, 15, 17, 18, 20, 22, 24, 25],
      [2, 3, 5, 6, 9, 10, 12, 13, 15, 16, 18, 20, 21, 23, 25],
      [1, 2, 4, 7, 8, 10, 11, 14, 15, 17, 19, 21, 22, 23, 25],
      [3, 5, 6, 7, 9, 11, 12, 13, 16, 18, 19, 20, 22, 24, 25],
    ],
    officialResult: [2, 3, 4, 6, 8, 9, 11, 12, 14, 15, 16, 17, 19, 21, 23],
  },
  {
    contestNumber: 3504,
    contestDate: "2026-10-05",
    status: "COMPLETED" as const,
    games: [
      [1, 2, 3, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 25],
      [2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 24, 25],
      [1, 3, 4, 6, 7, 10, 11, 13, 14, 16, 18, 20, 21, 24, 25],
      [2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22, 23, 25],
      [1, 4, 5, 6, 8, 9, 11, 12, 15, 16, 18, 20, 22, 24, 25],
    ],
    officialResult: [1, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22, 25],
  },
];

/**
 * Verifica se um registro corresponde estritamente à assinatura sintética conhecida dos concursos 3501..3504
 */
function isSyntheticDemoRecord(record: ContestRecord): boolean {
  if (record.isDemo) return true;
  const match = DEMO_CONTESTS_DATA.find(d => d.contestNumber === record.contestNumber);
  if (!match) return false;
  // Comprova correspondência de jogos conhecidos gerados artificialmente
  if (
    record.contestDate === match.contestDate &&
    Array.isArray(record.games) &&
    record.games.length === 5 &&
    JSON.stringify(record.games[0]) === JSON.stringify(match.games[0])
  ) {
    return true;
  }
  return false;
}

/**
 * 8. Migração Segura: Identifica registros demonstrativos legados sem nunca apagar ou reclassificar registros reais de usuário.
 */
export async function migrateExistingDemoDataUI(): Promise<number> {
  const db = await openAppDB();
  const existing = await getAllContestRecordsUI();
  let migratedCount = 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readwrite");
    const store = tx.objectStore(STORE_CONTESTS);

    for (const record of existing) {
      if (!record.isDemo && isSyntheticDemoRecord(record)) {
        // Marcação segura e não-destrutiva: apenas assinala isDemo = true
        const migrated: ContestRecord = {
          ...record,
          isDemo: true,
          updatedAt: new Date().toISOString(),
        };
        store.put(migrated);
        migratedCount++;
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return migratedCount;
}

/**
 * 9. Inicialização Normal Segura (Clean Startup):
 * Executa a migração não-destrutiva de dados legados, mas NÃO insere concursos sintéticos no banco limpo.
 * Garante que a primeira execução mantenha saldo R$ 0,00, 0 prêmios e 0 concursos apurados.
 */
export async function initializeSeedDataUI(): Promise<void> {
  await migrateExistingDemoDataUI();
}

/**
 * 10. Carregamento Explícito de Dados Demonstrativos (Opt-in)
 * Permite ao usuário carregar os 4 concursos de teste com marcação inequívoca isDemo: true
 */
export async function loadOptInDemoDataUI(): Promise<void> {
  const db = await openAppDB();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readwrite");
    const store = tx.objectStore(STORE_CONTESTS);

    for (const c of DEMO_CONTESTS_DATA) {
      const hits = c.games.map(g => g.filter(n => c.officialResult.includes(n)).length);
      const best = Math.max(...hits);
      const breakdown: Record<string, { count: number; unitValue: number; totalValue: number }> = {};
      let totalPrize = 0;

      for (const h of [11, 12, 13, 14, 15]) {
        const count = hits.filter(hit => hit === h).length;
        if (count > 0 && h <= 13) {
          const unitVal = h === 11 ? 7.0 : h === 12 ? 14.0 : 35.0;
          const tot = count * unitVal;
          totalPrize += tot;
          breakdown[String(h)] = { count, unitValue: unitVal, totalValue: tot };
        }
      }

      const rec: ContestRecord = {
        contestNumber: c.contestNumber,
        contestDate: c.contestDate,
        status: c.status,
        algorithmVersion: "C5-Memory-2.0.0",
        games: c.games,
        officialResult: c.officialResult,
        gameHits: hits,
        bestHits: best,
        bestHitsCount: hits.filter(h => h === best).length,
        totalCost: 17.50, // 5 * R$ 3,50
        totalPrize,
        prizeBreakdown: breakdown,
        isDemo: true, // Estritamente isolado de dados reais
        createdAt: `${c.contestDate}T10:00:00.000Z`,
        updatedAt: `${c.contestDate}T12:00:00.000Z`,
      };
      store.put(rec);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 11. Limpeza de Dados Demonstrativos
 * Remove exclusivamente os registros que possuem isDemo: true, preservando dados reais.
 */
export async function clearDemoDataUI(): Promise<number> {
  const db = await openAppDB();
  const existing = await getAllContestRecordsUI();
  let deletedCount = 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS], "readwrite");
    const store = tx.objectStore(STORE_CONTESTS);

    for (const r of existing) {
      if (r.isDemo) {
        store.delete(r.contestNumber);
        deletedCount++;
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return deletedCount;
}

/**
 * 12. Verifica se existem registros demonstrativos no armazenamento local
 */
export async function hasDemoRecordsUI(): Promise<boolean> {
  const existing = await getAllContestRecordsUI();
  return existing.some(r => r.isDemo === true);
}
