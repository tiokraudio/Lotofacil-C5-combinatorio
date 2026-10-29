/**
 * Gerenciador de Persistência e Transação Atômica C5-Memory-2.1.0
 * Ordem Executiva IC3
 * 
 * Regras Estritas:
 * 1. FONTE CANÔNICA DE VERDADE: Store 'contests'.
 * 2. READ-MODEL DERIVADO: Store 'c5_memory_history'.
 * 3. Transação Atômica Multi-Store: commit total ou rollback com zero efeitos.
 * 4. OCC por revision e fingerprint.
 * 5. Anti-TOCTOU na confirmação.
 * 6. Hard Duplicate Guard cross-version (2.0.0 e 2.1.0).
 * 7. Imutabilidade absoluta do estado FROZEN.
 * 8. Preservação estrita da identidade da versão (2.0.0 nunca vira 2.1.0).
 */

import {
  ContestRecord,
  MemoryHistory,
  C5Game,
  ResultSource,
  ContestFinancialStatus,
  ContestAuditEvent,
  isValidIso8601Timestamp,
} from "../c5-memory/types";
import { Draft210, FrozenMemoryPayload210, freezeDraft210, ALGORITHM_VERSION_2_1_0 } from "../c5-memory/engine210";
import { formatGameCanonical, createMemoryHistory } from "../c5-memory/history";
import { calculateHits } from "../c5-memory/math";
import {
  COST_PER_CONTEST,
  FIXED_PRIZES,
  getLotofacilRuleSet,
  getContestStandardCost,
} from "../c5-memory/lotofacilRules";
import { syncSha256 } from "../c5-memory/sha256";

export const STORE_CONTESTS = "contests";
export const STORE_MEMORY_HISTORY = "c5_memory_history";
export const STORE_AUDIT_EVENTS = "auditEvents";
export const CANONICAL_STORAGE_SOURCE = "contests" as const;
export const DERIVED_STORAGE_SOURCE = "c5_memory_history" as const;

export interface AtomicConfirmationResult210 {
  readonly record: ContestRecord;
  readonly updatedHistory: MemoryHistory;
}

/**
 * Reconstrução determinística de H exclusivamente a partir da fonte canônica 'contests' (Cross-Version)
 */
export function reconstructHistoryCrossVersion(
  contests: readonly ContestRecord[]
): MemoryHistory {
  // Filtra todos os concursos confirmados de C5-Memory (2.0.0 e 2.1.0) excluindo registros demonstrativos
  const confirmed = contests.filter(
    c =>
      !c.isDemo &&
      ((c.algorithmVersion as string) === "C5-Memory-2.0.0" || (c.algorithmVersion as string) === ALGORITHM_VERSION_2_1_0) &&
      (c.status === "FROZEN" || c.status === "COMPLETED")
  );

  // Ordena estritamente por número de concurso crescente
  const sorted = [...confirmed].sort((a, b) => a.contestNumber - b.contestNumber);

  const accumulatedGames: C5Game[] = [];
  for (const c of sorted) {
    for (const g of c.games) {
      accumulatedGames.push(g);
    }
  }

  const revision = sorted.length;
  return createMemoryHistory(accumulatedGames, revision);
}

/**
 * Confirmação Atômica de Aposta para C5-Memory-2.1.0 com OCC e Hard Block anti-duplicação
 */
export async function confirmMemoryBetAtomic210(
  db: IDBDatabase,
  contestNumber: number,
  draft: Draft210,
  expectedRevision: number,
  expectedFingerprint: string,
  injectedFailurePoint?: "AFTER_CONTEST_WRITE" | "BEFORE_COMPLETE"
): Promise<AtomicConfirmationResult210> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readwrite");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    let completedRecord: ContestRecord | null = null;
    let nextHistory: MemoryHistory | null = null;

    tx.onabort = () => {
      reject(tx.error || new Error("TRANSACTION_ABORTED"));
    };

    tx.onerror = () => {
      reject(tx.error || new Error("TRANSACTION_ERROR"));
    };

    tx.oncomplete = () => {
      if (completedRecord && nextHistory) {
        resolve({ record: completedRecord, updatedHistory: nextHistory });
      } else {
        reject(new Error("TRANSACTION_INCOMPLETE_STATE"));
      }
    };

    // 1. Verificar TOCTOU: o concurso já foi confirmado?
    const contestReq = contestStore.get(contestNumber);
    contestReq.onsuccess = () => {
      const currentContest = contestReq.result as ContestRecord | undefined;
      if (currentContest && (currentContest.status === "FROZEN" || currentContest.status === "COMPLETED")) {
        tx.abort();
        reject(new Error("CONTEST_ALREADY_CONFIRMED"));
        return;
      }

      // 2. Ler histórico atual para OCC e Hard Block anti-duplicação
      const histReq = historyStore.get("singleton");
      histReq.onsuccess = () => {
        const currentHistWrapper = histReq.result;
        const currentHistory: MemoryHistory = currentHistWrapper?.history || createMemoryHistory([], 0);

        // Validação OCC por revision e fingerprint
        if (currentHistory.revision !== expectedRevision) {
          tx.abort();
          reject(new Error(`OCC_REVISION_MISMATCH: esperado ${expectedRevision}, encontrado ${currentHistory.revision}`));
          return;
        }

        if (currentHistory.fingerprint !== expectedFingerprint) {
          tx.abort();
          reject(new Error(`OCC_FINGERPRINT_MISMATCH: esperado ${expectedFingerprint}, encontrado ${currentHistory.fingerprint}`));
          return;
        }

        // 3. HARD BLOCK DE REPETIÇÃO CROSS-VERSION
        const historySignatures = new Set(currentHistory.games.map(formatGameCanonical));
        for (let i = 0; i < draft.games.length; i++) {
          const gameSig = formatGameCanonical(draft.games[i]);
          if (historySignatures.has(gameSig)) {
            tx.abort();
            reject(new Error(`EXACT_HISTORY_DUPLICATE_BLOCKED: Jogo ${i + 1} (${gameSig}) já confirmado anteriormente em H.`));
            return;
          }
        }

        // 4. Congelar criptograficamente o Draft 2.1.0
        const frozenPayload: FrozenMemoryPayload210 = freezeDraft210(draft);

        const newRecord: ContestRecord = {
          contestNumber,
          contestDate: currentContest?.contestDate || new Date().toISOString().split("T")[0],
          status: "FROZEN",
          algorithmVersion: ALGORITHM_VERSION_2_1_0 as any,
          games: draft.games,
          draft: draft as any,
          frozenPayload: frozenPayload as any,
          totalCost: COST_PER_CONTEST,
          createdAt: currentContest?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Gravação do concurso
        contestStore.put(newRecord);

        // Simulação de falha controlada para provar atomicidade
        if (injectedFailurePoint === "AFTER_CONTEST_WRITE") {
          tx.abort();
          return;
        }

        // 5. Atualizar histórico H com os 5 jogos estruturais
        const updatedGames: C5Game[] = [...currentHistory.games, ...draft.games];
        const newHistoryRevision = currentHistory.revision + 1;
        const updatedHistory = createMemoryHistory(updatedGames, newHistoryRevision);

        historyStore.put({ id: "singleton", history: updatedHistory });

        if (injectedFailurePoint === "BEFORE_COMPLETE") {
          tx.abort();
          return;
        }

        completedRecord = newRecord;
        nextHistory = updatedHistory;
      };

      histReq.onerror = () => {
        tx.abort();
        reject(histReq.error);
      };
    };

    contestReq.onerror = () => {
      tx.abort();
      reject(contestReq.error);
    };
  });
}

/**
 * Apuração de Concurso (FROZEN -> COMPLETED)
 * Invariante: Preserva integralmente os dados originais de geração
 */
export interface ConfirmedVariablePrize {
  readonly contestNumber?: number;
  readonly tier?: 14 | 15;
  readonly unitValue?: number;
  readonly unitPrize?: number;
  readonly confirmationSource: "MANUAL_ENTRY" | "OFFICIAL_CAIXA";
  readonly confirmedAt?: string;
  readonly notes?: string;
  readonly documentProof?: string;
  readonly operatorId?: string;
  readonly confirmedBy?: string;
  readonly officialProof?: OfficialCaixaProof;
  readonly isFixture?: boolean;
  readonly isDemo?: boolean;
}

/**
 * Função canônica para geração do digest de prova documental da Caixa.
 */
export function computeOfficialDocumentDigest(doc: {
  contestNumber: number;
  tier: 14 | 15;
  unitValue: number;
  bulletinId: string;
  officialBulletinUrl: string;
  publishedAt: string;
}): string {
  return `CEF_OFFICIAL_DOCUMENT|CONTEST:${doc.contestNumber}|TIER:${doc.tier}|UNIT_VALUE:${doc.unitValue.toFixed(2)}|BULLETIN:${doc.bulletinId}|URL:${doc.officialBulletinUrl}|PUBLISHED:${doc.publishedAt}`;
}

export interface OfficialCaixaProof {
  readonly contestNumber: number;
  readonly tier: 14 | 15;
  readonly unitValue: number;
  readonly bulletinId: string;
  readonly officialBulletinUrl: string;
  readonly retrievalMethod: "OFFICIAL_CEF_DOCUMENT_DOWNLOAD" | "AUTHENTICATED_PORTAL_EXTRACT";
  readonly publishedAt: string;
  readonly retrievedAt: string;
  readonly rawDocumentPayload: string;
  readonly documentSha256: string;
  readonly proofHash: string;
  readonly documentDigestSource?: string;
  readonly isFixture?: boolean;
  readonly isAutonomousOriginProven?: boolean;
}

function createAuthenticCaixaProof(doc: {
  contestNumber: number;
  tier: 14 | 15;
  unitValue: number;
  bulletinId: string;
  officialBulletinUrl: string;
  retrievalMethod: "OFFICIAL_CEF_DOCUMENT_DOWNLOAD" | "AUTHENTICATED_PORTAL_EXTRACT";
  retrievedAt: string;
  publishedAt: string;
  rawDocumentPayload: string;
  isFixture?: boolean;
}): Readonly<OfficialCaixaProof> {
  const documentSha256 = syncSha256(doc.rawDocumentPayload);
  return Object.freeze({
    ...doc,
    documentSha256,
    proofHash: documentSha256,
    documentDigestSource: doc.rawDocumentPayload,
    isFixture: doc.isFixture ?? false,
    isAutonomousOriginProven: false, // P0-1: NUNCA inferido de isFixture; permanece false
  });
}

/**
 * Fluxo de obtenção de dados da fonte oficial auditável (P0-1):
 * - Registra a URL exata do endpoint oficial;
 * - Preserva os bytes brutos efetivamente recebidos (rawDocumentPayload);
 * - Registra data/hora da recuperação (retrievedAt);
 * - Calcula o SHA-256 do conteúdo armazenado para garantia de integridade pós-captura;
 * - Declara com transparência: isAutonomousOriginProven = false (SHA-256 prova integridade,
 *   não autenticidade de origem sem assinatura criptográfica ICP-Brasil/CEF).
 */
export function createOfficialSourceRetrievedEvidence(params: {
  contestNumber: number;
  tier: 14 | 15;
  unitValue: number;
  bulletinId: string;
  officialBulletinUrl: string;
  publishedAt: string;
  retrievedAt: string;
  rawDocumentPayload: string;
}): Readonly<OfficialCaixaProof> {
  if (!params.rawDocumentPayload || typeof params.rawDocumentPayload !== "string" || params.rawDocumentPayload.trim().length === 0) {
    throw new Error("MISSING_DOCUMENT_PAYLOAD: A evidência requer o conteúdo documental bruto efetivamente recuperado.");
  }
  const documentSha256 = syncSha256(params.rawDocumentPayload);
  return Object.freeze({
    ...params,
    retrievalMethod: "AUTHENTICATED_PORTAL_EXTRACT" as const,
    documentSha256,
    proofHash: documentSha256,
    documentDigestSource: params.rawDocumentPayload,
    isFixture: false,
    isAutonomousOriginProven: false, // SHA-256 isoladamente não autentica autoria da Caixa
  });
}

export function createOfficialCaixaProof(doc: {
  contestNumber: number;
  tier: 14 | 15;
  unitValue: number;
  bulletinId: string;
  officialBulletinUrl: string;
  retrievalMethod: "OFFICIAL_CEF_DOCUMENT_DOWNLOAD" | "AUTHENTICATED_PORTAL_EXTRACT";
  publishedAt: string;
  retrievedAt?: string;
  rawDocumentPayload: string;
  isFixture?: boolean;
}): Readonly<OfficialCaixaProof> {
  if (!doc.rawDocumentPayload || typeof doc.rawDocumentPayload !== "string" || doc.rawDocumentPayload.trim().length === 0) {
    throw new Error(
      `MISSING_DOCUMENT_PAYLOAD: A criação de prova oficial requer o conteúdo documental bruto efetivamente recuperado da Caixa Econômica Federal. A geração de JSON sintético pelo código é estritamente proibida.`
    );
  }
  return createAuthenticCaixaProof({
    ...doc,
    retrievedAt: doc.retrievedAt ?? doc.publishedAt,
    rawDocumentPayload: doc.rawDocumentPayload,
    isFixture: doc.isFixture ?? false,
  });
}

// FIXTURES DE TESTE HISTÓRICAS (Audit Fixtures):
// Preservadas ESTRITAMENTE para testes automatizados de controle de regressão.
// Não são transformadas em evidência oficial autônoma em ambiente de produção real.
const HISTORICAL_FIXTURE_PAYLOAD_3100 = JSON.stringify({
  numero: 3100,
  nome: "LOTOFÁCIL",
  dataApuracao: "10/05/2024",
  dezenasSorteadasOrdemSorteio: ["01", "02", "03", "04", "06", "08", "09", "10", "15", "16", "18", "20", "21", "22", "25"],
  listaRateioPremio: [
    { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 3, valorPremio: 2561075.53 },
    { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 438, valorPremio: 1663.26 },
    { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 16352, valorPremio: 30.0 },
    { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 215545, valorPremio: 12.0 },
    { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 1210175, valorPremio: 6.0 },
  ],
});

const HISTORICAL_FIXTURE_PAYLOAD_3104 = JSON.stringify({
  numero: 3104,
  nome: "LOTOFÁCIL",
  dataApuracao: "15/05/2024",
  dezenasSorteadasOrdemSorteio: ["01", "02", "03", "04", "05", "06", "08", "09", "10", "13", "15", "17", "19", "24", "25"],
  listaRateioPremio: [
    { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 2, valorPremio: 554246.41 },
    { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 306, valorPremio: 1085.08 },
    { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 11088, valorPremio: 30.0 },
    { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 123399, valorPremio: 12.0 },
    { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 642988, valorPremio: 6.0 },
  ],
});

export const CAIXA_HISTORICAL_FIXTURE_REGISTRY: Readonly<Record<string, Readonly<OfficialCaixaProof>>> = Object.freeze({
  "3100-15": createOfficialCaixaProof({
    contestNumber: 3100,
    tier: 15,
    unitValue: 2561075.53,
    bulletinId: "CEF-BOL-LOTOFACIL-3100-15",
    officialBulletinUrl: "https://loterias.caixa.gov.br/wps/portal/loterias/landing/lotofacil/concurso=3100",
    retrievalMethod: "AUTHENTICATED_PORTAL_EXTRACT",
    publishedAt: "2024-05-10T20:30:00Z",
    retrievedAt: "2024-05-10T21:00:00Z",
    rawDocumentPayload: HISTORICAL_FIXTURE_PAYLOAD_3100,
    isFixture: true,
  }),
  "3100-14": createOfficialCaixaProof({
    contestNumber: 3100,
    tier: 14,
    unitValue: 1663.26,
    bulletinId: "CEF-BOL-LOTOFACIL-3100-14",
    officialBulletinUrl: "https://loterias.caixa.gov.br/wps/portal/loterias/landing/lotofacil/concurso=3100",
    retrievalMethod: "AUTHENTICATED_PORTAL_EXTRACT",
    publishedAt: "2024-05-10T20:30:00Z",
    retrievedAt: "2024-05-10T21:00:00Z",
    rawDocumentPayload: HISTORICAL_FIXTURE_PAYLOAD_3100,
    isFixture: true,
  }),
  "3104-15": createOfficialCaixaProof({
    contestNumber: 3104,
    tier: 15,
    unitValue: 554246.41,
    bulletinId: "CEF-BOL-LOTOFACIL-3104-15",
    officialBulletinUrl: "https://loterias.caixa.gov.br/wps/portal/loterias/landing/lotofacil/concurso=3104",
    retrievalMethod: "AUTHENTICATED_PORTAL_EXTRACT",
    publishedAt: "2024-05-15T20:30:00Z",
    retrievedAt: "2024-05-15T21:00:00Z",
    rawDocumentPayload: HISTORICAL_FIXTURE_PAYLOAD_3104,
    isFixture: true,
  }),
  "3104-14": createOfficialCaixaProof({
    contestNumber: 3104,
    tier: 14,
    unitValue: 1085.08,
    bulletinId: "CEF-BOL-LOTOFACIL-3104-14",
    officialBulletinUrl: "https://loterias.caixa.gov.br/wps/portal/loterias/landing/lotofacil/concurso=3104",
    retrievalMethod: "AUTHENTICATED_PORTAL_EXTRACT",
    publishedAt: "2024-05-15T20:30:00Z",
    retrievedAt: "2024-05-15T21:00:00Z",
    rawDocumentPayload: HISTORICAL_FIXTURE_PAYLOAD_3104,
    isFixture: true,
  }),
});

/**
 * Registro de Provas Oficiais da Caixa Econômica Federal homologadas em produção.
 * 
 * Regra P0-1 (Terceira Rodada):
 * NÃO é um alias para o repositório de fixtures históricas.
 * O repositório de fixtures (CAIXA_HISTORICAL_FIXTURE_REGISTRY) é usado exclusivamente por testes de regressão.
 * Em produção, sem certificação ICP-Brasil externa, nenhuma prova estática artificial é criada;
 * permanece estritamente vazio por padrão.
 */
export const CAIXA_OFFICIAL_PROOF_REGISTRY: Readonly<Record<string, Readonly<OfficialCaixaProof>>> = Object.freeze({});

/**
 * Validação rigorosa de evidência oficial da Caixa Econômica Federal.
 * 
 * Regras P0-1 (Terceira Rodada):
 * 1. Rejeita strings arbitrárias ou ausência de prova (UNVERIFIED_OFFICIAL_CLAIM).
 * 2. Rejeita imediatamente QUALQUER prova com isFixture === true (HISTORICAL_FIXTURE_REJECTED).
 * 3. Valida URL oficial pertencente ao domínio auditável (*.caixa.gov.br).
 * 4. Valida correspondência de concurso, faixa e valor unitário.
 * 5. Valida criptograficamente que documentSha256 === syncSha256(rawDocumentPayload).
 * 6. Inspeciona o conteúdo documental bruto para corroborar concurso, faixa e valor.
 * 7. Exige isAutonomousOriginProven === true; na ausência de comprovação externa autônoma,
 *    o rateio é classificado honestamente como OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED e permanece PENDENTE.
 */
/**
 * P0.1, P0.2, P0.3 (Décima Segunda Rodada): Verificador Interno Autoritativo de Comprovação Oficial da Caixa
 * Executa a conferência documental e criptográfica contra o repositório oficial ativo.
 */
function verifyOfficialCaixaProofDirect(
  contestNumber: number,
  tier: number,
  claimedUnitValue: unknown,
  proof: OfficialCaixaProof | string | undefined
): OfficialCaixaProof {
  if (tier !== 14 && tier !== 15) {
    throw new Error(`INVALID_VARIABLE_TIER: Apenas faixas 14 e 15 requerem prova de rateio variável.`);
  }

  // 1. P0.2: Validação estrita preliminar do operando 1 (claimedUnitValue)
  if (
    typeof claimedUnitValue !== "number" ||
    Number.isNaN(claimedUnitValue) ||
    !Number.isFinite(claimedUnitValue) ||
    claimedUnitValue <= 0
  ) {
    throw new Error(
      `INVALID_MONETARY_VALUE: Valor unitário alegado (${String(
        claimedUnitValue
      )}) é inválido. Exige número finito estritamente positivo (rejeitado NaN, Infinity, -Infinity, strings, null, undefined, zero ou negativos).`
    );
  }

  // 2. Proíbe expressamente string arbitrária sem metadados ou objeto inexistente
  if (!proof || typeof proof === "string" || typeof proof !== "object") {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Alegação de OFFICIAL_CAIXA para o concurso ${contestNumber} (faixa ${tier}) rejeitada. String arbitrária ou objeto comprobatório auditável ausente.`
    );
  }

  // 3. REGRA P0: Rejeição imediata de QUALQUER fixture de teste histórica
  if (proof.isFixture === true) {
    throw new Error(
      `HISTORICAL_FIXTURE_REJECTED: Fixtures de teste históricas não constituem prova documental oficial da Caixa em produção e não podem homologar rateios financeiros.`
    );
  }

  // 4. Valida tipagem e completude da estrutura documental verificável
  if (
    typeof proof.contestNumber !== "number" ||
    typeof proof.tier !== "number" ||
    typeof proof.bulletinId !== "string" ||
    typeof proof.officialBulletinUrl !== "string" ||
    typeof (proof.rawDocumentPayload ?? proof.documentDigestSource) !== "string" ||
    typeof (proof.documentSha256 ?? proof.proofHash) !== "string"
  ) {
    throw new Error(
      `INVALID_PROOF_STRUCTURE: Estrutura da prova oficial da Caixa é inválida ou incompleta.`
    );
  }

  // 5. P0.2: Validação estrita preliminar do operando 2 (proof.unitValue)
  if (
    typeof proof.unitValue !== "number" ||
    Number.isNaN(proof.unitValue) ||
    !Number.isFinite(proof.unitValue) ||
    proof.unitValue <= 0
  ) {
    throw new Error(
      `INVALID_MONETARY_VALUE: Valor unitário no comprovante oficial (${String(
        proof.unitValue
      )}) é inválido. Exige número finito estritamente positivo (rejeitado NaN, Infinity, -Infinity, strings, null, undefined, zero ou negativos).`
    );
  }

  // 6. P0.2: Comparação de valores apenas APÓS validação estrita de ambos os operandos
  // Tolerância monetária EPSILON_MONETARY = 0.001: documentada e admitida exclusivamente
  // para neutralizar imprecisões de representação de frações decimais de centavos em ponto flutuante IEEE 754.
  const EPSILON_MONETARY = 0.001;
  if (Math.abs(proof.unitValue - claimedUnitValue) > EPSILON_MONETARY) {
    throw new Error(
      `RATEIO_PROOF_VALUE_MISMATCH: Valor de rateio incompatível com a evidência oficial. Valor alegado: R$ ${claimedUnitValue.toFixed(
        2
      )}, valor comprovado no boletim: R$ ${proof.unitValue.toFixed(2)}.`
    );
  }

  // 7. P0.3: Endurecimento da verificação de URL do boletim oficial
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(proof.officialBulletinUrl);
  } catch {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: A URL informada (${proof.officialBulletinUrl}) é malformada ou inválida.`
    );
  }

  // Exige estritamente protocolo https: (rejeita http:, ftp:, javascript:, etc.)
  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Protocolo '${parsedUrl.protocol}' inseguro ou incompatível. A comprovação oficial Caixa exige estritamente protocolo 'https:'.`
    );
  }

  // Rejeita credenciais embutidas na URL (ex: https://user:pass@loterias.caixa.gov.br)
  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error(
      "UNVERIFIED_OFFICIAL_CLAIM: A URL do boletim oficial não pode conter credenciais de autenticação embutidas."
    );
  }

  // Rejeita portas não-padrão (apenas porta vazia ou padrão 443 autorizadas)
  if (parsedUrl.port !== "" && parsedUrl.port !== "443") {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Porta não autorizada '${parsedUrl.port}' na URL do boletim oficial.`
    );
  }

  // Hostname estritamente autorizado (*.caixa.gov.br)
  const rawHostname = parsedUrl.hostname.toLowerCase();
  const isExactCaixa = rawHostname === "loterias.caixa.gov.br" || rawHostname === "caixa.gov.br";
  const isSubdomainCaixa = rawHostname.endsWith(".caixa.gov.br") && !rawHostname.endsWith("..caixa.gov.br");
  if (!isExactCaixa && !isSubdomainCaixa) {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: O hostname '${rawHostname}' não pertence ao domínio oficial auditável da Caixa Econômica Federal (*.caixa.gov.br).`
    );
  }

  // 8. P0.3: Validação de datas do documento se presentes (ISO 8601 de calendário válido)
  if (proof.publishedAt && !isValidIso8601Timestamp(proof.publishedAt)) {
    throw new Error(
      `INVALID_TIMESTAMP: Data de publicação oficial (publishedAt: ${proof.publishedAt}) deve ser um ISO 8601 de calendário válido.`
    );
  }
  if (proof.retrievedAt && !isValidIso8601Timestamp(proof.retrievedAt)) {
    throw new Error(
      `INVALID_TIMESTAMP: Data de captura da prova (retrievedAt: ${proof.retrievedAt}) deve ser um ISO 8601 de calendário válido.`
    );
  }

  // 9. P0.3: Validação explícita de concurso e faixa no comprovante recebido
  if (proof.contestNumber !== contestNumber) {
    throw new Error(
      `PROOF_CONTEST_MISMATCH: A evidência apresentada refere-se ao concurso ${proof.contestNumber}, incompatível com o concurso ${contestNumber} em apuração.`
    );
  }

  if (proof.tier !== tier) {
    throw new Error(
      `PROOF_TIER_MISMATCH: A evidência apresentada refere-se à faixa ${proof.tier}, incompatível com a faixa ${tier} em apuração.`
    );
  }

  // 10. Verificação criptográfica do SHA-256 sobre os bytes reais do documento recuperado
  const rawPayload = proof.rawDocumentPayload ?? proof.documentDigestSource!;
  const expectedHash = syncSha256(rawPayload);
  const givenHash = proof.documentSha256 ?? proof.proofHash;

  if (givenHash !== expectedHash) {
    throw new Error(
      `FORGED_PROOF_REJECTED: O hash fornecido (${givenHash}) não corresponde ao SHA-256 do documento (${expectedHash}). Prova inválida ou adulterada.`
    );
  }

  // 11. P0.1 & P0.3: Consulta o repositório de provas oficiais confiável
  const registryKey = `${contestNumber}-${tier}`;
  const registeredProof = CAIXA_OFFICIAL_PROOF_REGISTRY[proof.bulletinId] || CAIXA_OFFICIAL_PROOF_REGISTRY[registryKey];

  if (!registeredProof) {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Não há comprovação documental independente no repositório oficial da Caixa para o concurso ${contestNumber} (faixa ${tier}). O rateio deve permanecer estritamente PENDENTE.`
    );
  }

  // P0.3: Validação explícita de concurso e faixa no registro confiável
  if (registeredProof.contestNumber !== contestNumber) {
    throw new Error(
      `REGISTRY_CONTEST_MISMATCH: O registro confiável refere-se ao concurso ${registeredProof.contestNumber}, divergente do concurso ${contestNumber}.`
    );
  }
  if (registeredProof.tier !== tier) {
    throw new Error(
      `REGISTRY_TIER_MISMATCH: O registro confiável refere-se à faixa ${registeredProof.tier}, divergente da faixa ${tier}.`
    );
  }

  // P0.3: Validação cruzada de valor, hash e identidade documental
  if (registeredProof.bulletinId !== proof.bulletinId) {
    throw new Error(
      `FORGED_PROOF_REJECTED: O identificador documental apresentado (${proof.bulletinId}) diverge do boletim oficial arquivado (${registeredProof.bulletinId}).`
    );
  }

  const regHash = registeredProof.documentSha256 ?? registeredProof.proofHash;
  if (regHash !== givenHash || regHash !== expectedHash) {
    throw new Error(
      `FORGED_PROOF_REJECTED: Hash ou documento oficial falso/não correspondente detectado para o concurso ${contestNumber} (faixa ${tier}). Tentativa de falsificação bloqueada.`
    );
  }

  if (Math.abs(registeredProof.unitValue - claimedUnitValue) > EPSILON_MONETARY) {
    throw new Error(
      `FORGED_PROOF_REJECTED: O valor unitário no registro confiável (R$ ${registeredProof.unitValue.toFixed(
        2
      )}) diverge do valor alegado (R$ ${claimedUnitValue.toFixed(2)}).`
    );
  }

  // 12. P0.1 & P0.3: Autenticidade da Origem vs Integridade do Payload
  // A propriedade isAutonomousOriginProven no objeto recebido NÃO é aceita como prova por si só.
  // A autenticidade DEVE ser assegurada pelo registro confiável / cadeia de custódia.
  if (registeredProof.isAutonomousOriginProven !== true) {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: O comprovante para o concurso ${contestNumber} (faixa ${tier}) não possui autenticação independente de origem com cadeia de custódia externa verificada. O SHA-256 garante apenas integridade local de payload. Rateio mantido estritamente PENDENTE.`
    );
  }

  return registeredProof;
}

/**
 * P0.1, P0.2, P0.3 (Décima Segunda e Décima Terceira Rodadas): Verificador Autoritativo de Comprovação Oficial da Caixa
 * Executado pelo fluxo de PRODUÇÃO. Consulta EXCLUSIVAMENTE o repositório oficial da Caixa (CAIXA_OFFICIAL_PROOF_REGISTRY).
 * Proibição estrutural de injeção: NENHUM parâmetro de registro de confiança é aceito.
 */
export function verifyOfficialCaixaProof(
  contestNumber: number,
  tier: number,
  claimedUnitValue: unknown,
  proof?: OfficialCaixaProof | string
): OfficialCaixaProof {
  return verifyOfficialCaixaProofDirect(
    contestNumber,
    tier,
    claimedUnitValue,
    proof
  );
}

export interface RateioConfirmationValidationResult {
  readonly valid: boolean;
  readonly validatedUnitValue?: number;
  readonly reason?: string;
  readonly error?: Error;
  readonly confirmationSource?: "OFFICIAL_CAIXA" | "MANUAL_ENTRY";
  readonly verifiedProof?: OfficialCaixaProof;
  readonly operatorId?: string;
  readonly confirmedAt?: string;
  readonly officialPublishedAt?: string;
  readonly proofRetrievedAt?: string;
  readonly manualInformedValue?: number;
  readonly notes?: string;
}

function validateRateioConfirmationDirect(
  contestNumber: number,
  tier: number,
  confirmation: unknown
): RateioConfirmationValidationResult {
  if (tier !== 14 && tier !== 15) {
    return {
      valid: false,
      reason: `INVALID_VARIABLE_TIER: Apenas faixas 14 e 15 requerem validação de rateio variável (recebido: ${tier}).`,
    };
  }

  if (!confirmation || typeof confirmation !== "object") {
    return {
      valid: false,
      reason: "MISSING_CONFIRMATION: Comprovante de rateio ausente ou malformado.",
    };
  }

  const conf = confirmation as any;

  // 1. Rejeição imediata de QUALQUER fixture de teste ou demonstração
  if (
    conf.isFixture === true ||
    conf.isDemo === true ||
    conf.officialProof?.isFixture === true ||
    conf.officialProof?.isDemo === true
  ) {
    return {
      valid: false,
      reason: "HISTORICAL_FIXTURE_REJECTED: Fixtures de teste não constituem confirmação de rateio oficial em produção.",
    };
  }

  // 2. Extração e validação monetária estrita do valor unitário (Number.isFinite)
  const unitVal =
    conf.unitValue !== undefined
      ? conf.unitValue
      : conf.unitPrize !== undefined
      ? conf.unitPrize
      : (conf.officialProof?.unitValue ?? conf.proof?.unitValue);

  if (typeof unitVal !== "number" || Number.isNaN(unitVal) || !Number.isFinite(unitVal) || unitVal <= 0) {
    const errorPrefix =
      conf.confirmationSource === "MANUAL_ENTRY"
        ? `MANUAL_ENTRY_INVALID_VALUE: Valor unitário da entrada manual para a faixa ${tier} deve ser um número finito positivo (recebido: ${unitVal}).`
        : `INVALID_MONETARY_VALUE: Valor unitário do rateio (${unitVal}) deve ser um número finito positivo (rejeitado Infinity, -Infinity, NaN, <= 0).`;
    return {
      valid: false,
      reason: errorPrefix,
    };
  }

  // 3. Validação de correspondência de concurso e faixa
  const isManual = conf.confirmationSource === "MANUAL_ENTRY";
  if (isManual) {
    if (
      conf.contestNumber === undefined ||
      typeof conf.contestNumber !== "number" ||
      !Number.isInteger(conf.contestNumber) ||
      conf.contestNumber !== contestNumber
    ) {
      return {
        valid: false,
        reason: `MANUAL_ENTRY_CONTEST_MISMATCH: Entrada manual de rateio exige contestNumber correspondente ao concurso apurado (esperado: ${contestNumber}, recebido: ${conf.contestNumber}).`,
      };
    }
    if (
      conf.tier === undefined ||
      typeof conf.tier !== "number" ||
      !Number.isInteger(conf.tier) ||
      conf.tier !== tier
    ) {
      return {
        valid: false,
        reason: `MANUAL_ENTRY_TIER_MISMATCH: Entrada manual de rateio exige tier correspondente à faixa apurada (esperado: ${tier}, recebido: ${conf.tier}).`,
      };
    }
  } else {
    if (conf.contestNumber !== undefined && conf.contestNumber !== null) {
      if (
        typeof conf.contestNumber !== "number" ||
        !Number.isInteger(conf.contestNumber) ||
        conf.contestNumber !== contestNumber
      ) {
        return {
          valid: false,
          reason: `CONTEST_MISMATCH: Comprovante refere-se ao concurso ${conf.contestNumber}, incompatível com o concurso apurado (${contestNumber}).`,
        };
      }
    }

    if (conf.tier !== undefined && conf.tier !== null) {
      if (
        typeof conf.tier !== "number" ||
        !Number.isInteger(conf.tier) ||
        conf.tier !== tier
      ) {
        return {
          valid: false,
          reason: `TIER_MISMATCH: Comprovante refere-se à faixa ${conf.tier}, incompatível com a faixa apurada (${tier}).`,
        };
      }
    }
  }

  // 4. Verificação por Origem de Confirmação
  const source = conf.confirmationSource;

  if (source === "OFFICIAL_CAIXA") {
    const proofDoc = conf.officialProof ?? conf.documentProof ?? conf.proof;
    if (!proofDoc) {
      return {
        valid: false,
        reason: "UNVERIFIED_OFFICIAL_CLAIM: Falta documento comprobatório auditável da Caixa.",
      };
    }

    try {
      const verifiedProof = verifyOfficialCaixaProofDirect(
        contestNumber,
        tier,
        unitVal,
        proofDoc
      );

      // P0.3: No ramo OFFICIAL_CAIXA, não retorne valid: true se a data exigida pela regra de homologação estiver ausente ou inválida.
      if (!conf.confirmedAt) {
        return {
          valid: false,
          reason: "OFFICIAL_CAIXA_MISSING_TIMESTAMP: Homologação oficial da Caixa exige timestamp explícito de homologação (confirmedAt).",
        };
      }
      if (!isValidIso8601Timestamp(conf.confirmedAt)) {
        return {
          valid: false,
          reason: `OFFICIAL_CAIXA_INVALID_TIMESTAMP: Timestamp de homologação informado (${conf.confirmedAt}) não é um ISO 8601 de calendário válido ou contém data impossível.`,
        };
      }

      // P0.3: Diferenciar estritamente data de publicação oficial, data de captura e data de homologação
      const officialPublishedAt = verifiedProof.publishedAt ?? (proofDoc as any).publishedAt;
      const proofRetrievedAt = verifiedProof.retrievedAt ?? (proofDoc as any).retrievedAt;

      if (!isValidIso8601Timestamp(officialPublishedAt)) {
        return {
          valid: false,
          reason: `OFFICIAL_CAIXA_INVALID_PUBLISHED_DATE: Data de publicação oficial (${officialPublishedAt}) inválida ou impossível.`,
        };
      }
      if (proofRetrievedAt && !isValidIso8601Timestamp(proofRetrievedAt)) {
        return {
          valid: false,
          reason: `OFFICIAL_CAIXA_INVALID_RETRIEVED_DATE: Data de captura (${proofRetrievedAt}) inválida ou impossível.`,
        };
      }

      return {
        valid: true,
        validatedUnitValue: verifiedProof.unitValue,
        confirmationSource: "OFFICIAL_CAIXA",
        verifiedProof,
        confirmedAt: conf.confirmedAt,
        officialPublishedAt,
        proofRetrievedAt,
        operatorId: conf.operatorId ?? conf.confirmedBy,
        notes: conf.notes ?? "Rateio oficial homologado com evidência documental auditável da Caixa",
      };
    } catch (err: any) {
      return {
        valid: false,
        reason: err.message || "FALHA_NA_VERIFICACAO_DOCUMENTAL_DA_CAIXA",
        error: err,
      };
    }
  }

  if (source === "MANUAL_ENTRY") {
    // Para MANUAL_ENTRY, contestNumber e tier explícitos são OBRIGATÓRIOS no objeto
    if (conf.contestNumber === undefined || conf.tier === undefined) {
      return {
        valid: false,
        reason: "MANUAL_ENTRY_MISSING_IDENTIFIERS: Entrada manual de rateio exige contestNumber e tier explícitos no objeto.",
      };
    }

    const operator = conf.operatorId ?? conf.confirmedBy;
    if (!operator || typeof operator !== "string" || operator.trim().length === 0) {
      return {
        valid: false,
        reason: "MANUAL_ENTRY_MISSING_OPERATOR: Entrada manual exige operador responsável identificado (operatorId ou confirmedBy).",
      };
    }

    const confirmedAt = conf.confirmedAt;
    if (!isValidIso8601Timestamp(confirmedAt)) {
      return {
        valid: false,
        reason: `MANUAL_ENTRY_MISSING_TIMESTAMP: Entrada manual exige timestamp ISO 8601 válido de calendário (recebido: ${confirmedAt}).`,
      };
    }

    const notes = conf.notes;
    if (!notes || typeof notes !== "string" || notes.trim().length < 5) {
      return {
        valid: false,
        reason: "MANUAL_ENTRY_MISSING_NOTES: Entrada manual exige observação descritiva de justificativa (mínimo 5 caracteres).",
      };
    }

    return {
      valid: true,
      validatedUnitValue: unitVal,
      manualInformedValue: unitVal,
      confirmationSource: "MANUAL_ENTRY",
      confirmedAt,
      operatorId: operator.trim(),
      notes: notes.trim(),
    };
  }

  return {
    valid: false,
    reason: `UNAUTHORIZED_CONFIRMATION_SOURCE: Origem '${source}' não autorizada para homologação de rateio variável.`,
  };
}

/**
 * Validador canônico único e autoritativo para confirmações de rateio das faixas variáveis (14 e 15 acertos).
 * Utilizado de forma idêntica por scoreContestAtomic210(), calculateContestPrize() e isContestPendingVariableRateio().
 * 
 * P0.1 (Décima Segunda e Décima Terceira Rodadas): Caminho de produção estritamente fechado.
 * Proibição estrutural de injeção: Nenhum parâmetro de registro de confiança é aceito.
 */
export function validateRateioConfirmation(
  contestNumber: number,
  tier: number,
  confirmation: unknown
): RateioConfirmationValidationResult {
  return validateRateioConfirmationDirect(
    contestNumber,
    tier,
    confirmation
  );
}

export interface ScoreContestOptions {
  readonly allowCorrection?: boolean;
  readonly resultSource?: ResultSource;
  readonly resultFetchedAt?: string;
  readonly resultConfirmed?: boolean;
  readonly resultConfirmedBy?: string;
  readonly resultConfirmedAt?: string;
  readonly prizeValues?: Record<number, number>;
  readonly confirmedVariablePrizes?: Record<number, ConfirmedVariablePrize>;
  readonly isFixture?: boolean;
  readonly isDemo?: boolean;
}

/**
 * Identifica se um registro de concurso ou operação atual é uma fixture de teste ou demonstração.
 * 
 * Regra P0 (Oitava Rodada):
 * Avalia explicitamente todos os marcadores aceitos pelo modelo e opções de entrada:
 * - record.isDemo === true;
 * - record.isFixture === true;
 * - record.resultSource === "HISTORICAL_FIXTURE";
 * - record.draft.isDemo === true;
 * - record.draft.isFixture === true;
 * - options.isDemo === true;
 * - options.isFixture === true;
 * - options.resultSource === "HISTORICAL_FIXTURE".
 */
export function isRecordOrOperationFixture(
  record?: Partial<ContestRecord> | null,
  options?: ScoreContestOptions | null
): boolean {
  if (!record && !options) return false;
  return Boolean(
    record?.isDemo === true ||
    (record as any)?.isFixture === true ||
    record?.resultSource === "HISTORICAL_FIXTURE" ||
    (record?.draft as any)?.isDemo === true ||
    (record?.draft as any)?.isFixture === true ||
    options?.isDemo === true ||
    options?.isFixture === true ||
    options?.resultSource === "HISTORICAL_FIXTURE"
  );
}

/**
 * Validação rigorosa na camada de persistência para resultados oficiais da Lotofácil:
 * - Deve conter exatamente 15 dezenas em array;
 * - Cada elemento deve ser um número inteiro estrito;
 * - Cada dezena deve estar no intervalo regulamentar [1, 25];
 * - Todas as 15 dezenas devem ser estritamente únicas (sem duplicatas).
 */
export function validateLotofacilBet(game: readonly number[], gameIndex?: number): void {
  const indexContext = gameIndex !== undefined ? ` no índice ${gameIndex}` : "";
  if (!Array.isArray(game) || game.length !== 15) {
    throw new Error(
      `INVALID_GAME_LENGTH: A aposta${indexContext} deve conter exatamente 15 dezenas (recebido: ${
        Array.isArray(game) ? game.length : typeof game
      }).`
    );
  }

  for (let i = 0; i < game.length; i++) {
    const d = game[i];
    if (typeof d !== "number" || !Number.isInteger(d) || Number.isNaN(d)) {
      throw new Error(`INVALID_GAME_NON_INTEGER: A dezena na posição ${i} (${d})${indexContext} não é um número inteiro válido.`);
    }
    if (d < 1 || d > 25) {
      throw new Error(`INVALID_GAME_DEZENA_OUT_OF_RANGE: A dezena ${d} na posição ${i}${indexContext} está fora da faixa regulamentar (1 a 25).`);
    }
  }

  const unique = new Set(game);
  if (unique.size !== 15) {
    throw new Error(`DUPLICATE_DEZENAS_IN_GAME: A aposta${indexContext} não pode conter dezenas repetidas (apenas ${unique.size} dezenas distintas).`);
  }
}

export function validateOfficialLotofacilResult(officialResult: readonly number[]): void {
  if (!Array.isArray(officialResult) || officialResult.length !== 15) {
    throw new Error(
      `INVALID_RESULT_LENGTH: O resultado oficial deve conter exatamente 15 dezenas (recebido: ${
        Array.isArray(officialResult) ? officialResult.length : typeof officialResult
      }).`
    );
  }

  for (let i = 0; i < officialResult.length; i++) {
    const d = officialResult[i];
    if (typeof d !== "number" || !Number.isInteger(d)) {
      throw new Error(`INVALID_RESULT_NON_INTEGER: A dezena na posição ${i} (${d}) não é um número inteiro válido.`);
    }
    if (d < 1 || d > 25) {
      throw new Error(`INVALID_RESULT_DEZENA_OUT_OF_RANGE: A dezena ${d} na posição ${i} está fora da faixa regulamentar (1 a 25).`);
    }
  }

  const unique = new Set(officialResult);
  if (unique.size !== 15) {
    throw new Error(`DUPLICATE_DEZENAS_IN_RESULT: O resultado oficial não pode conter dezenas repetidas (apenas ${unique.size} dezenas distintas).`);
  }
}

export function isHumanConferenceValid(record: {
  readonly resultConfirmed?: boolean;
  readonly resultConfirmedBy?: string;
  readonly resultConfirmedAt?: string;
  readonly resultSource?: string;
  readonly updatedAt?: string;
  readonly createdAt?: string;
}): boolean {
  if (record.resultConfirmed !== true) {
    return false;
  }
  if (
    !record.resultConfirmedBy ||
    typeof record.resultConfirmedBy !== "string" ||
    record.resultConfirmedBy.trim().length === 0
  ) {
    return false;
  }
  // P1 & P2: Exige timestamp explícito da conferência no formato estrito ISO 8601.
  // NUNCA recorre silenciosamente a updatedAt ou createdAt como substitutos.
  return isValidIso8601Timestamp(record.resultConfirmedAt);
}

export async function scoreContestAtomic210(
  db: IDBDatabase,
  contestNumber: number,
  officialResult: readonly number[],
  options?: ScoreContestOptions
): Promise<ContestRecord> {
  // Validação estrita preliminar do resultado oficial na camada de persistência
  validateOfficialLotofacilResult(officialResult);

  // Ordenação canônica das dezenas apuradas
  const canonicalOfficialResult = [...officialResult].sort((a, b) => a - b);

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_AUDIT_EVENTS], "readwrite");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const auditStore = tx.objectStore(STORE_AUDIT_EVENTS);

    let updatedRecord: ContestRecord | null = null;

    tx.oncomplete = () => {
      if (updatedRecord) resolve(updatedRecord);
      else reject(new Error("FALHA_AO_APURAR_CONCURSO"));
    };

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("TRANSACTION_ABORTED"));

    const getReq = contestStore.get(contestNumber);
    getReq.onsuccess = () => {
      const record = getReq.result as ContestRecord | undefined;
      if (!record) {
        tx.abort();
        reject(new Error("CONTEST_NOT_FOUND"));
        return;
      }

      if (record.status === "COMPLETED" && !options?.allowCorrection) {
        tx.abort();
        reject(new Error("CONTEST_ALREADY_COMPLETED"));
        return;
      }

      if (record.status !== "FROZEN" && record.status !== "COMPLETED") {
        tx.abort();
        reject(new Error("CONTEST_NOT_FROZEN"));
        return;
      }

      // P0-1: Validar integralmente cada aposta antes de calcular acertos ou persistir qualquer alteração
      if (!Array.isArray(record.games) || record.games.length === 0) {
        tx.abort();
        reject(new Error("MISSING_GAMES: Concurso não possui apostas cadastradas para apuração."));
        return;
      }
      try {
        for (let i = 0; i < record.games.length; i++) {
          validateLotofacilBet(record.games[i], i);
        }
      } catch (gameErr: any) {
        tx.abort();
        reject(gameErr);
        return;
      }

      const effectiveResultSource = options?.resultSource ?? record.resultSource ?? "MANUAL_CONFERENCE";
      const isThirdParty = effectiveResultSource === "API_TERCEIROS" || effectiveResultSource === "API_LOTERIAS";
      const isManual = effectiveResultSource === "MANUAL_CONFERENCE";

      // P0 (Sétima Rodada): Bloqueio de fixtures e demonstrações antes de qualquer homologação financeira
      const isFixture = isRecordOrOperationFixture(record, options);

      // P0-1 & P2: Verificação da confirmação humana estritamente na OPERAÇÃO ATUAL (options)
      // com timestamp no formato estrito ISO 8601. Não aceita record.resultConfirmed antigo.
      const hasExplicitConfirmedFlag = options?.resultConfirmed === true;
      const hasValidOperator =
        typeof options?.resultConfirmedBy === "string" &&
        options.resultConfirmedBy.trim().length > 0;
      const hasValidTimestamp = isValidIso8601Timestamp(options?.resultConfirmedAt);

      const isCurrentConfirmationValid = hasExplicitConfirmedFlag && hasValidOperator && hasValidTimestamp;

      // Validação estrita da confirmação humana ANTES de qualquer homologação ou persistência financeira
      if (isThirdParty) {
        if (options?.resultConfirmed !== true) {
          tx.abort();
          reject(new Error("UNCONFIRMED_THIRD_PARTY_RESULT: Resultado de terceiros exige confirmação humana explícita (resultConfirmed === true)."));
          return;
        }

        if (!hasValidOperator) {
          tx.abort();
          reject(new Error("UNCONFIRMED_THIRD_PARTY_RESULT: Identificador do operador (resultConfirmedBy) é obrigatório para confirmar resultado de terceiros."));
          return;
        }

        if (!hasValidTimestamp) {
          tx.abort();
          reject(new Error("UNCONFIRMED_THIRD_PARTY_RESULT: Data/hora da conferência (resultConfirmedAt) inválida ou ausente."));
          return;
        }
      } else if (isManual) {
        if (options?.resultConfirmed === true) {
          if (!hasValidOperator) {
            tx.abort();
            reject(new Error("MANUAL_CONFERENCE_MISSING_OPERATOR: resultConfirmed === true exige identificador do operador (resultConfirmedBy)."));
            return;
          }
          if (!hasValidTimestamp) {
            tx.abort();
            reject(new Error("MANUAL_CONFERENCE_MISSING_TIMESTAMP: resultConfirmed === true exige timestamp explícito válido de conferência (resultConfirmedAt)."));
            return;
          }
        }
      } else if (options?.resultConfirmed === true) {
        if (!hasValidOperator) {
          tx.abort();
          reject(new Error("UNCONFIRMED_RESULT: resultConfirmed === true exige identificador do operador (resultConfirmedBy)."));
          return;
        }
        if (!hasValidTimestamp) {
          tx.abort();
          reject(new Error("UNCONFIRMED_RESULT: Data/hora da conferência (resultConfirmedAt) inválida ou ausente."));
          return;
        }
      }

      // Calcula acertos preservando todos os campos de geração
      const gameHits = record.games.map(g => calculateHits(g, canonicalOfficialResult));
      const bestHits = Math.max(...gameHits);
      const bestHitsCount = gameHits.filter(h => h === bestHits).length;

      const breakdown: Record<string, NonNullable<ContestRecord["prizeBreakdown"]>[string]> = {};

      let totalPrize = 0;
      let officialConfirmedPrize = 0;
      let manualConfirmedPrize = 0;
      let manualInformedPrize = 0;
      let officialValidatedPrize = 0;
      let hasPendingVariableRateio = false;
      let hasProvisionalVariableRateio = false;

      // Resolução de regras de premiação vigentes na data/concurso
      const ruleSet = getLotofacilRuleSet(record.contestNumber, record.contestDate);

      for (const h of [11, 12, 13, 14, 15] as const) {
        const count = gameHits.filter(hits => hits === h).length;
        if (count > 0) {
          if (isFixture) {
            // P0.2 (Décima Rodada): Fixtures e demonstrações NUNCA homologam prêmios nem persistem pendências financeiras oficiais em produção
            breakdown[String(h)] = {
              contestNumber,
              tier: h,
              count,
              unitValue: undefined,
              totalValue: 0.00,
              isVariableRateio: h >= 14,
              pendingRateio: true,
              confirmationSource: "OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED",
              isOfficialCaixaProof: false,
              notes: "Registro de fixture/demonstração bloqueado para homologação financeira em produção.",
            };
          } else if (!isCurrentConfirmationValid) {
            // Resultado provisório (PENDING_HOMOLOGATION): prêmios fixos e variáveis aguardam conferência humana
            if (h >= 14) {
              hasPendingVariableRateio = true;
              hasProvisionalVariableRateio = true;
            }
            breakdown[String(h)] = {
              contestNumber,
              tier: h,
              count,
              unitValue: undefined,
              totalValue: 0.00,
              isVariableRateio: h >= 14,
              pendingRateio: true,
              confirmationSource: "MANUAL_CONFERENCE",
              isOfficialCaixaProof: false,
              notes: "Resultado não homologado: prêmios (fixos e variáveis) pendentes de confirmação humana do resultado.",
            };
          } else if (h <= 13) {
            // Prêmios Fixos Oficiais da Caixa respeitando época (2024: R$ 6, 12, 30; Atual: R$ 7, 14, 35)
            const unitVal = ruleSet.fixedPrizes[h as 11 | 12 | 13];
            const tot = count * unitVal;
            totalPrize += tot;
            officialConfirmedPrize += tot;
            breakdown[String(h)] = {
              contestNumber,
              tier: h,
              count,
              unitValue: unitVal,
              totalValue: tot,
              isVariableRateio: false,
              pendingRateio: false,
              confirmationSource: "OFFICIAL_CAIXA",
              isOfficialCaixaProof: true,
            };
          } else {
            // Faixas Variáveis (14 e 15 acertos) para concurso homologado:
            // P0.1 (Décima Rodada): Validação autoritativa única canônica via validateRateioConfirmation()
            if (options?.prizeValues?.[h] !== undefined) {
              tx.abort();
              reject(
                new Error(
                  `LEGACY_PRIZE_VALUES_REJECTED: O caminho alternativo prizeValues para a faixa variável ${h} não atende aos requisitos de auditoria e foi descontinuado. Todas as entradas manuais de rateio exigem confirmedVariablePrizes com identificadores obrigatórios (contestNumber, tier, unitValue, operatorId, confirmedAt ISO 8601 e justificativa notes).`
                )
              );
              return;
            }

            const confirmedTier = options?.confirmedVariablePrizes?.[h];

            if (confirmedTier) {
              const validation = validateRateioConfirmation(contestNumber, h, confirmedTier);

              if (validation.valid) {
                const unitVal = validation.validatedUnitValue!;
                const tot = count * unitVal;
                totalPrize += tot;
                const isOfficial = validation.confirmationSource === "OFFICIAL_CAIXA";
                if (isOfficial) {
                  officialConfirmedPrize += tot;
                  officialValidatedPrize += tot;
                } else {
                  manualConfirmedPrize += tot;
                  // P0.2: manualInformedPrize não é incrementado para entradas manuais confirmadas e auditadas
                }

                breakdown[String(h)] = {
                  contestNumber,
                  tier: h,
                  count,
                  unitValue: unitVal,
                  totalValue: tot,
                  isVariableRateio: true,
                  pendingRateio: false,
                  confirmationSource: validation.confirmationSource!,
                  isOfficialCaixaProof: isOfficial,
                  confirmedAt: validation.confirmedAt,
                  operatorId: validation.operatorId,
                  notes: validation.notes,
                  documentProof: validation.verifiedProof?.documentSha256,
                  officialPublishedAt: validation.officialPublishedAt,
                  proofRetrievedAt: validation.proofRetrievedAt,
                  manualInformedValue: !isOfficial ? unitVal : undefined,
                  manualConfirmedValue: !isOfficial ? unitVal : undefined,
                  officialValidatedValue: isOfficial ? unitVal : undefined,
                };
              } else {
                const reason = validation.reason || "";
                // Erros fatais na entrada fornecida causam rollback imediato da transação:
                // - MANUAL_ENTRY inválido (ausência de operador, timestamp inválido, identificador incorreto, valor inválido)
                // - Fraude documental / hash adulterado (FORGED_PROOF_REJECTED)
                // - Mismatch de concurso ou faixa (MISMATCH)
                // - Valor monetário não finito ou negativo (INVALID_MONETARY_VALUE)
                // - URL fora do domínio Caixa (UNVERIFIED_OFFICIAL_CLAIM: A URL)
                const isFatalError =
                  confirmedTier.confirmationSource === "MANUAL_ENTRY" ||
                  reason.includes("MISMATCH") ||
                  reason.includes("INVALID_MONETARY_VALUE") ||
                  reason.includes("FORGED_PROOF_REJECTED") ||
                  reason.includes("UNVERIFIED_OFFICIAL_CLAIM: A URL") ||
                  reason.includes("INVALID_VARIABLE_TIER") ||
                  reason.includes("INVALID_PROOF_STRUCTURE");

                if (isFatalError) {
                  tx.abort();
                  reject(new Error(reason));
                  return;
                }

                // Erros não fatais (ex: prova é fixture, ou alegação sem prova autônoma / sem cadastro): rateio permanece pendente
                hasPendingVariableRateio = true;
                breakdown[String(h)] = {
                  contestNumber,
                  tier: h,
                  count,
                  unitValue: undefined,
                  totalValue: undefined,
                  isVariableRateio: true,
                  pendingRateio: true,
                  confirmationSource: "OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED",
                  isOfficialCaixaProof: false,
                  notes: reason || "Rateio oficial pendente de comprovação documental autêntica da Caixa Econômica Federal.",
                };
              }
            } else {
              // Nenhuma confirmação fornecida para faixa 14 ou 15: rateio oficial pendente
              hasPendingVariableRateio = true;
              breakdown[String(h)] = {
                contestNumber,
                tier: h,
                count,
                unitValue: undefined,
                totalValue: undefined,
                isVariableRateio: true,
                pendingRateio: true,
                confirmationSource: "OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED",
                isOfficialCaixaProof: false,
                notes: "Rateio oficial pendente de homologação pela Caixa Econômica Federal",
              };
            }
          }
        }
      }

      // Preserva custo histórico registrado; se ausente, obtém custo padrão da época
      const totalCost = record.totalCost ?? getContestStandardCost(record.contestNumber, record.contestDate);

      // P0-1: Não aceita record.resultConfirmed antigo como substituto silencioso da confirmação na operação atual
      const finalResultConfirmed = isCurrentConfirmationValid;
      const finalResultConfirmedBy = isCurrentConfirmationValid ? options!.resultConfirmedBy!.trim() : undefined;
      const finalResultConfirmedAt = isCurrentConfirmationValid ? options!.resultConfirmedAt! : undefined;

      // P0 (Sétima Rodada): Bloqueio de homologação financeira para fixtures
      // resultConfirmed: true, operador e timestamp NUNCA transformam fixture em concurso homologado!
      const finalFinancialStatus: ContestFinancialStatus =
        !isFixture && isCurrentConfirmationValid ? "HOMOLOGATED" : "PENDING_HOMOLOGATION";

      // P0.2: Regra canônica única para hasPendingVariableRateio
      // Fixtures NUNCA persistem hasPendingVariableRateio: true.
      // Concursos com 14/15 acertos sem rateio comprovado persistem hasPendingVariableRateio: true.
      const finalHasPendingVariableRateio =
        !isFixture && Boolean(hasPendingVariableRateio);

      const finalHasProvisionalVariableRateio =
        !isFixture && !isCurrentConfirmationValid && Boolean(hasProvisionalVariableRateio);

      const isRecordScoredAndHomologated = !isFixture && isCurrentConfirmationValid;
      const finalTotalPrize = isRecordScoredAndHomologated ? totalPrize : 0.00;
      const finalOfficialConfirmedPrize = isRecordScoredAndHomologated ? officialConfirmedPrize : 0.00;
      const finalManualConfirmedPrize = isRecordScoredAndHomologated ? manualConfirmedPrize : 0.00;
      const finalManualInformedPrize = isRecordScoredAndHomologated ? manualInformedPrize : 0.00;
      const finalOfficialValidatedPrize = isRecordScoredAndHomologated ? officialValidatedPrize : 0.00;
      const finalOfficialNetBalance = finalOfficialConfirmedPrize - totalCost;
      const finalOfficialRoiPercentage = totalCost > 0 ? (finalOfficialNetBalance / totalCost) * 100 : 0;

      updatedRecord = {
        ...record,
        status: "COMPLETED",
        financialStatus: finalFinancialStatus,
        officialResult: canonicalOfficialResult,
        gameHits,
        bestHits,
        bestHitsCount,
        totalCost,
        totalPrize: finalTotalPrize,
        officialConfirmedPrize: finalOfficialConfirmedPrize,
        manualConfirmedPrize: finalManualConfirmedPrize,
        manualInformedPrize: finalManualInformedPrize,
        officialValidatedPrize: finalOfficialValidatedPrize,
        officialNetBalance: finalOfficialNetBalance,
        officialRoiPercentage: finalOfficialRoiPercentage,
        hasPendingVariableRateio: finalHasPendingVariableRateio,
        hasProvisionalVariableRateio: finalHasProvisionalVariableRateio,
        prizeBreakdown: breakdown,
        resultSource: effectiveResultSource,
        resultFetchedAt: options?.resultFetchedAt ?? new Date().toISOString(),
        resultConfirmed: finalResultConfirmed,
        resultConfirmedAt: finalResultConfirmedAt,
        resultConfirmedBy: finalResultConfirmedBy,
        updatedAt: new Date().toISOString(),
        isDemo: Boolean(
          record.isDemo ||
          (record.draft as any)?.isDemo ||
          options?.isDemo
        ),
        isFixture: Boolean(
          (record as any).isFixture ||
          record.resultSource === "HISTORICAL_FIXTURE" ||
          (record.draft as any)?.isFixture ||
          options?.isFixture ||
          options?.resultSource === "HISTORICAL_FIXTURE" ||
          isFixture
        ),
      };

      // P1-2: Auditoria transacional real: evento gravado na mesma transação IndexedDB
      const auditEvent: ContestAuditEvent = {
        id: `audit_score_${contestNumber}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        contestNumber,
        operation: "SCORE_CONTEST",
        financialStatus: finalFinancialStatus,
        resultConfirmed: finalResultConfirmed,
        operatorId: finalResultConfirmedBy,
        timestamp: finalResultConfirmedAt ?? new Date().toISOString(),
        resultSource: effectiveResultSource,
        financialSummary: {
          totalCost,
          totalPrize: finalTotalPrize,
          officialConfirmedPrize: finalOfficialConfirmedPrize,
          manualConfirmedPrize: finalManualConfirmedPrize,
          officialValidatedPrize: finalOfficialValidatedPrize,
          netBalance: finalTotalPrize - totalCost,
          hasPendingVariableRateio: finalHasPendingVariableRateio,
          hasProvisionalVariableRateio: finalHasProvisionalVariableRateio,
          winningGamesCount: gameHits.filter(h => h >= 11).length,
        },
        createdAt: new Date().toISOString(),
      };

      contestStore.put(updatedRecord);
      auditStore.put(auditEvent);
    };
  });
}


/**
 * Exporta Backup JSON completo do estado do banco
 */
export async function exportCrossVersionBackup(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readonly");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    let contests: ContestRecord[] = [];
    let historyWrapper: any = null;

    contestStore.getAll().onsuccess = (e: any) => {
      contests = e.target.result || [];
    };

    historyStore.get("singleton").onsuccess = (e: any) => {
      historyWrapper = e.target.result;
    };

    tx.oncomplete = () => {
      const backup = {
        exportedAt: new Date().toISOString(),
        canonicalSource: CANONICAL_STORAGE_SOURCE,
        contests,
        history: historyWrapper?.history || null,
      };
      resolve(JSON.stringify(backup, null, 2));
    };

    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Restaura Backup JSON garantindo guarda estrita contra reclassificação de versões
 */
export async function restoreCrossVersionBackup(
  db: IDBDatabase,
  backupJson: string
): Promise<{ restoredContests: number; restoredRevision: number }> {
  const data = JSON.parse(backupJson);
  if (!Array.isArray(data.contests)) {
    throw new Error("Formato de backup inválido: lista de concursos ausente.");
  }

  // Guarda estrita: verificar se houve tentativa de reclassificação
  for (const c of data.contests) {
    if (c.algorithmVersion !== "C5-Memory-2.0.0" && c.algorithmVersion !== ALGORITHM_VERSION_2_1_0) {
      throw new Error(`RESTORE_VERSION_RECLASSIFICATION: versão desconhecida ou inválida ${c.algorithmVersion}`);
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readwrite");
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    // Limpa stores antes de restaurar
    contestStore.clear();
    historyStore.clear();

    for (const c of data.contests) {
      contestStore.put(c);
    }

    // O histórico é reconstruído a partir dos concursos restaurados
    const canonicalHistory = reconstructHistoryCrossVersion(data.contests);
    historyStore.put({ id: "singleton", history: canonicalHistory });

    tx.oncomplete = () => {
      resolve({
        restoredContests: data.contests.length,
        restoredRevision: canonicalHistory.revision,
      });
    };

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("RESTORE_ABORTED"));
  });
}
