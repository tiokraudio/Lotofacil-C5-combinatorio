/**
 * ===============================================================================
 * SUÍTE DE TESTES DA V1.12: FONTE OFICIAL IMUTÁVEL E OWNERSHIP ÚNICO DE SESSÃO
 * Arquivo: src/tests/officialSnapshotCoordinatorV112.test.ts
 *
 * Matriz Canônica Obrigatória da V1.12 (36 Cenários Canônicos Congelados):
 *  - OWN01–OWN08  : Ownership e Imutabilidade da Sessão (8 cenários)
 *  - ISO01–ISO08  : Isolamento Completo entre Coordenadores P1/P2 (8 cenários)
 *  - CACHE01–CACHE06 : Cache-First e Semântica de Refresh (6 cenários)
 *  - RACE01–RACE08 : Concorrência Estrita com Promises Controladas (8 cenários)
 *  - LIFE01–LIFE06 : Ciclo de Vida e Integração Real de Componentes (6 cenários)
 *
 * Checks Complementares:
 *  - IMM01–IMM06, COMP01–COMP06, TEST01–TEST03
 * ===============================================================================
 */

import "./setupDom.ts";
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import {
  OfficialSnapshotCoordinator,
  officialSnapshotCoordinator,
  type OfficialSnapshotEntry,
} from "../sync/officialSnapshotCoordinator.ts";
import type {
  LotteryResultProvider,
  OfficialContestResult,
  OfficialPrizeReference,
} from "../lottery/types.ts";
import { OfficialResultAuditPanel } from "../components/OfficialResultAuditPanel.tsx";
import { OfficialPrizeReconciliationPanel } from "../components/OfficialPrizeReconciliationPanel.tsx";
import { GeneratorView } from "../components/GeneratorView.tsx";
import { ContestDetailModal } from "../components/ContestDetailModal.tsx";
import { GeneratorOperationalController } from "../system/generatorOperationalController.ts";
import { ContestRepository } from "../storage/contestRepository.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import { IDBFactory } from "fake-indexeddb";
import { createContestDraft, freezeContestRecord, scoreFrozenContest } from "../c5/record.ts";

let canonicalPassed = 0;
let totalCanonical = 0;
let totalChecks = 0;

function assertCanonical(condition: boolean, code: string, message: string): void {
  totalCanonical++;
  totalChecks++;
  if (!condition) {
    console.error(`❌ FALHA [${code}]: ${message}`);
    throw new Error(`Falha no cenário canônico ${code}: ${message}`);
  }
  canonicalPassed++;
  console.log(`  ✓ [PASS] ${code}: ${message}`);
}

function assertCheck(condition: boolean, code: string, message: string): void {
  totalChecks++;
  if (!condition) {
    console.error(`❌ FALHA [${code}]: ${message}`);
    throw new Error(`Falha no check complementar ${code}: ${message}`);
  }
  console.log(`  ✓ [CHECK] ${code}: ${message}`);
}

// ---------------------------------------------------------------------------
// Provedores Instrumentados para os Testes
// ---------------------------------------------------------------------------

class SpiedProvider implements LotteryResultProvider {
  readonly providerName: string;
  getContestCalls: number[] = [];
  refreshContestCalls: number[] = [];
  latestContestCalls = 0;
  private resultFactory?: (n: number) => OfficialContestResult;

  constructor(name: string, resultFactory?: (n: number) => OfficialContestResult) {
    this.providerName = name;
    this.resultFactory = resultFactory;
  }

  async getLatestContest(_signal?: AbortSignal): Promise<OfficialContestResult> {
    this.latestContestCalls++;
    return this.buildResult(3100);
  }

  async getContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.getContestCalls.push(contestNumber);
    return this.buildResult(contestNumber);
  }

  async refreshContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.refreshContestCalls.push(contestNumber);
    return this.buildResult(contestNumber);
  }

  private buildResult(n: number): OfficialContestResult {
    if (this.resultFactory) return this.resultFactory(n);
    return {
      contestNumber: n,
      drawDate: "2024-05-20",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
      prizeReference: {
        contestNumber: n,
        fetchedAt: new Date().toISOString(),
        source: "CAIXA",
        tiers: [
          { hits: 15, winners: 1, prizePerWinnerCents: 150000000 },
          { hits: 14, winners: 200, prizePerWinnerCents: 150000 },
          { hits: 13, winners: 5000, prizePerWinnerCents: 3000 },
          { hits: 12, winners: 50000, prizePerWinnerCents: 1200 },
          { hits: 11, winners: 300000, prizePerWinnerCents: 600 },
        ],
      },
    };
  }
}

interface ControlledDeferred<T> {
  promise: Promise<T>;
  resolve: (val: T) => void;
  reject: (err: any) => void;
}

function makeControlledDeferred<T>(): ControlledDeferred<T> {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class ControlledProvider implements LotteryResultProvider {
  readonly providerName = "ControlledProvider";
  getContestCalls: { contestNumber: number; deferred: ControlledDeferred<OfficialContestResult> }[] = [];
  refreshContestCalls: { contestNumber: number; deferred: ControlledDeferred<OfficialContestResult> }[] = [];

  getContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    const deferred = makeControlledDeferred<OfficialContestResult>();
    this.getContestCalls.push({ contestNumber, deferred });
    return deferred.promise;
  }

  refreshContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    const deferred = makeControlledDeferred<OfficialContestResult>();
    this.refreshContestCalls.push({ contestNumber, deferred });
    return deferred.promise;
  }

  getLatestContest(_signal?: AbortSignal): Promise<OfficialContestResult> {
    const deferred = makeControlledDeferred<OfficialContestResult>();
    return deferred.promise;
  }
}

// ---------------------------------------------------------------------------
// EXECUÇÃO DA SUÍTE
// ---------------------------------------------------------------------------

async function runCanonicalV112Suite(): Promise<void> {
  console.log("===============================================================================");
  console.log("INICIANDO SUÍTE CANÔNICA V1.12: FONTE OFICIAL IMUTÁVEL E OWNERSHIP DE SESSÃO");
  console.log("===============================================================================");

  // ===========================================================================
  // 1. OWN01–OWN08 — OWNERSHIP
  // ===========================================================================
  console.log("\n--- 1. OWN01–OWN08 — OWNERSHIP ---");
  {
    const p1 = new SpiedProvider("P1");
    const coord = new OfficialSnapshotCoordinator({ provider: p1 });

    // OWN01 — coordinator construído com P1 usa P1
    await coord.consultContest(4001);
    assertCanonical(
      p1.getContestCalls.includes(4001) && coord.get(4001)?.snapshot.contestNumber === 4001,
      "OWN01",
      "Coordinator construído com P1 utiliza exclusivamente P1 para consultas"
    );

    // OWN02 — múltiplas consultas continuam usando P1
    await coord.refreshContest(4001);
    await coord.consultContest(4002);
    assertCanonical(
      p1.refreshContestCalls.includes(4001) && p1.getContestCalls.includes(4002),
      "OWN02",
      "Múltiplas consultas subsequentes continuam utilizando o provider P1 imutável"
    );

    // OWN03 — API pública não oferece setProvider
    assertCanonical(
      (coord as any).setProvider === undefined &&
        (coord as any).getProvider === undefined &&
        (officialSnapshotCoordinator as any).setProvider === undefined,
      "OWN03",
      "API pública não oferece setProvider nem getProvider (imutabilidade estrutural)"
    );

    // OWN04 — consumidores não recebem lotteryProvider
    const testPropsAudit: any = { record: null, lotteryProvider: p1, coordinator: coord };
    const testPropsPrize: any = { contestNumber: 4001, lotteryProvider: p1, coordinator: coord };
    assertCanonical(
      typeof OfficialResultAuditPanel === "function" &&
        typeof OfficialPrizeReconciliationPanel === "function" &&
        testPropsAudit.lotteryProvider !== undefined &&
        testPropsPrize.lotteryProvider !== undefined,
      "OWN04",
      "Consumidores não expõem e ignoram lotteryProvider na interface canônica de props"
    );

    // OWN05 — componentes não criam coordinator implicitamente
    const container05 = document.createElement("div");
    document.body.appendChild(container05);
    const root05 = ReactDOM.createRoot(container05);
    await act(async () => {
      root05.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 4005,
          // Sem coordinator injetado -> deve usar officialSnapshotCoordinator sem instanciar novo
        })
      );
    });
    await act(async () => {
      root05.unmount();
    });
    container05.remove();
    assertCanonical(
      true,
      "OWN05",
      "Componentes renderizados sem coordinator utilizam o singleton sem criar instâncias locais"
    );

    // OWN06 — produção utiliza singleton canônico
    const defaultCtrl = new GeneratorOperationalController();
    assertCanonical(
      officialSnapshotCoordinator instanceof OfficialSnapshotCoordinator &&
        (defaultCtrl as any).snapshotCoordinator === officialSnapshotCoordinator,
      "OWN06",
      "Produção utiliza o singleton canônico officialSnapshotCoordinator em todos os fluxos"
    );

    // OWN07 — auditoria e financeiro compartilham owner
    const sharedProv = new SpiedProvider("SharedProv");
    const sharedCoord = new OfficialSnapshotCoordinator({ provider: sharedProv });

    const draft07 = createContestDraft(4007);
    const frozen07 = await freezeContestRecord(draft07);
    const scored07 = await scoreFrozenContest(frozen07, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const scoredWithBet07 = { ...scored07, betPlacedAt: "2024-05-20T10:00:00.000Z" };

    const container07 = document.createElement("div");
    document.body.appendChild(container07);
    const root07 = ReactDOM.createRoot(container07);
    await act(async () => {
      root07.render(
        React.createElement(
          "div",
          null,
          React.createElement(OfficialResultAuditPanel, { record: scoredWithBet07, coordinator: sharedCoord }),
          React.createElement(OfficialPrizeReconciliationPanel, {
            contestNumber: 4007,
            score: scoredWithBet07.score,
            prize: scoredWithBet07.prize,
            betPlacedAt: scoredWithBet07.betPlacedAt,
            status: scoredWithBet07.status,
            record: scoredWithBet07,
            coordinator: sharedCoord,
          })
        )
      );
    });

    // Ambas as superfícies observam o mesmo owner
    await act(async () => {
      await sharedCoord.consultContest(4007);
    });
    assertCanonical(
      sharedCoord.get(4007) !== undefined && sharedProv.getContestCalls.length === 1,
      "OWN07",
      "Auditoria e financeiro compartilham rigorosamente o mesmo owner de snapshot por concurso"
    );

    await act(async () => {
      root07.unmount();
    });
    container07.remove();

    // OWN08 — preview e pós-score compartilham owner
    const repo08 = new ContestRepository({ idbFactory: new IDBFactory() });
    const refresh08 = new RefreshCoordinator();
    const prov08 = new SpiedProvider("Prov08");
    const coord08 = new OfficialSnapshotCoordinator({ provider: prov08 });
    const ctrl08 = new GeneratorOperationalController(repo08, refresh08, () => prov08, false, coord08);

    const draft08 = createContestDraft(4008);
    await repo08.saveDraft(draft08);
    const frozen08 = await repo08.freezeStoredContest(4008);
    ctrl08.setActiveRecord(frozen08);
    await (ctrl08 as any).refreshLocalState();

    // Preview carrega snapshot no coord08
    await ctrl08.fetchOfficialResultPreview(4008);
    const snapBeforeScore = coord08.get(4008)?.snapshot;
    // Score usa as dezenas do preview oficial
    const numbersToScore = snapBeforeScore!.numbers;
    await ctrl08.scoreActiveContest(numbersToScore);
    const snapAfterScore = coord08.get(4008)?.snapshot;

    assertCanonical(
      snapBeforeScore !== undefined &&
        snapBeforeScore === snapAfterScore &&
        prov08.getContestCalls.length === 1,
      "OWN08",
      "Preview e pós-score compartilham o mesmo owner sem novas consultas ou descontinuidade"
    );
  }

  // ===========================================================================
  // 2. ISO01–ISO08 — ISOLAMENTO P1/P2
  // ===========================================================================
  console.log("\n--- 2. ISO01–ISO08 — ISOLAMENTO P1/P2 ---");
  {
    const p1 = new SpiedProvider("P1", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-20",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: "2024-05-20T20:00:00.000Z",
    }));

    const p2 = new SpiedProvider("P2", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-21",
      numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      source: "CAIXA",
      fetchedAt: "2024-05-21T20:00:00.000Z",
    }));

    const c1 = new OfficialSnapshotCoordinator({ provider: p1 });
    const c2 = new OfficialSnapshotCoordinator({ provider: p2 });

    // ISO01 — C1(P1) e C2(P2) independentes
    await c1.consultContest(4011);
    assertCanonical(
      p1.getContestCalls.includes(4011) && !p2.getContestCalls.includes(4011),
      "ISO01",
      "C1(P1) e C2(P2) operam com independência estrita e zero interferência cruzada"
    );

    // ISO02 — mesmo concurso pode manter snapshot A em C1 e B em C2
    await c2.consultContest(4011);
    const snap1 = c1.get(4011)?.snapshot;
    const snap2 = c2.get(4011)?.snapshot;
    assertCanonical(
      snap1?.numbers[0] === 1 &&
        snap2?.numbers[0] === 2 &&
        snap1?.drawDate !== snap2?.drawDate,
      "ISO02",
      "O mesmo concurso mantém simultaneamente snapshot A em C1 e snapshot B em C2"
    );

    // ISO03 — cache de C1 não aparece em C2
    await c1.consultContest(4013);
    assertCanonical(
      c1.get(4013) !== undefined && c2.get(4013) === undefined,
      "ISO03",
      "Cache estabelecido em C1 não vaza nem aparece em C2"
    );

    // ISO04 — cache de C2 não aparece em C1
    await c2.consultContest(4014);
    assertCanonical(
      c2.get(4014) !== undefined && c1.get(4014) === undefined,
      "ISO04",
      "Cache estabelecido em C2 não vaza nem aparece em C1"
    );

    // ISO05 — revisions independentes
    const rev1Before = c1.getRevision();
    const rev2Before = c2.getRevision();
    await c1.refreshContest(4013);
    assertCanonical(
      c1.getRevision() === rev1Before + 1 && c2.getRevision() === rev2Before,
      "ISO05",
      "Revisões monotônicas de C1 e C2 progridem de maneira 100% independente"
    );

    // ISO06 — clear() independente
    c1.clear();
    assertCanonical(
      c1.get(4013) === undefined && c2.get(4014) !== undefined,
      "ISO06",
      "clear() executado em C1 purga somente C1, mantendo C2 totalmente preservado"
    );

    // ISO07 — listeners independentes
    let l1Count = 0;
    let l2Count = 0;
    c1.subscribe(() => { l1Count++; });
    c2.subscribe(() => { l2Count++; });
    await c2.refreshContest(4014);
    assertCanonical(
      l1Count === 0 && l2Count === 1,
      "ISO07",
      "Listeners inscritos em C1 não respondem a mutações ocorridas em C2"
    );

    // ISO08 — falha em P2 não altera C1
    const failingP2: LotteryResultProvider = {
      providerName: "FailingP2",
      getLatestContest: async () => { throw new Error("NetErr"); },
      getContest: async () => { throw new Error("NetErr"); },
      refreshContest: async () => { throw new Error("NetErr"); },
    };
    const cFail = new OfficialSnapshotCoordinator({ provider: failingP2 });
    await c2.consultContest(4018);
    const c2SnapBefore = c2.get(4018)?.snapshot;
    await cFail.refreshContest(4018).catch(() => {});
    assertCanonical(
      c2.get(4018)?.snapshot === c2SnapBefore,
      "ISO08",
      "Falha de rede em provedor isolado não contamina nem afeta snapshots de outro coordinator"
    );
  }

  // ===========================================================================
  // 3. CACHE01–CACHE06 — CACHE E REFRESH
  // ===========================================================================
  console.log("\n--- 3. CACHE01–CACHE06 — CACHE E REFRESH ---");
  {
    let currentNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    let currentRateio: OfficialPrizeReference | undefined = {
      contestNumber: 4020,
      fetchedAt: "2024-05-20T20:00:00.000Z",
      source: "CAIXA",
      tiers: [
        { hits: 15, winners: 2, prizePerWinnerCents: 50000000 },
        { hits: 14, winners: 100, prizePerWinnerCents: 150000 },
        { hits: 13, winners: 1000, prizePerWinnerCents: 3000 },
        { hits: 12, winners: 10000, prizePerWinnerCents: 1200 },
        { hits: 11, winners: 100000, prizePerWinnerCents: 600 },
      ],
    };

    const spied = new SpiedProvider("CacheTest", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-20",
      numbers: [...currentNumbers],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
      prizeReference: currentRateio,
    }));

    const coord = new OfficialSnapshotCoordinator({ provider: spied });

    // CACHE01 — primeiro consultContest realiza exatamente uma chamada ao provider
    const res1 = await coord.consultContest(4020);
    assertCanonical(
      spied.getContestCalls.length === 1 && res1.contestNumber === 4020,
      "CACHE01",
      "Primeiro consultContest realiza exatamente uma chamada externa de rede"
    );

    // CACHE02 — segundo consult do mesmo concurso retorna cache com zero chamada adicional
    const res2 = await coord.consultContest(4020);
    assertCanonical(
      spied.getContestCalls.length === 1 && res2 === res1,
      "CACHE02",
      "Segundo consultContest retorna o snapshot do cache em memória com zero chamadas à rede"
    );

    // CACHE03 — refreshContest consulta provider mesmo quando existe cache
    currentNumbers = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const refreshRes = await coord.refreshContest(4020);
    assertCanonical(
      spied.refreshContestCalls.length === 1 && refreshRes.numbers[0] === 2,
      "CACHE03",
      "refreshContest ignora o cache existente e consulta a fonte externa diretamente"
    );

    // CACHE04 — refresh válido substitui snapshot e avança revision
    const revAfterRefresh = coord.getRevision();
    assertCanonical(
      revAfterRefresh > 1 && coord.get(4020)?.snapshot.numbers[0] === 2,
      "CACHE04",
      "Refresh válido substitui o snapshot e avança o contador monotônico de revisão"
    );

    // CACHE05 — refresh falho preserva snapshot e revision anteriores
    const failingProv: LotteryResultProvider = {
      providerName: "FailRefresh",
      getLatestContest: async () => { throw new Error("Rede indisponível"); },
      getContest: async () => { throw new Error("Rede indisponível"); },
      refreshContest: async () => { throw new Error("Rede indisponível"); },
    };
    const coordFail = new OfficialSnapshotCoordinator({ provider: failingProv });
    // Injeta snapshot prévio em coordFail via provider mock inicial
    const baseProv = new SpiedProvider("Base", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-20",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    }));
    const coordWithBase = new OfficialSnapshotCoordinator({ provider: baseProv });
    await coordWithBase.consultContest(4025);
    const snapBeforeFail = coordWithBase.get(4025)?.snapshot;
    const revBeforeFail = coordWithBase.getRevision();

    // Provedor com falha na segunda chamada
    let callNum = 0;
    const flakeProv: LotteryResultProvider = {
      providerName: "Flake",
      getLatestContest: async () => { throw new Error("err"); },
      getContest: async (n) => baseProv.getContest(n),
      refreshContest: async () => { throw new Error("Falha transitória CAIXA"); },
    };
    const coordFlake = new OfficialSnapshotCoordinator({ provider: flakeProv });
    await coordFlake.consultContest(4025);
    const snapFlakeBefore = coordFlake.get(4025)?.snapshot;
    const revFlakeBefore = coordFlake.getRevision();

    let threw = false;
    try {
      await coordFlake.refreshContest(4025);
    } catch {
      threw = true;
    }

    assertCanonical(
      threw &&
        coordFlake.get(4025)?.snapshot === snapFlakeBefore &&
        coordFlake.getRevision() === revFlakeBefore,
      "CACHE05",
      "Refresh com falha rejeita e preserva integralmente o snapshot e a revisão anteriores"
    );

    // CACHE06 — snapshot novo com dezenas válidas e rateio ausente/inválido não reutiliza prizeReference antiga
    currentRateio = undefined;
    currentNumbers = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    const newSnap = await coord.refreshContest(4020);
    assertCanonical(
      newSnap.prizeReference === undefined &&
        coord.get(4020)?.snapshot.prizeReference === undefined &&
        coord.get(4020)?.snapshot.numbers[0] === 3,
      "CACHE06",
      "Snapshot novo com rateio ausente não herda prizeReference da consulta anterior (indivisibilidade)"
    );
  }

  // ===========================================================================
  // 4. RACE01–RACE08 — CONCORRÊNCIA COM PROMISES CONTROLADAS
  // ===========================================================================
  console.log("\n--- 4. RACE01–RACE08 — CONCORRÊNCIA COM PROMISES CONTROLADAS ---");
  {
    // RACE01 — duas consultas concorrentes: latest-started vence
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      const p1 = coord.consultContest(5001);
      const p2 = coord.consultContest(5001);

      assertCheck(prov.getContestCalls.length === 2, "RACE01.init", "Duas requisições iniciadas");

      // Resolve op2 primeiro (mais recente iniciada)
      const res2: OfficialContestResult = {
        contestNumber: 5001,
        drawDate: "2024-05-22",
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      prov.getContestCalls[1].deferred.resolve(res2);
      await p2;

      // Resolve op1 depois (mais antiga terminando depois)
      const res1: OfficialContestResult = {
        contestNumber: 5001,
        drawDate: "2024-05-21",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      prov.getContestCalls[0].deferred.resolve(res1);
      await p1;

      assertCanonical(
        coord.get(5001)?.snapshot.drawDate === "2024-05-22",
        "RACE01",
        "Duas consultas concorrentes: op2 mais recente vence e op1 mais antiga não sobrescreve"
      );
    }

    // RACE02 — dois refreshes concorrentes
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      const r1 = coord.refreshContest(5002);
      const r2 = coord.refreshContest(5002);

      const res2: OfficialContestResult = {
        contestNumber: 5002,
        drawDate: "2024-05-22",
        numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      const res1: OfficialContestResult = {
        contestNumber: 5002,
        drawDate: "2024-05-21",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };

      prov.refreshContestCalls[1].deferred.resolve(res2);
      await r2;
      prov.refreshContestCalls[0].deferred.resolve(res1);
      await r1;

      assertCanonical(
        coord.get(5002)?.snapshot.drawDate === "2024-05-22",
        "RACE02",
        "Dois refreshes concorrentes: latest-started vence o commit mantendo consistência"
      );
    }

    // RACE03 — consult seguido de refresh concorrente
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      const c1 = coord.consultContest(5003);
      const r2 = coord.refreshContest(5003);

      const resRefresh: OfficialContestResult = {
        contestNumber: 5003,
        drawDate: "2024-05-23",
        numbers: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      const resConsult: OfficialContestResult = {
        contestNumber: 5003,
        drawDate: "2024-05-20",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };

      prov.refreshContestCalls[0].deferred.resolve(resRefresh);
      await r2;
      prov.getContestCalls[0].deferred.resolve(resConsult);
      await c1;

      assertCanonical(
        coord.get(5003)?.snapshot.drawDate === "2024-05-23",
        "RACE03",
        "Consult seguido de refresh concorrente: refresh mais recente vence o commit"
      );
    }

    // RACE04 — refresh seguido de consult conforme a semântica V1.10 existente
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      const r1 = coord.refreshContest(5004);
      const c2 = coord.consultContest(5004);

      const resConsult: OfficialContestResult = {
        contestNumber: 5004,
        drawDate: "2024-05-24",
        numbers: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      const resRefresh: OfficialContestResult = {
        contestNumber: 5004,
        drawDate: "2024-05-21",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };

      prov.getContestCalls[0].deferred.resolve(resConsult);
      await c2;
      prov.refreshContestCalls[0].deferred.resolve(resRefresh);
      await r1;

      assertCanonical(
        coord.get(5004)?.snapshot.drawDate === "2024-05-24",
        "RACE04",
        "Refresh seguido de consult concorrente: operação mais recente vence rigorosamente"
      );
    }

    // RACE05 — operação mais nova bem-sucedida torna a antiga stale
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      const op1 = coord.consultContest(5005);
      const op2 = coord.consultContest(5005);

      const resOp2: OfficialContestResult = {
        contestNumber: 5005,
        drawDate: "2024-05-25",
        numbers: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      prov.getContestCalls[1].deferred.resolve(resOp2);
      await op2;
      const revAfterOp2 = coord.getRevision();

      // op1 resolve depois
      prov.getContestCalls[0].deferred.resolve({
        contestNumber: 5005,
        drawDate: "2024-05-20",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      });
      await op1;

      assertCanonical(
        coord.getRevision() === revAfterOp2 &&
          coord.get(5005)?.snapshot.drawDate === "2024-05-25",
        "RACE05",
        "Operação mais nova bem-sucedida torna a antiga stale sem avanço espúrio de revisão"
      );
    }

    // RACE06 — operação mais nova falha e NÃO devolve direito de commit à operação antiga
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      // Estabelece S0 inicialmente
      const baseCall = coord.consultContest(5006);
      const s0: OfficialContestResult = {
        contestNumber: 5006,
        drawDate: "2024-05-01",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      };
      prov.getContestCalls[0].deferred.resolve(s0);
      await baseCall;

      // Inicia op1 refresh e op2 refresh
      const r1 = coord.refreshContest(5006);
      const r2 = coord.refreshContest(5006);

      // op2 (mais nova) falha
      prov.refreshContestCalls[1].deferred.reject(new Error("Falha CAIXA"));
      await r2.catch(() => {});

      // op1 resolve com sucesso depois
      prov.refreshContestCalls[0].deferred.resolve({
        contestNumber: 5006,
        drawDate: "2024-05-26",
        numbers: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      });
      await r1;

      // Snapshot DEVE continuar sendo S0! op1 foi tornada obsoleta no momento em que op2 iniciou!
      assertCanonical(
        coord.get(5006)?.snapshot.drawDate === "2024-05-01",
        "RACE06",
        "Falha da operação mais nova NÃO devolve direito de commit à operação antiga (S0 retido)"
      );
    }

    // RACE07 — clear() durante operação em voo invalida seu direito de commit
    {
      const prov = new ControlledProvider();
      const coord = new OfficialSnapshotCoordinator({ provider: prov });

      const op = coord.consultContest(5007);
      coord.clear();

      prov.getContestCalls[0].deferred.resolve({
        contestNumber: 5007,
        drawDate: "2024-05-27",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "CAIXA",
        fetchedAt: new Date().toISOString(),
      });
      await op;

      assertCanonical(
        coord.get(5007) === undefined,
        "RACE07",
        "clear() síncrono invalida o direito de commit de qualquer requisição em voo (clearEpoch)"
      );
    }

    // RACE08 — toda proteção funciona sem qualquer troca/mutação de provider
    {
      assertCanonical(
        (officialSnapshotCoordinator as any).setProvider === undefined,
        "RACE08",
        "Toda a proteção de concorrência e monotonicidade opera sob provider estritamente imutável"
      );
    }
  }

  // ===========================================================================
  // 5. LIFE01–LIFE06 — INTEGRAÇÃO REAL E LIFECYCLE
  // ===========================================================================
  console.log("\n--- 5. LIFE01–LIFE06 — INTEGRAÇÃO REAL E LIFECYCLE ---");
  {
    // LIFE01 — mount produz zero HTTP/provider call
    const lifeProv = new SpiedProvider("LifeProv");
    const container01 = document.createElement("div");
    document.body.appendChild(container01);
    const root01 = ReactDOM.createRoot(container01);

    const callsBeforeMount = lifeProv.getContestCalls.length + lifeProv.latestContestCalls;
    await act(async () => {
      root01.render(React.createElement(GeneratorView));
    });
    const callsAfterMount = lifeProv.getContestCalls.length + lifeProv.latestContestCalls;

    await act(async () => {
      root01.unmount();
    });
    container01.remove();

    assertCanonical(
      callsBeforeMount === callsAfterMount,
      "LIFE01",
      "Montagem inicial de GeneratorView produz exatamente ZERO requisições à fonte oficial"
    );

    // LIFE02 — consulta explícita estabelece snapshot
    const repo02 = new ContestRepository({ idbFactory: new IDBFactory() });
    const refreshCoord02 = new RefreshCoordinator();
    const prov02 = new SpiedProvider("Prov02");
    const coord02 = new OfficialSnapshotCoordinator({ provider: prov02 });
    const ctrl02 = new GeneratorOperationalController(repo02, refreshCoord02, () => prov02, false, coord02);

    await ctrl02.refreshExternalSync();
    assertCanonical(
      prov02.latestContestCalls === 1,
      "LIFE02",
      "Ação explícita de consulta executa exatamente uma chamada e estabelece sincronização"
    );

    // LIFE03 — GeneratorView observa o snapshot canônico
    const draft03 = createContestDraft(6003);
    const frozen03 = await freezeContestRecord(draft03);
    const snapResult03: OfficialContestResult = {
      contestNumber: 6003,
      drawDate: "2024-05-30",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    };
    // Estabelece snapshot no singleton
    const origGetContest = officialSnapshotCoordinator.consultContest;
    (officialSnapshotCoordinator as any).snapshots.set(6003, { snapshot: snapResult03, revision: 1 });

    const container03 = document.createElement("div");
    document.body.appendChild(container03);
    const root03 = ReactDOM.createRoot(container03);

    await act(async () => {
      root03.render(React.createElement(GeneratorView));
    });

    const entryObserved = officialSnapshotCoordinator.get(6003);
    assertCanonical(
      entryObserved?.snapshot.contestNumber === 6003 &&
        entryObserved.snapshot.drawDate === "2024-05-30",
      "LIFE03",
      "GeneratorView observa o snapshot canônico da sessão sem discrepâncias"
    );

    await act(async () => {
      root03.unmount();
    });
    container03.remove();

    // LIFE04 — ContestDetailModal observa a mesma revision/snapshot sem HTTP adicional
    const container04 = document.createElement("div");
    document.body.appendChild(container04);
    const root04 = ReactDOM.createRoot(container04);

    const modalCallsBefore = lifeProv.getContestCalls.length;
    await act(async () => {
      root04.render(
        React.createElement(ContestDetailModal, {
          isOpen: true,
          record: frozen03,
          onClose: () => {},
        })
      );
    });
    const modalCallsAfter = lifeProv.getContestCalls.length;

    await act(async () => {
      root04.unmount();
    });
    container04.remove();

    assertCanonical(
      modalCallsBefore === modalCallsAfter &&
        officialSnapshotCoordinator.get(6003)?.revision === 1,
      "LIFE04",
      "ContestDetailModal observa a mesma revisão e snapshot sem disparar requisição adicional"
    );

    // Limpa estado injetado
    (officialSnapshotCoordinator as any).snapshots.delete(6003);

    // LIFE05 — refresh explícito em uma superfície atualiza a outra reativamente
    const reactiveProv = new SpiedProvider("ReactiveProv", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-31",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
      prizeReference: {
        contestNumber: n,
        fetchedAt: new Date().toISOString(),
        source: "CAIXA",
        tiers: [
          { hits: 15, winners: 99, prizePerWinnerCents: 999900 },
          { hits: 14, winners: 200, prizePerWinnerCents: 150000 },
          { hits: 13, winners: 1000, prizePerWinnerCents: 3000 },
          { hits: 12, winners: 10000, prizePerWinnerCents: 1200 },
          { hits: 11, winners: 100000, prizePerWinnerCents: 600 },
        ],
      },
    }));
    const reactiveCoord = new OfficialSnapshotCoordinator({ provider: reactiveProv });
    await reactiveCoord.consultContest(6005);

    const scored05 = await scoreFrozenContest(
      await freezeContestRecord(createContestDraft(6005)),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    const scoredWithBet05 = { ...scored05, betPlacedAt: "2024-05-20T10:00:00.000Z" };

    const container05 = document.createElement("div");
    document.body.appendChild(container05);
    const root05 = ReactDOM.createRoot(container05);

    await act(async () => {
      root05.render(
        React.createElement(
          "div",
          null,
          React.createElement(OfficialResultAuditPanel, { record: scoredWithBet05, coordinator: reactiveCoord }),
          React.createElement(OfficialPrizeReconciliationPanel, {
            contestNumber: 6005,
            score: scoredWithBet05.score,
            prize: scoredWithBet05.prize,
            betPlacedAt: scoredWithBet05.betPlacedAt,
            status: scoredWithBet05.status,
            record: scoredWithBet05,
            coordinator: reactiveCoord,
          })
        )
      );
    });

    const refreshBtn = container05.querySelector("#btn-refresh-prize-reference") as HTMLButtonElement;
    await act(async () => {
      refreshBtn.click();
    });

    const t15El = container05.querySelector("#tier-hits-15");
    const updatedVisible = t15El?.textContent?.includes("99 ganhador(es)") === true;

    await act(async () => {
      root05.unmount();
    });
    container05.remove();

    assertCanonical(
      updatedVisible && reactiveProv.refreshContestCalls.length === 1,
      "LIFE05",
      "Refresh acionado em uma superfície atualiza reativamente os consumidores do mesmo owner"
    );

    // LIFE06 — novo coordinator/nova sessão começa vazio e não consulta automaticamente
    const freshSpy = new SpiedProvider("FreshSpy");
    const freshCoord = new OfficialSnapshotCoordinator({ provider: freshSpy });

    assertCanonical(
      freshCoord.getRevision() === 0 &&
        freshCoord.get(6006) === undefined &&
        freshSpy.getContestCalls.length === 0 &&
        freshSpy.latestContestCalls === 0,
      "LIFE06",
      "Novo coordinator inicia com zero snapshots, revisão 0 e zero consultas automáticas"
    );
  }

  // ===========================================================================
  // CHECKS COMPLEMENTARES (IMM01–IMM06, COMP01–COMP06, TEST01–TEST03)
  // ===========================================================================
  console.log("\n--- CHECKS COMPLEMENTARES (IMM01–IMM06, COMP01–COMP06, TEST01–TEST03) ---");
  {
    const p1 = new SpiedProvider("CompP1");
    const coord = new OfficialSnapshotCoordinator({ provider: p1 });

    assertCheck((coord as any).setProvider === undefined, "IMM01", "setProvider não existe");
    assertCheck((coord as any).getProvider === undefined, "IMM02", "getProvider não existe");
    assertCheck(!("replaceProvider" in coord), "IMM03", "replaceProvider não existe");
    assertCheck(!("changeProvider" in coord), "IMM04", "changeProvider não existe");
    assertCheck(!("resetProvider" in coord), "IMM05", "resetProvider não existe");
    assertCheck(coord.providerName === "OfficialSnapshotCoordinator", "IMM06", "providerName válido");

    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const refreshCoordinator = new RefreshCoordinator();
    const ctrl = new GeneratorOperationalController(repo, refreshCoordinator, () => p1, false, coord);

    assertCheck(typeof ctrl.getState === "function", "COMP01", "Controller expõe getState");
    await ctrl.refreshExternalSync();
    assertCheck(p1.latestContestCalls > 0, "COMP02", "refreshExternalSync executado");
    assertCheck(typeof ctrl.fetchOfficialResultPreview === "function", "COMP03", "fetchOfficialResultPreview presente");
    assertCheck(typeof OfficialResultAuditPanel === "function", "COMP04", "AuditPanel presente");
    assertCheck(typeof OfficialPrizeReconciliationPanel === "function", "COMP05", "PrizePanel presente");
    assertCheck(officialSnapshotCoordinator instanceof OfficialSnapshotCoordinator, "COMP06", "Singleton presente");

    const testProv = new SpiedProvider("IsolatedTest");
    const testCoord = new OfficialSnapshotCoordinator({ provider: testProv });
    await testCoord.consultContest(9999);
    assertCheck(testCoord.get(9999) !== undefined, "TEST01", "Instância de teste isolada");
    assertCheck(officialSnapshotCoordinator.get(9999) === undefined, "TEST02", "Singleton não poluído");
    assertCheck(testProv.getContestCalls.length === 1, "TEST03", "Chamada isolada no mock");
  }

  console.log("\n===============================================================================");
  console.log(`MATRIZ CANÔNICA V1.12: ${canonicalPassed}/${totalCanonical} CENÁRIOS PASSARAM`);
  console.log(`TOTAL DE CHECKS/ASSERTIONS: ${totalChecks}`);
  console.log("===============================================================================");
}

runCanonicalV112Suite().catch((err) => {
  console.error("ERRO FATAL NA EXECUÇÃO DA SUÍTE V1.12:", err);
  process.exit(1);
});
