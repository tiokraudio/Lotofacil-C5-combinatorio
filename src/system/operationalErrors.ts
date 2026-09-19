/**
 * Classificação e Tratamento de Erros Operacionais (v1.5.0)
 *
 * Garante:
 * - Tipagem estrita de causas operacionais (AppOperationalErrorCode)
 * - Mensagens objetivas e acolhedoras para o usuário sem exposição de stack traces ou DOMExceptions
 * - Preservação da integridade da causa interna para logs de desenvolvimento
 * - Clareza sobre se os dados locais foram preservados e qual a ação recomendada
 */

export type AppOperationalErrorCode =
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_WRITE_FAILED"
  | "CRYPTO_UNAVAILABLE"
  | "NETWORK_UNAVAILABLE"
  | "CAIXA_TEMPORARY_ERROR"
  | "EXTERNAL_INVALID"
  | "CONCURRENT_MODIFICATION"
  | "QUARANTINED"
  | "UNKNOWN";

export interface OperationalErrorInfo {
  code: AppOperationalErrorCode;
  userMessage: string;
  dataPreserved: boolean;
  suggestedAction: string;
}

export class AppOperationalError extends Error {
  readonly code: AppOperationalErrorCode;
  readonly userMessage: string;
  readonly dataPreserved: boolean;
  readonly suggestedAction: string;
  readonly originalError?: unknown;

  constructor(
    code: AppOperationalErrorCode,
    userMessage: string,
    options: {
      dataPreserved?: boolean;
      suggestedAction?: string;
      originalError?: unknown;
    } = {}
  ) {
    super(userMessage);
    this.name = "AppOperationalError";
    this.code = code;
    this.userMessage = userMessage;
    this.dataPreserved = options.dataPreserved ?? true;
    this.suggestedAction = options.suggestedAction ?? "Verifique os dados e tente novamente.";
    this.originalError = options.originalError;
  }
}

/**
 * Mapeia qualquer erro capturado para AppOperationalError sem expor stack traces ou dados sensíveis.
 */
export function classifyOperationalError(
  err: unknown,
  fallbackCode: AppOperationalErrorCode = "UNKNOWN"
): AppOperationalError {
  if (err instanceof AppOperationalError) {
    return err;
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : "";

  // 1. Erros de WebCrypto
  if (
    rawMessage.includes("crypto") ||
    rawMessage.includes("getRandomValues") ||
    rawMessage.includes("subtle") ||
    rawMessage.includes("Web Crypto")
  ) {
    return new AppOperationalError(
      "CRYPTO_UNAVAILABLE",
      "Mecanismo criptográfico seguro (WebCrypto) indisponível neste navegador. Operação bloqueada para sua segurança.",
      {
        dataPreserved: true,
        suggestedAction: "Abra a aplicação em um navegador moderno com suporte a WebCrypto e conexão segura (HTTPS).",
        originalError: err,
      }
    );
  }

  // 2. Erros de Quota de Armazenamento ou Falha de Escrita no IndexedDB
  if (
    errName === "QuotaExceededError" ||
    rawMessage.includes("QuotaExceededError") ||
    rawMessage.includes("quota") ||
    rawMessage.includes("storage write") ||
    rawMessage.includes("gravação")
  ) {
    return new AppOperationalError(
      "STORAGE_WRITE_FAILED",
      "Não foi possível salvar os dados no armazenamento local. Nenhuma confirmação de gravação foi recebida.",
      {
        dataPreserved: true,
        suggestedAction: "Libere espaço de armazenamento no navegador e tente novamente.",
        originalError: err,
      }
    );
  }

  // 3. Conflito de Concorrência
  if (
    errName === "ConstraintError" ||
    rawMessage.includes("Colisão de concurso") ||
    rawMessage.includes("mudou durante a operação") ||
    rawMessage.includes("já possui registro") ||
    rawMessage.includes("Operação concorrente")
  ) {
    return new AppOperationalError(
      "CONCURRENT_MODIFICATION",
      "Conflito de concorrência detectado: o registro foi modificado em outra aba ou operação simultânea.",
      {
        dataPreserved: true,
        suggestedAction: "Atualize os dados e confirme o estado atual antes de tentar novamente.",
        originalError: err,
      }
    );
  }

  // 4. Quarentena
  if (
    rawMessage.includes("quarentena") ||
    rawMessage.includes("quarantine") ||
    rawMessage.includes("falhou na auditoria de integridade")
  ) {
    return new AppOperationalError(
      "QUARANTINED",
      "O registro encontra-se em quarentena de segurança e não pode sofrer mutações.",
      {
        dataPreserved: true,
        suggestedAction: "Acesse a aba Auditoria & Backup para inspecionar os detalhes do registro.",
        originalError: err,
      }
    );
  }

  // 5. Erros de Acesso/Abertura do IndexedDB
  if (
    rawMessage.includes("IndexedDB") ||
    rawMessage.includes("armazenamento local") ||
    rawMessage.includes("IDBDatabase") ||
    rawMessage.includes("openDatabase")
  ) {
    return new AppOperationalError(
      "STORAGE_UNAVAILABLE",
      "Não foi possível acessar o armazenamento local.",
      {
        dataPreserved: true,
        suggestedAction: "Verifique se a navegação anônima está restringindo o IndexedDB ou recarregue a página.",
        originalError: err,
      }
    );
  }

  // 6. Erros de Rede / Conexão com CAIXA
  if (
    rawMessage.includes("fetch") ||
    rawMessage.includes("rede") ||
    rawMessage.includes("offline") ||
    rawMessage.includes("network") ||
    rawMessage.includes("indisponível")
  ) {
    return new AppOperationalError(
      "NETWORK_UNAVAILABLE",
      "A fonte oficial (CAIXA) está temporariamente inacessível. O aplicativo local permanece disponível.",
      {
        dataPreserved: true,
        suggestedAction: "Verifique sua conexão com a internet ou tente consultar mais tarde.",
        originalError: err,
      }
    );
  }

  // 7. Resultado Externo Inválido
  if (
    rawMessage.includes("não corresponde") ||
    rawMessage.includes("pertence ao concurso") ||
    rawMessage.includes("divergência") ||
    rawMessage.includes("inválido")
  ) {
    return new AppOperationalError(
      "EXTERNAL_INVALID",
      rawMessage,
      {
        dataPreserved: true,
        suggestedAction: "Verifique o número do concurso solicitado e tente novamente.",
        originalError: err,
      }
    );
  }

  // Fallback padrão seguro sem expor stack
  return new AppOperationalError(
    fallbackCode,
    rawMessage.length > 0 ? rawMessage : "Ocorreu um erro operacional inesperado.",
    {
      dataPreserved: true,
      suggestedAction: "Tente realizar a operação novamente.",
      originalError: err,
    }
  );
}
