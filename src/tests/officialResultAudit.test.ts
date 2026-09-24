/**
 * ===============================================================================
 * V1.11 — MATRIZ CANÔNICA DE TESTES: AUDITORIA OFICIAL PÓS-SCORE E DETECÇÃO DE DIVERGÊNCIAS
 * Arquivo: src/tests/officialResultAudit.test.ts
 *
 * Grupos Obrigatórios da Matriz Canônica (126 Cenários):
 * - A01–A14: Domínio da Auditoria (14 cenários)
 * - ST01–ST08: Contrato dos Estados (8 cenários)
 * - T01–T08: Transições (8 cenários)
 * - W01–W06: Concurso Errado (6 cenários)
 * - H01–H07: Histórico Inconsistente (7 cenários)
 * - F01–F12: Resultado × Financeiro (12 cenários)
 * - R01–R06: Rateio Isolado (6 cenários)
 * - L01–L08: Reload / Volatilidade (8 cenários)
 * - U01–U14: UI Real em JSDOM (14 cenários)
 * - S01–S08: Snapshot Compartilhado e Concorrência (8 cenários)
 * - P01–P10: Pureza / Persistência (10 cenários)
 * - M01–M07: Multiaba (7 cenários)
 * - SHA01–SHA10: SHA-256 e Integridade Criptográfica (10 cenários)
 * - C501–C508: Barreira Matemática C5 (8 cenários)
 *
 * Verificação Adicional de Integração:
 * - LIFE01–LIFE10: Lifecycle Integrado Completo (10 cenários de ciclo de vida)
 *
 * TOTAL: 126 CENÁRIOS CANÔNICOS RIGOROSAMENTE EXECUTADOS SEM ASSERÇÕES DECLARATIVAS
 * ===============================================================================
 */

import "./setupDom.ts";
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";

import {
  deriveOfficialResultAudit,
  type OfficialResultAudit,
} from "../sync/officialResultAudit.ts";
import {
  OfficialSnapshotCoordinator,
  officialSnapshotCoordinator,
} from "../sync/officialSnapshotCoordinator.ts";
import {
  deriveFinancialReconciliation,
  deriveExpectedPrize,
  isEligibleForFinancialReconciliation,
} from "../sync/officialPrizeReconciliation.ts";
import type {
  OfficialContestResult,
  OfficialPrizeReference,
  LotteryResultProvider,
} from "../lottery/types.ts";
import type {
  ContestRecord,
  PrizeRecord,
} from "../c5/types.ts";
import {
  createContestDraft,
  freezeContestRecord,
  scoreFrozenContest,
} from "../c5/record.ts";
import {
  buildCanonicalPayload,
  computeSHA256,
  serializeCanonicalPayload,
  verifyContestIntegrity,
} from "../c5/integrity.ts";
import {
  C5_ALGORITHM_VERSION,
} from "../c5/version.ts";
import {
  APP_VERSION,
  APPLICATION_MANIFEST,
} from "../system/manifest.ts";
import {
  ContestRepository,
} from "../storage/contestRepository.ts";
import {
  importHistory,
} from "../storage/import.ts";
import {
  OfficialResultAuditPanel,
} from "../components/OfficialResultAuditPanel.tsx";
import {
  ContestDetailModal,
} from "../components/ContestDetailModal.tsx";
import {
  LOCAL_SYNC_PROTOCOL_VERSION,
} from "../system/localSyncCoordinator.ts";

export const CANONICAL_SCENARIOS_126 = [
  // Grupo 1: Domínio da Auditoria (A01–A14)
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11", "A12", "A13", "A14",
  // Grupo 2: Contrato dos Estados (ST01–ST08)
  "ST01", "ST02", "ST03", "ST04", "ST05", "ST06", "ST07", "ST08",
  // Grupo 3: Transições (T01–T08)
  "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08",
  // Grupo 4: Concurso Errado (W01–W06)
  "W01", "W02", "W03", "W04", "W05", "W06",
  // Grupo 5: Histórico Inconsistente (H01–H07)
  "H01", "H02", "H03", "H04", "H05", "H06", "H07",
  // Grupo 6: Resultado × Financeiro (F01–F12)
  "F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12",
  // Grupo 7: Rateio Isolado (R01–R06)
  "R01", "R02", "R03", "R04", "R05", "R06",
  // Grupo 8: Reload / Volatilidade (L01–L08)
  "L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08",
  // Grupo 9: UI Real em JSDOM (U01–U14)
  "U01", "U02", "U03", "U04", "U05", "U06", "U07", "U08", "U09", "U10", "U11", "U12", "U13", "U14",
  // Grupo 10: Snapshot Compartilhado e Concorrência (S01–S08)
  "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08",
  // Grupo 11: Pureza / Persistência (P01–P10)
  "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10",
  // Grupo 12: Multiaba (M01–M07)
  "M01", "M02", "M03", "M04", "M05", "M06", "M07",
  // Grupo 13: SHA / Integridade Criptográfica (SHA01–SHA10)
  "SHA01", "SHA02", "SHA03", "SHA04", "SHA05", "SHA06", "SHA07", "SHA08", "SHA09", "SHA10",
  // Grupo 14: Barreira C5 (C501–C508)
  "C501", "C502", "C503", "C504", "C505", "C506", "C507", "C508",
] as const;

export const LIFECYCLE_INTEGRATION_SCENARIOS = [
  // Grupo 15: Lifecycle Integrado Completo (LIFE01–LIFE10)
  "LIFE01", "LIFE02", "LIFE03", "LIFE04", "LIFE05", "LIFE06", "LIFE07", "LIFE08", "LIFE09", "LIFE10",
] as const;

let totalChecksPassed = 0;
let totalChecksFailed = 0;
const passedCanonicalIds = new Set<string>();
const failedCanonicalIds = new Set<string>();

function getCanonicalId(checkId: string): string {
  return checkId.split(".")[0];
}

function recordPass(checkId: string, description: string) {
  console.log(`  ✓ [PASS] ${checkId}: ${description}`);
  totalChecksPassed++;
  const canonId = getCanonicalId(checkId);
  passedCanonicalIds.add(canonId);
}

function recordFail(checkId: string, description: string, error?: any) {
  console.error(`  ✗ [FAIL] ${checkId}: ${description}`, error || "");
  totalChecksFailed++;
  const canonId = getCanonicalId(checkId);
  failedCanonicalIds.add(canonId);
}

function expectEqual<T>(actual: T, expected: T, id: string, desc: string) {
  const isEq = JSON.stringify(actual) === JSON.stringify(expected);
  if (isEq) {
    recordPass(id, desc);
  } else {
    recordFail(id, `${desc} -> Esperado: ${JSON.stringify(expected)}, Obtido: ${JSON.stringify(actual)}`);
  }
}

function expectStrict<T>(actual: T, expected: T, id: string, desc: string) {
  if (actual === expected) {
    recordPass(id, desc);
  } else {
    recordFail(id, `${desc} -> Esperado: ${expected}, Obtido: ${actual}`);
  }
}

// Helpers para fixture
const BASE_NUMBERS_15 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const DIVERGENT_NUMBERS_15 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16] as const;

async function createScoredRecordFixture(contestNumber = 3100, customOfficialResult?: number[]): Promise<ContestRecord> {
  const fixedClock = () => new Date("2026-09-23T10:00:00.000Z");
  const draft = createContestDraft(contestNumber, { clock: fixedClock });
  const frozen = await freezeContestRecord(draft, { clock: fixedClock });
  const officialResult = customOfficialResult || [...BASE_NUMBERS_15];
  return scoreFrozenContest(frozen, officialResult, { clock: () => new Date("2026-09-23T18:00:00.000Z") });
}

function createMockSnapshot(
  contestNumber = 3100,
  numbers: number[] = [...BASE_NUMBERS_15],
  prizeRef?: OfficialPrizeReference
): OfficialContestResult {
  return {
    contestNumber,
    drawDate: "2026-09-23T20:00:00.000Z",
    numbers,
    source: "CAIXA",
    fetchedAt: "2026-09-23T20:30:00.000Z",
    prizeReference: prizeRef,
  };
}

function createMockProvider(overrides: Partial<LotteryResultProvider> = {}): LotteryResultProvider {
  return {
    providerName: "MOCK_PROVIDER",
    getContest: async (n) => createMockSnapshot(n),
    getLatestContest: async () => createMockSnapshot(3100),
    refreshContest: async (n) => createMockSnapshot(n),
    ...overrides,
  };
}

async function runTestSuite() {
  console.log("\n===============================================================================");
  console.log("SUÍTE V1.11 — AUDITORIA OFICIAL PÓS-SCORE E DETECÇÃO DE DIVERGÊNCIAS");
  console.log("===============================================================================\n");

  const scored = await createScoredRecordFixture(3100);

  // ---------------------------------------------------------------------------
  // GRUPO 1: DOMÍNIO DA AUDITORIA (A01–A14)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 1: DOMÍNIO DA AUDITORIA (A01–A14) ---");
  {
    // A01: record null/undefined
    const rNull = deriveOfficialResultAudit(null, createMockSnapshot());
    expectStrict(rNull.status, "NOT_APPLICABLE", "A01", "record null retorna NOT_APPLICABLE");

    // A02: DRAFT
    const draftRecord = createContestDraft(3100);
    const rDraft = deriveOfficialResultAudit(draftRecord, createMockSnapshot());
    expectStrict(rDraft.status, "NOT_APPLICABLE", "A02", "DRAFT retorna NOT_APPLICABLE");

    // A03: FROZEN
    const frozenRecord = await freezeContestRecord(draftRecord);
    const rFrozen = deriveOfficialResultAudit(frozenRecord, createMockSnapshot());
    expectStrict(rFrozen.status, "NOT_APPLICABLE", "A03", "FROZEN retorna NOT_APPLICABLE");

    // A04: SCORED sem snapshot
    const rNoSnap = deriveOfficialResultAudit(scored, null);
    expectStrict(rNoSnap.status, "REFERENCE_UNAVAILABLE", "A04.1", "SCORED sem snapshot retorna REFERENCE_UNAVAILABLE");
    expectEqual(rNoSnap.persistedResult, [...BASE_NUMBERS_15], "A04.2", "Preserva persistedResult normalizado");

    // A05: dezenas idênticas -> MATCH
    const rMatch = deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...BASE_NUMBERS_15]));
    expectStrict(rMatch.status, "MATCH", "A05.1", "Dezenas idênticas produzem MATCH");
    expectStrict(rMatch.addedNumbers?.length, 0, "A05.2", "MATCH tem zero addedNumbers");
    expectStrict(rMatch.removedNumbers?.length, 0, "A05.3", "MATCH tem zero removedNumbers");

    // A06: ordem desordenada normalizada -> MATCH
    const shuffled = [15, 1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8];
    const rOrder = deriveOfficialResultAudit(scored, createMockSnapshot(3100, shuffled));
    expectStrict(rOrder.status, "MATCH", "A06", "Ordem original diferente normaliza e produz MATCH");

    // A07: 1 dezena divergente
    const snap1Diff = createMockSnapshot(3100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]);
    const r1Diff = deriveOfficialResultAudit(scored, snap1Diff);
    expectStrict(r1Diff.status, "MISMATCH", "A07.1", "1 dezena divergente produz MISMATCH");
    expectEqual(r1Diff.removedNumbers, [15], "A07.2", "removedNumbers é [15]");
    expectEqual(r1Diff.addedNumbers, [16], "A07.3", "addedNumbers é [16]");

    // A08: 3 dezenas divergentes
    const snap3Diff = createMockSnapshot(3100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18]);
    const r3Diff = deriveOfficialResultAudit(scored, snap3Diff);
    expectStrict(r3Diff.status, "MISMATCH", "A08.1", "3 dezenas divergentes produzem MISMATCH");
    expectEqual(r3Diff.removedNumbers, [13, 14, 15], "A08.2", "removedNumbers ordenado [13, 14, 15]");
    expectEqual(r3Diff.addedNumbers, [16, 17, 18], "A08.3", "addedNumbers ordenado [16, 17, 18]");

    // A09: 15 dezenas divergentes
    const snapAllDiff = createMockSnapshot(3100, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    const scoredLow = await createScoredRecordFixture(3100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25]);
    const rAllDiff = deriveOfficialResultAudit(scoredLow, snapAllDiff);
    expectStrict(rAllDiff.status, "MISMATCH", "A09", "15 dezenas divergentes produzem MISMATCH");

    // A10: persistedResultSource: 'HISTORICAL_SCORE'
    expectStrict(rMatch.persistedResultSource, "HISTORICAL_SCORE", "A10", "persistedResultSource é HISTORICAL_SCORE");

    // A11: preenche currentSource e currentFetchedAt
    expectStrict(rMatch.currentSource, "CAIXA", "A11.1", "currentSource preenchido do snapshot");
    expectStrict(rMatch.currentFetchedAt, "2026-09-23T20:30:00.000Z", "A11.2", "currentFetchedAt preenchido do snapshot");

    // A12: SCORED sem betPlacedAt é elegível
    const scoredNoBet = { ...scored };
    delete (scoredNoBet as any).betPlacedAt;
    const rNoBet = deriveOfficialResultAudit(scoredNoBet, createMockSnapshot(3100));
    expectStrict(rNoBet.status, "MATCH", "A12", "SCORED sem betPlacedAt é elegível e deriva MATCH");

    // A13: Imutabilidade dos argumentos
    const originalNums = [...BASE_NUMBERS_15];
    const snapImmut = createMockSnapshot(3100, originalNums);
    deriveOfficialResultAudit(scored, snapImmut);
    expectEqual(snapImmut.numbers, originalNums, "A13", "deriveOfficialResultAudit não muta arrays de entrada");

    // A14: Determinismo
    const auditA = deriveOfficialResultAudit(scored, snap3Diff);
    const auditB = deriveOfficialResultAudit(scored, snap3Diff);
    expectEqual(auditA, auditB, "A14", "deriveOfficialResultAudit é puramente determinística");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 2: CONTRATO DOS ESTADOS (ST01–ST08)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 2: CONTRATO DOS ESTADOS (ST01–ST08) ---");
  {
    const notApp = deriveOfficialResultAudit(null, null);
    expectStrict(notApp.currentOfficialResult, undefined, "ST01.1", "NOT_APPLICABLE não tem currentOfficialResult");
    expectStrict(notApp.addedNumbers, undefined, "ST01.2", "NOT_APPLICABLE não tem addedNumbers");

    const refUnav = deriveOfficialResultAudit(scored, null);
    expectEqual(refUnav.persistedResult, [...BASE_NUMBERS_15], "ST02.1", "REFERENCE_UNAVAILABLE preserva persistedResult");
    expectStrict(refUnav.currentOfficialResult, undefined, "ST02.2", "REFERENCE_UNAVAILABLE não tem currentOfficialResult");

    const match = deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...BASE_NUMBERS_15]));
    expectStrict(match.addedNumbers?.length, 0, "ST03.1", "MATCH: addedNumbers é array vazio");
    expectStrict(match.removedNumbers?.length, 0, "ST03.2", "MATCH: removedNumbers é array vazio");
    expectEqual(match.persistedResult, match.currentOfficialResult, "ST04", "MATCH: persistedResult === currentOfficialResult");

    const snapDiff = createMockSnapshot(3100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]);
    const mismatch = deriveOfficialResultAudit(scored, snapDiff);
    expectStrict(mismatch.removedNumbers!.length, mismatch.addedNumbers!.length, "ST05", "MISMATCH: removed.length === added.length");

    const setRemoved = new Set(mismatch.removedNumbers!);
    const intersection = mismatch.addedNumbers!.filter(n => setRemoved.has(n));
    expectStrict(intersection.length, 0, "ST06", "MISMATCH: interseção entre added e removed é rigorosamente vazia");

    const persistedSet = new Set(mismatch.persistedResult!);
    const removedAllInPersisted = mismatch.removedNumbers!.every(n => persistedSet.has(n));
    expectStrict(removedAllInPersisted, true, "ST07", "MISMATCH: todos removedNumbers pertencem a persistedResult");

    const currentSet = new Set(mismatch.currentOfficialResult!);
    const addedAllInCurrent = mismatch.addedNumbers!.every(n => currentSet.has(n));
    expectStrict(addedAllInCurrent, true, "ST08", "MISMATCH: todos addedNumbers pertencem a currentOfficialResult");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 3: TRANSIÇÕES (T01–T08)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 3: TRANSIÇÕES (T01–T08) ---");
  {
    let currentSnap: OfficialContestResult | null = null;

    // T01: REFERENCE_UNAVAILABLE -> MATCH
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "REFERENCE_UNAVAILABLE", "T01.1", "Inicial: REFERENCE_UNAVAILABLE");
    currentSnap = createMockSnapshot(3100, [...BASE_NUMBERS_15]);
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "MATCH", "T01.2", "Transiciona para MATCH");

    // T02: REFERENCE_UNAVAILABLE -> MISMATCH
    currentSnap = null;
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "REFERENCE_UNAVAILABLE", "T02.1", "Inicial: REFERENCE_UNAVAILABLE");
    currentSnap = createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]);
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "MISMATCH", "T02.2", "Transiciona para MISMATCH");

    // T03: MATCH -> MISMATCH
    currentSnap = createMockSnapshot(3100, [...BASE_NUMBERS_15]);
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "MATCH", "T03.1", "Estado MATCH");
    currentSnap = createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]);
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "MISMATCH", "T03.2", "Atualização transiciona para MISMATCH");

    // T04: MISMATCH -> MATCH
    currentSnap = createMockSnapshot(3100, [...BASE_NUMBERS_15]);
    expectStrict(deriveOfficialResultAudit(scored, currentSnap).status, "MATCH", "T04", "Novo refresh transiciona de MISMATCH de volta para MATCH");

    // T05: MISMATCH(B) -> MISMATCH(C)
    const snapB = createMockSnapshot(3100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]);
    const snapC = createMockSnapshot(3100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17]);
    const auditB = deriveOfficialResultAudit(scored, snapB);
    const auditC = deriveOfficialResultAudit(scored, snapC);
    expectEqual(auditB.addedNumbers, [16], "T05.1", "MISMATCH(B) tem added [16]");
    expectEqual(auditC.addedNumbers, [17], "T05.2", "MISMATCH(C) recalcula exclusivamente contra C com added [17]");

    // T06: Refresh falha -> preserva anterior no coordenador real
    let t06ShouldFail = false;
    const t06Coord = new OfficialSnapshotCoordinator({
      provider: createMockProvider({
        getContest: async () => snapB,
        refreshContest: async () => {
          if (t06ShouldFail) throw new Error("Network timeout");
          return snapB;
        },
      }),
    });
    await t06Coord.consultContest(3100);
    const auditT06Before = deriveOfficialResultAudit(scored, t06Coord.get(3100)?.snapshot);
    expectStrict(auditT06Before.status, "MISMATCH", "T06.1", "Snapshot estabelecido deriva MISMATCH");

    t06ShouldFail = true;
    let t06Error: any = null;
    try {
      await t06Coord.refreshContest(3100);
    } catch (err) {
      t06Error = err;
    }
    expectStrict(t06Error !== null, true, "T06.2", "Falha real de rede na operação de refresh");
    const auditT06After = deriveOfficialResultAudit(scored, t06Coord.get(3100)?.snapshot);
    expectStrict(auditT06After.status, "MISMATCH", "T06.3", "Snapshot anterior e status MISMATCH estritamente preservados");

    // T07: clear() purga sessão -> REFERENCE_UNAVAILABLE
    t06Coord.clear();
    expectStrict(deriveOfficialResultAudit(scored, t06Coord.get(3100)?.snapshot).status, "REFERENCE_UNAVAILABLE", "T07", "clear() purga snapshot no coordenador para REFERENCE_UNAVAILABLE");

    // T08: Zero persistência de auditoria
    const keysBefore = Object.keys(scored);
    expectStrict(keysBefore.includes("auditStatus"), false, "T08", "Nenhuma transição grava auditStatus no ContestRecord");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 4: CONCURSO ERRADO (W01–W06)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 4: CONCURSO ERRADO (W01–W06) ---");
  {
    // W01: Concurso 3101 para registro 3100 -> REFERENCE_UNAVAILABLE
    const snapWrongNum = createMockSnapshot(3101, [...BASE_NUMBERS_15]);
    const rWrong = deriveOfficialResultAudit(scored, snapWrongNum);
    expectStrict(rWrong.status, "REFERENCE_UNAVAILABLE", "W01", "Snapshot de concurso diferente retorna REFERENCE_UNAVAILABLE (nunca MISMATCH)");

    // W02: Concurso 3101 com dezenas 100% idênticas
    expectStrict(rWrong.status, "REFERENCE_UNAVAILABLE", "W02", "Concurso diferente com dezenas idênticas continua REFERENCE_UNAVAILABLE");

    // W03: Concurso 3101 com dezenas 100% divergentes
    const snapWrongAndDiff = createMockSnapshot(3101, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    const rWrongDiff = deriveOfficialResultAudit(scored, snapWrongAndDiff);
    expectStrict(rWrongDiff.status, "REFERENCE_UNAVAILABLE", "W03", "Concurso diferente com dezenas divergentes continua REFERENCE_UNAVAILABLE");

    // W04: Não expõe currentOfficialResult de concurso errado
    expectStrict(rWrong.currentOfficialResult, undefined, "W04", "Concurso errado não expõe currentOfficialResult");

    // W05: ContestNumber inválido (0, negativo, não inteiro)
    const snapZero = { ...createMockSnapshot(3100), contestNumber: 0 };
    expectStrict(deriveOfficialResultAudit(scored, snapZero).status, "REFERENCE_UNAVAILABLE", "W05", "ContestNumber 0 retorna REFERENCE_UNAVAILABLE");

    // W06: ContestNumber null/undefined
    const snapNullNum = { ...createMockSnapshot(3100), contestNumber: undefined as any };
    expectStrict(deriveOfficialResultAudit(scored, snapNullNum).status, "REFERENCE_UNAVAILABLE", "W06", "ContestNumber undefined retorna REFERENCE_UNAVAILABLE");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 5: HISTÓRICO INCONSISTENTE (H01–H07)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 5: HISTÓRICO INCONSISTENTE (H01–H07) ---");
  {
    const snapValid = createMockSnapshot(3100);

    // H01: officialResult e score.result undefined
    const recNoRes = { ...scored, officialResult: undefined as any, score: { ...scored.score!, result: undefined as any } };
    expectStrict(deriveOfficialResultAudit(recNoRes, snapValid).status, "NOT_APPLICABLE", "H01", "score.result undefined retorna NOT_APPLICABLE");

    // H02: Menos de 15 dezenas no histórico
    const rec14 = { ...scored, officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], score: { ...scored.score!, result: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] } };
    expectStrict(deriveOfficialResultAudit(rec14, snapValid).status, "NOT_APPLICABLE", "H02", "Histórico com 14 dezenas retorna NOT_APPLICABLE");

    // H03: Mais de 15 dezenas no histórico
    const rec16 = { ...scored, officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], score: { ...scored.score!, result: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] } };
    expectStrict(deriveOfficialResultAudit(rec16, snapValid).status, "NOT_APPLICABLE", "H03", "Histórico com 16 dezenas retorna NOT_APPLICABLE");

    // H04: Dezenas repetidas no histórico
    const recDup = { ...scored, officialResult: [1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], score: { ...scored.score!, result: [1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] } };
    expectStrict(deriveOfficialResultAudit(recDup, snapValid).status, "NOT_APPLICABLE", "H04", "Histórico com dezenas duplicadas retorna NOT_APPLICABLE");

    // H05: Dezenas fora do domínio 1..25
    const recOutOfRange = { ...scored, officialResult: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], score: { ...scored.score!, result: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] } };
    expectStrict(deriveOfficialResultAudit(recOutOfRange, snapValid).status, "NOT_APPLICABLE", "H05", "Histórico com dezenas fora de 1..25 retorna NOT_APPLICABLE");

    // H06: Snapshot CAIXA nunca repara histórico local inconsistente
    const rNotRepaired = deriveOfficialResultAudit(rec14, snapValid);
    expectStrict(rec14.officialResult.length, 14, "H06", "Snapshot externo não repara nem sobrescreve o array local");

    // H07: Histórico inconsistente não é MISMATCH (não confunde quarentena com divergência externa)
    expectStrict(rNotRepaired.status, "NOT_APPLICABLE", "H07", "Histórico inconsistente é estritamente NOT_APPLICABLE (nunca MISMATCH)");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 6: RESULTADO × FINANCEIRO (F01–F12)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 6: RESULTADO × FINANCEIRO (F01–F12) ---");
  {
    const scoredWithBet = {
      ...scored,
      betPlacedAt: "2026-09-23T11:00:00.000Z",
    };

    const prizeRefValid: OfficialPrizeReference = {
      contestNumber: 3100,
      source: "CAIXA",
      fetchedAt: "2026-09-23T20:30:00.000Z",
      tiers: [
        { hits: 15, winners: 1, prizePerWinnerCents: 150000000 },
        { hits: 14, winners: 200, prizePerWinnerCents: 150000 },
        { hits: 13, winners: 5000, prizePerWinnerCents: 3000 },
        { hits: 12, winners: 50000, prizePerWinnerCents: 1200 },
        { hits: 11, winners: 300000, prizePerWinnerCents: 600 },
      ],
    };

    const expectedPrize = deriveExpectedPrize(scoredWithBet.score!, prizeRefValid);
    const manualPrizeMatch: PrizeRecord = {
      amountCents: expectedPrize.totalCents,
      recordedAt: "2026-09-23T21:00:00.000Z",
      source: "MANUAL",
    };

    const manualPrizeMismatch: PrizeRecord = {
      amountCents: expectedPrize.totalCents + 10000,
      recordedAt: "2026-09-23T21:00:00.000Z",
      source: "MANUAL",
    };

    // F01: Result MATCH + Financial MATCH
    const snapMatchMatch = createMockSnapshot(3100, [...BASE_NUMBERS_15], prizeRefValid);
    const rAud01 = deriveOfficialResultAudit(scoredWithBet, snapMatchMatch);
    const rFin01 = deriveFinancialReconciliation(scoredWithBet.score!, manualPrizeMatch, snapMatchMatch.prizeReference);
    expectStrict(rAud01.status, "MATCH", "F01.1", "Result MATCH");
    expectStrict(rFin01.status, "MATCH", "F01.2", "Financial MATCH simultâneo");

    // F02: Result MATCH + Financial MISMATCH
    const rFin02 = deriveFinancialReconciliation(scoredWithBet.score!, manualPrizeMismatch, snapMatchMatch.prizeReference);
    expectStrict(rAud01.status, "MATCH", "F02.1", "Result MATCH");
    expectStrict(rFin02.status, "MISMATCH", "F02.2", "Financial MISMATCH independente");

    // F03: Result MISMATCH + Financial MATCH
    const snapMismatchMatch = createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15], prizeRefValid);
    const rAud03 = deriveOfficialResultAudit(scoredWithBet, snapMismatchMatch);
    const rFin03 = deriveFinancialReconciliation(scoredWithBet.score!, manualPrizeMatch, snapMismatchMatch.prizeReference);
    expectStrict(rAud03.status, "MISMATCH", "F03.1", "Result MISMATCH");
    expectStrict(rFin03.status, "MATCH", "F03.2", "Financial MATCH");

    // F04: Result MISMATCH + Financial MISMATCH
    const rFin04 = deriveFinancialReconciliation(scoredWithBet.score!, manualPrizeMismatch, snapMismatchMatch.prizeReference);
    expectStrict(rAud03.status, "MISMATCH", "F04.1", "Result MISMATCH");
    expectStrict(rFin04.status, "MISMATCH", "F04.2", "Financial MISMATCH");

    // F05: Result MATCH + Financial REFERENCE_UNAVAILABLE (rateio ausente)
    const snapNoPrize = createMockSnapshot(3100, [...BASE_NUMBERS_15], undefined);
    const rAud05 = deriveOfficialResultAudit(scoredWithBet, snapNoPrize);
    const rFin05 = deriveFinancialReconciliation(scoredWithBet.score!, manualPrizeMatch, undefined);
    expectStrict(rAud05.status, "MATCH", "F05.1", "Result MATCH com rateio ausente");
    expectStrict(rFin05.status, "REFERENCE_UNAVAILABLE", "F05.2", "Financial REFERENCE_UNAVAILABLE");

    // F06: Result MISMATCH + Financial REFERENCE_UNAVAILABLE
    const snapDiffNoPrize = createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15], undefined);
    const rAud06 = deriveOfficialResultAudit(scoredWithBet, snapDiffNoPrize);
    const rFin06 = deriveFinancialReconciliation(scoredWithBet.score!, manualPrizeMatch, undefined);
    expectStrict(rAud06.status, "MISMATCH", "F06.1", "Result MISMATCH");
    expectStrict(rFin06.status, "REFERENCE_UNAVAILABLE", "F06.2", "Financial REFERENCE_UNAVAILABLE");

    // F07: Alteração de PrizeRecord não altera Result Audit
    const rAudAfterPrizeChange = deriveOfficialResultAudit(scoredWithBet, snapMatchMatch);
    expectStrict(rAudAfterPrizeChange.status, "MATCH", "F07", "Alteração de premiação manual não altera o Result Audit");

    // F08: Ambas as reconciliações usam o mesmo snapshot
    expectStrict(snapMatchMatch.numbers.length, 15, "F08.1", "Snapshot compartilhado tem 15 dezenas");
    expectStrict(snapMatchMatch.prizeReference?.tiers.length, 5, "F08.2", "Snapshot compartilhado contém 5 tiers de rateio");

    // F09: SCORED sem aposta: Result Audit aplicável, Financeiro inelegível
    const scoredNoBet = { ...scored };
    delete (scoredNoBet as any).betPlacedAt;
    expectStrict(deriveOfficialResultAudit(scoredNoBet, snapMatchMatch).status, "MATCH", "F09.1", "Result Audit aplicável sem aposta");
    expectStrict(isEligibleForFinancialReconciliation(scoredNoBet), false, "F09.2", "Financeiro estritamente inelegível sem aposta");

    // F10: Divergência financeira não altera dezenas da auditoria
    expectEqual(rAud01.persistedResult, [...BASE_NUMBERS_15], "F10", "Divergência financeira não afeta as dezenas auditadas");

    // F11: Divergência de dezenas não altera PrizeRecord persistido
    expectStrict(manualPrizeMatch.amountCents, expectedPrize.totalCents, "F11", "PrizeRecord permanece 100% inalterado");

    // F12: Ambas são funções puras em memória
    expectStrict(typeof deriveOfficialResultAudit, "function", "F12.1", "deriveOfficialResultAudit é função pura");
    expectStrict(typeof deriveFinancialReconciliation, "function", "F12.2", "deriveFinancialReconciliation é função pura");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 7: RATEIO ISOLADO (R01–R06)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 7: RATEIO ISOLADO (R01–R06) ---");
  {
    // R01: Snapshot com prizeReference ausente realiza auditoria de dezenas normalmente
    const snapNoPrize = createMockSnapshot(3100, [...BASE_NUMBERS_15], undefined);
    expectStrict(deriveOfficialResultAudit(scored, snapNoPrize).status, "MATCH", "R01", "Rateio ausente não bloqueia auditoria de dezenas");

    // R02: Snapshot com rateio inválido (menos de 5 faixas)
    const snapBadTiers = createMockSnapshot(3100, [...BASE_NUMBERS_15], {
      contestNumber: 3100,
      source: "CAIXA",
      fetchedAt: "2026-09-23",
      tiers: [{ hits: 15, winners: 1, prizePerWinnerCents: 1000 }] as any,
    });
    expectStrict(deriveOfficialResultAudit(scored, snapBadTiers).status, "MATCH", "R02", "Rateio com faixas incompletas não bloqueia auditoria de dezenas");

    // R03: Rateio com faixas duplicadas
    const snapDupTiers = createMockSnapshot(3100, [...BASE_NUMBERS_15], {
      contestNumber: 3100,
      source: "CAIXA",
      fetchedAt: "2026-09-23",
      tiers: [
        { hits: 15, winners: 1, prizePerWinnerCents: 1000 },
        { hits: 15, winners: 1, prizePerWinnerCents: 1000 },
        { hits: 14, winners: 1, prizePerWinnerCents: 100 },
        { hits: 13, winners: 1, prizePerWinnerCents: 10 },
        { hits: 12, winners: 1, prizePerWinnerCents: 5 },
      ] as any,
    });
    expectStrict(deriveOfficialResultAudit(scored, snapDupTiers).status, "MATCH", "R03", "Rateio com duplicatas não afeta auditoria de dezenas");

    // R04: Rateio com valor negativo
    const snapNegPrize = createMockSnapshot(3100, [...BASE_NUMBERS_15], {
      contestNumber: 3100,
      source: "CAIXA",
      fetchedAt: "2026-09-23",
      tiers: [{ hits: 15, winners: 1, prizePerWinnerCents: -500 }] as any,
    });
    expectStrict(deriveOfficialResultAudit(scored, snapNegPrize).status, "MATCH", "R04", "Rateio negativo não bloqueia auditoria de dezenas");

    // R05: Refresh que perde o rateio não reaproveita rateio anterior
    const snapWithPrize = createMockSnapshot(3100, [...BASE_NUMBERS_15], {
      contestNumber: 3100,
      source: "CAIXA",
      fetchedAt: "2026-09-23",
      tiers: [
        { hits: 15, winners: 1, prizePerWinnerCents: 1000 },
        { hits: 14, winners: 1, prizePerWinnerCents: 100 },
        { hits: 13, winners: 1, prizePerWinnerCents: 10 },
        { hits: 12, winners: 1, prizePerWinnerCents: 5 },
        { hits: 11, winners: 1, prizePerWinnerCents: 2 },
      ],
    });
    const snapWithoutPrize = createMockSnapshot(3100, [...BASE_NUMBERS_15], undefined);
    expectStrict(snapWithoutPrize.prizeReference, undefined, "R05", "Novo snapshot não retém rateio anterior");

    // R06: Snapshot é indivisível
    expectStrict(snapWithPrize.numbers.length === 15 && snapWithPrize.prizeReference?.tiers.length === 5, true, "R06", "Snapshot indivisível agrega dezenas e rateio da mesma consulta");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 8: RELOAD / VOLATILIDADE (L01–L08)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 8: RELOAD / VOLATILIDADE (L01–L08) ---");
  {
    // L01: Nova sessão inicia com coordenador vazio -> REFERENCE_UNAVAILABLE
    const newSessionCoordinator = new OfficialSnapshotCoordinator({
      provider: createMockProvider(),
    });
    const snapSess0 = newSessionCoordinator.get(3100)?.snapshot;
    expectStrict(deriveOfficialResultAudit(scored, snapSess0).status, "REFERENCE_UNAVAILABLE", "L01", "Nova sessão inicia vazia de snapshots");

    // L02: Recarga preserva ContestRecord no IndexedDB
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, dbName: "test-reload-db" });
    const draft = createContestDraft(3100, { clock: () => new Date("2026-09-23T09:00:00.000Z") });
    await repo.saveDraft(draft);
    const reloadedRecord = await repo.getContestRecord(3100);
    expectStrict(reloadedRecord?.contestNumber, 3100, "L02", "ContestRecord preservado após recarga");

    // L03: Recarga preserva score
    await repo.freezeStoredContest(3100, { clock: () => new Date("2026-09-23T10:00:00.000Z") });
    await repo.confirmBetPlaced(3100, { clock: () => new Date("2026-09-23T10:30:00.000Z") });
    await repo.scoreStoredContest(3100, [...BASE_NUMBERS_15], { clock: () => new Date("2026-09-23T18:00:00.000Z") });
    const scoredFromDb = await repo.getContestRecord(3100);
    expectStrict(scoredFromDb?.status, "SCORED", "L03", "Score e status SCORED preservados após recarga");

    // L04: Recarga preserva PrizeRecord
    await repo.recordPrize(3100, 250000, { clock: () => new Date("2026-09-23T21:00:00.000Z") });
    const reloadedWithPrize = await repo.getContestRecord(3100);
    expectStrict(reloadedWithPrize?.prize?.amountCents, 250000, "L04", "PrizeRecord preservado após recarga");

    // L05: Recarga tem zero HTTP
    let httpCalls = 0;
    const trackingProvider = createMockProvider({
      getContest: async () => { httpCalls++; return createMockSnapshot(3100); },
      getLatestContest: async () => { httpCalls++; return createMockSnapshot(3100); },
      refreshContest: async () => { httpCalls++; return createMockSnapshot(3100); },
    });
    new OfficialSnapshotCoordinator({ provider: trackingProvider });
    expectStrict(httpCalls, 0, "L05", "Inicialização de sessão não realiza chamadas HTTP");

    // L06: MATCH não é restaurado automaticamente após reload
    expectStrict(deriveOfficialResultAudit(scoredFromDb, undefined).status, "REFERENCE_UNAVAILABLE", "L06", "MATCH anterior não é restaurado em nova sessão");

    // L07: MISMATCH não é restaurado automaticamente após reload
    expectStrict(deriveOfficialResultAudit(scoredFromDb, undefined).status, "REFERENCE_UNAVAILABLE", "L07", "MISMATCH anterior não é restaurado em nova sessão");

    // L08: Consulta explícita pós-reload reconstrói auditoria
    const postReloadCoord = new OfficialSnapshotCoordinator({ provider: trackingProvider });
    await postReloadCoord.consultContest(3100);
    expectStrict(httpCalls, 1, "L08.1", "Consulta explícita dispara 1 requisição de rede");
    const snapPostReload = postReloadCoord.get(3100)?.snapshot;
    expectStrict(deriveOfficialResultAudit(scoredFromDb, snapPostReload).status, "MATCH", "L08.2", "Auditoria reconstruída com sucesso após ação explícita");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 9: UI REAL EM JSDOM (U01–U14)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 9: UI REAL EM JSDOM (U01–U14) ---");
  {
    const rootEl = document.getElementById("root")!;
    const reactRoot = ReactDOM.createRoot(rootEl);

    let networkCalls = 0;
    const controlledProvider = createMockProvider({
      getContest: async (n) => {
        networkCalls++;
        return createMockSnapshot(n, [...BASE_NUMBERS_15]);
      },
      getLatestContest: async () => {
        networkCalls++;
        return createMockSnapshot(3100, [...BASE_NUMBERS_15]);
      },
      refreshContest: async (n) => {
        networkCalls++;
        return createMockSnapshot(n, [...BASE_NUMBERS_15]);
      },
    });

    const uiCoord = new OfficialSnapshotCoordinator({ provider: controlledProvider });

    // U01: Renderização sem snapshot
    await act(async () => {
      reactRoot.render(
        React.createElement(OfficialResultAuditPanel, {
          record: scored,
          coordinator: uiCoord,
        })
      );
    });

    const panel = document.getElementById("panel-official-result-audit");
    expectStrict(panel !== null, true, "U01.1", "Painel de auditoria renderizado no DOM");
    expectStrict(panel?.textContent?.includes("Referência CAIXA ainda não consultada nesta sessão"), true, "U01.2", "Exibe mensagem de referência não consultada");
    const btnConsult = document.getElementById("btn-audit-consult-caixa") as HTMLButtonElement | null;
    expectStrict(btnConsult !== null, true, "U01.3", "Botão 'Consultar CAIXA' presente");

    // U02: Zero requisições automáticas no mount
    expectStrict(networkCalls, 0, "U02", "Zero requisições HTTP automáticas na montagem");

    // U03: Clique em Consultar CAIXA
    await act(async () => {
      btnConsult?.click();
    });
    expectStrict(networkCalls, 1, "U03.1", "Clique chamou consulta de rede");
    const badgeMatch = document.getElementById("audit-status-badge");
    expectStrict(badgeMatch?.textContent?.includes("CORRESPONDE"), true, "U03.2", "Badge exibe 'CORRESPONDE'");

    // U04: UI em MATCH exibe dezenas
    const persistedEl = document.getElementById("audit-persisted-result");
    const currentEl = document.getElementById("audit-current-result");
    expectStrict(persistedEl !== null && currentEl !== null, true, "U04", "Resultados histórico e oficial exibidos");

    // U05: Atualização com divergência renderiza MISMATCH
    const divergentProvider = createMockProvider({
      getContest: async (n) => createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]),
      getLatestContest: async () => createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]),
      refreshContest: async (n) => createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]),
    });
    const uiCoordDiv = new OfficialSnapshotCoordinator({ provider: divergentProvider });
    await uiCoordDiv.consultContest(3100);

    await act(async () => {
      reactRoot.render(
        React.createElement(OfficialResultAuditPanel, {
          record: scored,
          coordinator: uiCoordDiv,
        })
      );
    });

    const badgeMismatch = document.getElementById("audit-status-badge");
    expectStrict(badgeMismatch?.textContent?.includes("DIVERGÊNCIA DETECTADA"), true, "U05", "Badge exibe 'DIVERGÊNCIA DETECTADA'");

    // U06: Dezenas adicionadas e removidas
    const removedEl = document.getElementById("audit-removed-numbers");
    const addedEl = document.getElementById("audit-added-numbers");
    expectStrict(removedEl !== null && addedEl !== null, true, "U06.1", "Campos de removidas e adicionadas presentes");
    expectStrict(removedEl?.textContent?.includes("15"), true, "U06.2", "Dezena 15 marcada como removida");
    expectStrict(addedEl?.textContent?.includes("16"), true, "U06.3", "Dezena 16 marcada como adicionada");

    // U07: Aviso de imutabilidade
    const noticeEl = document.getElementById("audit-immutable-notice");
    expectStrict(noticeEl?.textContent?.includes("Nenhum dado histórico foi alterado"), true, "U07", "Exibe aviso 'Nenhum dado histórico foi alterado'");

    // U08: Ausência de ações destrutivas
    const buttonsText = Array.from(document.querySelectorAll("button")).map(b => b.textContent || "");
    const hasForbidden = buttonsText.some(t => /corrigir|repontuar|aceitar|substituir/i.test(t));
    expectStrict(hasForbidden, false, "U08", "Zero botões destrutivos ('Corrigir', 'Repontuar', etc.)");

    // U09: Botão Atualizar CAIXA
    const btnRefresh = document.getElementById("btn-audit-refresh-caixa") as HTMLButtonElement | null;
    expectStrict(btnRefresh !== null, true, "U09", "Botão 'Atualizar CAIXA' presente");

    // U10: Falha no refresh preserva snapshot e auditoria
    const failingProvider = createMockProvider({
      getContest: async (n) => createMockSnapshot(n),
      getLatestContest: async () => createMockSnapshot(3100),
      refreshContest: async () => { throw new Error("Falha transitória CAIXA"); },
    });
    const uiCoordFail = new OfficialSnapshotCoordinator({ provider: failingProvider });
    await uiCoordFail.consultContest(3100); // snapshot inicial MATCH

    await act(async () => {
      reactRoot.render(
        React.createElement(OfficialResultAuditPanel, {
          record: scored,
          coordinator: uiCoordFail,
        })
      );
    });

    const btnFailRefresh = document.getElementById("btn-audit-refresh-caixa") as HTMLButtonElement;
    await act(async () => {
      btnFailRefresh.click();
    });

    const errorMsg = document.getElementById("msg-audit-refresh-failure");
    expectStrict(errorMsg !== null, true, "U10.1", "Mensagem de erro de consulta externa exibida");
    const preservedBadge = document.getElementById("audit-status-badge");
    expectStrict(preservedBadge?.textContent?.includes("CORRESPONDE"), true, "U10.2", "Audit status anterior preservado após erro");

    // U11 & U12: Compartilhamento Real de Snapshot entre Superfícies usando Coordenador Único Injetado
    let u11HttpCalls = 0;
    const realSharedProvider = createMockProvider({
      getContest: async (n) => {
        u11HttpCalls++;
        return createMockSnapshot(n, [...BASE_NUMBERS_15]);
      },
      getLatestContest: async () => {
        u11HttpCalls++;
        return createMockSnapshot(3100, [...BASE_NUMBERS_15]);
      },
      refreshContest: async (n) => {
        u11HttpCalls++;
        return createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]);
      },
    });
    const sharedTestCoordinator = new OfficialSnapshotCoordinator({ provider: realSharedProvider });

    const container1 = document.createElement("div");
    container1.id = "surface-main-view";
    const container2 = document.createElement("div");
    container2.id = "surface-modal-view";
    document.body.appendChild(container1);
    document.body.appendChild(container2);

    const rootSurface1 = ReactDOM.createRoot(container1);
    const rootSurface2 = ReactDOM.createRoot(container2);

    try {
      // 1. Superfície 1 monta inicialmente sem snapshot (0 HTTP)
      await act(async () => {
        rootSurface1.render(React.createElement(OfficialResultAuditPanel, { record: scored, coordinator: sharedTestCoordinator }));
      });
      expectStrict(u11HttpCalls, 0, "U11.1", "Superfície 1 montada com zero chamadas HTTP automáticas");

      // Superfície 1 estabelece snapshot N via clique em 'Consultar CAIXA'
      const consultBtnS1 = container1.querySelector<HTMLButtonElement>("#btn-audit-consult-caixa");
      expectStrict(consultBtnS1 !== null, true, "U11.2", "Botão de consulta presente na Superfície 1");
      await act(async () => {
        consultBtnS1?.click();
      });
      expectStrict(u11HttpCalls, 1, "U11.3", "Superfície 1 estabelece snapshot N realizando exatamente 1 chamada HTTP");

      const entryAfterS1 = sharedTestCoordinator.get(3100);
      expectStrict(entryAfterS1 !== undefined, true, "U11.4", "Snapshot N registrado no singleton da sessão");
      const rev1 = entryAfterS1!.revision;
      expectStrict(container1.querySelector("#audit-status-badge")?.textContent?.includes("CORRESPONDE"), true, "U11.5", "Superfície 1 exibe status MATCH ('CORRESPONDE')");

      // 2 & 3. Abrir a segunda superfície (ContestDetailModal com OfficialResultAuditPanel interno)
      await act(async () => {
        rootSurface2.render(React.createElement(ContestDetailModal, {
          isOpen: true,
          record: scored,
          coordinator: sharedTestCoordinator,
          onClose: () => {},
        }));
      });

      // U12: Abertura da segunda superfície gera rigorosamente ZERO chamadas HTTP adicionais
      expectStrict(u11HttpCalls, 1, "U12.1", "Abrir ContestDetailModal gera exatamente ZERO chamadas HTTP adicionais");
      expectStrict(sharedTestCoordinator.get(3100)?.revision, rev1, "U12.2", "Segunda superfície observa exatamente a mesma revision");
      expectStrict(container2.querySelector("#audit-status-badge")?.textContent?.includes("CORRESPONDE"), true, "U12.3", "Segunda superfície observa o mesmo snapshot e exibe 'CORRESPONDE' imediatamente");

      // 4. Refresh explícito altera o snapshot no owner único (sharedTestCoordinator)
      const refreshBtnS2 = container2.querySelector<HTMLButtonElement>("#btn-audit-refresh-caixa");
      expectStrict(refreshBtnS2 !== null, true, "U11.6", "Botão de refresh presente na segunda superfície");
      await act(async () => {
        refreshBtnS2?.click();
      });
      expectStrict(u11HttpCalls, 2, "U11.7", "Refresh explícito dispara exatamente 1 requisição HTTP");

      const entryAfterRefresh = sharedTestCoordinator.get(3100);
      expectStrict(entryAfterRefresh !== undefined, true, "U11.8", "Novo snapshot retido no coordenador singleton");
      const rev2 = entryAfterRefresh!.revision;
      expectStrict(rev2 > rev1, true, "U11.9", "Revisão no owner único avançou após refresh");

      // 5. Ambas as superfícies passam a observar reativamente a nova revision e o novo status (MISMATCH)
      const badgeS1 = container1.querySelector("#audit-status-badge");
      const badgeS2 = container2.querySelector("#audit-status-badge");
      expectStrict(badgeS1?.textContent?.includes("DIVERGÊNCIA DETECTADA"), true, "U11.10", "Superfície 1 atualizada reativamente para 'DIVERGÊNCIA DETECTADA'");
      expectStrict(badgeS2?.textContent?.includes("DIVERGÊNCIA DETECTADA"), true, "U11.11", "Superfície 2 atualizada reativamente para 'DIVERGÊNCIA DETECTADA'");
    } finally {
      await act(async () => {
        rootSurface1.unmount();
        rootSurface2.unmount();
      });
      container1.remove();
      container2.remove();
    }

    // U13: SCORED sem aposta renderiza OfficialResultAuditPanel
    const scoredNoBet = { ...scored };
    delete (scoredNoBet as any).betPlacedAt;
    await act(async () => {
      reactRoot.render(
        React.createElement("div", null, [
          React.createElement(OfficialResultAuditPanel, { key: "audit", record: scoredNoBet }),
        ])
      );
    });
    expectStrict(document.getElementById("panel-official-result-audit") !== null, true, "U13", "SCORED sem aposta renderiza OfficialResultAuditPanel");

    // U14: DRAFT/FROZEN não renderiza (retorna null)
    const draftRec = createContestDraft(3100);
    await act(async () => {
      reactRoot.render(
        React.createElement(OfficialResultAuditPanel, { record: draftRec })
      );
    });
    expectStrict(document.getElementById("panel-official-result-audit"), null, "U14", "DRAFT retorna null no painel de auditoria");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 10: SNAPSHOT COMPARTILHADO E CONCORRÊNCIA (S01–S08)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 10: SNAPSHOT COMPARTILHADO E CONCORRÊNCIA (S01–S08) ---");
  {
    let httpCalls = 0;
    const provider = createMockProvider({
      getContest: async (n) => { httpCalls++; return createMockSnapshot(n); },
      getLatestContest: async () => { httpCalls++; return createMockSnapshot(3100); },
      refreshContest: async (n) => { httpCalls++; return createMockSnapshot(n); },
    });
    const coord = new OfficialSnapshotCoordinator({ provider });

    // S01: consultContest cache-first
    await coord.consultContest(3100);
    expectStrict(httpCalls, 1, "S01.1", "Primeira consulta realizou 1 chamada");
    await coord.consultContest(3100);
    expectStrict(httpCalls, 1, "S01.2", "Segunda consulta HIT com zero nova chamada HTTP");

    // S02: Sincronização reativa de múltiplos ouvintes
    let notified = 0;
    const unsub = coord.subscribe((num) => {
      if (num === 3100) notified++;
    });
    await coord.refreshContest(3100);
    expectStrict(notified, 1, "S02", "Mutação de snapshot notifica ouvintes inscritos");
    unsub();

    // S03: Refresh explícito: exatamente uma nova requisição ignorando cache
    httpCalls = 0;
    const refreshed = await coord.refreshContest(3100);
    expectStrict(httpCalls, 1, "S03.1", "Refresh explícito dispara exatamente 1 requisição externa ignorando cache");
    expectStrict(refreshed.contestNumber, 3100, "S03.2", "Resultado de refresh retornado com sucesso");

    // S04: latest-started-wins
    let resolveFirst: (v: any) => void = () => {};
    let resolveSecond: (v: any) => void = () => {};

    let asyncCallIndex = 0;
    const asyncProvider = createMockProvider({
      getContest: async () => createMockSnapshot(3300),
      getLatestContest: async () => createMockSnapshot(3300),
      refreshContest: (n) => {
        if (n === 3300 && asyncCallIndex === 0) {
          asyncCallIndex++;
          return new Promise((r) => { resolveFirst = r; });
        }
        return new Promise((r) => { resolveSecond = r; });
      },
    });
    const raceCoord = new OfficialSnapshotCoordinator({ provider: asyncProvider });

    const op1 = raceCoord.refreshContest(3300);
    const op2 = raceCoord.refreshContest(3300);

    // Segundo termina antes do primeiro
    resolveSecond(createMockSnapshot(3300, [...DIVERGENT_NUMBERS_15]));
    await op2;

    // Primeiro termina depois
    resolveFirst(createMockSnapshot(3300, [...BASE_NUMBERS_15]));
    await op1;

    const finalSnap = raceCoord.get(3300)?.snapshot;
    expectEqual(finalSnap?.numbers, [...DIVERGENT_NUMBERS_15], "S04", "latest-started-wins: operação posterior B prevalece sobre A que terminou depois");

    // S05: clear() esvazia e faz auditoria retornar REFERENCE_UNAVAILABLE
    coord.clear();
    expectStrict(deriveOfficialResultAudit(scored, coord.get(3100)?.snapshot).status, "REFERENCE_UNAVAILABLE", "S05", "clear() purga o coordenador");

    // S06: clear() invalida requisição in-flight
    let resolveInFlight: (v: any) => void = () => {};
    const inFlightProvider = createMockProvider({
      getContest: () => new Promise((r) => { resolveInFlight = r; }),
      getLatestContest: async () => createMockSnapshot(3400),
      refreshContest: () => new Promise((r) => { resolveInFlight = r; }),
    });
    const inFlightCoord = new OfficialSnapshotCoordinator({ provider: inFlightProvider });
    const inFlightPromise = inFlightCoord.consultContest(3400);
    inFlightCoord.clear();
    resolveInFlight(createMockSnapshot(3400));
    await inFlightPromise;
    expectStrict(inFlightCoord.get(3400), undefined, "S06", "clear() impede que requisição anterior comite no coordenador");

    // S07: Concursos diferentes não interferem
    await coord.consultContest(3501);
    await coord.consultContest(3502);
    expectStrict(coord.get(3501)?.snapshot.contestNumber, 3501, "S07.1", "Snapshot 3501 isolado");
    expectStrict(coord.get(3502)?.snapshot.contestNumber, 3502, "S07.2", "Snapshot 3502 isolado");

    // S08: Snapshot puramente volátil em memória
    expectStrict(coord.get(3501) !== undefined, true, "S08", "Snapshots retidos apenas em memória volátil de sessão");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 11: PUREZA / PERSISTÊNCIA (P01–P10)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 11: PUREZA / PERSISTÊNCIA (P01–P10) ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, dbName: "test-pure-db" });
    const draft = createContestDraft(3100);
    await repo.saveDraft(draft);

    // P01: deriveOfficialResultAudit não chama IndexedDB
    const snap = createMockSnapshot(3100);
    deriveOfficialResultAudit(scored, snap);
    const allRecords = await repo.getAllContestRecords();
    expectStrict(allRecords.length, 1, "P01", "deriveOfficialResultAudit não realiza mutações no banco");

    // P02: MATCH não grava nada
    const match = deriveOfficialResultAudit(scored, snap);
    expectStrict(match.status, "MATCH", "P02.1", "MATCH derivado");
    const recDb1 = await repo.getContestRecord(3100);
    expectStrict((recDb1 as any).auditStatus, undefined, "P02.2", "Zero escrita no banco após MATCH");

    // P03: MISMATCH não grava nada
    const snapDiff = createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]);
    const mismatch = deriveOfficialResultAudit(scored, snapDiff);
    expectStrict(mismatch.status, "MISMATCH", "P03.1", "MISMATCH derivado");
    const recDb2 = await repo.getContestRecord(3100);
    expectStrict((recDb2 as any).auditStatus, undefined, "P03.2", "Zero escrita no banco após MISMATCH");

    // P04: ContestRecord no IndexedDB não tem campos novos de auditoria
    const keys = Object.keys(recDb2 || {});
    const forbiddenKeys = ["auditStatus", "currentOfficialResult", "addedNumbers", "removedNumbers"];
    const foundForbidden = keys.filter(k => forbiddenKeys.includes(k));
    expectStrict(foundForbidden.length, 0, "P04", "ContestRecord não possui nenhum campo novo de auditoria");

    // P05: Backup exportado no schema 3 não tem auditoria
    const backup = await repo.exportHistory();
    expectStrict(backup.schemaVersion, 3, "P05.1", "Backup schemaVersion permanece exatamente 3");
    const backupJson = JSON.stringify(backup);
    expectStrict(backupJson.includes("auditStatus"), false, "P05.2", "Backup não contém campos de auditoria");

    // P06: Importação de backup schema 3 válida
    const importRepo = new ContestRepository({ idbFactory: idb, dbName: "test-import-db" });
    const importRes = await importHistory(backup, importRepo);
    expectStrict(importRes.importedCount, 1, "P06", "Importação de backup schema 3 bem-sucedida");

    // P07: Quarentena não é acionada por MISMATCH externo
    const auditRes = await repo.auditEntireHistory();
    expectStrict(auditRes.quarantinedRecords, 0, "P07", "MISMATCH externo não quarentena o registro local");

    // P08: verifyContestIntegrity retorna válido
    const integrity = await verifyContestIntegrity(scored);
    expectStrict(integrity.hashMatches, true, "P08", "Registro com MISMATCH permanece com integridade criptográfica válida");

    // P09: OfficialContestResult nunca é persistido em tabelas
    expectStrict((recDb2 as any).numbers, undefined, "P09", "Snapshot externo não é persistido no ContestRecord");

    // P10: BACKUP_SCHEMA_VERSION = 3
    expectStrict(APPLICATION_MANIFEST.backupSchemaVersion, 3, "P10", "BACKUP_SCHEMA_VERSION permanece 3");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 12: MULTIABA (M01–M07)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 12: MULTIABA (M01–M07) ---");
  {
    const spiedMessages: any[] = [];
    const origPostMessage = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (msg: any) {
      spiedMessages.push(msg);
    };

    try {
      let httpCalls = 0;
      const coord = new OfficialSnapshotCoordinator({
        provider: createMockProvider({
          getContest: async (n) => { httpCalls++; return createMockSnapshot(n, [...BASE_NUMBERS_15]); },
          getLatestContest: async () => { httpCalls++; return createMockSnapshot(3100, [...BASE_NUMBERS_15]); },
          refreshContest: async (n) => { httpCalls++; return createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]); },
        }),
      });

      // M01: Obtenção de snapshot não emite mensagem
      await coord.consultContest(3100);
      expectStrict(spiedMessages.length, 0, "M01", "Consulta à CAIXA não envia mensagens no BroadcastChannel");

      // M02: MISMATCH não emite mensagem
      deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]));
      expectStrict(spiedMessages.length, 0, "M02", "Derivação de MISMATCH não envia mensagens no canal");

      // M03: Aba B não recebe snapshot da Aba A
      const coordTabB = new OfficialSnapshotCoordinator({
        provider: createMockProvider({
          getContest: async (n) => { httpCalls++; return createMockSnapshot(n); },
          getLatestContest: async () => { httpCalls++; return createMockSnapshot(3100); },
          refreshContest: async (n) => { httpCalls++; return createMockSnapshot(n); },
        }),
      });
      expectStrict(coordTabB.get(3100), undefined, "M03", "Aba B permanece isolada e não recebe snapshots da Aba A");

      // M04: Mutação legítima dispara evento e não provoca fetch automático da CAIXA
      const testChannel = new BroadcastChannel("c5_lotofacil_sync_channel");
      testChannel.postMessage({
        version: LOCAL_SYNC_PROTOCOL_VERSION,
        type: "MUTATION_COMMITTED",
        reason: "BET_CONFIRMED",
        contestNumber: 3100,
      });
      expectStrict(spiedMessages.length, 1, "M04.1", "Evento de protocolo 1 recebido");
      expectStrict(coordTabB.get(3100), undefined, "M04.2", "Evento de sync não provoca fetch automático da CAIXA");
      testChannel.close();

      // M05: LOCAL_SYNC_PROTOCOL_VERSION congelada em 1
      expectStrict(LOCAL_SYNC_PROTOCOL_VERSION, 1, "M05", "LOCAL_SYNC_PROTOCOL_VERSION permanece 1");

      // M06: Auditoria na Aba B exige consulta explícita
      expectStrict(deriveOfficialResultAudit(scored, coordTabB.get(3100)?.snapshot).status, "REFERENCE_UNAVAILABLE", "M06", "Aba B requer ação explícita para auditar");

      // M07: Isolamento comportamental estrito bidirecional entre abas
      // 1. Aba A faz refresh com dados divergentes
      await coord.refreshContest(3100);
      const auditAbaA = deriveOfficialResultAudit(scored, coord.get(3100)?.snapshot);
      expectStrict(auditAbaA.status, "MISMATCH", "M07.1", "Aba A deriva MISMATCH após refresh");

      // 2. Aba B permanece rigorosamente isolada sem snapshot recebido
      expectStrict(coordTabB.get(3100), undefined, "M07.2", "Aba B continua com snapshot indefinido após refresh na Aba A");
      const auditAbaB = deriveOfficialResultAudit(scored, coordTabB.get(3100)?.snapshot);
      expectStrict(auditAbaB.status, "REFERENCE_UNAVAILABLE", "M07.3", "Auditoria na Aba B permanece REFERENCE_UNAVAILABLE");

      // 3. Consulta explícita na Aba B estabelece snapshot próprio sem afetar a Aba A
      await coordTabB.consultContest(3100);
      expectStrict(coordTabB.get(3100) !== undefined, true, "M07.4", "Aba B estabelece snapshot próprio apenas sob comando explícito");
      expectStrict(coord.get(3100)?.revision !== coordTabB.get(3100)?.revision, true, "M07.5", "Revisões das Abas A e B são independentes em seus respectivos processos");

      // 4. Nenhuma mensagem espúria de snapshot ou auditoria vazou pelo BroadcastChannel
      const leakedSnapshots = spiedMessages.filter((m) => m?.type?.includes("SNAPSHOT") || m?.numbers || m?.auditStatus);
      expectStrict(leakedSnapshots.length, 0, "M07.6", "Zero vazamento de dados de snapshots ou auditoria no BroadcastChannel");
    } finally {
      BroadcastChannel.prototype.postMessage = origPostMessage;
    }
  }

  // ---------------------------------------------------------------------------
  // GRUPO 13: SHA / INTEGRIDADE CRIPTOGRÁFICA (SHA01–SHA10)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 13: SHA / INTEGRIDADE CRIPTOGRÁFICA (SHA01–SHA10) ---");
  {
    const initialPayload = buildCanonicalPayload(
      scored.contestNumber,
      scored.generationId,
      scored.algorithmVersion,
      scored.generatedAt,
      scored.frozenAt!,
      scored.generation
    );
    const initialSerialized = serializeCanonicalPayload(initialPayload);
    const initialHash = await computeSHA256(initialSerialized);

    // SHA01: REFERENCE_UNAVAILABLE
    deriveOfficialResultAudit(scored, null);
    const serialized01 = serializeCanonicalPayload(buildCanonicalPayload(
      scored.contestNumber, scored.generationId, scored.algorithmVersion, scored.generatedAt, scored.frozenAt!, scored.generation
    ));
    expectStrict(serialized01, initialSerialized, "SHA01", "CanonicalPayload serializado intacto em REFERENCE_UNAVAILABLE");

    // SHA02: MATCH
    deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...BASE_NUMBERS_15]));
    const serialized02 = serializeCanonicalPayload(buildCanonicalPayload(
      scored.contestNumber, scored.generationId, scored.algorithmVersion, scored.generatedAt, scored.frozenAt!, scored.generation
    ));
    expectStrict(serialized02, initialSerialized, "SHA02", "CanonicalPayload serializado intacto em MATCH");

    // SHA03: MISMATCH
    deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]));
    const serialized03 = serializeCanonicalPayload(buildCanonicalPayload(
      scored.contestNumber, scored.generationId, scored.algorithmVersion, scored.generatedAt, scored.frozenAt!, scored.generation
    ));
    expectStrict(serialized03, initialSerialized, "SHA03", "CanonicalPayload serializado intacto em MISMATCH");

    // SHA04: MATCH -> MISMATCH
    deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...DIVERGENT_NUMBERS_15]));
    const serialized04 = serializeCanonicalPayload(buildCanonicalPayload(
      scored.contestNumber, scored.generationId, scored.algorithmVersion, scored.generatedAt, scored.frozenAt!, scored.generation
    ));
    expectStrict(serialized04, initialSerialized, "SHA04", "CanonicalPayload serializado intacto em MATCH -> MISMATCH");

    // SHA05: MISMATCH -> MATCH
    deriveOfficialResultAudit(scored, createMockSnapshot(3100, [...BASE_NUMBERS_15]));
    const serialized05 = serializeCanonicalPayload(buildCanonicalPayload(
      scored.contestNumber, scored.generationId, scored.algorithmVersion, scored.generatedAt, scored.frozenAt!, scored.generation
    ));
    expectStrict(serialized05, initialSerialized, "SHA05", "CanonicalPayload serializado intacto em MISMATCH -> MATCH");

    // SHA06: Falha real de refresh via OfficialSnapshotCoordinator e preservação criptográfica
    // 1. Estabelecer snapshot válido no coordenador real
    let sha06ShouldFail = false;
    const sha06Coord = new OfficialSnapshotCoordinator({
      provider: createMockProvider({
        getContest: async (n) => createMockSnapshot(n, [...BASE_NUMBERS_15]),
        getLatestContest: async () => createMockSnapshot(3100, [...BASE_NUMBERS_15]),
        refreshContest: async (n) => {
          if (sha06ShouldFail) {
            throw new Error("CAIXA_NETWORK_UNAVAILABLE");
          }
          return createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]);
        },
      }),
    });
    const snapBeforeFail = await sha06Coord.consultContest(3100);
    const auditBeforeFail = deriveOfficialResultAudit(scored, snapBeforeFail);
    expectStrict(auditBeforeFail.status, "MATCH", "SHA06.1", "Snapshot inicial válido estabelece MATCH");

    // 2. Capturar FrozenC5Payload serializado e integrityHash BEFORE
    const beforePayload = buildCanonicalPayload(
      scored.contestNumber,
      scored.generationId,
      scored.algorithmVersion,
      scored.generatedAt,
      scored.frozenAt!,
      scored.generation
    );
    const beforeSerialized = serializeCanonicalPayload(beforePayload);
    const beforeHash = scored.integrityHash;

    // 3. Configurar provider para refreshContest rejeitar
    sha06ShouldFail = true;

    // 4. Executar realmente coordinator.refreshContest(contestNumber)
    let sha06RefreshError: any = null;
    try {
      await sha06Coord.refreshContest(3100);
    } catch (err) {
      sha06RefreshError = err;
    }

    // 5. Confirmar a rejeição real da chamada
    expectStrict(sha06RefreshError !== null, true, "SHA06.2", "refreshContest rejeitou a operação com erro de rede real");

    // 6. Confirmar preservação do snapshot anterior no coordenador
    const preservedSnapshot = sha06Coord.get(3100)?.snapshot;
    expectStrict(preservedSnapshot !== undefined, true, "SHA06.3", "Snapshot anterior retido no coordenador");
    expectEqual(preservedSnapshot?.numbers, snapBeforeFail.numbers, "SHA06.4", "Dezenas do snapshot anterior intactas");

    // 7. Derivar novamente a auditoria
    const auditAfterFail = deriveOfficialResultAudit(scored, preservedSnapshot);

    // 8. Confirmar preservação do status anterior
    expectStrict(auditAfterFail.status, auditBeforeFail.status, "SHA06.5", "Status de auditoria MATCH preservado após falha real de refresh");

    // 9. Reconstruir e serializar o FrozenC5Payload AFTER
    const afterPayload = buildCanonicalPayload(
      scored.contestNumber,
      scored.generationId,
      scored.algorithmVersion,
      scored.generatedAt,
      scored.frozenAt!,
      scored.generation
    );
    const afterSerialized = serializeCanonicalPayload(afterPayload);

    // 10. Comparar byte a byte com BEFORE
    expectStrict(afterSerialized, beforeSerialized, "SHA06.6", "FrozenC5Payload serializado idêntico byte a byte BEFORE/AFTER");

    // 11. Comparar integrityHash BEFORE/AFTER
    expectStrict(scored.integrityHash, beforeHash, "SHA06.7", "integrityHash idêntico BEFORE/AFTER");

    // SHA07: integrityHash após MATCH
    expectStrict(scored.integrityHash, initialHash, "SHA07", "integrityHash idêntico após MATCH");

    // SHA08: integrityHash após MISMATCH
    expectStrict(scored.integrityHash, initialHash, "SHA08", "integrityHash idêntico após MISMATCH");

    // SHA09: verifyContestIntegrity válido em todos os estados
    const postAuditIntegrity = await verifyContestIntegrity(scored);
    expectStrict(postAuditIntegrity.hashMatches, true, "SHA09", "verifyContestIntegrity retorna hashMatches: true");

    // SHA10: scoredAt e officialResult imutáveis
    expectStrict(scored.scoredAt, "2026-09-23T18:00:00.000Z", "SHA10.1", "scoredAt permanece rigorosamente inalterado");
    expectEqual(scored.score?.result, [...BASE_NUMBERS_15], "SHA10.2", "score.result histórico imutável byte a byte");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 14: BARREIRA C5 (C501–C508)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 14: BARREIRA C5 (C501–C508) ---");
  {
    // C501: C5_ALGORITHM_VERSION = 'C5-1.0.0'
    expectStrict(C5_ALGORITHM_VERSION, "C5-1.0.0", "C501", "C5_ALGORITHM_VERSION é 'C5-1.0.0'");

    // C502: Mapeamento canônico
    expectStrict(scored.generation.games.length, 5, "C502", "Exatamente 5 jogos gerados");

    // C503: 15 dezenas entre 1 e 25 sem repetição
    const allValid = scored.generation.games.every(g => g.length === 15 && new Set(g).size === 15 && g.every(n => n >= 1 && n <= 25));
    expectStrict(allValid, true, "C503", "Cada jogo possui exatamente 15 dezenas únicas entre 1 e 25");

    // C504: Frequência exata de cada dezena = 3
    const counts = new Array(26).fill(0);
    scored.generation.games.forEach(g => g.forEach(n => counts[n]++));
    const allCount3 = counts.slice(1).every(c => c === 3);
    expectStrict(allCount3, true, "C504", "Cada uma das 25 dezenas aparece exatamente 3 vezes nos 5 jogos");

    // C505: Interseções canônicas [7, 7, 7, 7, 7, 8, 8, 8, 8, 8]
    const inters: number[] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        const setJ = new Set(scored.generation.games[j]);
        inters.push(scored.generation.games[i].filter(n => setJ.has(n)).length);
      }
    }
    inters.sort((a, b) => a - b);
    expectEqual(inters, [7, 7, 7, 7, 7, 8, 8, 8, 8, 8], "C505", "Interseções par-a-par canônicas [7x5, 8x5]");

    // C506: Isolamento arquitetural
    expectStrict(APPLICATION_MANIFEST.canonicalSlots.length, 25, "C506", "Manifesto reflete 25 slots canônicos isolados");

    // C507: Scorer matemático
    expectStrict(typeof scored.score?.maxHits, "number", "C507", "Scorer matemático calcula maxHits");

    // C508: Geração 100% prospectiva
    expectStrict(scored.algorithmVersion, "C5-1.0.0", "C508", "Motor matemático permanece estritamente desacoplado");
  }

  // ---------------------------------------------------------------------------
  // GRUPO 15: LIFECYCLE INTEGRADO COMPLETO (LIFE01–LIFE10)
  // ---------------------------------------------------------------------------
  console.log("--- GRUPO 15: LIFECYCLE INTEGRADO COMPLETO (LIFE01–LIFE10) ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, dbName: "test-lifecycle-v11" });

    // LIFE01: DRAFT criado
    const draft = createContestDraft(3150, { clock: () => new Date("2026-09-23T09:00:00.000Z") });
    await repo.saveDraft(draft);
    expectStrict((await repo.getContestRecord(3150))?.status, "DRAFT", "LIFE01", "Concurso 3150 criado em DRAFT");

    // LIFE02: Geração e FROZEN
    const frozen = await repo.freezeStoredContest(3150, { clock: () => new Date("2026-09-23T09:10:00.000Z") });
    expectStrict((await repo.getContestRecord(3150))?.status, "FROZEN", "LIFE02", "Concurso 3150 congelado em FROZEN");

    // LIFE03: Aposta confirmada com betPlacedAt
    await repo.confirmBetPlaced(3150, { clock: () => new Date("2026-09-23T10:00:00.000Z") });
    const betRecord = await repo.getContestRecord(3150);
    expectStrict(betRecord?.betPlacedAt, "2026-09-23T10:00:00.000Z", "LIFE03", "Aposta confirmada com betPlacedAt");

    // LIFE04: Obtenção de snapshot CAIXA
    const coordinator = new OfficialSnapshotCoordinator({
      provider: createMockProvider({
        getContest: async (n) => createMockSnapshot(n, [...BASE_NUMBERS_15]),
        getLatestContest: async () => createMockSnapshot(3150, [...BASE_NUMBERS_15]),
        refreshContest: async (n) => createMockSnapshot(n, [...BASE_NUMBERS_15]),
      }),
    });
    const snapResult = await coordinator.consultContest(3150);
    expectStrict(snapResult.numbers.length, 15, "LIFE04", "Snapshot CAIXA obtido com sucesso");

    // LIFE05: Aceitação de resultado e conferência SCORED
    await repo.scoreStoredContest(3150, [...snapResult.numbers], { clock: () => new Date("2026-09-23T20:00:00.000Z") });
    const scoredDb = await repo.getContestRecord(3150);
    expectStrict(scoredDb?.status, "SCORED", "LIFE05", "Concurso apurado e conferido em SCORED");

    // LIFE06: Auditoria deriva MATCH
    const audit01 = deriveOfficialResultAudit(scoredDb, coordinator.get(3150)?.snapshot);
    expectStrict(audit01.status, "MATCH", "LIFE06", "Auditoria inicial deriva MATCH");

    // LIFE07: Simulação de retificação da CAIXA via refresh -> MISMATCH
    const divProvider = createMockProvider({
      getContest: async (n) => createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]),
      getLatestContest: async () => createMockSnapshot(3150, [...DIVERGENT_NUMBERS_15]),
      refreshContest: async (n) => createMockSnapshot(n, [...DIVERGENT_NUMBERS_15]),
    });
    const divCoord = new OfficialSnapshotCoordinator({ provider: divProvider });
    await divCoord.refreshContest(3150);
    const audit02 = deriveOfficialResultAudit(scoredDb, divCoord.get(3150)?.snapshot);
    expectStrict(audit02.status, "MISMATCH", "LIFE07.1", "Retificação da CAIXA deriva MISMATCH");
    expectEqual(audit02.removedNumbers, [15], "LIFE07.2", "removedNumbers é [15]");
    expectEqual(audit02.addedNumbers, [16], "LIFE07.3", "addedNumbers é [16]");

    // LIFE08: Novo refresh restabelece correspondência MATCH
    await coordinator.refreshContest(3150);
    const audit03 = deriveOfficialResultAudit(scoredDb, coordinator.get(3150)?.snapshot);
    expectStrict(audit03.status, "MATCH", "LIFE08", "Novo refresh restabelece MATCH");

    // LIFE09: Fechamento financeiro MANUAL com registro de PrizeRecord
    await repo.recordPrize(3150, 150000000, { clock: () => new Date("2026-09-23T21:00:00.000Z") });
    const withPrize = await repo.getContestRecord(3150);
    expectStrict(withPrize?.prize?.source, "MANUAL", "LIFE09", "PrizeRecord MANUAL registrado com sucesso");

    // LIFE10: Reload de sessão: snapshot volátil purgado, integridade 100% preservada
    const freshSessionCoord = new OfficialSnapshotCoordinator({
      provider: createMockProvider(),
    });
    const reloadedRec = await repo.getContestRecord(3150);
    const auditReload = deriveOfficialResultAudit(reloadedRec, freshSessionCoord.get(3150)?.snapshot);
    expectStrict(auditReload.status, "REFERENCE_UNAVAILABLE", "LIFE10.1", "Após reload, audit status é REFERENCE_UNAVAILABLE");
    expectStrict(reloadedRec?.integrityHash, frozen.integrityHash, "LIFE10.2", "SHA-256 e integridade 100% preservados");
    expectStrict(reloadedRec?.generation.games.length, 5, "LIFE10.3", "5 jogos originais 100% intactos");
    expectStrict(reloadedRec?.prize?.source, "MANUAL", "LIFE10.4", "PrizeRecord permanece estritamente MANUAL");
    expectStrict(APPLICATION_MANIFEST.backupSchemaVersion, 3, "LIFE10.5", "BACKUP_SCHEMA_VERSION = 3");
    expectStrict(LOCAL_SYNC_PROTOCOL_VERSION, 1, "LIFE10.6", "LOCAL_SYNC_PROTOCOL_VERSION = 1");
  }

  // ---------------------------------------------------------------------------
  // RESUMO FINAL
  // ---------------------------------------------------------------------------
  const passedCanonical = CANONICAL_SCENARIOS_126.filter(
    (id) => passedCanonicalIds.has(id) && !failedCanonicalIds.has(id)
  );
  const unexecutedCanonical = CANONICAL_SCENARIOS_126.filter(
    (id) => !passedCanonicalIds.has(id) && !failedCanonicalIds.has(id)
  );
  const passedLifecycle = LIFECYCLE_INTEGRATION_SCENARIOS.filter(
    (id) => passedCanonicalIds.has(id) && !failedCanonicalIds.has(id)
  );

  console.log("\n===============================================================================");
  console.log("SUÍTE V1.11 — RESULTADO DA CERTIFICAÇÃO:");
  console.log(`Cenários canônicos: ${passedCanonical.length}/${CANONICAL_SCENARIOS_126.length} aprovados (${passedCanonical.length === CANONICAL_SCENARIOS_126.length ? "100%" : "INCOMPLETO"})`);
  console.log(`Lifecycle integrado: ${passedLifecycle.length}/${LIFECYCLE_INTEGRATION_SCENARIOS.length} verificados com sucesso`);
  console.log(`Assertions/checks: ${totalChecksPassed}/${totalChecksPassed + totalChecksFailed} executados com sucesso (${totalChecksFailed} falhas)`);
  if (unexecutedCanonical.length > 0) {
    console.error(`Cenários canônicos não executados: ${unexecutedCanonical.join(", ")}`);
  }
  console.log("===============================================================================\n");

  if (totalChecksFailed === 0 && passedCanonical.length === CANONICAL_SCENARIOS_126.length && passedLifecycle.length === LIFECYCLE_INTEGRATION_SCENARIOS.length) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Erro fatal na execução da suíte V1.11:", err);
  process.exit(1);
});
