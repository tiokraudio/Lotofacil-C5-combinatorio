/**
 * Harness Isolado Exclusivo para Testes Automatizados de Homologação Sintética
 * 
 * ATENÇÃO - ISOLAMENTO ESTRUTURAL DE SEGURANÇA (P0.1 - Décima Terceira Rodada):
 * Este módulo reside EXCLUSIVAMENTE dentro do diretório de testes (`src/c5-memory/testing/`).
 * NUNCA deve ser importado por componentes de produção, storage managers ou qualquer ponto
 * de entrada da aplicação (main.tsx, App.tsx, etc.).
 * 
 * Proporciona um simulador isolado para validação com injeção de registros sintéticos de teste,
 * garantindo que as funções de produção permaneçam 100% fail-closed e herméticas.
 */

import {
  ContestRecord,
  isValidIso8601Timestamp,
} from "../types";
import {
  OfficialCaixaProof,
  ConfirmedVariablePrize,
  RateioConfirmationValidationResult,
} from "../../storage/storageManager210";
import {
  isRecordFixture,
  isHumanConferenceValid,
  getAuthoritativeHits,
  buildC5ContestPerformance,
  getProvisionalHits,
  isContestPendingProvisionalRateio,
  ContestFinancialBreakdown,
} from "../analytics/c5Analytics";
import {
  getFixedLotofacilPrize,
  getContestStandardCost,
} from "../lotofacilRules";
import {
  DashboardDTO,
  MonthlyReportDTO,
  HitTierMetric,
  HitDistributionMap,
  EvolutionPoint,
  MonthlyContestRow,
} from "../analytics/types";

import { syncSha256 } from "../sha256";

const EPSILON_MONETARY = 0.001;

/**
 * Validação documental e criptográfica contra um repositório isolado de testes.
 */
export function testHarnessVerifyOfficialCaixaProof(
  contestNumber: number,
  tier: number,
  claimedUnitValue: unknown,
  proof: OfficialCaixaProof | string | undefined,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>
): OfficialCaixaProof {
  if (tier !== 14 && tier !== 15) {
    throw new Error(`INVALID_VARIABLE_TIER: Apenas faixas 14 e 15 requerem prova de rateio variável.`);
  }

  // P0.2: Validação rigorosa preliminar de claimedUnitValue
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

  if (!proof || typeof proof === "string" || typeof proof !== "object") {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Alegação de OFFICIAL_CAIXA para o concurso ${contestNumber} (faixa ${tier}) rejeitada. String arbitrária ou objeto comprobatório auditável ausente.`
    );
  }

  if (proof.isFixture === true) {
    throw new Error(
      `HISTORICAL_FIXTURE_REJECTED: Fixtures de teste históricas não constituem prova documental oficial da Caixa em produção e não podem homologar rateios financeiros.`
    );
  }

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

  const EPSILON_MONETARY = 0.001;
  if (Math.abs(proof.unitValue - claimedUnitValue) > EPSILON_MONETARY) {
    throw new Error(
      `RATEIO_PROOF_VALUE_MISMATCH: Valor de rateio incompatível com a evidência oficial. Valor alegado: R$ ${claimedUnitValue.toFixed(
        2
      )}, valor comprovado no boletim: R$ ${proof.unitValue.toFixed(2)}.`
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(proof.officialBulletinUrl);
  } catch {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: A URL informada (${proof.officialBulletinUrl}) é malformada ou inválida.`
    );
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Protocolo '${parsedUrl.protocol}' inseguro ou incompatível. A comprovação oficial Caixa exige estritamente protocolo 'https:'.`
    );
  }

  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error(
      "UNVERIFIED_OFFICIAL_CLAIM: A URL do boletim oficial não pode conter credenciais de autenticação embutidas."
    );
  }

  if (parsedUrl.port !== "" && parsedUrl.port !== "443") {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Porta não autorizada '${parsedUrl.port}' na URL do boletim oficial.`
    );
  }

  const rawHostname = parsedUrl.hostname.toLowerCase();
  const isExactCaixa = rawHostname === "loterias.caixa.gov.br" || rawHostname === "caixa.gov.br";
  const isSubdomainCaixa = rawHostname.endsWith(".caixa.gov.br") && !rawHostname.endsWith("..caixa.gov.br");
  if (!isExactCaixa && !isSubdomainCaixa) {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: O hostname '${rawHostname}' não pertence ao domínio oficial auditável da Caixa Econômica Federal (*.caixa.gov.br).`
    );
  }

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

  const rawPayload = proof.rawDocumentPayload ?? proof.documentDigestSource!;
  const expectedHash = syncSha256(rawPayload);
  const givenHash = proof.documentSha256 ?? proof.proofHash;

  if (givenHash !== expectedHash) {
    throw new Error(
      `FORGED_PROOF_REJECTED: O hash fornecido (${givenHash}) não corresponde ao SHA-256 do documento (${expectedHash}). Prova inválida ou adulterada.`
    );
  }

  const registryKey = `${contestNumber}-${tier}`;
  const registeredProof = testRegistry[proof.bulletinId] || testRegistry[registryKey];

  if (!registeredProof) {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: Não há comprovação documental independente no repositório de testes para o concurso ${contestNumber} (faixa ${tier}). O rateio deve permanecer estritamente PENDENTE.`
    );
  }

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

  if (registeredProof.isAutonomousOriginProven !== true) {
    throw new Error(
      `UNVERIFIED_OFFICIAL_CLAIM: O comprovante para o concurso ${contestNumber} (faixa ${tier}) não possui autenticação independente de origem com cadeia de custódia externa verificada. O SHA-256 garante apenas integridade local de payload. Rateio mantido estritamente PENDENTE.`
    );
  }

  return registeredProof;
}

/**
 * Validação de Confirmação de Rateio contra um repositório isolado de testes.
 */
export function testHarnessValidateRateioConfirmation(
  contestNumber: number,
  tier: number,
  confirmation: unknown,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>,
  options?: {
    claimedUnitValue?: number;
    officialProofRequired?: boolean;
  }
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
      reason: `MISSING_CONFIRMATION_DATA: Objeto de confirmação de rateio para concurso ${contestNumber} faixa ${tier} ausente.`,
    };
  }

  const raw = confirmation as Record<string, unknown>;

  const effectiveContestNumber = raw.contestNumber ?? contestNumber;
  if (typeof effectiveContestNumber !== "number" || !Number.isInteger(effectiveContestNumber)) {
    return {
      valid: false,
      reason: `INVALID_IDENTIFIER_CONTEST: contestNumber deve ser um número inteiro válido (recebido: ${typeof effectiveContestNumber}).`,
    };
  }
  if (effectiveContestNumber !== contestNumber) {
    return {
      valid: false,
      reason: `MISMATCH_CONTEST_NUMBER: contestNumber informado (${effectiveContestNumber}) diverge do concurso em apuração (${contestNumber}).`,
    };
  }

  const effectiveTier = raw.tier ?? tier;
  if (typeof effectiveTier !== "number" || !Number.isInteger(effectiveTier)) {
    return {
      valid: false,
      reason: `INVALID_IDENTIFIER_TIER: tier deve ser um número inteiro válido (recebido: ${typeof effectiveTier}).`,
    };
  }
  if (effectiveTier !== tier) {
    return {
      valid: false,
      reason: `MISMATCH_TIER: tier informado (${effectiveTier}) diverge da faixa em apuração (${tier}).`,
    };
  }

  const rawValue =
    options?.claimedUnitValue ??
    raw.unitValue ??
    raw.unitPrize ??
    raw.totalValue ??
    (raw.officialProof as any)?.unitValue ??
    (raw.proof as any)?.unitValue;
  if (
    typeof rawValue !== "number" ||
    Number.isNaN(rawValue) ||
    !Number.isFinite(rawValue) ||
    rawValue <= 0
  ) {
    return {
      valid: false,
      reason: `INVALID_MONETARY_VALUE: Valor do rateio (${String(
        rawValue
      )}) é inválido. Exige número finito estritamente positivo (rejeitado NaN, Infinity, -Infinity, strings, null, undefined, zero ou negativos).`,
    };
  }

  const confirmationSource =
    raw.confirmationSource === "OFFICIAL_CAIXA" || raw.isOfficialCaixaProof === true || raw.type === "OFFICIAL_CAIXA"
      ? "OFFICIAL_CAIXA"
      : raw.confirmationSource === "MANUAL_ENTRY" || raw.type === "MANUAL_ENTRY"
      ? "MANUAL_ENTRY"
      : undefined;

  if (!confirmationSource) {
    return {
      valid: false,
      reason: `INVALID_CONFIRMATION_SOURCE: Fonte de confirmação de rateio deve ser explicitamente 'OFFICIAL_CAIXA' ou 'MANUAL_ENTRY'.`,
    };
  }

  if (confirmationSource === "OFFICIAL_CAIXA") {
    const rawProof = (raw.proof ?? raw.officialProof ?? raw) as OfficialCaixaProof | string;
    try {
      const verifiedProof = testHarnessVerifyOfficialCaixaProof(
        contestNumber,
        tier,
        rawValue,
        rawProof,
        testRegistry
      );

      const confirmedAt = typeof raw.confirmedAt === "string" ? raw.confirmedAt.trim() : "";
      if (!confirmedAt) {
        return {
          valid: false,
          reason: "OFFICIAL_CAIXA_MISSING_TIMESTAMP: Homologação oficial da Caixa exige timestamp explícito de homologação (confirmedAt).",
          confirmationSource: "OFFICIAL_CAIXA",
        };
      }
      if (!isValidIso8601Timestamp(confirmedAt)) {
        return {
          valid: false,
          reason: `OFFICIAL_CAIXA_INVALID_TIMESTAMP: Timestamp de homologação informado (${confirmedAt}) não é um ISO 8601 de calendário válido ou contém data impossível.`,
          confirmationSource: "OFFICIAL_CAIXA",
        };
      }

      return {
        valid: true,
        validatedUnitValue: rawValue,
        confirmationSource: "OFFICIAL_CAIXA",
        verifiedProof,
        confirmedAt,
        officialPublishedAt: verifiedProof.publishedAt,
        proofRetrievedAt: verifiedProof.retrievedAt,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        valid: false,
        reason: error.message,
        error,
        confirmationSource: "OFFICIAL_CAIXA",
      };
    }
  }

  // MANUAL_ENTRY
  if (options?.officialProofRequired) {
    return {
      valid: false,
      reason: "OFFICIAL_PROOF_REQUIRED: Esta operação exige comprovação oficial da Caixa; entrada manual não é aceita",
      confirmationSource: "MANUAL_ENTRY",
    };
  }

  const operatorId = typeof raw.operatorId === "string" ? raw.operatorId.trim() : "";
  if (!operatorId) {
    return {
      valid: false,
      reason: `MANUAL_ENTRY_MISSING_OPERATOR: Confirmação manual de rateio (faixa ${tier}) exige identificador do operador responsável (operatorId).`,
      confirmationSource: "MANUAL_ENTRY",
    };
  }

  const confirmedAt = typeof raw.confirmedAt === "string" ? raw.confirmedAt.trim() : "";
  if (!confirmedAt || !isValidIso8601Timestamp(confirmedAt)) {
    return {
      valid: false,
      reason: `MANUAL_ENTRY_MISSING_TIMESTAMP: Confirmação manual de rateio (faixa ${tier}) exige data/hora da confirmação em formato ISO 8601 válido (confirmedAt).`,
      confirmationSource: "MANUAL_ENTRY",
    };
  }

  const notes =
    typeof raw.notes === "string"
      ? raw.notes.trim()
      : typeof raw.justification === "string"
      ? raw.justification.trim()
      : "";
  if (!notes) {
    return {
      valid: false,
      reason: `MANUAL_ENTRY_MISSING_JUSTIFICATION: Confirmação manual de rateio (faixa ${tier}) exige justificativa ou fonte das notas de rateio.`,
      confirmationSource: "MANUAL_ENTRY",
    };
  }

  return {
    valid: true,
    validatedUnitValue: rawValue,
    confirmationSource: "MANUAL_ENTRY",
    operatorId,
    confirmedAt,
    notes,
    manualInformedValue: rawValue,
  };
}

/**
 * Cálculo financeiro detalhado em harness isolado de testes.
 */
export function testHarnessCalculateContestFinancialBreakdown(
  record: ContestRecord,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>
): ContestFinancialBreakdown {
  const totalCost =
    typeof record.totalCost === "number" && !Number.isNaN(record.totalCost) && record.totalCost > 0
      ? record.totalCost
      : getContestStandardCost(record.contestNumber, record.contestDate);

  const isFixture = isRecordFixture(record);
  const isProvisional =
    record.financialStatus === "PENDING_HOMOLOGATION" ||
    record.resultConfirmed !== true ||
    !isHumanConferenceValid(record) ||
    record.status !== "COMPLETED";

  const authValidation = getAuthoritativeHits(record);
  const hits = authValidation.valid ? authValidation.hits : [];
  const realCounts: Record<number, number> = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  for (const h of hits) {
    if (h >= 11 && h <= 15) realCounts[h]++;
  }

  let fixedPrize = 0;
  if (!isFixture && !isProvisional && authValidation.valid) {
    for (const tier of [11, 12, 13] as const) {
      const count = realCounts[tier];
      if (count > 0) {
        const fixedUnit = getFixedLotofacilPrize(tier, record.contestNumber, record.contestDate);
        if (fixedUnit !== undefined) {
          fixedPrize += count * fixedUnit;
        }
      }
    }
  }

  let officialValidatedPrize = 0;
  let manualConfirmedPrize = 0;
  let manualInformedPrize = 0;
  let hasPendingVariableRateio = false;
  let hasPendingOfficialProof = false;

  for (const tier of [14, 15] as const) {
    const count = realCounts[tier];
    if (count === 0) continue;

    if (isFixture) {
      continue;
    }

    const confirmationData = record.confirmedVariablePrizes?.[tier] || record.prizeBreakdown?.[String(tier)];

    if (isProvisional || !authValidation.valid) {
      hasPendingVariableRateio = true;
      hasPendingOfficialProof = true;
      const informedUnit = (confirmationData as any)?.unitPrize ?? (confirmationData as any)?.unitValue;
      if (typeof informedUnit === "number" && !Number.isNaN(informedUnit) && Number.isFinite(informedUnit) && informedUnit > 0) {
        manualInformedPrize += count * informedUnit;
      }
      continue;
    }

    if (!confirmationData) {
      hasPendingVariableRateio = true;
      hasPendingOfficialProof = true;
      const informedUnit =
        (record.prizeBreakdown?.[String(tier)] as any)?.unitValue ??
        (record.prizeBreakdown?.[String(tier)] as any)?.unitPrize ??
        (record.prizeBreakdown?.[String(tier)] as any)?.totalValue;
      if (typeof informedUnit === "number" && !Number.isNaN(informedUnit) && Number.isFinite(informedUnit) && informedUnit > 0) {
        manualInformedPrize += count * informedUnit;
      }
      continue;
    }

    const validation = testHarnessValidateRateioConfirmation(
      record.contestNumber,
      tier,
      confirmationData,
      testRegistry
    );

    if (!validation.valid || !validation.validatedUnitValue || validation.validatedUnitValue <= 0) {
      hasPendingVariableRateio = true;
      hasPendingOfficialProof = true;
      const informedUnit =
        (confirmationData as any)?.unitValue ??
        (confirmationData as any)?.unitPrize ??
        (confirmationData as any)?.totalValue ??
        (record.prizeBreakdown?.[String(tier)] as any)?.unitValue ??
        (record.prizeBreakdown?.[String(tier)] as any)?.unitPrize ??
        (record.prizeBreakdown?.[String(tier)] as any)?.totalValue;
      if (typeof informedUnit === "number" && !Number.isNaN(informedUnit) && Number.isFinite(informedUnit) && informedUnit > 0) {
        manualInformedPrize += count * informedUnit;
      }
      continue;
    }

    const prize = count * validation.validatedUnitValue;
    if (validation.confirmationSource === "OFFICIAL_CAIXA") {
      officialValidatedPrize += prize;
    } else if (validation.confirmationSource === "MANUAL_ENTRY") {
      manualConfirmedPrize += prize;
      hasPendingOfficialProof = true;
    }
  }

  const officialTotalPrize = fixedPrize + officialValidatedPrize;
  const totalAuditedPrize = officialTotalPrize + manualConfirmedPrize;
  const officialNetBalance = isFixture ? 0 : (officialTotalPrize - totalCost === 0 ? 0 : officialTotalPrize - totalCost);
  const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;
  const netBalance = isFixture ? 0 : (totalAuditedPrize - totalCost === 0 ? 0 : totalAuditedPrize - totalCost);
  const roiPercentage = totalCost > 0 ? (netBalance / totalCost) * 100 : 0;

  return {
    cost: totalCost,
    fixedPrize,
    manualInformedPrize,
    manualConfirmedPrize,
    officialValidatedPrize,
    officialTotalPrize,
    totalAuditedPrize,
    officialNetBalance,
    officialRoiPercentage,
    netBalance,
    roiPercentage,
    hasPendingVariableRateio,
    hasPendingOfficialProof,
    hasProvisionalVariableRateio: isProvisional && hasPendingVariableRateio,
  };
}

export function testHarnessCalculateContestPrize(
  record: ContestRecord,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>,
  options?: { officialOnly?: boolean }
): number {
  const breakdown = testHarnessCalculateContestFinancialBreakdown(record, testRegistry);
  if (options?.officialOnly) {
    return breakdown.officialTotalPrize;
  }
  return breakdown.totalAuditedPrize;
}

export function testHarnessCalculateContestOfficialPrize(
  record: ContestRecord,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>
): number {
  return testHarnessCalculateContestPrize(record, testRegistry, { officialOnly: true });
}

export function testHarnessIsContestPendingVariableRateio(
  record: ContestRecord,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>,
  options?: { officialProofRequired?: boolean }
): boolean {
  const breakdown = testHarnessCalculateContestFinancialBreakdown(record, testRegistry);
  if (options?.officialProofRequired) {
    return breakdown.hasPendingOfficialProof;
  }
  return breakdown.hasPendingVariableRateio;
}

export function testHarnessIsContestPendingOfficialProof(
  record: ContestRecord,
  testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>>
): boolean {
  return testHarnessIsContestPendingVariableRateio(record, testRegistry, { officialProofRequired: true });
}

export function testHarnessBuildC5Dashboard(
  records: ContestRecord[],
  param2?: number | Readonly<Record<string, Readonly<OfficialCaixaProof>>>,
  param3?: boolean | number,
  param4?: Readonly<Record<string, Readonly<OfficialCaixaProof>>> | boolean
): DashboardDTO {
  let testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>> = {};
  let currentContestNumber: number | undefined;
  let includeDemo = false;

  if (typeof param2 === "object" && param2 !== null) {
    testRegistry = param2;
    currentContestNumber = typeof param3 === "number" ? param3 : undefined;
    includeDemo = typeof param4 === "boolean" ? param4 : false;
  } else {
    currentContestNumber = typeof param2 === "number" ? param2 : undefined;
    includeDemo = typeof param3 === "boolean" ? param3 : false;
    testRegistry = typeof param4 === "object" && param4 !== null ? (param4 as any) : {};
  }

  const filtered = records.filter(r => (includeDemo ? true : !isRecordFixture(r)));
  const confirmed = filtered.filter(r => r.status === "COMPLETED" || r.status === "FROZEN");
  const completed = filtered.filter(r => r.status === "COMPLETED");

  const totalCost = confirmed.reduce(
    (acc, r) => acc + (typeof r.totalCost === "number" && r.totalCost > 0 ? r.totalCost : getContestStandardCost(r.contestNumber, r.contestDate)),
    0
  );

  const totalPrize = completed.reduce(
    (acc, r) => acc + testHarnessCalculateContestPrize(r, testRegistry),
    0
  );
  const officialTotalPrize = completed.reduce(
    (acc, r) => acc + testHarnessCalculateContestOfficialPrize(r, testRegistry),
    0
  );
  const netBalance = totalPrize - totalCost;
  const roiPercentage = totalCost > 0 ? ((totalPrize - totalCost) / totalCost) * 100 : 0;
  const officialNetBalance = officialTotalPrize - totalCost;
  const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;

  let manualConfirmedPrize = 0;
  let manualInformedPrize = 0;
  let officialValidatedPrize = 0;
  for (const r of completed) {
    const fin = testHarnessCalculateContestFinancialBreakdown(r, testRegistry);
    manualConfirmedPrize += fin.manualConfirmedPrize;
    manualInformedPrize += fin.manualInformedPrize;
    officialValidatedPrize += fin.officialValidatedPrize;
  }

  const winningContestsCount = completed.filter(r => {
    if (r.financialStatus === "PENDING_HOMOLOGATION") return false;
    if (r.financialStatus !== "HOMOLOGATED" && (r.resultConfirmed !== true || !isHumanConferenceValid(r))) return false;
    const best = typeof r.bestHits === "number" ? r.bestHits : buildC5ContestPerformance(r).bestHits;
    return best >= 11;
  }).length;

  const pendingRateioContests = completed.filter(r => testHarnessIsContestPendingVariableRateio(r, testRegistry));
  const hasPendingVariableRateio = pendingRateioContests.length > 0;
  const pendingRateioContestsCount = pendingRateioContests.length;

  const resolvedContestNumber =
    typeof currentContestNumber === "number" && !Number.isNaN(currentContestNumber)
      ? currentContestNumber
      : (filtered.length > 0 ? filtered[filtered.length - 1].contestNumber : 3511);

  const currentRecord = filtered.find(r => r.contestNumber === resolvedContestNumber);
  const currentStatus = currentRecord ? currentRecord.status : "AVAILABLE";

  const emptyTier: HitTierMetric = { tier: 11, count: 0, total: 0, percentage: 0, theoreticalProbability: 0 };

  return {
    currentContestNumber: resolvedContestNumber,
    currentStatus,
    confirmedContests: confirmed.length,
    scoredContests: completed.length,
    confirmedGames: confirmed.length * 5,
    scoredGames: completed.length * 5,
    overallBestHits: 0,
    overallBestHitsCount: 0,
    hitDistribution: {} as HitDistributionMap,
    totalDistributionSum: 0,
    tiers: { tier11: emptyTier, tier12: emptyTier, tier13: emptyTier, tier14: emptyTier, tier15: emptyTier },
    evolutionSeries: [] as EvolutionPoint[],
    totalCost,
    totalPrize,
    officialTotalPrize,
    officialNetBalance,
    officialRoiPercentage,
    manualConfirmedPrize,
    manualInformedPrize,
    officialValidatedPrize,
    netBalance,
    roiPercentage,
    winningContestsCount,
    hasPendingVariableRateio,
    pendingRateioContestsCount,
  };
}

export function testHarnessBuildC5MonthlyReport(
  records: ContestRecord[],
  param2: number | Readonly<Record<string, Readonly<OfficialCaixaProof>>>,
  param3?: number,
  param4?: boolean | number,
  param5?: Readonly<Record<string, Readonly<OfficialCaixaProof>>> | boolean
): MonthlyReportDTO {
  let testRegistry: Readonly<Record<string, Readonly<OfficialCaixaProof>>> = {};
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  let includeDemo = false;

  if (typeof param2 === "object" && param2 !== null) {
    testRegistry = param2;
    year = typeof param3 === "number" ? param3 : year;
    month = typeof param4 === "number" ? param4 : month;
    includeDemo = typeof param5 === "boolean" ? param5 : false;
  } else {
    year = typeof param2 === "number" ? param2 : year;
    month = typeof param3 === "number" ? param3 : month;
    includeDemo = typeof param4 === "boolean" ? param4 : false;
    testRegistry = typeof param5 === "object" && param5 !== null ? (param5 as any) : {};
  }

  const dash = testHarnessBuildC5Dashboard(records, undefined, includeDemo, testRegistry);

  const contestRows: MonthlyContestRow[] = [];
  for (const rec of records) {
    const fin = testHarnessCalculateContestFinancialBreakdown(rec, testRegistry);
    const rowCost = typeof rec.totalCost === "number" && rec.totalCost > 0 ? rec.totalCost : getContestStandardCost(rec.contestNumber, rec.contestDate);
    const prize = testHarnessCalculateContestPrize(rec, testRegistry);
    const officialPrize = testHarnessCalculateContestOfficialPrize(rec, testRegistry);
    contestRows.push({
      contestNumber: rec.contestNumber,
      contestDate: rec.contestDate,
      j1Hits: 0, j2Hits: 0, j3Hits: 0, j4Hits: 0, j5Hits: 0,
      bestHits: 0, bestHitsCount: 0,
      cost: rowCost,
      prize,
      officialPrize,
      manualPrize: fin.manualConfirmedPrize,
      netBalance: prize - rowCost,
      officialNetBalance: officialPrize - rowCost,
      hasPendingVariableRateio: testHarnessIsContestPendingVariableRateio(rec, testRegistry),
      hasProvisionalVariableRateio: isContestPendingProvisionalRateio(rec),
    });
  }

  return {
    year,
    month,
    monthLabel: `${year}-${String(month).padStart(2, "0")}`,
    totalContestsInMonth: records.length,
    confirmedContests: dash.confirmedContests,
    scoredContests: dash.scoredContests,
    confirmedGames: dash.confirmedGames,
    scoredGames: dash.scoredGames,
    bestHitsOfMonth: 0,
    bestHitsContests: [],
    bestHitsOccurrences: 0,
    hitDistribution: {} as HitDistributionMap,
    tiers: dash.tiers,
    contestRows,
    totalCost: dash.totalCost,
    totalPrize: dash.totalPrize,
    netBalance: dash.netBalance,
    roiPercentage: dash.roiPercentage,
    officialTotalPrize: dash.officialTotalPrize,
    officialNetBalance: dash.officialNetBalance,
    officialRoiPercentage: dash.officialRoiPercentage,
    manualConfirmedPrize: dash.manualConfirmedPrize,
    manualInformedPrize: dash.manualInformedPrize,
    officialValidatedPrize: dash.officialValidatedPrize,
    winningContestsCount: dash.winningContestsCount,
    hasPendingVariableRateio: dash.hasPendingVariableRateio,
    pendingRateioContestsCount: dash.pendingRateioContestsCount,
  };
}
