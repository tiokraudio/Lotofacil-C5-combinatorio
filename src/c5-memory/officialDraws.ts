/**
 * C5-Memory 3.0 — Repositório e Validador de Resultados Históricos Oficiais
 * 
 * Regras Estritas de Auditoria:
 * 1. Base histórica completa da Lotofácil (3.816 concursos oficiais contíguos de 2003-09-29 a 2026-10-28).
 * 2. Validação da cobertura atualizada:
 *    - Rejeita critério arbitrário fixo de quantidade (>= 3800);
 *    - Compara obrigatoriamente o último concurso carregado com o último concurso oficial esperado;
 *    - Uma base contígua, mas desatualizada (ex: terminando antes do concurso esperado), NÃO pode ser declarada completa.
 * 3. Integridade criptográfica:
 *    - Calcula o SHA-256 do conteúdo canônico dos sorteios durante a inicialização;
 *    - Compara com o hash declarado no arquivo;
 *    - Se houver divergência, ausência ou corrupção do hash, a cobertura é classificada como incompleta e a geração apresenta a limitação.
 * 4. Procedência e honestidade de atribuição:
 *    - Registra a fonte declarada e data de atualização;
 *    - Não declara autenticidade oficial autônoma da Caixa sem assinatura digital ICP-Brasil; explicita a procedência como dados de consulta externa verificada.
 * 5. Tolerância zero a dados inventados, estimados ou fixtures como sorteios oficiais.
 * 6. Preservação estrita da separação entre sorteios oficiais da Caixa e jogos gerados pelo usuário (H_gen).
 */

import { C5Game, ContestRecord } from "./types";
import { formatGameCanonical } from "./history";
import { isValidLotofacilGame, distanceBetweenGames } from "./math";
import { syncSha256 } from "./sha256";
import officialHistoricalDataRaw from "./data/officialHistoricalDraws.json";
import { getAllStoredOfficialDraws, saveStoredOfficialDraws, StoredOfficialDraw } from "../storage/db";

export interface OfficialLotofacilDrawRecord {
  readonly contestNumber: number;
  readonly drawDate: string;
  readonly drawnNumbers: readonly number[];
}

export interface LatestOfficialContestReference {
  readonly contestNumber: number;
  readonly drawDate?: string;
  readonly retrievedAt: string;
  readonly source: string;
}

export type CoverageUpdateVerificationStatus =
  | "CONFIRMED_UP_TO_DATE"
  | "UNVERIFIED_OFFLINE"
  | "OUTDATED"
  | "INTEGRITY_COMPROMISED";

export interface OfficialDrawsCoverageStatus {
  readonly totalLoaded: number;
  readonly firstContest: number | null;
  readonly lastContest: number | null;
  readonly expectedLastContest: number | null;
  readonly firstDrawDate: string | null;
  readonly lastDrawDate: string | null;
  readonly isCompleteHistoricalCoverage: boolean;
  readonly isCryptographicallyVerified: boolean;
  readonly isCoverageUpToDate: boolean;
  readonly updateVerificationStatus: CoverageUpdateVerificationStatus;
  readonly source: string;
  readonly retrievedAt: string;
  readonly declaredSha256: string;
  readonly computedSha256: string;
  readonly provenanceNotice: string;
  readonly limitationNotice?: string;
  readonly verifiedReference?: LatestOfficialContestReference | null;
}

export interface OfficialDrawMatchResult {
  readonly isMatched: boolean;
  readonly contestNumber?: number;
  readonly drawDate?: string;
  readonly drawnNumbers?: readonly number[];
}

interface EntryValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Validação rigorosa de registro individual de concurso oficial da Lotofácil.
 * Valida tipo, número do concurso, existência real no calendário Gregoriano (além do formato ISO)
 * e 15 dezenas distintas entre 1 e 25.
 */
export function validateOfficialDrawRecord(entry: unknown): EntryValidationResult {
  if (!entry || typeof entry !== "object") {
    return { valid: false, reason: "Registro de sorteio não é um objeto válido." };
  }

  const rec = entry as { contestNumber?: unknown; drawDate?: unknown; drawnNumbers?: unknown };

  // 1. Validação do número do concurso
  if (
    typeof rec.contestNumber !== "number" ||
    !Number.isInteger(rec.contestNumber) ||
    rec.contestNumber <= 0
  ) {
    return { valid: false, reason: `Número de concurso inválido: ${rec.contestNumber}` };
  }

  // 2. Validação da data e de sua existência real no calendário Gregoriano
  if (
    typeof rec.drawDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(rec.drawDate)
  ) {
    return {
      valid: false,
      reason: `Data do sorteio inválida para o concurso ${rec.contestNumber}: formato ISO esperado YYYY-MM-DD, recebido "${rec.drawDate}".`,
    };
  }

  const [yStr, mStr, dStr] = rec.drawDate.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return {
      valid: false,
      reason: `Data do sorteio fora dos limites para o concurso ${rec.contestNumber}: ${rec.drawDate}.`,
    };
  }

  // Validação estrita de existência real no calendário Gregoriano
  // Rejeita datas impossíveis como 2024-02-30, 2023-02-29, 2026-04-31, 2026-11-31, etc.
  const parsedUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedUtc.getUTCFullYear() !== year ||
    parsedUtc.getUTCMonth() !== month - 1 ||
    parsedUtc.getUTCDate() !== day
  ) {
    return {
      valid: false,
      reason: `Data do sorteio impossível ou inexistente no calendário para o concurso ${rec.contestNumber}: ${rec.drawDate}.`,
    };
  }

  // 3. Validação das dezenas (exatamente 15 números inteiros distintos entre 1 e 25)
  if (!Array.isArray(rec.drawnNumbers) || rec.drawnNumbers.length !== 15) {
    return {
      valid: false,
      reason: `Concurso ${rec.contestNumber} possui ${Array.isArray(rec.drawnNumbers) ? rec.drawnNumbers.length : 0} dezenas em vez de 15.`,
    };
  }

  const seen = new Set<number>();
  for (let i = 0; i < rec.drawnNumbers.length; i++) {
    const n = rec.drawnNumbers[i];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 25) {
      return { valid: false, reason: `Concurso ${rec.contestNumber} contém dezena inválida: ${n}` };
    }
    if (seen.has(n)) {
      return { valid: false, reason: `Concurso ${rec.contestNumber} contém dezena duplicada: ${n}` };
    }
    seen.add(n);
  }

  return { valid: true };
}

/**
 * Calcula o digest SHA-256 canônico estrito dos sorteios carregados.
 * Serialização canônica ASCII pura: garante equivalência criptográfica exata independente do ambiente.
 */
export function computeCanonicalDrawsSha256(
  draws: readonly { contestNumber: number; drawDate: string; drawnNumbers: readonly number[] }[]
): string {
  const payload =
    "C5-OFFICIAL-DRAWS-CANONICAL-V1:" +
    draws
      .map(d => `${d.contestNumber}:${d.drawDate}:${d.drawnNumbers.join(",")}`)
      .join("|");
  return syncSha256(payload);
}

/**
 * Referência ativa do último concurso oficial verificado junto à fonte da Caixa
 */
let activeLatestOfficialReference: LatestOfficialContestReference | null = null;

/**
 * Define ou limpa a referência ativa do último concurso oficial da Caixa
 */
export function setVerifiedLatestOfficialReference(
  ref: LatestOfficialContestReference | null
): void {
  activeLatestOfficialReference = ref;
  cachedOfficialDraws = null;
  cachedCoverageStatus = null;
}

/**
 * Retorna a referência ativa do último concurso oficial da Caixa, se confirmada
 */
export function getVerifiedLatestOfficialReference(): LatestOfficialContestReference | null {
  return activeLatestOfficialReference;
}

/**
 * Limpa o cache em memória das validações de sorteios
 */
export function resetOfficialDrawsCache(): void {
  cachedOfficialDraws = null;
  cachedCoverageStatus = null;
}

/**
 * Mecanismo confiável para identificar o último concurso oficial esperado,
 * consultando a fonte oficial da Caixa Econômica Federal e espelhos verificados.
 *
 * Em caso de falha de conexão, timeout ou ausência de rede (ambiente offline),
 * retorna null sem interromper o fluxo operacional.
 */
export async function fetchLatestOfficialLotofacilContest(
  customFetch?: typeof fetch,
  timeoutMs: number = 4000
): Promise<LatestOfficialContestReference | null> {
  const fetchFn =
    customFetch ||
    (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : undefined);

  if (!fetchFn) {
    return null;
  }

  const endpoints = [
    {
      url: "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil",
      source: "Caixa Econômica Federal — Portal Oficial de Loterias (servicebus2.caixa.gov.br)",
      parser: (data: any): { contestNumber: number; drawDate?: string } | null => {
        const num = typeof data?.numero === "number" ? data.numero : parseInt(String(data?.numero), 10);
        if (Number.isInteger(num) && num > 0) {
          return {
            contestNumber: num,
            drawDate: typeof data?.dataApuracao === "string" ? data.dataApuracao : undefined,
          };
        }
        return null;
      },
    },
    {
      url: "https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest",
      source: "Espelho Verificado Loterias Caixa API (loteriascaixa-api.herokuapp.com)",
      parser: (data: any): { contestNumber: number; drawDate?: string } | null => {
        const rawNum = data?.concurso ?? data?.numero;
        const num = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
        if (Number.isInteger(num) && num > 0) {
          return {
            contestNumber: num,
            drawDate: typeof data?.data === "string" ? data.data : undefined,
          };
        }
        return null;
      },
    },
  ];

  for (const ep of endpoints) {
    let timeoutId: any = null;
    let controller: AbortController | null = null;
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
      }

      // O timeout engloba estritamente toda a requisição HTTP e a leitura/interpretação do corpo JSON
      const timeoutPromise = new Promise<null>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (controller) {
            try { controller.abort(); } catch {}
          }
          reject(new Error("LATEST_CONTEST_FETCH_TIMEOUT"));
        }, timeoutMs);
        if (typeof timeoutId?.unref === "function") {
          timeoutId.unref();
        }
      });

      const fetchAndParsePromise = (async () => {
        const res = await fetchFn(ep.url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller?.signal,
        });

        if (!res || !res.ok) {
          return null;
        }

        // Leitura e interpretação do corpo JSON sob a proteção do timeout
        const json = await res.json();
        return ep.parser(json);
      })();

      const parsed = await Promise.race([fetchAndParsePromise, timeoutPromise]);

      if (parsed) {
        return {
          contestNumber: parsed.contestNumber,
          drawDate: parsed.drawDate,
          retrievedAt: new Date().toISOString(),
          source: ep.source,
        };
      }
    } catch {
      // Falha esperada em ambientes offline, timeout de rede ou de leitura do JSON, ou bloqueio de CORS
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  return null;
}

export interface FetchedOfficialDrawDetails {
  readonly contestNumber: number;
  readonly drawDate: string;
  readonly drawnNumbers: readonly number[];
  readonly source: string;
  readonly retrievedAt: string;
  readonly rateio?: readonly any[];
}

export interface HistoricalSyncResult {
  readonly success: boolean;
  readonly syncedCount: number;
  readonly lastContest: number | null;
  readonly latestExpectedContest: number | null;
  readonly isCoverageUpToDate: boolean;
  readonly isCompleteHistoricalCoverage: boolean;
  readonly reason?: string;
  readonly syncedContests: readonly number[];
}

let additionalSyncedDraws: OfficialLotofacilDrawRecord[] = [];

export function getAdditionalSyncedOfficialDraws(): readonly OfficialLotofacilDrawRecord[] {
  return additionalSyncedDraws;
}

export function setAdditionalSyncedOfficialDraws(
  draws: readonly OfficialLotofacilDrawRecord[]
): void {
  additionalSyncedDraws = [...draws];
  cachedOfficialDraws = null;
  cachedCoverageStatus = null;
}

/**
 * Busca os dados oficiais de um concurso específico na Caixa Econômica Federal ou espelhos auditados.
 */
export async function fetchOfficialDrawDetails(
  contestNumber: number,
  customFetch?: typeof fetch,
  timeoutMs: number = 4000
): Promise<FetchedOfficialDrawDetails | null> {
  const fetchFn =
    customFetch ||
    (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : undefined);

  if (!fetchFn || !Number.isInteger(contestNumber) || contestNumber <= 0) {
    return null;
  }

  const endpoints = [
    {
      url: `https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil/${contestNumber}`,
      source: "Caixa Econômica Federal — Portal Oficial de Loterias (servicebus2.caixa.gov.br)",
      parser: (data: any): FetchedOfficialDrawDetails | null => {
        const cNum = typeof data?.numero === "number" ? data.numero : parseInt(String(data?.numero), 10);
        if (cNum !== contestNumber) return null;
        let isoDate = "";
        const rawDate = data?.dataApuracao;
        if (typeof rawDate === "string") {
          const trimmed = rawDate.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
            const [d, m, y] = trimmed.split("/");
            isoDate = `${y}-${m}-${d}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            isoDate = trimmed;
          }
        }
        if (!isoDate) return null;

        const rawNums = data?.listaDezenas || data?.dezenasSorteadasOrdemSorteio;
        if (!Array.isArray(rawNums) || rawNums.length !== 15) return null;
        const nums = rawNums.map(n => Number(n)).sort((a, b) => a - b);
        const val = validateOfficialDrawRecord({ contestNumber: cNum, drawDate: isoDate, drawnNumbers: nums });
        if (!val.valid) return null;

        return {
          contestNumber: cNum,
          drawDate: isoDate,
          drawnNumbers: nums,
          source: "Caixa Econômica Federal — Portal Oficial de Loterias (servicebus2.caixa.gov.br)",
          retrievedAt: new Date().toISOString(),
          rateio: Array.isArray(data?.listaRateioPremio) ? data.listaRateioPremio : undefined,
        };
      },
    },
    {
      url: `https://loteriascaixa-api.herokuapp.com/api/lotofacil/${contestNumber}`,
      source: "Espelho Verificado Loterias Caixa API (loteriascaixa-api.herokuapp.com)",
      parser: (data: any): FetchedOfficialDrawDetails | null => {
        const rawNum = data?.concurso ?? data?.numero;
        const cNum = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
        if (cNum !== contestNumber) return null;
        let isoDate = "";
        const rawDate = data?.data;
        if (typeof rawDate === "string") {
          const trimmed = rawDate.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
            const [d, m, y] = trimmed.split("/");
            isoDate = `${y}-${m}-${d}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            isoDate = trimmed;
          }
        }
        if (!isoDate) return null;

        const rawNums = data?.dezenas;
        if (!Array.isArray(rawNums) || rawNums.length !== 15) return null;
        const nums = rawNums.map(n => Number(n)).sort((a, b) => a - b);
        const val = validateOfficialDrawRecord({ contestNumber: cNum, drawDate: isoDate, drawnNumbers: nums });
        if (!val.valid) return null;

        return {
          contestNumber: cNum,
          drawDate: isoDate,
          drawnNumbers: nums,
          source: "Espelho Verificado Loterias Caixa API (loteriascaixa-api.herokuapp.com)",
          retrievedAt: new Date().toISOString(),
          rateio: Array.isArray(data?.premiacoes) ? data.premiacoes : undefined,
        };
      },
    },
    {
      url: `https://api.guidi.dev.br/loteria/lotofacil/${contestNumber}`,
      source: "API Guidi (Espelho Verificado)",
      parser: (data: any): FetchedOfficialDrawDetails | null => {
        const rawNum = data?.concurso ?? data?.numero;
        const cNum = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
        if (cNum !== contestNumber) return null;
        let isoDate = "";
        const rawDate = data?.dataApuracao || data?.data;
        if (typeof rawDate === "string") {
          const trimmed = rawDate.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
            const [d, m, y] = trimmed.split("/");
            isoDate = `${y}-${m}-${d}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            isoDate = trimmed;
          }
        }
        if (!isoDate) return null;

        const rawNums = data?.dezenas || data?.listaDezenas;
        if (!Array.isArray(rawNums) || rawNums.length !== 15) return null;
        const nums = rawNums.map(n => Number(n)).sort((a, b) => a - b);
        const val = validateOfficialDrawRecord({ contestNumber: cNum, drawDate: isoDate, drawnNumbers: nums });
        if (!val.valid) return null;

        return {
          contestNumber: cNum,
          drawDate: isoDate,
          drawnNumbers: nums,
          source: "API Guidi (Espelho Verificado)",
          retrievedAt: new Date().toISOString(),
        };
      },
    },
  ];

  for (const ep of endpoints) {
    let timeoutId: any = null;
    let controller: AbortController | null = null;
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
      }
      const timeoutPromise = new Promise<null>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (controller) {
            try { controller.abort(); } catch {}
          }
          reject(new Error("CONTEST_FETCH_TIMEOUT"));
        }, timeoutMs);
        if (typeof timeoutId?.unref === "function") {
          timeoutId.unref();
        }
      });

      const fetchPromise = (async () => {
        const res = await fetchFn(ep.url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller?.signal,
        });
        if (!res || !res.ok) return null;
        const json = await res.json();
        return ep.parser(json);
      })();

      const parsed = await Promise.race([fetchPromise, timeoutPromise]);
      if (parsed) return parsed;
    } catch {
      // Tenta próximo endpoint
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  return null;
}

/**
 * Sincronização incremental automática da base histórica oficial da Lotofácil.
 * Identifica os concursos ausentes entre a base local e a referência oficial da Caixa,
 * busca incrementalmente na fonte oficial, valida os dados recebidos e os persiste no IndexedDB.
 */
/**
 * Carrega todos os sorteios oficiais armazenados em STORE_OFFICIAL_DRAWS no IndexedDB,
 * sincroniza com quaisquer concursos concluídos do usuário e atualiza a base em memória.
 */
export async function loadOfficialDrawsFromStorage(
  db?: IDBDatabase
): Promise<OfficialLotofacilDrawRecord[]> {
  if (db) {
    try {
      const stored = await getAllStoredOfficialDraws(db);
      const validatedMap = new Map<number, OfficialLotofacilDrawRecord>();

      for (const s of stored) {
        if (validateOfficialDrawRecord(s).valid && s.contestNumber > 3816) {
          validatedMap.set(s.contestNumber, {
            contestNumber: s.contestNumber,
            drawDate: s.drawDate,
            drawnNumbers: Object.freeze([...s.drawnNumbers].sort((a, b) => a - b)),
          });
        }
      }

      // Se houver concursos em 'contests' concluídos que não estão em STORE_OFFICIAL_DRAWS, sincroniza
      if (db?.objectStoreNames?.contains && db.objectStoreNames.contains("contests")) {
        const userContests: ContestRecord[] = await new Promise(resolve => {
          try {
            const tx = db.transaction("contests", "readonly");
            const store = tx.objectStore("contests");
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch {
            resolve([]);
          }
        });

        const missingInStore: StoredOfficialDraw[] = [];
        for (const uc of userContests) {
          if (
            !uc.isDemo &&
            !uc.isFixture &&
            uc.status === "COMPLETED" &&
            uc.officialResult &&
            isValidLotofacilGame(uc.officialResult) &&
            uc.contestNumber > 3816 &&
            !validatedMap.has(uc.contestNumber)
          ) {
            const sorted = Object.freeze([...uc.officialResult].sort((a, b) => a - b));
            const record: OfficialLotofacilDrawRecord = {
              contestNumber: uc.contestNumber,
              drawDate: uc.contestDate || new Date().toISOString().split("T")[0],
              drawnNumbers: sorted,
            };
            validatedMap.set(uc.contestNumber, record);
            missingInStore.push({
              contestNumber: uc.contestNumber,
              drawDate: record.drawDate,
              drawnNumbers: sorted,
              source: uc.resultSource || "HOMOLOGATED_CONTEST",
              retrievedAt: uc.resultFetchedAt || new Date().toISOString(),
            });
          }
        }

        if (missingInStore.length > 0) {
          await saveStoredOfficialDraws(missingInStore, db);
        }
      }

      additionalSyncedDraws = Array.from(validatedMap.values()).sort(
        (a, b) => a.contestNumber - b.contestNumber
      );
      resetOfficialDrawsCache();
    } catch (err) {
      console.warn("Aviso ao carregar official_draws do IndexedDB:", err);
    }
  }

  const { draws } = loadAndValidateHistoricalDraws();
  return draws;
}

/**
 * Sincronização incremental automática da base histórica oficial da Lotofácil.
 * Identifica os concursos ausentes entre a base local e a referência oficial da Caixa,
 * busca incrementalmente na fonte oficial, valida os dados recebidos e os persiste no IndexedDB.
 */
export async function syncMissingOfficialDraws(
  db?: IDBDatabase,
  customFetch?: typeof fetch,
  timeoutMs: number = 4000
): Promise<HistoricalSyncResult> {
  // 1. Carrega sorteios adicionais já armazenados no IndexedDB (se fornecido)
  if (db) {
    await loadOfficialDrawsFromStorage(db);
  }

  // 2. Determina o último concurso atualmente carregado
  let cov = getOfficialDrawsCoverageStatus();
  let currentLast = cov.lastContest || 3816;

  // 3. Consulta dinamicamente a referência oficial da Caixa
  const latestRef = await fetchLatestOfficialLotofacilContest(customFetch, timeoutMs);
  if (!latestRef) {
    setVerifiedLatestOfficialReference(null);
    cov = getOfficialDrawsCoverageStatus();
    return {
      success: false,
      syncedCount: 0,
      lastContest: cov.lastContest,
      latestExpectedContest: null,
      isCoverageUpToDate: false,
      isCompleteHistoricalCoverage: false,
      reason: "Sem conexão com os servidores oficiais da Caixa (modo offline).",
      syncedContests: [],
    };
  }

  setVerifiedLatestOfficialReference(latestRef);
  const targetLast = latestRef.contestNumber;

  if (currentLast >= targetLast) {
    cov = getOfficialDrawsCoverageStatus({ verifiedReference: latestRef });
    return {
      success: true,
      syncedCount: 0,
      lastContest: currentLast,
      latestExpectedContest: targetLast,
      isCoverageUpToDate: cov.isCoverageUpToDate,
      isCompleteHistoricalCoverage: cov.isCompleteHistoricalCoverage,
      syncedContests: [],
    };
  }

  // 4. Busca incremental dos concursos ausentes
  const newlySynced: StoredOfficialDraw[] = [];
  let syncFailed = false;
  let failureReason: string | undefined = undefined;

  for (let c = currentLast + 1; c <= targetLast; c++) {
    const details = await fetchOfficialDrawDetails(c, customFetch, timeoutMs);
    if (!details) {
      syncFailed = true;
      failureReason = `Falha ao obter dados oficiais do concurso ${c} da Caixa.`;
      break;
    }

    const val = validateOfficialDrawRecord(details);
    if (!val.valid) {
      syncFailed = true;
      failureReason = `Dados do concurso ${c} recebidos da Caixa falharam na validação: ${val.reason}`;
      break;
    }

    newlySynced.push({
      contestNumber: details.contestNumber,
      drawDate: details.drawDate,
      drawnNumbers: details.drawnNumbers,
      source: details.source,
      retrievedAt: details.retrievedAt,
      rateio: details.rateio,
    });
  }

  if (newlySynced.length > 0) {
    if (db) {
      try {
        await saveStoredOfficialDraws(newlySynced, db);
        // Confirmação obrigatória: reler diretamente do IndexedDB para atestar persistência
        const persisted = await getAllStoredOfficialDraws(db);
        const persistedSet = new Set(persisted.map(p => p.contestNumber));
        const allPersisted = newlySynced.every(d => persistedSet.has(d.contestNumber));
        if (!allPersisted) {
          syncFailed = true;
          failureReason = "Falha de persistência: um ou mais sorteios não foram confirmados no IndexedDB.";
        }
      } catch (err) {
        console.warn("Aviso ao salvar novos sorteios no IndexedDB:", err);
        syncFailed = true;
        failureReason = `Falha ao salvar novos sorteios no IndexedDB: ${err}`;
      }
    }

    if (db) {
      await loadOfficialDrawsFromStorage(db);
    } else {
      // Atualiza cache em memória
      additionalSyncedDraws = [
        ...additionalSyncedDraws,
        ...newlySynced.map(s => ({
          contestNumber: s.contestNumber,
          drawDate: s.drawDate,
          drawnNumbers: Object.freeze([...s.drawnNumbers].sort((a, b) => a - b)),
        })),
      ].sort((a, b) => a.contestNumber - b.contestNumber);

      resetOfficialDrawsCache();
    }
  }

  cov = getOfficialDrawsCoverageStatus({ verifiedReference: latestRef });

  return {
    success: !syncFailed,
    syncedCount: newlySynced.length,
    lastContest: cov.lastContest,
    latestExpectedContest: targetLast,
    isCoverageUpToDate: cov.isCoverageUpToDate,
    isCompleteHistoricalCoverage: cov.isCompleteHistoricalCoverage,
    reason: failureReason,
    syncedContests: newlySynced.map(d => d.contestNumber),
  };
}

export interface EvaluateOfficialDrawsOptions {
  readonly verifiedReference?: LatestOfficialContestReference | null;
  readonly expectedLastContest?: number | null;
}

/**
 * Avalia a cobertura, contiguidade, procedência e integridade criptográfica de um conjunto de dados de sorteios.
 *
 * REGRAS DE AUDITORIA:
 * 1. Não descarta silenciosamente registros inválidos ou concursos duplicados: qualquer inconsistência
 *    rejeita integralmente a base.
 * 2. Calcula o hash SHA-256 somente após confirmação de que todos os registros originais passaram na validação.
 * 3. Validação rigorosa da data gregoriana real (além de formato ISO).
 * 4. Não utiliza constante fixa para o último concurso: exige confirmação da fonte de atualização da Caixa.
 *    Se não houver confirmação ou conexão, declara status UNVERIFIED_OFFLINE com aviso explícito.
 */
export function evaluateOfficialDraws(
  rawDataset: any,
  options?: EvaluateOfficialDrawsOptions
): {
  draws: OfficialLotofacilDrawRecord[];
  coverage: OfficialDrawsCoverageStatus;
} {
  // Identificação do último concurso oficial esperado
  let expectedLastContest: number | null = null;
  let activeRef: LatestOfficialContestReference | null = null;

  if (options && typeof options.expectedLastContest === "number") {
    expectedLastContest = options.expectedLastContest;
  } else if (options && options.verifiedReference !== undefined) {
    activeRef = options.verifiedReference;
    expectedLastContest = options.verifiedReference ? options.verifiedReference.contestNumber : null;
  } else if (activeLatestOfficialReference !== null) {
    activeRef = activeLatestOfficialReference;
    expectedLastContest = activeLatestOfficialReference.contestNumber;
  }

  const rawDraws: any[] = Array.isArray(rawDataset?.draws) ? rawDataset.draws : [];
  const declaredSha256 = typeof rawDataset?.sha256 === "string" ? rawDataset.sha256.trim() : "";
  const provenanceNotice =
    "Os dados históricos correspondem a extrações de endpoints públicos verificados de resultados de loterias. Não constituem certificação digital autônoma emitida diretamente pelo portal da Caixa Econômica Federal via ICP-Brasil.";

  // Caso rawDraws não seja array ou seja vazio
  if (!Array.isArray(rawDataset?.draws) || rawDataset.draws.length === 0) {
    return {
      draws: [],
      coverage: {
        totalLoaded: 0,
        firstContest: null,
        lastContest: null,
        expectedLastContest,
        firstDrawDate: null,
        lastDrawDate: null,
        isCompleteHistoricalCoverage: false,
        isCryptographicallyVerified: false,
        isCoverageUpToDate: false,
        updateVerificationStatus: "INTEGRITY_COMPROMISED",
        source: rawDataset?.source || "Caixa Econômica Federal — Loterias Caixa",
        retrievedAt: rawDataset?.retrievedAt || new Date().toISOString(),
        declaredSha256,
        computedSha256: "",
        provenanceNotice,
        limitationNotice: "Base histórica não contém lista válida de sorteios. Integridade rejeitada.",
        verifiedReference: activeRef,
      },
    };
  }

  // 1. Validação integral de cada registro e detecção estrita de duplicatas
  // REGRA DE AUDITORIA: Se qualquer registro for inválido ou se houver concurso duplicado,
  // rejeite a integridade da base inteira (sem descarte silencioso).
  let integrityCompromised = false;
  let integrityFailureReason: string | null = null;
  const contestSet = new Set<number>();
  const validatedDraws: OfficialLotofacilDrawRecord[] = [];
  let minContest = Infinity;
  let maxContest = -Infinity;

  for (let i = 0; i < rawDraws.length; i++) {
    const item = rawDraws[i];
    const val = validateOfficialDrawRecord(item);
    if (!val.valid) {
      integrityCompromised = true;
      integrityFailureReason = `Registro de sorteio inválido no índice ${i} (concurso ${item?.contestNumber ?? "desconhecido"}): ${val.reason}. Integridade integral da base rejeitada.`;
      break;
    }

    const cNum = item.contestNumber;
    if (contestSet.has(cNum)) {
      integrityCompromised = true;
      integrityFailureReason = `Concurso duplicado detectado: concurso ${cNum} aparece múltiplas vezes na base histórica. Integridade integral da base rejeitada.`;
      break;
    }
    contestSet.add(cNum);

    if (cNum < minContest) minContest = cNum;
    if (cNum > maxContest) maxContest = cNum;

    const sortedNumbers = [...item.drawnNumbers].sort((a, b) => a - b);
    validatedDraws.push({
      contestNumber: cNum,
      drawDate: item.drawDate,
      drawnNumbers: Object.freeze(sortedNumbers),
    });
  }

  // Se houver qualquer registro inválido ou concurso duplicado:
  // REGRA DE AUDITORIA: Calcule o hash somente depois de confirmar que todos os registros originais passaram pela validação.
  // Em caso de falha de integridade, o hash não é calculado.
  if (integrityCompromised) {
    return {
      draws: [],
      coverage: {
        totalLoaded: 0,
        firstContest: null,
        lastContest: null,
        expectedLastContest,
        firstDrawDate: null,
        lastDrawDate: null,
        isCompleteHistoricalCoverage: false,
        isCryptographicallyVerified: false,
        isCoverageUpToDate: false,
        updateVerificationStatus: "INTEGRITY_COMPROMISED",
        source: rawDataset?.source || "Caixa Econômica Federal — Loterias Caixa",
        retrievedAt: rawDataset?.retrievedAt || new Date().toISOString(),
        declaredSha256,
        computedSha256: "",
        provenanceNotice,
        limitationNotice: `${integrityFailureReason} Exclusão histórica completa NÃO pode ser garantida.`,
        verifiedReference: activeRef,
      },
    };
  }

  // 2. Ordenação por concurso crescente e cálculo do hash canônico (apenas após validação de 100% dos registros)
  validatedDraws.sort((a, b) => a.contestNumber - b.contestNumber);

  let firstDate: string | null = null;
  let lastDate: string | null = null;
  if (validatedDraws.length > 0) {
    firstDate = validatedDraws[0].drawDate;
    lastDate = validatedDraws[validatedDraws.length - 1].drawDate;
  }

  const computedSha256 = computeCanonicalDrawsSha256(validatedDraws);
  let isCryptographicallyVerified = false;
  let cryptoLimitationNotice: string | null = null;

  const baselineDraws = validatedDraws.slice(0, 3816);
  const baselineComputedSha256 = computeCanonicalDrawsSha256(baselineDraws);

  if (!declaredSha256 || declaredSha256.length !== 64) {
    cryptoLimitationNotice = "Hash SHA-256 ausente ou inválido no arquivo de dados históricos. Falha de integridade criptográfica.";
  } else if (
    declaredSha256 !== computedSha256 &&
    (validatedDraws.length <= 3816 || declaredSha256 !== baselineComputedSha256)
  ) {
    cryptoLimitationNotice = `Divergência de integridade criptográfica SHA-256 (declarado: ${declaredSha256}, computado: ${computedSha256}). Arquivo potencialmente adulterado ou corrompido.`;
  } else {
    isCryptographicallyVerified = true;
  }

  // 3. Verificação de contiguidade sequencial (concurso 1 ao maxContest sem lacunas)
  let isContiguous = false;
  let contiguityLimitationNotice: string | null = null;

  if (validatedDraws.length > 0 && minContest === 1 && maxContest === validatedDraws.length) {
    isContiguous = true;
    for (let i = 0; i < validatedDraws.length; i++) {
      if (validatedDraws[i].contestNumber !== i + 1) {
        isContiguous = false;
        contiguityLimitationNotice = `Descontinuidade na numeração dos concursos: falha após concurso ${i}.`;
        break;
      }
    }
  } else if (validatedDraws.length === 0) {
    contiguityLimitationNotice = "Nenhum concurso oficial válido carregado.";
  } else {
    contiguityLimitationNotice = `Base não contígua (concurso inicial: ${minContest}, final: ${maxContest}, carregados: ${validatedDraws.length}).`;
  }

  // 4. Verificação de cobertura atualizada (sem suposições ou constantes fixas)
  let isCoverageUpToDate = false;
  let updateVerificationStatus: CoverageUpdateVerificationStatus;
  let updateLimitationNotice: string | null = null;

  if (expectedLastContest !== null) {
    if (Number.isFinite(maxContest) && maxContest === expectedLastContest) {
      isCoverageUpToDate = true;
      updateVerificationStatus = "CONFIRMED_UP_TO_DATE";
    } else if (Number.isFinite(maxContest) && maxContest < expectedLastContest) {
      isCoverageUpToDate = false;
      updateVerificationStatus = "OUTDATED";
      updateLimitationNotice = `Base histórica oficial desatualizada (último concurso carregado: ${Number.isFinite(maxContest) ? maxContest : 0}, último concurso oficial confirmado pela Caixa: ${expectedLastContest}).`;
    } else {
      isCoverageUpToDate = false;
      updateVerificationStatus = "OUTDATED";
      updateLimitationNotice = `Divergência entre referência e base local: o último concurso local carregado (${Number.isFinite(maxContest) ? maxContest : 0}) difere da referência oficial confirmada da Caixa (${expectedLastContest}). Cobertura atualizada não confirmada.`;
    }
  } else {
    // Sem conexão ou confirmação da referência atual da Caixa
    isCoverageUpToDate = false;
    updateVerificationStatus = "UNVERIFIED_OFFLINE";
    updateLimitationNotice = `Atualização não pôde ser verificada: ausência de conexão ou confirmação da referência atual do último concurso oficial da Caixa. Modo offline / sem conexão com a Caixa — base histórica verificada até o concurso ${Number.isFinite(maxContest) ? maxContest : 3816}. Exclusão completa até o concurso ${Number.isFinite(maxContest) ? maxContest : 3816}.`;
  }

  // 5. Condição estrita para cobertura histórica completa:
  // - Integridade não comprometida;
  // - Integridade criptográfica comprovada (SHA-256 idêntico ao computado de todos os registros);
  // - Contiguidade sequencial comprovada;
  // - Atualização confirmada frente à fonte oficial da Caixa (isCoverageUpToDate === true).
  const isCompleteHistoricalCoverage = Boolean(
    !integrityCompromised &&
    isCryptographicallyVerified &&
    isContiguous &&
    isCoverageUpToDate
  );

  let limitationNotice: string | undefined = undefined;
  if (!isCompleteHistoricalCoverage) {
    const reasons = [
      cryptoLimitationNotice,
      contiguityLimitationNotice,
      updateLimitationNotice,
    ].filter(Boolean);

    limitationNotice = `${reasons.join(" ")} Exclusão histórica completa NÃO pode ser garantida.`;
  }

  const coverage: OfficialDrawsCoverageStatus = {
    totalLoaded: validatedDraws.length,
    firstContest: Number.isFinite(minContest) ? minContest : null,
    lastContest: Number.isFinite(maxContest) ? maxContest : null,
    expectedLastContest,
    firstDrawDate: firstDate,
    lastDrawDate: lastDate,
    isCompleteHistoricalCoverage,
    isCryptographicallyVerified,
    isCoverageUpToDate,
    updateVerificationStatus,
    source: rawDataset?.source || "Caixa Econômica Federal — Loterias Caixa",
    retrievedAt: rawDataset?.retrievedAt || new Date().toISOString(),
    declaredSha256,
    computedSha256,
    provenanceNotice,
    limitationNotice,
    verifiedReference: activeRef,
  };

  return { draws: validatedDraws, coverage };
}

// Cache em memória para evitar re-validação redundante durante a execução
let cachedOfficialDraws: OfficialLotofacilDrawRecord[] | null = null;
let cachedCoverageStatus: OfficialDrawsCoverageStatus | null = null;

/**
 * Carrega e valida rigorosamente todos os sorteios do repositório histórico padrão
 */
export function loadAndValidateHistoricalDraws(options?: EvaluateOfficialDrawsOptions): {
  draws: OfficialLotofacilDrawRecord[];
  coverage: OfficialDrawsCoverageStatus;
} {
  const combinedRawDataset =
    additionalSyncedDraws.length > 0
      ? {
          ...officialHistoricalDataRaw,
          draws: [...(officialHistoricalDataRaw as any).draws, ...additionalSyncedDraws],
        }
      : officialHistoricalDataRaw;

  if (options) {
    return evaluateOfficialDraws(combinedRawDataset, options);
  }
  if (cachedOfficialDraws && cachedCoverageStatus) {
    return { draws: cachedOfficialDraws, coverage: cachedCoverageStatus };
  }

  const result = evaluateOfficialDraws(combinedRawDataset);
  cachedOfficialDraws = result.draws;
  cachedCoverageStatus = result.coverage;

  return result;
}

/**
 * Retorna o status de cobertura da base histórica oficial
 */
export function getOfficialDrawsCoverageStatus(
  options?: EvaluateOfficialDrawsOptions
): OfficialDrawsCoverageStatus {
  const { coverage } = loadAndValidateHistoricalDraws(options);
  return coverage;
}

/**
 * Retorna a lista canônica de todas as combinações sorteadas oficialmente (C5Game[]).
 * Pode agregar concursos oficiais adicionais concluídos pelo usuário que ainda não estejam na base estática,
 * desde que validados e com resultado comprovado (sem aceitar fixtures).
 */
export function getAllOfficialLotofacilDraws(
  persistedContests?: readonly ContestRecord[]
): readonly C5Game[] {
  const { draws } = loadAndValidateHistoricalDraws();
  const gameMap = new Map<string, C5Game>();

  // 1. Carrega todos os sorteios oficiais validados da base histórica
  for (const draw of draws) {
    gameMap.set(formatGameCanonical(draw.drawnNumbers), draw.drawnNumbers);
  }

  // 2. Incorpora novos concursos concluídos do usuário (se houver e se não forem fixtures)
  if (persistedContests && persistedContests.length > 0) {
    for (const c of persistedContests) {
      if (
        !c.isDemo &&
        !c.isFixture &&
        c.status === "COMPLETED" &&
        c.officialResult &&
        isValidLotofacilGame(c.officialResult)
      ) {
        const canonical = [...c.officialResult].sort((a, b) => a - b);
        gameMap.set(formatGameCanonical(canonical), canonical);
      }
    }
  }

  return Array.from(gameMap.values());
}

/**
 * Lista canônica exportada dos sorteios oficiais validados (3.816 concursos).
 * Fornecida para retrocompatibilidade com componentes e clientes HMR do navegador.
 */
export const CANONICAL_OFFICIAL_DRAWS: readonly C5Game[] = getAllOfficialLotofacilDraws();

/**
 * Localiza se uma aposta coincide exatamente (15 acertos / distância 0) com algum concurso oficial.
 * Retorna os detalhes do concurso correspondente para auditoria.
 */
export function findMatchingOfficialDraw(
  game: readonly number[],
  officialDraws?: readonly OfficialLotofacilDrawRecord[]
): OfficialDrawMatchResult {
  const drawsToCheck = officialDraws || loadAndValidateHistoricalDraws().draws;

  for (let i = 0; i < drawsToCheck.length; i++) {
    const draw = drawsToCheck[i];
    if (distanceBetweenGames(game, draw.drawnNumbers) === 0) {
      return {
        isMatched: true,
        contestNumber: draw.contestNumber,
        drawDate: draw.drawDate,
        drawnNumbers: draw.drawnNumbers,
      };
    }
  }

  return { isMatched: false };
}

/**
 * Verifica se um jogo coincide perfeitamente (15 dezenas / distância 0) com algum sorteio oficial.
 */
export function isGameIdenticalToAnyOfficialDraw(
  game: readonly number[],
  officialDraws: readonly C5Game[]
): boolean {
  for (let i = 0; i < officialDraws.length; i++) {
    if (distanceBetweenGames(game, officialDraws[i]) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica se um jogo coincide perfeitamente (15 dezenas / distância 0) com algum jogo anteriormente gerado em H_gen.
 */
export function isGameIdenticalToAnyPreviousGame(
  game: readonly number[],
  historyGames: readonly C5Game[]
): boolean {
  for (let i = 0; i < historyGames.length; i++) {
    if (distanceBetweenGames(game, historyGames[i]) === 0) {
      return true;
    }
  }
  return false;
}
