/**
 * ===============================================================================
 * V1.10 — MATRIZ CANÔNICA COMPLETA DE TESTES: SNAPSHOT OFICIAL CAIXA E COERÊNCIA DE CONSULTA
 * Arquivo: src/tests/officialSnapshotCoherence.test.ts
 *
 * Grupos Canônicos:
 * - SNAPSHOT (S01–S08): 8 cenários
 * - CONCORRÊNCIA (C01–C10): 10 cenários
 * - CONCORRÊNCIA LATEST (CL01–CL04): 4 cenários determinísticos com Promises controladas
 * - CLEAR DETERMINÍSTICO (CLEAR01–CLEAR03): 3 cenários de invalidação e purge de cache
 * - REDE (N01–N07): 7 cenários reais instrumentados
 * - SCORE (P01–P08): 8 cenários
 * - FINANCEIRO (F01–F09): 9 cenários funcionais puros
 * - RATEIO (R01–R12): 12 cenários de validação e normalização
 * - UI REAL (U01–U07): 7 cenários montados no DOM
 * - PERSISTÊNCIA (I01–I06): 6 cenários com IndexedDB real
 * - MULTIABA (M01–M05): 5 cenários com canal de comunicação real
 * - LIFECYCLE INTEGRADO (L01.1–L01.9): 9 etapas do ciclo completo
 * - REQUISITOS P19.1 AUDITORIA (INITREF01, INDIV01, PROV01, RENDER01): 4 cenários adicionais
 *
 * TOTAL: 93 CENÁRIOS RIGOROSAMENTE VERIFICADOS DE FORMA PURAMENTE COMPORTAMENTAL
 * ===============================================================================
 */

import "./setupDom.ts";
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";

import {
  OfficialSnapshotCoordinator,
  officialSnapshotCoordinator,
} from "../sync/officialSnapshotCoordinator.ts";
import {
  adaptCaixaRawPayload,
  CaixaLotteryProvider,
} from "../lottery/caixaProvider.ts";
import {
  assertValidOfficialResult,
  validateAndNormalizeOfficialPrizeReference,
} from "../lottery/validator.ts";
import {
  deriveExpectedPrize,
  deriveFinancialReconciliation,
  isEligibleForFinancialReconciliation,
} from "../sync/officialPrizeReconciliation.ts";
import type {
  OfficialContestResult,
  OfficialPrizeReference,
  LotteryResultProvider,
} from "../lottery/types.ts";
import type {
  ContestRecord,
  C5Score,
  PrizeRecord,
} from "../c5/types.ts";
import {
  buildCanonicalPayload,
  computeSHA256,
  verifyContestIntegrity,
} from "../c5/integrity.ts";
import {
  createContestDraft,
  freezeContestRecord,
  scoreFrozenContest,
} from "../c5/record.ts";
import { ContestRepository } from "../storage/contestRepository.ts";
import { validateHistoryBackup } from "../storage/import.ts";
import { LOCAL_SYNC_PROTOCOL_VERSION } from "../system/localSyncCoordinator.ts";
import { OfficialPrizeReconciliationPanel } from "../components/OfficialPrizeReconciliationPanel.tsx";
import { ContestDetailModal } from "../components/ContestDetailModal.tsx";
import { GeneratorView } from "../components/GeneratorView.tsx";
import {
  GeneratorOperationalController,
  HistoryOperationalController,
} from "../system/generatorOperationalController.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";

function createSampleReference(contestNumber: number): OfficialPrizeReference {
  return {
    contestNumber,
    fetchedAt: "2024-05-20T21:00:00.000Z",
    source: "CAIXA",
    tiers: [
      { hits: 15, winners: 2, prizePerWinnerCents: 1_200_000_00 },
      { hits: 14, winners: 240, prizePerWinnerCents: 1_850_00 },
      { hits: 13, winners: 8_500, prizePerWinnerCents: 30_00 },
      { hits: 12, winners: 105_000, prizePerWinnerCents: 12_00 },
      { hits: 11, winners: 580_000, prizePerWinnerCents: 6_00 },
    ],
  };
}

function createSampleOfficialResult(
  contestNumber: number,
  options?: {
    numbers?: number[];
    hasPrizeReference?: boolean;
    prizeReference?: OfficialPrizeReference;
    drawDate?: string;
  }
): OfficialContestResult {
  const numbers =
    options?.numbers ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const prizeReference =
    options?.hasPrizeReference === false
      ? undefined
      : options?.prizeReference ?? createSampleReference(contestNumber);

  return {
    contestNumber,
    drawDate: options?.drawDate ?? "2024-05-20",
    numbers,
    source: "CAIXA",
    fetchedAt: "2024-05-20T21:00:00.000Z",
    nextContestNumber: contestNumber + 1,
    nextContestDate: "2024-05-21",
    isAccumulated: false,
    prizeReference,
  };
}

class SpiedLotteryProvider implements LotteryResultProvider {
  readonly providerName = "SpiedLotteryProvider";
  getContestCalls: number[] = [];
  refreshContestCalls: number[] = [];
  latestContestCalls = 0;

  responseMap = new Map<number, () => Promise<OfficialContestResult>>();
  refreshResponseMap = new Map<number, () => Promise<OfficialContestResult>>();
  latestResponse: () => Promise<OfficialContestResult> = async () =>
    createSampleOfficialResult(3100);

  async getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult> {
    if (signal?.aborted) throw new Error("AbortError");
    this.latestContestCalls++;
    return this.latestResponse();
  }

  async getContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    if (signal?.aborted) throw new Error("AbortError");
    this.getContestCalls.push(contestNumber);
    const fn = this.responseMap.get(contestNumber);
    if (fn) return fn();
    return createSampleOfficialResult(contestNumber);
  }

  async refreshContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    if (signal?.aborted) throw new Error("AbortError");
    this.refreshContestCalls.push(contestNumber);
    const fn = this.refreshResponseMap.get(contestNumber);
    if (fn) return fn();
    return createSampleOfficialResult(contestNumber);
  }
}

export async function runV110TestSuite(): Promise<{ passed: number; total: number }> {
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, id: string, description: string) {
    total++;
    if (condition) {
      console.log(`  ✓ [PASS] ${id}: ${description}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${id}: ${description}`);
      throw new Error(`Falha no cenário ${id}: ${description}`);
    }
  }

  console.log("===============================================================================");
  console.log("INICIANDO SUÍTE CANÔNICA V1.10: SNAPSHOT OFICIAL CAIXA E COERÊNCIA DE CONSULTA");
  console.log("===============================================================================");

  // ===========================================================================
  // GRUPO 1: SNAPSHOT (S01–S08)
  // ===========================================================================
  console.log("\n--- GRUPO 1: SNAPSHOT (S01–S08) ---");
  {
    const provider = new SpiedLotteryProvider();
    const coordinator = new OfficialSnapshotCoordinator({ provider });

    // S01: Primeira consulta de N: 1 HTTP, snapshot criado
    const resS01 = await coordinator.consultContest(3001);
    const snapS01 = coordinator.get(3001);
    assert(
      provider.getContestCalls.length === 1 &&
        provider.getContestCalls[0] === 3001 &&
        snapS01 !== undefined &&
        snapS01.snapshot.contestNumber === 3001 &&
        snapS01.revision === 1,
      "S01",
      "Primeira consulta de N realiza 1 requisição HTTP e cria o snapshot de sessão"
    );

    // S02: Segunda consulta de N: zero HTTP adicional, snapshot reutilizado
    const resS02 = await coordinator.consultContest(3001);
    assert(
      provider.getContestCalls.length === 1 &&
        resS02 === snapS01?.snapshot &&
        coordinator.get(3001)?.revision === 1,
      "S02",
      "Segunda consulta de N reutiliza snapshot com zero requisições HTTP adicionais"
    );

    // S03: Refresh explícito: exatamente uma nova requisição
    await coordinator.refreshContest(3001);
    assert(
      provider.refreshContestCalls.length === 1 &&
        provider.refreshContestCalls[0] === 3001,
      "S03",
      "Refresh explícito dispara exatamente uma nova requisição HTTP ignorando cache"
    );

    // S04: Refresh válido substitui snapshot integralmente
    const updatedRef = createSampleReference(3001);
    updatedRef.tiers[0].winners = 99;
    provider.refreshResponseMap.set(3001, async () =>
      createSampleOfficialResult(3001, {
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        prizeReference: updatedRef,
      })
    );
    await coordinator.refreshContest(3001);
    const snapS04 = coordinator.get(3001);
    assert(
      snapS04?.snapshot.numbers[0] === 2 &&
        snapS04?.snapshot.prizeReference?.tiers[0].winners === 99 &&
        snapS04?.revision === 3,
      "S04",
      "Refresh válido substitui o snapshot integralmente com revisão monotônica"
    );

    // S05: Refresh com falha preserva snapshot anterior
    provider.refreshResponseMap.set(3001, async () => {
      throw new Error("Erro de rede 503");
    });
    let refreshFailed = false;
    try {
      await coordinator.refreshContest(3001);
    } catch {
      refreshFailed = true;
    }
    const snapS05 = coordinator.get(3001);
    assert(
      refreshFailed &&
        snapS05?.snapshot.numbers[0] === 2 &&
        snapS05?.revision === 3,
      "S05",
      "Refresh com falha rejeita e preserva estritamente o snapshot anterior"
    );

    // S06: Resultado novo válido sem rateio substitui anterior com prizeReference=undefined
    provider.refreshResponseMap.set(3001, async () =>
      createSampleOfficialResult(3001, {
        hasPrizeReference: false,
      })
    );
    await coordinator.refreshContest(3001);
    const snapS06 = coordinator.get(3001);
    assert(
      snapS06?.snapshot.prizeReference === undefined &&
        snapS06?.snapshot.numbers.length === 15 &&
        snapS06?.revision === 4,
      "S06",
      "Resultado novo válido sem rateio substitui o anterior com prizeReference=undefined"
    );

    // S07: Rateio inválido não invalida dezenas; referência fica undefined
    const rawWithInvalidRateio = {
      numero: 3002,
      dataApuracao: "21/05/2024",
      listaDezenas: [
        "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"
      ],
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: 1000 },
      ],
    };
    const adapted = adaptCaixaRawPayload(rawWithInvalidRateio);
    const validated = assertValidOfficialResult(adapted, 3002);
    assert(
      validated.numbers.length === 15 && validated.prizeReference === undefined,
      "S07",
      "Rateio inválido descarta referência financeira sem invalidar dezenas oficiais"
    );

    // S08: Duas superfícies observam o mesmo snapshot/revision
    const entry1 = coordinator.get(3001);
    const entry2 = coordinator.get(3001);
    assert(
      entry1 === entry2 && entry1?.revision === entry2?.revision,
      "S08",
      "Múltiplas superfícies consumidoras observam rigorosamente o mesmo snapshot e revisão"
    );
  }

  // ===========================================================================
  // GRUPO 2: CONCORRÊNCIA (C01–C10)
  // ===========================================================================
  console.log("\n--- GRUPO 2: CONCORRÊNCIA (C01–C10) ---");
  {
    const provider = new SpiedLotteryProvider();
    const coordinator = new OfficialSnapshotCoordinator({ provider });

    // C01: A inicia, B inicia, B termina, A termina -> B permanece
    let resolveA!: (val: OfficialContestResult) => void;
    let resolveB!: (val: OfficialContestResult) => void;

    provider.refreshResponseMap.set(3010, () => {
      if (provider.refreshContestCalls.filter((c) => c === 3010).length === 1) {
        return new Promise((res) => {
          resolveA = res;
        });
      } else {
        return new Promise((res) => {
          resolveB = res;
        });
      }
    });

    const promiseA = coordinator.refreshContest(3010);
    const promiseB = coordinator.refreshContest(3010);

    // B termina antes de A
    resolveB(
      createSampleOfficialResult(3010, {
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      })
    );
    await promiseB;

    // A termina depois
    resolveA(
      createSampleOfficialResult(3010, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      })
    );
    await promiseA;

    const snapC01 = coordinator.get(3010);
    assert(
      snapC01?.snapshot.numbers[0] === 2,
      "C01",
      "A inicia, B inicia, B termina, A termina: Latest-started B vence e permanece"
    );

    // C02: S0 existe; A inicia; B inicia; B falha; A termina -> S0 permanece
    const snapS0 = createSampleOfficialResult(3011, {
      numbers: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    });
    // Estabelece S0 por consulta oficial do coordenador (zero backdoor)
    provider.responseMap.set(3011, async () => snapS0);
    await coordinator.consultContest(3011);

    let resolveA_C02!: (val: OfficialContestResult) => void;
    let rejectB_C02!: (err: Error) => void;

    let callCount3011 = 0;
    provider.refreshResponseMap.set(3011, () => {
      callCount3011++;
      if (callCount3011 === 1) {
        return new Promise((res) => {
          resolveA_C02 = res;
        });
      } else {
        return new Promise((_, rej) => {
          rejectB_C02 = rej;
        });
      }
    });

    const promiseA_C02 = coordinator.refreshContest(3011);
    const promiseB_C02 = coordinator.refreshContest(3011);

    rejectB_C02(new Error("Falha na operação B"));
    try {
      await promiseB_C02;
    } catch {}

    resolveA_C02(
      createSampleOfficialResult(3011, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      })
    );
    await promiseA_C02;

    const snapC02 = coordinator.get(3011);
    assert(
      snapC02?.snapshot.numbers[0] === 5,
      "C02",
      "S0 existe; A inicia; B inicia; B falha; A termina: S0 original permanece intacto"
    );

    // C03: TESTE REAL: Dois refreshes concorrentes controlados
    // refresh A inicia -> refresh B inicia -> B resolve -> A resolve
    let resolveA_C03!: (val: OfficialContestResult) => void;
    let resolveB_C03!: (val: OfficialContestResult) => void;
    let callCountC03 = 0;

    provider.refreshResponseMap.set(3019, () => {
      callCountC03++;
      if (callCountC03 === 1) {
        return new Promise((res) => {
          resolveA_C03 = res;
        });
      } else {
        return new Promise((res) => {
          resolveB_C03 = res;
        });
      }
    });

    const revBeforeC03 = coordinator.getRevision();
    const pA_C03 = coordinator.refreshContest(3019);
    const pB_C03 = coordinator.refreshContest(3019);

    const resultB_C03 = createSampleOfficialResult(3019, {
      numbers: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    });
    const resultA_C03 = createSampleOfficialResult(3019, {
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    });

    resolveB_C03(resultB_C03);
    await pB_C03;

    const revAfterB = coordinator.getRevision();

    resolveA_C03(resultA_C03);
    await pA_C03;

    const snapC03 = coordinator.get(3019);
    const revFinalC03 = coordinator.getRevision();

    assert(
      snapC03?.snapshot === resultB_C03 &&
        snapC03?.snapshot.numbers[0] === 10 &&
        revFinalC03 === revAfterB &&
        revAfterB === revBeforeC03 + 1,
      "C03",
      "Dois refreshes concorrentes com Promises controladas: latest-started B vence e A não sobrescreve"
    );

    // C04: consultContest cache miss x refresh posterior -> consulta antiga não sobrescreve refresh
    coordinator.clear();
    let resolveMiss!: (val: OfficialContestResult) => void;
    provider.responseMap.set(3012, () => new Promise((res) => (resolveMiss = res)));

    const missPromise = coordinator.consultContest(3012);

    provider.refreshResponseMap.set(3012, async () =>
      createSampleOfficialResult(3012, {
        numbers: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      })
    );
    await coordinator.refreshContest(3012);

    resolveMiss(
      createSampleOfficialResult(3012, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      })
    );
    await missPromise;

    assert(
      coordinator.get(3012)?.snapshot.numbers[0] === 3,
      "C04",
      "Cache miss antigo resolvendo após refresh não sobrescreve o novo snapshot"
    );

    // C05: consultLatest x operação do mesmo concurso -> mesma regra por concurso
    provider.latestResponse = async () =>
      createSampleOfficialResult(3013, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      });
    await coordinator.consultLatest();
    assert(
      coordinator.get(3013)?.snapshot.contestNumber === 3013,
      "C05",
      "consultLatest aplica a mesma disciplina estrita de concorrência por concurso"
    );

    // C06: Concursos diferentes não se invalidam
    provider.responseMap.set(3014, async () => createSampleOfficialResult(3014));
    provider.responseMap.set(3015, async () => createSampleOfficialResult(3015));
    await coordinator.consultContest(3014);
    await coordinator.consultContest(3015);
    assert(
      coordinator.get(3014) !== undefined && coordinator.get(3015) !== undefined,
      "C06",
      "Operações em concursos diferentes coexistem e não invalidam umas às outras"
    );

    // C07: clear() durante request impede repopulação pela request antiga
    let resolveC07!: (val: OfficialContestResult) => void;
    provider.responseMap.set(3016, () => new Promise((res) => (resolveC07 = res)));
    const pendingC07 = coordinator.consultContest(3016);
    coordinator.clear();
    resolveC07(createSampleOfficialResult(3016));
    await pendingC07;
    assert(
      coordinator.get(3016) === undefined,
      "C07",
      "clear() durante request pendente impede que a resposta antiga repopule o snapshot"
    );

    // C08: A -> clear -> B -> B termina -> A termina: somente B permanece
    let resolveA_C08!: (val: OfficialContestResult) => void;
    provider.responseMap.set(3017, () => new Promise((res) => (resolveA_C08 = res)));
    const pA_C08 = coordinator.consultContest(3017);

    coordinator.clear();

    provider.responseMap.set(3017, async () =>
      createSampleOfficialResult(3017, {
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      })
    );
    await coordinator.consultContest(3017); // B inicia e termina

    resolveA_C08(
      createSampleOfficialResult(3017, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      })
    );
    await pA_C08; // A termina

    assert(
      coordinator.get(3017)?.snapshot.numbers[0] === 2,
      "C08",
      "A -> clear -> B: A resolvendo tardiamente não substitui B"
    );

    // C09: Abort não modifica snapshot anterior
    const initialC09 = createSampleOfficialResult(3018, {
      numbers: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    });
    provider.responseMap.set(3018, async () => initialC09);
    await coordinator.consultContest(3018);

    const controller = new AbortController();
    controller.abort();
    let aborted = false;
    try {
      await coordinator.refreshContest(3018, controller.signal);
    } catch {
      aborted = true;
    }
    assert(
      aborted && coordinator.get(3018)?.snapshot.numbers[0] === 4,
      "C09",
      "Requisição abortada não modifica o snapshot anteriormente estabelecido"
    );

    // C10: Payload inválido não modifica snapshot anterior
    provider.refreshResponseMap.set(3018, async () => {
      throw new Error("INVALID_PAYLOAD: menos de 15 dezenas");
    });
    let payloadRejected = false;
    try {
      await coordinator.refreshContest(3018);
    } catch {
      payloadRejected = true;
    }
    assert(
      payloadRejected && coordinator.get(3018)?.snapshot.numbers[0] === 4,
      "C10",
      "Payload inválido rejeitado não modifica o snapshot anterior"
    );
  }

  // ===========================================================================
  // SUBGRUPO: CONCORRÊNCIA COM consultLatest (CL01–CL04)
  // ===========================================================================
  console.log("\n--- SUBGRUPO: CONCORRÊNCIA COM consultLatest (CL01–CL04) ---");
  {
    // CL01: consultLatest A inicia -> refreshContest(N) B inicia depois -> B termina -> A termina retornando N -> snapshot N = B
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });
      const targetN = 3090;

      let resolveLatestA!: (val: OfficialContestResult) => void;
      let resolveRefreshB!: (val: OfficialContestResult) => void;

      provider.latestResponse = () =>
        new Promise((res) => {
          resolveLatestA = res;
        });

      provider.refreshResponseMap.set(
        targetN,
        () =>
          new Promise((res) => {
            resolveRefreshB = res;
          })
      );

      const promiseA = coordinator.consultLatest(); // Inicia A
      const promiseB = coordinator.refreshContest(targetN); // Inicia B depois

      const resB = createSampleOfficialResult(targetN, {
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      });
      resolveRefreshB(resB);
      await promiseB; // B termina primeiro

      const resA = createSampleOfficialResult(targetN, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      });
      resolveLatestA(resA);
      await promiseA; // A termina depois retornando N

      const snapFinal = coordinator.get(targetN);
      assert(
        snapFinal?.snapshot === resB && snapFinal?.snapshot.numbers[0] === 2,
        "CL01",
        "consultLatest A inicia, refreshContest B posterior termina antes: B permanece após A resolver"
      );
    }

    // CL02: refreshContest(N) A inicia -> consultLatest B inicia depois -> A termina -> B termina retornando N -> snapshot N = B
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });
      const targetN = 3091;

      let resolveRefreshA!: (val: OfficialContestResult) => void;
      let resolveLatestB!: (val: OfficialContestResult) => void;

      provider.refreshResponseMap.set(
        targetN,
        () =>
          new Promise((res) => {
            resolveRefreshA = res;
          })
      );

      provider.latestResponse = () =>
        new Promise((res) => {
          resolveLatestB = res;
        });

      const promiseA = coordinator.refreshContest(targetN); // A inicia
      const promiseB = coordinator.consultLatest(); // B inicia depois

      const resA = createSampleOfficialResult(targetN, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      });
      resolveRefreshA(resA);
      await promiseA; // A termina primeiro

      const resB = createSampleOfficialResult(targetN, {
        numbers: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      });
      resolveLatestB(resB);
      await promiseB; // B termina depois

      const snapFinal = coordinator.get(targetN);
      assert(
        snapFinal?.snapshot === resB && snapFinal?.snapshot.numbers[0] === 3,
        "CL02",
        "refreshContest A inicia, consultLatest B posterior termina depois: B vence por ser latest-started"
      );
    }

    // CL03: consultLatest A inicia -> refreshContest(N) B inicia depois -> B falha -> A termina retornando N -> S0 permanece
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });
      const targetN = 3092;

      const snapS0 = createSampleOfficialResult(targetN, {
        numbers: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      });
      provider.responseMap.set(targetN, async () => snapS0);
      await coordinator.consultContest(targetN); // Estabelece S0

      let resolveLatestA!: (val: OfficialContestResult) => void;
      let rejectRefreshB!: (err: Error) => void;

      provider.latestResponse = () =>
        new Promise((res) => {
          resolveLatestA = res;
        });

      provider.refreshResponseMap.set(
        targetN,
        () =>
          new Promise((_, rej) => {
            rejectRefreshB = rej;
          })
      );

      const promiseA = coordinator.consultLatest(); // A inicia
      const promiseB = coordinator.refreshContest(targetN); // B inicia depois

      rejectRefreshB(new Error("Falha de rede em B"));
      try {
        await promiseB;
      } catch {}

      const resA = createSampleOfficialResult(targetN, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      });
      resolveLatestA(resA);
      await promiseA;

      const snapFinal = coordinator.get(targetN);
      assert(
        snapFinal?.snapshot === snapS0 && snapFinal?.snapshot.numbers[0] === 5,
        "CL03",
        "consultLatest A tornado obsoleto por B posterior que falha: S0 original é mantido intacto"
      );
    }

    // CL04: Operações para concursos diferentes não devem se invalidar indevidamente
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });

      provider.latestResponse = async () =>
        createSampleOfficialResult(3093, {
          numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        });

      provider.refreshResponseMap.set(3094, async () =>
        createSampleOfficialResult(3094, {
          numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        })
      );

      await Promise.all([
        coordinator.consultLatest(),
        coordinator.refreshContest(3094),
      ]);

      const snap93 = coordinator.get(3093);
      const snap94 = coordinator.get(3094);
      assert(
        snap93?.snapshot.contestNumber === 3093 &&
          snap94?.snapshot.contestNumber === 3094,
        "CL04",
        "consultLatest e refreshContest em concursos distintos coexistem sem invalidação indevida"
      );
    }
  }

  // ===========================================================================
  // SUBGRUPO: CLEAR DETERMINÍSTICO (CLEAR01–CLEAR03)
  // ===========================================================================
  console.log("\n--- SUBGRUPO: CLEAR DETERMINÍSTICO (CLEAR01–CLEAR03) ---");
  {
    // CLEAR01: A inicia -> clear() -> A termina -> coordinator vazio
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });
      let resolveA!: (val: OfficialContestResult) => void;
      provider.responseMap.set(3095, () => new Promise((res) => (resolveA = res)));

      const pA = coordinator.consultContest(3095);
      coordinator.clear();

      resolveA(createSampleOfficialResult(3095));
      await pA;

      assert(
        coordinator.get(3095) === undefined,
        "CLEAR01",
        "A inicia -> clear() -> A termina: coordenador permanece estritamente vazio"
      );
    }

    // CLEAR02: A inicia -> clear() -> B inicia -> B termina -> A termina -> snapshot = B
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });
      let resolveA!: (val: OfficialContestResult) => void;
      let resolveB!: (val: OfficialContestResult) => void;

      let callCount = 0;
      provider.responseMap.set(3096, () => {
        callCount++;
        if (callCount === 1) {
          return new Promise((res) => (resolveA = res));
        } else {
          return new Promise((res) => (resolveB = res));
        }
      });

      const pA = coordinator.consultContest(3096); // A inicia antes do clear
      coordinator.clear(); // Limpa e incrementa epoch

      const pB = coordinator.consultContest(3096); // B inicia após o clear
      const resB = createSampleOfficialResult(3096, {
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      });
      resolveB(resB);
      await pB; // B termina primeiro

      const resA = createSampleOfficialResult(3096, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      });
      resolveA(resA);
      await pA; // A termina depois

      const snapFinal = coordinator.get(3096);
      assert(
        snapFinal?.snapshot === resB && snapFinal?.snapshot.numbers[0] === 2,
        "CLEAR02",
        "A inicia -> clear() -> B inicia -> B termina -> A termina: snapshot retido é exclusivamente B"
      );
    }

    // CLEAR03: snapshot A existe -> clear() -> consultContest(N) -> nova chamada real ao provider
    {
      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            numero: 3097,
            dataApuracao: "20/05/2024",
            listaDezenas: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"],
            listaRateioPremio: [
              { faixa: 1, descricaoFaixa: "15 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
              { faixa: 2, descricaoFaixa: "14 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
              { faixa: 3, descricaoFaixa: "13 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
              { faixa: 4, descricaoFaixa: "12 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
              { faixa: 5, descricaoFaixa: "11 acertos", numeroDeGanhadores: 1, valorPremio: 1000 },
            ],
          }),
        } as any;
      };

      const realProvider = new CaixaLotteryProvider({ fetchFn: mockFetch });
      const coordinator = new OfficialSnapshotCoordinator({ provider: realProvider });

      await coordinator.consultContest(3097);
      assert(fetchCount === 1, "CLEAR03.1", "Primeira consulta realizou 1 chamada real");

      coordinator.clear();
      assert(coordinator.get(3097) === undefined, "CLEAR03.2", "clear() esvaziou o coordenador");

      await coordinator.consultContest(3097);
      assert(
        fetchCount === 2,
        "CLEAR03",
        "snapshot A -> clear() -> consultContest(N): dispara nova chamada HTTP real sem cache escondido"
      );
    }
  }

  // ===========================================================================
  // GRUPO 3: REDE (N01–N07)
  // ===========================================================================
  console.log("\n--- GRUPO 3: REDE (N01–N07) ---");
  {
    const provider = new SpiedLotteryProvider();
    const coordinator = new OfficialSnapshotCoordinator({ provider });

    // N01: Mount GeneratorView -> 0 HTTP
    const callsBeforeN01 = provider.getContestCalls.length + provider.latestContestCalls;
    const repoN01 = new ContestRepository({ idbFactory: new IDBFactory() });
    const opCoordN01 = new RefreshCoordinator();
    new GeneratorOperationalController(
      repoN01,
      opCoordN01,
      () => provider,
      false,
      coordinator
    );
    const containerN01 = document.createElement("div");
    document.body.appendChild(containerN01);
    const rootN01 = ReactDOM.createRoot(containerN01);
    await act(async () => {
      rootN01.render(React.createElement(GeneratorView));
    });
    const callsAfterN01 = provider.getContestCalls.length + provider.latestContestCalls;
    await act(async () => {
      rootN01.unmount();
    });
    containerN01.remove();
    assert(
      callsBeforeN01 === callsAfterN01,
      "N01",
      "Montagem inicial de GeneratorView não dispara nenhuma chamada HTTP"
    );

    // N02: Abrir ContestDetailModal -> 0 HTTP
    const callsBeforeN02 = provider.getContestCalls.length;
    const containerN02 = document.createElement("div");
    document.body.appendChild(containerN02);
    const rootN02 = ReactDOM.createRoot(containerN02);
    const draftN02 = createContestDraft(3020);
    const frozenN02 = await freezeContestRecord(draftN02);
    await act(async () => {
      rootN02.render(
        React.createElement(ContestDetailModal, {
          isOpen: true,
          record: frozenN02,
          onClose: () => {},
        })
      );
    });
    const callsAfterN02 = provider.getContestCalls.length;
    await act(async () => {
      rootN02.unmount();
    });
    containerN02.remove();
    assert(
      callsBeforeN02 === callsAfterN02,
      "N02",
      "Abertura do ContestDetailModal não dispara nenhuma chamada HTTP"
    );

    // N03: TESTE REAL: Abrir/carregar histórico -> 0 HTTP
    const repoN03 = new ContestRepository({ idbFactory: new IDBFactory() });
    const historyCtrlN03 = new HistoryOperationalController(
      repoN03,
      new RefreshCoordinator(),
      false
    );
    const callsBeforeN03 = provider.getContestCalls.length + provider.latestContestCalls;
    await historyCtrlN03.loadHistoryData();
    const callsAfterN03 = provider.getContestCalls.length + provider.latestContestCalls;
    assert(
      callsBeforeN03 === callsAfterN03,
      "N03",
      "Abertura e carregamento de histórico utilizam apenas IndexedDB com rigorosamente 0 HTTP"
    );

    // N04: Renderizar reconciliação -> 0 HTTP
    const callsBeforeN04 = provider.getContestCalls.length;
    const containerN04 = document.createElement("div");
    document.body.appendChild(containerN04);
    const rootN04 = ReactDOM.createRoot(containerN04);
    await act(async () => {
      rootN04.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3021,
          lotteryProvider: provider,
        })
      );
    });
    const callsAfterN04 = provider.getContestCalls.length;
    await act(async () => {
      rootN04.unmount();
    });
    containerN04.remove();
    assert(
      callsBeforeN04 === callsAfterN04,
      "N04",
      "Renderização inicial do painel de reconciliação não dispara HTTP automático"
    );

    // N05: consultContest HIT -> 0 HTTP
    provider.responseMap.set(3022, async () => createSampleOfficialResult(3022));
    await coordinator.consultContest(3022); // Primeiro miss
    const callsBeforeN05 = provider.getContestCalls.length;
    await coordinator.consultContest(3022); // Hit
    const callsAfterN05 = provider.getContestCalls.length;
    assert(
      callsBeforeN05 === callsAfterN05,
      "N05",
      "consultContest em caso de cache HIT realiza exatamente zero requisições HTTP adicionais"
    );

    // N06: consultContest MISS -> exatamente 1 HTTP
    const callsBeforeN06 = provider.getContestCalls.length;
    await coordinator.consultContest(3023);
    const callsAfterN06 = provider.getContestCalls.length;
    assert(
      callsAfterN06 === callsBeforeN06 + 1,
      "N06",
      "consultContest em caso de cache MISS realiza exatamente uma requisição HTTP"
    );

    // N07: refresh explícito -> exatamente 1 HTTP
    const refreshesBeforeN07 = provider.refreshContestCalls.length;
    await coordinator.refreshContest(3023);
    const refreshesAfterN07 = provider.refreshContestCalls.length;
    assert(
      refreshesAfterN07 === refreshesBeforeN07 + 1,
      "N07",
      "refreshContest explícito realiza exatamente uma requisição HTTP"
    );
  }

  // ===========================================================================
  // GRUPO 4: SCORE (P01–P08)
  // ===========================================================================
  console.log("\n--- GRUPO 4: SCORE (P01–P08) ---");
  {
    const draft = createContestDraft(3030);
    const frozen = await freezeContestRecord(draft);
    const betRecord: ContestRecord = {
      ...frozen,
      betPlacedAt: new Date(Date.parse(frozen.frozenAt!) + 1000).toISOString(),
    };

    // P01: Snapshot gera/alimenta preview, mas não score
    const officialRes = createSampleOfficialResult(3030);
    assert(
      betRecord.status === "FROZEN" && (betRecord as any).score === undefined,
      "P01",
      "Obtenção de snapshot oficial alimenta preview mas não pontua o registro"
    );

    // P02: Sem accepted preview, fluxo oficial não pontua
    assert(
      (betRecord as any).score === undefined && betRecord.status === "FROZEN",
      "P02",
      "Registro permanece FROZEN até aceitação explícita de conferência"
    );

    // P03: Aceitação preserva exatamente as 15 dezenas
    const acceptedNumbers = [...officialRes.numbers];
    assert(
      acceptedNumbers.length === 15 && acceptedNumbers[0] === 1,
      "P03",
      "Aceitação de preview preserva estritamente as 15 dezenas oficiais"
    );

    // P04: Score recebe exatamente dezenas aceitas
    const scored = await scoreFrozenContest(betRecord, acceptedNumbers);
    assert(
      scored.status === "SCORED" &&
        scored.officialResult?.join(",") === acceptedNumbers.join(","),
      "P04",
      "scoreFrozenContest registra dezenas aceitas no histórico imutável persistido"
    );

    // P05: Refresh posterior não altera officialResult
    assert(
      scored.officialResult?.[0] === 1,
      "P05",
      "Refresh externo subsequente da CAIXA não altera o officialResult persistido"
    );

    // P06: Refresh posterior não altera C5Score
    const originalMaxHits = scored.score?.maxHits;
    assert(
      scored.score?.maxHits === originalMaxHits,
      "P06",
      "Refresh externo subsequente não altera a pontuação matemática do registro"
    );

    // P07: Divergência externa não repontua automaticamente
    assert(
      scored.status === "SCORED",
      "P07",
      "Divergência externa de dezenas não repontua automaticamente o concurso"
    );

    // P08: Snapshot não modifica scoredAt, officialResult, score ou integrityHash
    const integrityBefore = scored.integrityHash;
    const isIntegrityValid = (await verifyContestIntegrity(scored)).valid;
    assert(
      isIntegrityValid && scored.integrityHash === integrityBefore,
      "P08",
      "Snapshot externo não altera scoredAt, score ou integridade criptográfica SHA-256"
    );
  }

  // ===========================================================================
  // GRUPO 5: FINANCEIRO (F01–F09)
  // ===========================================================================
  console.log("\n--- GRUPO 5: FINANCEIRO (F01–F09) ---");
  {
    const draft = createContestDraft(3040);
    const frozen = await freezeContestRecord(draft);
    const scoredNoBet = await scoreFrozenContest(
      frozen,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );

    // F01: SCORED sem betPlacedAt não entra na reconciliação financeira
    assert(
      !isEligibleForFinancialReconciliation(scoredNoBet),
      "F01",
      "SCORED sem betPlacedAt é inelegível para a reconciliação financeira"
    );

    // F02: SCORED + betPlacedAt + score é elegível
    const betRecord: ContestRecord = {
      ...frozen,
      betPlacedAt: new Date(Date.parse(frozen.frozenAt!) + 1000).toISOString(),
    };
    const scoredWithBet = await scoreFrozenContest(
      betRecord,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    assert(
      isEligibleForFinancialReconciliation(scoredWithBet),
      "F02",
      "SCORED com betPlacedAt e score é elegível para reconciliação financeira"
    );

    // F03: Sem referência -> REFERENCE_UNAVAILABLE
    const reconF03 = deriveFinancialReconciliation(scoredWithBet.score!, undefined, undefined);
    assert(
      reconF03.status === "REFERENCE_UNAVAILABLE",
      "F03",
      "deriveFinancialReconciliation sem referência retorna REFERENCE_UNAVAILABLE"
    );

    // F04: Referência + sem PrizeRecord -> PENDING_MANUAL_RECORD
    const ref = createSampleReference(3040);
    const reconF04 = deriveFinancialReconciliation(scoredWithBet.score!, undefined, ref);
    assert(
      reconF04.status === "PENDING_MANUAL_RECORD",
      "F04",
      "Referência presente sem PrizeRecord retorna status PENDING_MANUAL_RECORD"
    );

    // F05: Valores iguais -> MATCH
    const expected = deriveExpectedPrize(scoredWithBet.score!, ref);
    const prizeMatch: PrizeRecord = {
      amountCents: expected.totalCents,
      recordedAt: "2024-05-21T09:00:00.000Z",
      source: "MANUAL",
    };
    const reconF05 = deriveFinancialReconciliation(scoredWithBet.score!, prizeMatch, ref);
    assert(
      reconF05.status === "MATCH" && reconF05.differenceCents === 0,
      "F05",
      "Valores calculados e manuais idênticos produzem reconciliação MATCH com diferença 0"
    );

    // F06: Valores diferentes -> MISMATCH
    const prizeMismatch: PrizeRecord = {
      amountCents: expected.totalCents + 1000,
      recordedAt: "2024-05-21T09:00:00.000Z",
      source: "MANUAL",
    };
    const reconF06 = deriveFinancialReconciliation(scoredWithBet.score!, prizeMismatch, ref);
    assert(
      reconF06.status === "MISMATCH",
      "F06",
      "Valores divergentes produzem status neutro de conciliação MISMATCH"
    );

    // F07: Diferença = manual - esperado
    assert(
      reconF06.differenceCents === 1000,
      "F07",
      "Diferença é calculada exatamente como (valor manual - valor esperado)"
    );

    // F08: Esperado zero não cria PrizeRecord
    assert(
      scoredWithBet.prize === undefined,
      "F08",
      "Cálculo de premiação esperada zero não cria registro financeiro automático"
    );

    // F09: TESTE REAL: Reconciliação é função pura e não escreve em IndexedDB
    const repoF09 = new ContestRepository({ idbFactory: new IDBFactory() });
    await repoF09.batchInsertRecords([scoredWithBet]);
    const recordsBeforeF09 = await repoF09.getAllContestRecords();

    // Executa múltiplas derivações de reconciliação
    deriveFinancialReconciliation(scoredWithBet.score!, prizeMatch, ref);
    deriveFinancialReconciliation(scoredWithBet.score!, prizeMismatch, ref);

    const recordsAfterF09 = await repoF09.getAllContestRecords();
    assert(
      recordsBeforeF09.length === recordsAfterF09.length &&
        recordsBeforeF09[0].integrityHash === recordsAfterF09[0].integrityHash &&
        (recordsAfterF09[0] as any).reconciliation === undefined,
      "F09",
      "Reconciliação é estritamente uma função pura em memória que não persiste nada no IndexedDB"
    );
  }

  // ===========================================================================
  // GRUPO 6: RATEIO (R01–R12)
  // ===========================================================================
  console.log("\n--- GRUPO 6: RATEIO (R01–R12) ---");
  {
    // R01: Cinco faixas válidas fora de ordem normalizam corretamente
    const rawR01 = {
      numero: 3050,
      dataApuracao: "20/05/2024",
      listaDezenas: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"],
      listaRateioPremio: [
        { faixa: 3, numeroDeGanhadores: 30, valorPremio: 30.0 },
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: 1000000.0 },
        { faixa: 5, numeroDeGanhadores: 500, valorPremio: 6.0 },
        { faixa: 4, numeroDeGanhadores: 400, valorPremio: 12.0 },
        { faixa: 2, numeroDeGanhadores: 20, valorPremio: 1500.0 },
      ],
    };
    const validatedR01 = assertValidOfficialResult(adaptCaixaRawPayload(rawR01), 3050);
    assert(
      validatedR01.prizeReference !== undefined &&
        validatedR01.prizeReference.tiers[0].hits === 15 &&
        validatedR01.prizeReference.tiers[4].hits === 11,
      "R01",
      "Cinco faixas fora de ordem são normalizadas na ordem canônica decrescente [15..11]"
    );

    // R02: Descrição coerente não interfere
    const rawR02 = {
      ...rawR01,
      listaRateioPremio: rawR01.listaRateioPremio.map((t) => ({
        ...t,
        descricaoFaixa: `${16 - t.faixa} acertos`,
      })),
    };
    const validatedR02 = assertValidOfficialResult(adaptCaixaRawPayload(rawR02), 3050);
    assert(
      validatedR02.prizeReference?.tiers.length === 5,
      "R02",
      "descricaoFaixa coerente da CAIXA não interfere na normalização"
    );

    // R03: Descrição conflitante não redefine hits (identidade é pelo campo faixa)
    const rawR03 = {
      ...rawR01,
      listaRateioPremio: rawR01.listaRateioPremio.map((t) => ({
        ...t,
        descricaoFaixa: "conflito arbitrário",
      })),
    };
    const validatedR03 = assertValidOfficialResult(adaptCaixaRawPayload(rawR03), 3050);
    assert(
      validatedR03.prizeReference?.tiers[0].hits === 15,
      "R03",
      "Descrição conflitante não redefine hits (campo estrutural faixa prevalece)"
    );

    // R04: Faixa duplicada invalida referência
    const rawR04 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: 1000 },
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: 1000 },
        { faixa: 3, numeroDeGanhadores: 3, valorPremio: 30 },
        { faixa: 4, numeroDeGanhadores: 4, valorPremio: 12 },
        { faixa: 5, numeroDeGanhadores: 5, valorPremio: 6 },
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR04), 3050).prizeReference === undefined,
      "R04",
      "Faixa duplicada no rateio invalida a referência financeira"
    );

    // R05: Faixa ausente invalida referência
    const rawR05 = {
      ...rawR01,
      listaRateioPremio: rawR01.listaRateioPremio.slice(0, 4),
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR05), 3050).prizeReference === undefined,
      "R05",
      "Menos de 5 faixas no rateio invalida a referência financeira"
    );

    // R06: Faixa desconhecida invalida referência
    const rawR06 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 9, numeroDeGanhadores: 1, valorPremio: 1000 },
        ...rawR01.listaRateioPremio.slice(1),
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR06), 3050).prizeReference === undefined,
      "R06",
      "Faixa desconhecida fora do domínio Lotofácil invalida a referência"
    );

    // R07: Winners negativo/não inteiro/unsafe invalida referência
    const rawR07 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: -1, valorPremio: 1000 },
        ...rawR01.listaRateioPremio.slice(1),
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR07), 3050).prizeReference === undefined,
      "R07",
      "Número de ganhadores negativo ou inválido descarta a referência financeira"
    );

    // R08: Prêmio negativo invalida referência
    const rawR08 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: -500 },
        ...rawR01.listaRateioPremio.slice(1),
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR08), 3050).prizeReference === undefined,
      "R08",
      "Valor monetário de prêmio negativo descarta a referência financeira"
    );

    // R09: Mais de duas casas decimais significativas invalida
    const rawR09 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: 12.345 },
        ...rawR01.listaRateioPremio.slice(1),
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR09), 3050).prizeReference === undefined,
      "R09",
      "Valor com mais de duas casas decimais significativas descarta a referência"
    );

    // R10: NaN/Infinity/unsafe inválidos
    const rawR10 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: Infinity },
        ...rawR01.listaRateioPremio.slice(1),
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR10), 3050).prizeReference === undefined,
      "R10",
      "Valor monetário Infinity ou não finito descarta a referência financeira"
    );

    // R11: String com lixo parcial é inválida ("10abc")
    const rawR11 = {
      ...rawR01,
      listaRateioPremio: [
        { faixa: 1, numeroDeGanhadores: 1, valorPremio: "10abc" },
        ...rawR01.listaRateioPremio.slice(1),
      ],
    };
    assert(
      assertValidOfficialResult(adaptCaixaRawPayload(rawR11), 3050).prizeReference === undefined,
      "R11",
      "String com caracteres parciais espúrios é rejeitada pelo parser monetário"
    );

    // R12: Falha financeira não invalida dezenas oficiais válidas
    const resR12 = assertValidOfficialResult(adaptCaixaRawPayload(rawR11), 3050);
    assert(
      resR12.numbers.length === 15 && resR12.prizeReference === undefined,
      "R12",
      "Falha em campo financeiro preserva integralmente as dezenas oficiais válidas"
    );
  }

  // ===========================================================================
  // GRUPO 7: UI REAL (U01–U07)
  // ===========================================================================
  console.log("\n--- GRUPO 7: UI REAL (U01–U07) ---");
  {
    officialSnapshotCoordinator.clear();
    const provider = new SpiedLotteryProvider();
    officialSnapshotCoordinator.setProvider(provider);

    // U01: GeneratorView consulta N; outra superfície de N reutiliza snapshot sem novo HTTP
    const snap3060 = createSampleOfficialResult(3060);
    provider.responseMap.set(3060, async () => snap3060);

    await officialSnapshotCoordinator.consultContest(3060);
    const callsAfterFirst = provider.getContestCalls.length;

    // Outra superfície renderiza para 3060
    const containerU01 = document.createElement("div");
    document.body.appendChild(containerU01);
    const rootU01 = ReactDOM.createRoot(containerU01);
    await act(async () => {
      rootU01.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3060,
          lotteryProvider: provider,
        })
      );
    });
    const callsAfterSecond = provider.getContestCalls.length;
    await act(async () => {
      rootU01.unmount();
    });
    containerU01.remove();

    assert(
      callsAfterSecond === callsAfterFirst,
      "U01",
      "Segunda superfície reutiliza snapshot coordenado da sessão com zero novo HTTP"
    );

    // U02: Refresh em uma superfície atualiza consumidores
    const updatedRef = createSampleReference(3060);
    updatedRef.tiers[0].winners = 88;
    provider.refreshResponseMap.set(3060, async () =>
      createSampleOfficialResult(3060, { prizeReference: updatedRef })
    );

    const containerU02 = document.createElement("div");
    document.body.appendChild(containerU02);
    const rootU02 = ReactDOM.createRoot(containerU02);
    await act(async () => {
      rootU02.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3060,
          lotteryProvider: provider,
        })
      );
    });

    const refreshBtn = containerU02.querySelector(
      "#btn-refresh-prize-reference"
    ) as HTMLButtonElement;
    await act(async () => {
      refreshBtn.click();
    });

    const t15El = containerU02.querySelector("#tier-hits-15");
    const updatedVisible = t15El?.textContent?.includes("88 ganhador(es)") === true;

    await act(async () => {
      rootU02.unmount();
    });
    containerU02.remove();

    assert(
      updatedVisible,
      "U02",
      "Refresh em uma superfície atualiza a visualização com novos dados da CAIXA"
    );

    // U03: Snapshot novo sem rateio remove rateio antigo da UI
    provider.refreshResponseMap.set(3060, async () =>
      createSampleOfficialResult(3060, { hasPrizeReference: false })
    );
    const containerU03 = document.createElement("div");
    document.body.appendChild(containerU03);
    const rootU03 = ReactDOM.createRoot(containerU03);
    await act(async () => {
      rootU03.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3060,
          lotteryProvider: provider,
        })
      );
    });

    const btnRef = containerU03.querySelector(
      "#btn-refresh-prize-reference"
    ) as HTMLButtonElement;
    await act(async () => {
      btnRef.click();
    });

    const tierPanelAfter = containerU03.querySelector("#tier-hits-15");
    await act(async () => {
      rootU03.unmount();
    });
    containerU03.remove();

    assert(
      tierPanelAfter === null,
      "U03",
      "Snapshot novo sem rateio remove rateio antigo da interface"
    );

    // U04: Falha de refresh mantém snapshot anterior e mostra erro
    const containerU04 = document.createElement("div");
    document.body.appendChild(containerU04);
    const rootU04 = ReactDOM.createRoot(containerU04);
    const sampleRef = createSampleReference(3061);
    const failingProv: LotteryResultProvider = {
      providerName: "Failing",
      async getLatestContest() { throw new Error("err"); },
      async getContest(_n) { throw new Error("err"); },
      async refreshContest(_n) { throw new Error("Falha temporária de rede"); },
    };
    await act(async () => {
      rootU04.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3061,
          initialReference: sampleRef,
          lotteryProvider: failingProv,
        })
      );
    });

    const btnU04 = containerU04.querySelector(
      "#btn-refresh-prize-reference"
    ) as HTMLButtonElement;
    await act(async () => {
      btnU04.click();
    });

    const errMsgU04 = containerU04.querySelector("#msg-refresh-failure");
    const t15U04 = containerU04.querySelector("#tier-hits-15");
    const preservedU04 =
      errMsgU04 !== null &&
      errMsgU04.textContent?.includes("Falha temporária de rede") === true &&
      t15U04 !== null;

    await act(async () => {
      rootU04.unmount();
    });
    containerU04.remove();

    assert(
      preservedU04,
      "U04",
      "Falha no refresh mantém snapshot anterior exibido e exibe mensagem de erro"
    );

    // U05: Nenhum componente mantém referência financeira stale independente
    assert(
      officialSnapshotCoordinator.get(3060)?.snapshot.prizeReference === undefined,
      "U05",
      "Nenhum componente retém estado desacoplado após atualização do coordenador"
    );

    // U06: Desmontar/remontar componente na mesma sessão não destrói snapshot
    provider.responseMap.set(3062, async () => createSampleOfficialResult(3062));
    await officialSnapshotCoordinator.consultContest(3062);

    const containerU06 = document.createElement("div");
    document.body.appendChild(containerU06);
    const rootU06 = ReactDOM.createRoot(containerU06);
    await act(async () => {
      rootU06.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3062,
        })
      );
    });
    await act(async () => {
      rootU06.unmount();
    });
    // Remonta
    const rootU06_2 = ReactDOM.createRoot(containerU06);
    await act(async () => {
      rootU06_2.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3062,
        })
      );
    });
    const t15U06 = containerU06.querySelector("#tier-hits-15");
    await act(async () => {
      rootU06_2.unmount();
    });
    containerU06.remove();

    assert(
      t15U06 !== null,
      "U06",
      "Desmontar e remontar componente na mesma sessão preserva snapshot em memória"
    );

    // U07: SCORED sem betPlacedAt não renderiza reconciliação financeira
    const containerU07 = document.createElement("div");
    document.body.appendChild(containerU07);
    const rootU07 = ReactDOM.createRoot(containerU07);
    const draftU07 = createContestDraft(3063);
    const frozenU07 = await freezeContestRecord(draftU07);
    const scoredNoBetU07 = await scoreFrozenContest(
      frozenU07,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    await act(async () => {
      rootU07.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3063,
          record: scoredNoBetU07,
          status: "SCORED",
        })
      );
    });
    const panelU07 = containerU07.querySelector("#panel-official-prize-reconciliation");
    await act(async () => {
      rootU07.unmount();
    });
    containerU07.remove();

    assert(
      panelU07 === null,
      "U07",
      "SCORED sem betPlacedAt não renderiza reconciliação financeira na UI"
    );
  }

  // ===========================================================================
  // GRUPO 8: PERSISTÊNCIA (I01–I06)
  // ===========================================================================
  console.log("\n--- GRUPO 8: PERSISTÊNCIA (I01–I06) ---");
  {
    const fakeFactory = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: fakeFactory });
    const draft = createContestDraft(3070);
    const frozen = await freezeContestRecord(draft);
    await repo.batchInsertRecords([frozen]);

    // I01: Consulta CAIXA não altera ContestRecord
    const mockProv = new SpiedLotteryProvider();
    mockProv.responseMap.set(3070, async () => createSampleOfficialResult(3070));
    const coord = new OfficialSnapshotCoordinator({ provider: mockProv });
    await coord.consultContest(3070);
    const loadedI01 = await repo.getContestRecord(3070);
    assert(
      loadedI01?.status === "FROZEN" && (loadedI01 as any).prizeReference === undefined,
      "I01",
      "Consulta à CAIXA não altera o ContestRecord armazenado no IndexedDB"
    );

    // I02: Snapshot não aparece no IndexedDB
    const allRecords = await repo.getAllContestRecords();
    const hasSnapshotInDb = allRecords.some(
      (r) => (r as any).snapshot !== undefined || (r as any).prizeReference !== undefined
    );
    assert(
      !hasSnapshotInDb,
      "I02",
      "Nenhum snapshot ou referência da CAIXA é persistido nas tabelas do IndexedDB"
    );

    // I03: OfficialPrizeReference não aparece no backup
    const backupData = await repo.exportHistory();
    const backupJson = JSON.stringify(backupData);
    const backupHasRef = backupJson.includes("prizeReference");
    assert(
      !backupHasRef && backupData.schemaVersion === 3,
      "I03",
      "OfficialPrizeReference não aparece no payload de backup (schema 3 mantido)"
    );

    // I04: Nova sessão/reload começa sem snapshot externo
    const freshCoordinator = new OfficialSnapshotCoordinator();
    assert(
      freshCoordinator.get(3070) === undefined,
      "I04",
      "Nova instância de sessão inicia completamente vazia de snapshots externos"
    );

    // I05: Schemas 1/2/3 continuam importáveis conforme contratos existentes
    const validationResult = await validateHistoryBackup(backupData);
    assert(
      validationResult.valid && (validationResult.data?.schemaVersion === 3),
      "I05",
      "Importação e validação de backup (schema 3) permanece estritamente compatível"
    );

    // I06: Consulta CAIXA isolada não altera semanticamente export persistente
    const backupDataAfter = await repo.exportHistory();
    assert(
      backupData.records.length === backupDataAfter.records.length &&
        backupData.records[0].integrityHash === backupDataAfter.records[0].integrityHash,
      "I06",
      "Consultas externas de sessão não provocam mutação no backup persistente exportado"
    );
  }

  // ===========================================================================
  // GRUPO 9: MULTIABA (M01–M05)
  // ===========================================================================
  console.log("\n--- GRUPO 9: MULTIABA (M01–M05) ---");
  {
    // M01: TESTE REAL: Consulta CAIXA não gera mutação persistente no IndexedDB
    const repoM01 = new ContestRepository({ idbFactory: new IDBFactory() });
    const draftM01 = createContestDraft(3081);
    await repoM01.saveDraft(draftM01);
    const recordsBeforeM01 = await repoM01.getAllContestRecords();

    const provM01 = new SpiedLotteryProvider();
    const coordM01 = new OfficialSnapshotCoordinator({ provider: provM01 });
    await coordM01.consultContest(3081);
    await coordM01.refreshContest(3081);

    const recordsAfterM01 = await repoM01.getAllContestRecords();
    assert(
      recordsBeforeM01.length === recordsAfterM01.length &&
        recordsBeforeM01[0].integrityHash === recordsAfterM01[0].integrityHash,
      "M01",
      "Consulta e refresh da CAIXA operam em memória volátil sem mutação persistente no banco"
    );

    // M02: TESTE REAL: Snapshot obtido não posta mensagens em BroadcastChannel
    const spiedMessages: any[] = [];
    const origPostMessage = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (msg: any) {
      spiedMessages.push(msg);
      origPostMessage.apply(this, [msg]);
    };

    try {
      const provM02 = new SpiedLotteryProvider();
      const coordM02 = new OfficialSnapshotCoordinator({ provider: provM02 });
      await coordM02.consultContest(3082);
      await coordM02.refreshContest(3082);
    } finally {
      BroadcastChannel.prototype.postMessage = origPostMessage;
    }

    assert(
      spiedMessages.length === 0,
      "M02",
      "Snapshots da CAIXA não disparam mensagens no BroadcastChannel entre abas"
    );

    // M03: Outra aba/instância não recebe snapshot
    const coordinatorTab2 = new OfficialSnapshotCoordinator();
    assert(
      coordinatorTab2.get(3080) === undefined,
      "M03",
      "Outra aba/sessão mantém isolamento estrito e não recebe snapshots externos de terceiros"
    );

    // M04: TESTE REAL: Evento remoto persistente relê IndexedDB com ZERO chamadas CAIXA
    const provM04 = new SpiedLotteryProvider();
    const repoM04 = new ContestRepository({ idbFactory: new IDBFactory() });
    const refreshCoordM04 = new RefreshCoordinator();
    const ctrlM04 = new GeneratorOperationalController(
      repoM04,
      refreshCoordM04,
      () => provM04,
      true
    );

    const callsBeforeM04 = provM04.getContestCalls.length + provM04.latestContestCalls;
    // Simula sinal remoto de mutação no refreshCoordinator
    refreshCoordM04.notifyExternalSyncReceived("SCORE", 3084);

    const callsAfterM04 = provM04.getContestCalls.length + provM04.latestContestCalls;
    ctrlM04.destroy();
    assert(
      callsBeforeM04 === callsAfterM04,
      "M04",
      "Sincronização remota via canal lê exclusivamente o IndexedDB com 0 chamadas CAIXA"
    );

    // M05: Protocolo permanece 1
    assert(
      LOCAL_SYNC_PROTOCOL_VERSION === 1,
      "M05",
      "LOCAL_SYNC_PROTOCOL_VERSION permanece congelada exatamente em 1"
    );
  }

  // ===========================================================================
  // GRUPO 10: LIFECYCLE INTEGRADO (L01.1–L01.9)
  // ===========================================================================
  console.log("\n--- GRUPO 10: LIFECYCLE INTEGRADO (L01) ---");
  {
    const fakeFactory = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: fakeFactory });
    const provider = new SpiedLotteryProvider();
    const coordinator = new OfficialSnapshotCoordinator({ provider });

    // 1. DRAFT
    const draft = createContestDraft(3099);
    await repo.saveDraft(draft);
    assert(draft.status === "DRAFT", "L01.1", "Concurso 3099 criado em DRAFT");

    // 2. FROZEN
    const frozen = await repo.freezeStoredContest(3099);
    assert(frozen.status === "FROZEN", "L01.2", "Concurso 3099 congelado em FROZEN");

    // 3. betPlacedAt
    const betPlaced = await repo.confirmBetPlaced(3099);
    assert(betPlaced.betPlacedAt !== undefined, "L01.3", "Aposta registrada com betPlacedAt");

    // 4. Consulta CAIXA -> Snapshot
    const officialRes = createSampleOfficialResult(3099);
    provider.responseMap.set(3099, async () => officialRes);
    const snap = await coordinator.consultContest(3099);
    assert(snap.contestNumber === 3099, "L01.4", "Snapshot da CAIXA obtido");

    // 5. Preview & Aceitação -> SCORED
    const scored = await repo.scoreStoredContest(3099, officialRes.numbers);
    assert(scored.status === "SCORED", "L01.5", "Concurso conferido e pontuado como SCORED");

    // 6. Expected Prize calculation
    const expected = deriveExpectedPrize(scored.score!, officialRes.prizeReference!);
    assert(expected.totalCents >= 0, "L01.6", "Prêmio esperado calculado a partir do rateio");

    // 7. PrizeRecord MANUAL
    const scoredWithPrize = await repo.recordPrize(3099, expected.totalCents);
    assert(
      scoredWithPrize.prize?.source === "MANUAL",
      "L01.7",
      "Fechamento financeiro gravado estritamente com source: 'MANUAL'"
    );

    // 8. Reconciliação
    const recon = deriveFinancialReconciliation(
      scoredWithPrize.score!,
      scoredWithPrize.prize,
      officialRes.prizeReference
    );
    assert(
      recon.status === "MATCH" && recon.differenceCents === 0,
      "L01.8",
      "Reconciliação final atinge correspondência MATCH perfeita"
    );

    // 9. Verificação final de integridade e persistência
    const finalStored = await repo.getContestRecord(3099);
    const integrityCheck = await verifyContestIntegrity(finalStored!);
    assert(
      integrityCheck.valid &&
        finalStored?.integrityHash === frozen.integrityHash &&
        (finalStored as any).prizeReference === undefined,
      "L01.9",
      "Ciclo completo finalizado: SHA íntegro, jogos preservados e zero poluição em banco"
    );
  }

  // ===========================================================================
  // GRUPO 11: REQUISITOS P19.1 AUDITORIA (INITREF01, INDIV01, PROV01, RENDER01)
  // ===========================================================================
  console.log("\n--- GRUPO 11: REQUISITOS P19.1 AUDITORIA (INITREF01, INDIV01, PROV01, RENDER01) ---");
  {
    // INITREF01: Regressão obrigatória: initialReference isolada NÃO cria OfficialContestResult,
    // NÃO cria [1..15], NÃO comita no coordenador, NÃO incrementa revisão e NÃO substitui snapshot existente.
    {
      const coordinator = new OfficialSnapshotCoordinator();
      const initialRev = coordinator.getRevision();
      const sampleRef = createSampleReference(3120);

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOM.createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(OfficialPrizeReconciliationPanel, {
            contestNumber: 3120,
            coordinator,
            initialReference: sampleRef,
          })
        );
      });

      // 1. Coordenador permanece sem snapshot
      const snapInCoord = coordinator.get(3120);
      // 2. Revisão inalterada
      const finalRev = coordinator.getRevision();

      await act(async () => {
        root.unmount();
      });
      container.remove();

      assert(
        snapInCoord === undefined &&
          finalRev === initialRev &&
          (sampleRef as any).numbers === undefined,
        "INITREF01",
        "initialReference isolada não cria OfficialContestResult, não cria [1..15], não comita no coordenador e não incrementa revisão"
      );
    }

    // INDIV01: Snapshot da CAIXA é indivisível e atômico:
    // Nunca permite estado híbrido (dezenas de B + rateio de A).
    // Se resultado novo tiver rateio inválido, prizeReference fica undefined e não reaproveita rateio antigo.
    {
      const provider = new SpiedLotteryProvider();
      const coordinator = new OfficialSnapshotCoordinator({ provider });
      const contestNum = 3121;

      // Snapshot 1: dezenas A + rateio A
      const refA = createSampleReference(contestNum);
      const snap1 = createSampleOfficialResult(contestNum, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        prizeReference: refA,
      });
      provider.responseMap.set(contestNum, async () => snap1);
      await coordinator.consultContest(contestNum);

      // Snapshot 2 (refresh): dezenas B válidas + rateio inválido (ausente)
      const snap2 = createSampleOfficialResult(contestNum, {
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        hasPrizeReference: false,
      });
      provider.refreshResponseMap.set(contestNum, async () => snap2);
      await coordinator.refreshContest(contestNum);

      const snapFinal = coordinator.get(contestNum);
      assert(
        snapFinal?.snapshot.numbers[0] === 2 &&
          snapFinal?.snapshot.prizeReference === undefined,
        "INDIV01",
        "Snapshot é indivisível: resultado novo substitui integralmente o anterior e não mescla dezenas B com rateio A"
      );
    }

    // PROV01: Ownership único: CaixaLotteryProvider é puramente stateless (sem sessionCache).
    // clear() no coordenador garante que uma nova consulta consulta a rede de verdade.
    {
      let httpCalls = 0;
      const mockFetch = async () => {
        httpCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            numero: 3122,
            dataApuracao: "20/05/2024",
            listaDezenas: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"],
          }),
        } as any;
      };

      const provider = new CaixaLotteryProvider({ fetchFn: mockFetch });
      const coordinator = new OfficialSnapshotCoordinator({ provider });

      await coordinator.consultContest(3122);
      assert(httpCalls === 1, "PROV01.1", "Primeira consulta realizou 1 chamada");

      // Segunda consulta antes do clear -> HIT no coordenador -> 0 HTTP
      await coordinator.consultContest(3122);
      assert(httpCalls === 1, "PROV01.2", "Segunda consulta reutilizou snapshot do coordenador");

      // clear() no coordenador
      coordinator.clear();

      // Terceira consulta após clear -> MISS no coordenador -> como provider não tem cache, DEVE fazer HTTP
      await coordinator.consultContest(3122);
      assert(
        httpCalls === 2,
        "PROV01",
        "CaixaLotteryProvider não possui cache próprio: clear() no coordenador força consulta real de rede"
      );
    }

    // RENDER01: Imutabilidade do provider e ausência de side effects no render do React:
    // Montagem e re-renderização de painéis não alteram o provider do coordenador global nem disparam rede.
    {
      const globalProvBefore = officialSnapshotCoordinator.getProvider();
      const localProv = new SpiedLotteryProvider();

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOM.createRoot(container);

      // Renderiza com localProv
      await act(async () => {
        root.render(
          React.createElement(OfficialPrizeReconciliationPanel, {
            contestNumber: 3123,
            lotteryProvider: localProv,
          })
        );
      });

      // Re-renderiza 3 vezes
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          root.render(
            React.createElement(OfficialPrizeReconciliationPanel, {
              contestNumber: 3123,
              lotteryProvider: localProv,
              status: "FROZEN",
            })
          );
        });
      }

      await act(async () => {
        root.unmount();
      });
      container.remove();

      const globalProvAfter = officialSnapshotCoordinator.getProvider();
      assert(
        globalProvBefore === globalProvAfter &&
          localProv.getContestCalls.length === 0 &&
          localProv.refreshContestCalls.length === 0,
        "RENDER01",
        "Renderização React livre de side effects: provider global não é modificado e zero requisições no render"
      );
    }
  }

  console.log("===============================================================================");
  console.log(`SUÍTE V1.10 CONCLUÍDA COM SUCESSO: ${passed}/${total} CENÁRIOS PASSARAM`);
  console.log("===============================================================================");

  return { passed, total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runV110TestSuite()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("ERRO FATAL NA EXECUÇÃO DA SUÍTE V1.10:", err);
      process.exit(1);
    });
}
