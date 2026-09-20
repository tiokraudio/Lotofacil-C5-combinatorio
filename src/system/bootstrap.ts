/**
 * Bootstrap Centralizado da Aplicação (v1.5.0)
 *
 * Estados do ciclo de vida:
 * - BOOTING: Verificação inicial de infraestrutura local essencial. Botões inativos.
 * - READY: Infraestrutura essencial íntegra e operacional.
 * - DEGRADED: Falha não-essencial ou presença de quarentena. Registros válidos operacionais.
 * - FATAL: Falha essencial (IndexedDB inacessível, WebCrypto ausente, manifesto inconsistente).
 *          Operações de mutação bloqueadas. Permite ação "Tentar Novamente".
 */

import { APP_VERSION, APPLICATION_MANIFEST } from "./manifest.ts";
import { C5_ALGORITHM_VERSION } from "../c5/version.ts";
import { ContestRepository } from "../storage/contestRepository.ts";
import { openDatabase, closeDatabase } from "../storage/db.ts";
import type { StorageOptions } from "../storage/types.ts";
import {
  type AppOperationalErrorCode,
  AppOperationalError,
  classifyOperationalError,
} from "./operationalErrors.ts";

export type AppBootState = "BOOTING" | "READY" | "DEGRADED" | "FATAL";

export interface AppBootResult {
  state: AppBootState;
  bootId: number;
  stale?: boolean;
  totalRecords: number;
  validRecords: number;
  quarantineCount: number;
  durationMs: number;
  error?: {
    code: AppOperationalErrorCode;
    message: string;
    userMessage: string;
    canRetry: boolean;
  };
}

export interface BootstrapOptions {
  storageOptions?: StorageOptions;
  repository?: ContestRepository;
  cryptoObj?: {
    getRandomValues?: (array: any) => any;
    subtle?: any;
    randomUUID?: () => string;
  };
}

let activeBootRunId = 0;

/**
 * Executa o bootstrap centralizado da aplicação.
 * Protegido contra race conditions via monotonic runId.
 */
export async function performAppBootstrap(options?: BootstrapOptions): Promise<AppBootResult> {
  const bootId = ++activeBootRunId;
  const startTime = Date.now();

  try {
    // 1. Verificação Estrita de WebCrypto (Essencial Global)
    const cryptoSource = options?.cryptoObj ?? (typeof window !== "undefined" ? window.crypto : (globalThis as any).crypto);

    if (!cryptoSource || typeof cryptoSource.getRandomValues !== "function") {
      return {
        state: "FATAL",
        bootId,
        totalRecords: 0,
        validRecords: 0,
        quarantineCount: 0,
        durationMs: Date.now() - startTime,
        error: {
          code: "CRYPTO_UNAVAILABLE",
          message: "crypto.getRandomValues ausente ou inválido.",
          userMessage: "Mecanismo criptográfico seguro (WebCrypto) indisponível neste navegador. Operação bloqueada para sua segurança.",
          canRetry: true,
        },
      };
    }

    if (!cryptoSource.subtle) {
      return {
        state: "FATAL",
        bootId,
        totalRecords: 0,
        validRecords: 0,
        quarantineCount: 0,
        durationMs: Date.now() - startTime,
        error: {
          code: "CRYPTO_UNAVAILABLE",
          message: "crypto.subtle ausente.",
          userMessage: "Mecanismo criptográfico SHA-256 (crypto.subtle) indisponível neste navegador. Operação bloqueada para sua segurança.",
          canRetry: true,
        },
      };
    }

    // 2. Verificação de Integridade do Manifesto e Versões
    if (
      APP_VERSION !== "1.6.0" ||
      APPLICATION_MANIFEST.appVersion !== "1.6.0" ||
      C5_ALGORITHM_VERSION !== "C5-1.0.0" ||
      APPLICATION_MANIFEST.algorithmVersion !== "C5-1.0.0" ||
      APPLICATION_MANIFEST.canonicalSlots.length !== 25
    ) {
      return {
        state: "FATAL",
        bootId,
        totalRecords: 0,
        validRecords: 0,
        quarantineCount: 0,
        durationMs: Date.now() - startTime,
        error: {
          code: "UNKNOWN",
          message: "Manifesto ou versões internas corrompidos ou inconsistentes.",
          userMessage: "Inconsistência interna de manifesto da aplicação.",
          canRetry: true,
        },
      };
    }

    // 3. Verificação de Acesso e Conexão com o IndexedDB
    let db: IDBDatabase | null = null;
    try {
      db = await openDatabase(options?.storageOptions);
    } catch (dbErr: any) {
      return {
        state: "FATAL",
        bootId,
        totalRecords: 0,
        validRecords: 0,
        quarantineCount: 0,
        durationMs: Date.now() - startTime,
        error: {
          code: "STORAGE_UNAVAILABLE",
          message: dbErr?.message || "Falha ao abrir IndexedDB",
          userMessage: "Não foi possível acessar o armazenamento local.",
          canRetry: true,
        },
      };
    } finally {
      if (db) {
        closeDatabase(db);
      }
    }

    // 4. Auditoria Coordenada do Histórico Local (Única chamada no Boot)
    const repo = options?.repository ?? new ContestRepository(options?.storageOptions);
    let auditResult;
    try {
      auditResult = await repo.auditEntireHistory();
    } catch (auditErr: any) {
      return {
        state: "FATAL",
        bootId,
        totalRecords: 0,
        validRecords: 0,
        quarantineCount: 0,
        durationMs: Date.now() - startTime,
        error: {
          code: "STORAGE_UNAVAILABLE",
          message: auditErr?.message || "Falha ao ler histórico local",
          userMessage: "Não foi possível acessar o armazenamento local.",
          canRetry: true,
        },
      };
    }

    // Verifica se uma nova inicialização foi disparada enquanto esta aguardava I/O
    if (bootId !== activeBootRunId) {
      return {
        state: "BOOTING",
        bootId,
        stale: true,
        totalRecords: auditResult.totalRecords,
        validRecords: auditResult.validRecords,
        quarantineCount: auditResult.quarantinedRecords ?? 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Avaliação do Estado do Boot (Quarentena -> DEGRADED; Íntegro/Vazio -> READY)
    const quarantineCount = auditResult.quarantinedRecords ?? 0;
    const hasInvalid = !auditResult.valid || quarantineCount > 0 || auditResult.invalidRecords > 0;

    if (hasInvalid) {
      return {
        state: "DEGRADED",
        bootId,
        totalRecords: auditResult.totalRecords,
        validRecords: auditResult.validRecords,
        quarantineCount,
        durationMs: Date.now() - startTime,
        error: {
          code: "QUARANTINED",
          message: `${quarantineCount} registro(s) em quarentena de integridade.`,
          userMessage: `${quarantineCount} concurso(s) com violação de integridade em quarentena. Os registros válidos permanecem operacionais.`,
          canRetry: false,
        },
      };
    }

    return {
      state: "READY",
      bootId,
      totalRecords: auditResult.totalRecords,
      validRecords: auditResult.validRecords,
      quarantineCount: 0,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const operational = classifyOperationalError(err);
    return {
      state: "FATAL",
      bootId,
      totalRecords: 0,
      validRecords: 0,
      quarantineCount: 0,
      durationMs: Date.now() - startTime,
      error: {
        code: operational.code,
        message: operational.message,
        userMessage: operational.userMessage,
        canRetry: true,
      },
    };
  }
}
