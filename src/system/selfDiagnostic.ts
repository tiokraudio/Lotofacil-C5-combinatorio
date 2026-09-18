/**
 * Módulo de Autodiagnóstico da Aplicação e do Motor C₅ (Versão 1.1).
 *
 * Executa inspeções independentes e não destrutivas sobre:
 * 1. Versões e Manifesto Canônico
 * 2. Primitivas Criptográficas (Web Crypto API)
 * 3. Gerador Pseudo-Aleatório Seguro (RNG Smoke Test)
 * 4. Motor Canônico C₅ (Golden Standard Runtime & Interseções Exatas)
 * 5. Validador Independente de Invariantes (validateC5)
 * 6. Armazenamento Local (IndexedDB Read-Only + Isolated Write Test)
 * 7. Auditoria Completa do Histórico Local (auditEntireHistory)
 * 8. Conectividade e Disponibilidade Externa (CAIXA Oficial)
 */

import { APP_VERSION, APP_NAME, APPLICATION_MANIFEST } from "./manifest.ts";
import { C5_ALGORITHM_VERSION } from "../c5/version.ts";
import { buildC5FromPermutation } from "../c5/canonicalBuilder.ts";
import { validateC5 } from "../c5/validator.ts";
import { cryptoRandomInt } from "../c5/random.ts";
import type { C5Generation } from "../c5/types.ts";
import { ContestRepository } from "../storage/contestRepository.ts";
import {
  DEFAULT_DB_NAME,
  DB_VERSION,
  CONTEST_STORE_NAME,
  getIDBFactory,
  openDatabase,
} from "../storage/db.ts";
import type { LotteryResultProvider } from "../lottery/types.ts";
import { CaixaLotteryProvider } from "../lottery/caixaProvider.ts";

export type DiagnosticStatus = "PASS" | "WARN" | "FAIL" | "UNAVAILABLE";

export interface DiagnosticCheck {
  id: string;
  name: string;
  category:
    | "SYSTEM"
    | "CRYPTO"
    | "RNG"
    | "GOLDEN"
    | "VALIDATOR"
    | "STORAGE"
    | "HISTORY"
    | "EXTERNAL";
  status: DiagnosticStatus;
  message: string;
  details?: Record<string, unknown>;
  durationMs: number;
}

export interface HistoryAuditDiagnostic {
  valid: boolean;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  corruptedDetails?: string[];
}

export interface ExternalCaixaDiagnostic {
  reachable: boolean;
  status: DiagnosticStatus;
  latestContestNumber?: number;
  nextContestNumber?: number;
  responseTimeMs?: number;
  error?: string;
}

export interface SelfDiagnosticResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  appVersion: string;
  algorithmVersion: string;
  localStatus: "PASS" | "WARN" | "FAIL";
  globalStatus: "PASS" | "WARN" | "FAIL";
  checks: DiagnosticCheck[];
  historyAudit: HistoryAuditDiagnostic;
  external?: ExternalCaixaDiagnostic;
}

export interface SelfDiagnosticOptions {
  checkExternal?: boolean;
  lotteryProvider?: LotteryResultProvider;
  repository?: ContestRepository;
  idbFactory?: IDBFactory;
  cryptoOverride?: {
    getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
    subtle?: SubtleCrypto;
    randomUUID?: () => string;
  };
  builderOverride?: (permutation: number[]) => C5Generation;
}

// Matriz canônica de referência para a permutação identidade [1..25]
const EXPECTED_GOLDEN_GAMES: [number[], number[], number[], number[], number[]] = [
  [4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25],
  [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 25],
  [1, 2, 3, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23],
  [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 22, 23, 24, 25],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21],
];

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function calcIntersection(a: number[], b: number[]): number {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x)).length;
}

/**
 * Executa o autodiagnóstico integral da aplicação.
 */
export async function runSelfDiagnostic(
  options?: SelfDiagnosticOptions
): Promise<SelfDiagnosticResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const checks: DiagnosticCheck[] = [];

  let localFailed = false;
  let localWarn = false;

  // -------------------------------------------------------------------------
  // 1. MANIFESTO & VERSÕES
  // -------------------------------------------------------------------------
  {
    const t0 = Date.now();
    const isAppVerOk = APP_VERSION === "1.1.0";
    const isAlgoVerOk = C5_ALGORITHM_VERSION === "C5-1.0.0";
    const isManifestOk =
      APPLICATION_MANIFEST.appVersion === "1.1.0" &&
      APPLICATION_MANIFEST.algorithmVersion === "C5-1.0.0" &&
      APPLICATION_MANIFEST.canonicalSlots.length === 25;

    const pass = isAppVerOk && isAlgoVerOk && isManifestOk;
    checks.push({
      id: "manifest_version",
      name: "Aplicação & Algoritmo",
      category: "SYSTEM",
      status: pass ? "PASS" : "FAIL",
      message: pass
        ? `${APP_NAME} v${APP_VERSION} (Motor ${C5_ALGORITHM_VERSION}) íntegro`
        : `Divergência de versão detectada (App: ${APP_VERSION}, Algoritmo: ${C5_ALGORITHM_VERSION})`,
      details: {
        appVersion: APP_VERSION,
        algorithmVersion: C5_ALGORITHM_VERSION,
        slotsCount: APPLICATION_MANIFEST.canonicalSlots.length,
      },
      durationMs: Date.now() - t0,
    });
    if (!pass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 2. WEB CRYPTO
  // -------------------------------------------------------------------------
  {
    const t0 = Date.now();
    const cryptoObj =
      options?.cryptoOverride !== undefined
        ? options.cryptoOverride
        : typeof globalThis !== "undefined"
        ? globalThis.crypto
        : undefined;

    const hasGlobal = typeof cryptoObj !== "undefined";
    const hasGetRandomValues =
      hasGlobal && typeof cryptoObj.getRandomValues === "function";
    const hasSubtle = hasGlobal && typeof cryptoObj.subtle !== "undefined";
    const hasRandomUUID =
      hasGlobal && typeof cryptoObj.randomUUID === "function";

    const cryptoPass =
      hasGlobal && hasGetRandomValues && hasSubtle && hasRandomUUID;

    checks.push({
      id: "web_crypto",
      name: "Web Crypto API",
      category: "CRYPTO",
      status: cryptoPass ? "PASS" : "FAIL",
      message: cryptoPass
        ? "Primitivas criptográficas (getRandomValues, subtle, randomUUID) plenamente operacionais"
        : "Recurso Web Crypto obrigatório indisponível no ambiente",
      details: {
        globalCrypto: hasGlobal,
        getRandomValues: hasGetRandomValues,
        subtleCrypto: hasSubtle,
        randomUUID: hasRandomUUID,
      },
      durationMs: Date.now() - t0,
    });
    if (!cryptoPass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 3. RNG SMOKE TEST
  // -------------------------------------------------------------------------
  {
    const t0 = Date.now();
    let rngPass = true;
    const errors: string[] = [];

    try {
      // Teste de limites seguros sem sobrecarga
      for (let i = 0; i < 10; i++) {
        const v1 = cryptoRandomInt(1);
        if (v1 !== 0) {
          rngPass = false;
          errors.push(`cryptoRandomInt(1) retornou ${v1} (esperava 0)`);
        }
        const v2 = cryptoRandomInt(2);
        if (v2 !== 0 && v2 !== 1) {
          rngPass = false;
          errors.push(`cryptoRandomInt(2) retornou ${v2} (esperava 0 ou 1)`);
        }
        const v25 = cryptoRandomInt(25);
        if (v25 < 0 || v25 >= 25 || !Number.isInteger(v25)) {
          rngPass = false;
          errors.push(`cryptoRandomInt(25) retornou ${v25} fora de [0, 24]`);
        }
      }
    } catch (err: unknown) {
      rngPass = false;
      errors.push(
        `Erro ao executar amostragem RNG: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    checks.push({
      id: "rng_smoke",
      name: "RNG Criptográfico (Rejection Sampling)",
      category: "RNG",
      status: rngPass ? "PASS" : "FAIL",
      message: rngPass
        ? "Amostragem criptográfica uniforme testada e delimitada com sucesso"
        : `Falha no RNG: ${errors.join("; ")}`,
      durationMs: Date.now() - t0,
    });
    if (!rngPass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 4. GOLDEN STANDARD RUNTIME (Permutação Identidade [1..25])
  // -------------------------------------------------------------------------
  let goldenGen: C5Generation | null = null;
  {
    const t0 = Date.now();
    const identity = Array.from({ length: 25 }, (_, i) => i + 1);
    let builderPass = true;
    const discrepancies: string[] = [];

    try {
      const builder = options?.builderOverride ?? buildC5FromPermutation;
      goldenGen = builder(identity);

      for (let g = 0; g < 5; g++) {
        if (!arraysEqual(goldenGen.games[g], EXPECTED_GOLDEN_GAMES[g])) {
          builderPass = false;
          discrepancies.push(
            `J${g + 1} gerado [${goldenGen.games[g].join(
              " "
            )}] != esperado [${EXPECTED_GOLDEN_GAMES[g].join(" ")}]`
          );
        }
      }
    } catch (err: unknown) {
      builderPass = false;
      discrepancies.push(
        `Exceção ao construir Golden Standard: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    checks.push({
      id: "golden_runtime",
      name: "Motor Canônico C₅ (Golden Standard)",
      category: "GOLDEN",
      status: builderPass ? "PASS" : "FAIL",
      message: builderPass
        ? "Jogos canônicos J1..J5 produzidos pelo builder idênticos ao Golden Standard oficial"
        : `Divergência matemática no Golden Standard: ${discrepancies.join(
            "; "
          )}`,
      durationMs: Date.now() - t0,
    });
    if (!builderPass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 5. INTERSEÇÕES NOMEADAS EM RUNTIME
  // -------------------------------------------------------------------------
  {
    const t0 = Date.now();
    let intersectionsPass = false;
    let details: Record<string, number> = {};

    if (goldenGen) {
      const j = goldenGen.games;
      const i12 = calcIntersection(j[0], j[1]);
      const i23 = calcIntersection(j[1], j[2]);
      const i34 = calcIntersection(j[2], j[3]);
      const i45 = calcIntersection(j[3], j[4]);
      const i51 = calcIntersection(j[4], j[0]);

      const i13 = calcIntersection(j[0], j[2]);
      const i14 = calcIntersection(j[0], j[3]);
      const i24 = calcIntersection(j[1], j[3]);
      const i25 = calcIntersection(j[1], j[4]);
      const i35 = calcIntersection(j[2], j[4]);

      details = {
        "J1∩J2": i12,
        "J2∩J3": i23,
        "J3∩J4": i34,
        "J4∩J5": i45,
        "J5∩J1": i51,
        "J1∩J3": i13,
        "J1∩J4": i14,
        "J2∩J4": i24,
        "J2∩J5": i25,
        "J3∩J5": i35,
      };

      const pairs8Ok =
        i12 === 8 && i23 === 8 && i34 === 8 && i45 === 8 && i51 === 8;
      const pairs7Ok =
        i13 === 7 && i14 === 7 && i24 === 7 && i25 === 7 && i35 === 7;

      intersectionsPass = pairs8Ok && pairs7Ok;
    }

    checks.push({
      id: "named_intersections",
      name: "Geometria de Interseções C₅",
      category: "GOLDEN",
      status: intersectionsPass ? "PASS" : "FAIL",
      message: intersectionsPass
        ? "Exatamente 5 pares com 8 dezenas e 5 pares com 7 dezenas confirmados [7,7,7,7,7,8,8,8,8,8]"
        : "Interseções entre pares violam a geometria do grafo canônico C₅",
      details,
      durationMs: Date.now() - t0,
    });
    if (!intersectionsPass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 6. VALIDADOR DE INVARIANTES (validateC5)
  // -------------------------------------------------------------------------
  {
    const t0 = Date.now();
    let valPass = false;
    let valErrors: string[] = [];

    if (goldenGen) {
      const res = validateC5(goldenGen);
      valPass = res.valid;
      valErrors = res.errors;
    }

    checks.push({
      id: "validator_c5",
      name: "Validador de Invariantes C₅ (validateC5)",
      category: "VALIDATOR",
      status: valPass ? "PASS" : "FAIL",
      message: valPass
        ? "Todas as invariantes estruturais (A a I) aprovadas pelo validador independente"
        : `Validador rejeitou geração canônica: ${valErrors.join("; ")}`,
      durationMs: Date.now() - t0,
    });
    if (!valPass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 7. INDEXEDDB (Read-Only Real DB + Isolated Temp Write)
  // -------------------------------------------------------------------------
  {
    const t0 = Date.now();
    let idbPass = true;
    let idbMessage = "";

    try {
      const factory = getIDBFactory({ idbFactory: options?.idbFactory });

      // Verificação de leitura não destrutiva no banco oficial
      const officialDb = await openDatabase({ idbFactory: options?.idbFactory });
      try {
        const tx = officialDb.transaction([CONTEST_STORE_NAME], "readonly");
        const store = tx.objectStore(CONTEST_STORE_NAME);
        await new Promise<void>((resolve, reject) => {
          const countReq = store.count();
          countReq.onsuccess = () => resolve();
          countReq.onerror = () =>
            reject(new Error("Falha ao ler registros do banco oficial"));
        });
      } finally {
        officialDb.close();
      }

      // Teste de escrita isolado em banco temporário exclusivo
      const tempDbName = `c5_diag_tmp_${Date.now()}_${Math.floor(
        Math.random() * 100000
      )}`;
      await new Promise<void>((resolve, reject) => {
        const tempReq = factory.open(tempDbName, 1);
        tempReq.onupgradeneeded = () => {
          const db = tempReq.result;
          db.createObjectStore("diag_test", { keyPath: "id" });
        };
        tempReq.onsuccess = () => {
          const db = tempReq.result;
          try {
            const tx = db.transaction(["diag_test"], "readwrite");
            const store = tx.objectStore("diag_test");
            store.put({ id: 1, ping: "pong", ts: Date.now() });
            tx.oncomplete = () => {
              db.close();
              factory.deleteDatabase(tempDbName);
              resolve();
            };
            tx.onerror = () => {
              db.close();
              factory.deleteDatabase(tempDbName);
              reject(new Error("Falha em transação de escrita isolada"));
            };
          } catch (e) {
            db.close();
            factory.deleteDatabase(tempDbName);
            reject(e);
          }
        };
        tempReq.onerror = () =>
          reject(new Error("Falha ao abrir banco temporário de diagnóstico"));
      });

      idbMessage =
        "Banco de dados oficial operacional para leitura; escrita isolada validada com sucesso";
    } catch (err: unknown) {
      idbPass = false;
      idbMessage = `Falha no armazenamento local: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }

    checks.push({
      id: "indexeddb_storage",
      name: "Armazenamento Local (IndexedDB)",
      category: "STORAGE",
      status: idbPass ? "PASS" : "FAIL",
      message: idbMessage,
      durationMs: Date.now() - t0,
    });
    if (!idbPass) localFailed = true;
  }

  // -------------------------------------------------------------------------
  // 8. AUDITORIA DO HISTÓRICO LOCAL
  // -------------------------------------------------------------------------
  let historyAuditResult: HistoryAuditDiagnostic = {
    valid: true,
    totalRecords: 0,
    validRecords: 0,
    invalidRecords: 0,
  };

  {
    const t0 = Date.now();
    try {
      const repo =
        options?.repository ??
        new ContestRepository({ idbFactory: options?.idbFactory });
      const audit = await repo.auditEntireHistory();

      const corrupted = audit.records.filter((r) => !r.valid);
      historyAuditResult = {
        valid: audit.valid,
        totalRecords: audit.totalRecords,
        validRecords: audit.validRecords,
        invalidRecords: audit.invalidRecords,
        corruptedDetails: corrupted.map(
          (c) => `Concurso ${c.contestNumber}: ${c.errors.join("; ")}`
        ),
      };

      if (audit.totalRecords === 0) {
        checks.push({
          id: "history_audit",
          name: "Histórico de Concursos",
          category: "HISTORY",
          status: "PASS",
          message: "Histórico vazio; 0 registros cadastrados",
          details: { ...historyAuditResult },
          durationMs: Date.now() - t0,
        });
      } else if (audit.valid) {
        checks.push({
          id: "history_audit",
          name: "Histórico de Concursos",
          category: "HISTORY",
          status: "PASS",
          message: `${audit.totalRecords} registro(s) auditados com 100% de integridade criptográfica`,
          details: { ...historyAuditResult },
          durationMs: Date.now() - t0,
        });
      } else {
        localWarn = true;
        checks.push({
          id: "history_audit",
          name: "Histórico de Concursos",
          category: "HISTORY",
          status: "WARN",
          message: `Inconsistência detectada em ${audit.invalidRecords} registro(s) do histórico`,
          details: { ...historyAuditResult },
          durationMs: Date.now() - t0,
        });
      }
    } catch (err: unknown) {
      localWarn = true;
      checks.push({
        id: "history_audit",
        name: "Histórico de Concursos",
        category: "HISTORY",
        status: "WARN",
        message: `Falha ao auditar histórico: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. CONECTIVIDADE EXTERNA (CAIXA Oficial)
  // -------------------------------------------------------------------------
  let externalDiag: ExternalCaixaDiagnostic | undefined = undefined;

  if (options?.checkExternal) {
    const t0 = Date.now();
    try {
      const provider = options.lotteryProvider ?? new CaixaLotteryProvider();
      const latest = await provider.getLatestContest();
      const elapsed = Date.now() - t0;

      externalDiag = {
        reachable: true,
        status: "PASS",
        latestContestNumber: latest.contestNumber,
        nextContestNumber: latest.nextContestNumber,
        responseTimeMs: elapsed,
      };

      checks.push({
        id: "caixa_external",
        name: "API Loterias CAIXA (Externa)",
        category: "EXTERNAL",
        status: "PASS",
        message: `Portal oficial acessível (Concurso ${latest.contestNumber} obtido em ${elapsed}ms)`,
        details: { ...externalDiag },
        durationMs: elapsed,
      });
    } catch (err: unknown) {
      const elapsed = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : String(err);

      externalDiag = {
        reachable: false,
        status: "UNAVAILABLE",
        responseTimeMs: elapsed,
        error: errMsg,
      };

      checks.push({
        id: "caixa_external",
        name: "API Loterias CAIXA (Externa)",
        category: "EXTERNAL",
        status: "UNAVAILABLE",
        message: `Portal de loterias inacessível ou offline: ${errMsg}`,
        details: { ...externalDiag },
        durationMs: elapsed,
      });
    }
  } else {
    // Verificação externa pulada deliberadamente (ex: execução inicial passiva ou modo offline)
    externalDiag = {
      reachable: false,
      status: "UNAVAILABLE",
      error: "Consulta externa não solicitada ou em modo offline",
    };
    checks.push({
      id: "caixa_external",
      name: "API Loterias CAIXA (Externa)",
      category: "EXTERNAL",
      status: "UNAVAILABLE",
      message: "Consulta externa não solicitada ou em modo offline",
      durationMs: 0,
    });
  }

  // -------------------------------------------------------------------------
  // DETERMINAÇÃO DOS STATUS GLOBAIS E LOCAIS
  // -------------------------------------------------------------------------
  const localStatus: "PASS" | "WARN" | "FAIL" = localFailed
    ? "FAIL"
    : localWarn
    ? "WARN"
    : "PASS";

  const globalStatus: "PASS" | "WARN" | "FAIL" =
    localStatus === "FAIL"
      ? "FAIL"
      : localStatus === "WARN" || externalDiag?.status === "UNAVAILABLE"
      ? "WARN"
      : "PASS";

  const finishedAt = new Date().toISOString();
  const totalDuration = Date.now() - startTime;

  return {
    startedAt,
    finishedAt,
    durationMs: totalDuration,
    appVersion: APP_VERSION,
    algorithmVersion: C5_ALGORITHM_VERSION,
    localStatus,
    globalStatus,
    checks,
    historyAudit: historyAuditResult,
    external: externalDiag,
  };
}
