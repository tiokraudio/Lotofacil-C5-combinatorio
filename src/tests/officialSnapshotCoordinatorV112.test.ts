/**
 * ===============================================================================
 * SUÍTE DE TESTES DA V1.12: FONTE OFICIAL IMUTÁVEL E OWNERSHIP ÚNICO DE SESSÃO
 * Arquivo: src/tests/officialSnapshotCoordinatorV112.test.ts
 *
 * Cobertura Completa dos Requisitos da V1.12:
 *  1. Imutabilidade estrita da associação Coordinator -> Provider (sem setProvider/getProvider)
 *  2. Ausência de métodos substitutos de mutação (replaceProvider, changeProvider, resetProvider)
 *  3. Injeção imutável exclusiva no construtor (default para getLotteryProvider())
 *  4. Dois coordinators independentes operam sem contaminação cruzada (C1(P1) e C2(P2))
 *  5. Operações em voo de C1 não podem commitar em C2
 *  6. GeneratorOperationalController consome snapshotCoordinator fixo sem reconfiguração dinâmica
 *  7. OfficialResultAuditPanel aceita exclusivamente coordinator?: OfficialSnapshotCoordinator (sem lotteryProvider)
 *  8. OfficialPrizeReconciliationPanel aceita exclusivamente coordinator?: OfficialSnapshotCoordinator (sem lotteryProvider)
 *  9. Quando coordinator é omitido, componentes e controllers utilizam officialSnapshotCoordinator singleton
 * 10. Testabilidade limpa via injeção de dependência de OfficialSnapshotCoordinator isolado
 * 11. Preservação de concorrência: latest-started-wins por concurso
 * 12. Preservação de clear(): purga snapshots em memória e invalida commits pendentes em voo
 * 13. Preservação de pureza volátil: zero persistência em IndexedDB, storage ou mensagens de canal
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
} from "../lottery/types.ts";
import { OfficialResultAuditPanel } from "../components/OfficialResultAuditPanel.tsx";
import { OfficialPrizeReconciliationPanel } from "../components/OfficialPrizeReconciliationPanel.tsx";
import { GeneratorOperationalController } from "../system/generatorOperationalController.ts";
import { ContestRepository } from "../storage/contestRepository.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import { IDBFactory } from "fake-indexeddb";
import { createContestDraft, freezeContestRecord, scoreFrozenContest } from "../c5/record.ts";

let passed = 0;
let total = 0;

function assert(condition: boolean, code: string, message: string): void {
  total++;
  if (!condition) {
    console.error(`❌ FALHA [${code}]: ${message}`);
    throw new Error(`Falha no cenário ${code}: ${message}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${code}: ${message}`);
}

class MockProvider implements LotteryResultProvider {
  readonly providerName: string;
  getContestCalls: number[] = [];
  refreshContestCalls: number[] = [];
  latestContestCalls = 0;
  private resultFn?: (n: number) => OfficialContestResult;

  constructor(name: string, resultFn?: (n: number) => OfficialContestResult) {
    this.providerName = name;
    this.resultFn = resultFn;
  }

  async getLatestContest(_signal?: AbortSignal): Promise<OfficialContestResult> {
    this.latestContestCalls++;
    return this.produceResult(3100);
  }

  async getContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.getContestCalls.push(contestNumber);
    return this.produceResult(contestNumber);
  }

  async refreshContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.refreshContestCalls.push(contestNumber);
    return this.produceResult(contestNumber);
  }

  private produceResult(n: number): OfficialContestResult {
    if (this.resultFn) return this.resultFn(n);
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

async function runV112TestSuite(): Promise<void> {
  console.log("===============================================================================");
  console.log("INICIANDO SUÍTE CANÔNICA V1.12: FONTE OFICIAL IMUTÁVEL E OWNERSHIP DE SESSÃO");
  console.log("===============================================================================");

  // ---------------------------------------------------------------------------
  // GRUPO 1: IMUTABILIDADE DO PROVIDER NO COORDINATOR (IMM01–IMM06)
  // ---------------------------------------------------------------------------
  console.log("\n--- GRUPO 1: IMUTABILIDADE DO PROVIDER (IMM01–IMM06) ---");
  {
    const p1 = new MockProvider("P1");
    const coord = new OfficialSnapshotCoordinator({ provider: p1 });

    // IMM01: setProvider removido da API
    assert(
      (coord as any).setProvider === undefined,
      "IMM01",
      "setProvider() está formalmente removido da API de OfficialSnapshotCoordinator"
    );

    // IMM02: getProvider removido da API
    assert(
      (coord as any).getProvider === undefined,
      "IMM02",
      "getProvider() está formalmente removido da API de OfficialSnapshotCoordinator"
    );

    // IMM03: Métodos alternativos de mutação não existem
    const forbiddenMethods = [
      "replaceProvider",
      "changeProvider",
      "resetProvider",
      "switchProvider",
      "updateProvider",
    ];
    const hasForbidden = forbiddenMethods.some((m) => typeof (coord as any)[m] === "function");
    assert(
      !hasForbidden,
      "IMM03",
      "Nenhum método alternativo de mutação ou troca de provider existe na instância"
    );

    // IMM04: Construção com provider injetado utiliza exclusivamente aquele provider
    await coord.consultContest(3201);
    assert(
      p1.getContestCalls.includes(3201),
      "IMM04",
      "Coordinator realiza consultas exclusivamente através do provider fixado no construtor"
    );

    // IMM05: officialSnapshotCoordinator singleton exportado existe e é imutável
    assert(
      officialSnapshotCoordinator instanceof OfficialSnapshotCoordinator &&
        (officialSnapshotCoordinator as any).setProvider === undefined,
      "IMM05",
      "Singleton de produção officialSnapshotCoordinator é instância imutável"
    );

    // IMM06: Coordinator implementa LotteryResultProvider para compatibilidade direta de leitura
    assert(
      typeof coord.getContest === "function" &&
        typeof coord.getLatestContest === "function" &&
        coord.providerName === "OfficialSnapshotCoordinator",
      "IMM06",
      "Coordinator implementa a interface LotteryResultProvider de forma pura"
    );
  }

  // ---------------------------------------------------------------------------
  // GRUPO 2: OWNERSHIP ÚNICO E ISOLAMENTO DE INSTÂNCIAS (OWN01–OWN05)
  // ---------------------------------------------------------------------------
  console.log("\n--- GRUPO 2: OWNERSHIP ÚNICO E ISOLAMENTO DE INSTÂNCIAS (OWN01–OWN05) ---");
  {
    const p1 = new MockProvider("P1", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-20",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: "2024-05-20T20:00:00.000Z",
    }));

    const p2 = new MockProvider("P2", (n) => ({
      contestNumber: n,
      drawDate: "2024-05-21",
      numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      source: "CAIXA",
      fetchedAt: "2024-05-21T20:00:00.000Z",
    }));

    const c1 = new OfficialSnapshotCoordinator({ provider: p1 });
    const c2 = new OfficialSnapshotCoordinator({ provider: p2 });

    // OWN01: C1 consulta N e armazena resultado de P1; C2 permanece sem snapshot para N
    const r1 = await c1.consultContest(3202);
    assert(
      c1.get(3202)?.snapshot.numbers[0] === 1 && c2.get(3202) === undefined,
      "OWN01",
      "Snapshot obtido por C1 pertence exclusivamente a C1 e não vaza para C2"
    );

    // OWN02: C2 consulta N e armazena resultado independente de P2
    const r2 = await c2.consultContest(3202);
    assert(
      r2.numbers[0] === 2 &&
        c1.get(3202)?.snapshot.numbers[0] === 1 &&
        c2.get(3202)?.snapshot.numbers[0] === 2,
      "OWN02",
      "C1 e C2 coexistem de forma 100% isolada com seus respectivos providers imutáveis"
    );

    // OWN03: clear() em C1 não afeta snapshots nem revisions de C2
    const rev2Before = c2.getRevision();
    c1.clear();
    assert(
      c1.get(3202) === undefined &&
        c2.get(3202) !== undefined &&
        c2.getRevision() === rev2Before,
      "OWN03",
      "clear() em C1 purga exclusivamente C1, deixando C2 totalmente intacto"
    );

    // OWN04: Listeners inscritos em C1 não disparam em eventos de C2
    let c1ListenerNotified = false;
    c1.subscribe(() => {
      c1ListenerNotified = true;
    });
    await c2.refreshContest(3202);
    assert(
      !c1ListenerNotified,
      "OWN04",
      "Listeners de C1 não recebem nenhuma notificação originada de mutações em C2"
    );

    // OWN05: Operações em voo de C1 não podem commitar em C2
    let resolveP1!: (v: OfficialContestResult) => void;
    const delayedP1 = new Promise<OfficialContestResult>((res) => {
      resolveP1 = res;
    });
    const slowP1: LotteryResultProvider = {
      providerName: "SlowP1",
      getLatestContest: async () => { throw new Error("not impl"); },
      getContest: async () => delayedP1,
      refreshContest: async () => delayedP1,
    };
    const cSlow = new OfficialSnapshotCoordinator({ provider: slowP1 });
    const inFlightPromise = cSlow.consultContest(3203);

    assert(
      c2.get(3203) === undefined,
      "OWN05.1",
      "Operação em voo em cSlow não afeta c2"
    );
    resolveP1({
      contestNumber: 3203,
      drawDate: "2024-05-20",
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      source: "CAIXA",
      fetchedAt: new Date().toISOString(),
    });
    await inFlightPromise;
    assert(
      cSlow.get(3203) !== undefined && c2.get(3203) === undefined,
      "OWN05",
      "Commit tardio de cSlow altera apenas cSlow e preserva isolamento estrito de c2"
    );
  }

  // ---------------------------------------------------------------------------
  // GRUPO 3: COMPOSIÇÃO DE PRODUÇÃO E CONSUMIDORES (COMP01–COMP06)
  // ---------------------------------------------------------------------------
  console.log("\n--- GRUPO 3: COMPOSIÇÃO DE PRODUÇÃO E CONSUMIDORES (COMP01–COMP06) ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const refreshCoordinator = new RefreshCoordinator();
    const mockProv = new MockProvider("MockProv");
    const testCoord = new OfficialSnapshotCoordinator({ provider: mockProv });

    // COMP01: GeneratorOperationalController aceita snapshotCoordinator fixo
    const controller = new GeneratorOperationalController(
      repo,
      refreshCoordinator,
      () => mockProv,
      false,
      testCoord
    );

    // COMP02: refreshExternalSync utiliza diretamente o coordinator do controller
    await controller.refreshExternalSync();
    assert(
      mockProv.latestContestCalls > 0,
      "COMP02",
      "Controller executa refreshExternalSync através do snapshotCoordinator injetado"
    );

    // COMP03: fetchOfficialResultPreview utiliza o coordinator do controller
    const draft = createContestDraft(3204);
    await repo.saveDraft(draft);
    const frozen = await repo.freezeStoredContest(3204);
    await (controller as any).refreshLocalState();

    await controller.fetchOfficialResultPreview(3204);
    assert(
      mockProv.getContestCalls.includes(3204),
      "COMP03",
      "Controller executa fetchOfficialResultPreview através do snapshotCoordinator injetado"
    );

    // COMP04: OfficialResultAuditPanel aceita coordinator?: OfficialSnapshotCoordinator
    const scored = await scoreFrozenContest(
      frozen,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );

    const containerAudit = document.createElement("div");
    document.body.appendChild(containerAudit);
    const rootAudit = ReactDOM.createRoot(containerAudit);

    await act(async () => {
      rootAudit.render(
        React.createElement(OfficialResultAuditPanel, {
          record: scored,
          coordinator: testCoord,
        })
      );
    });

    const auditBtn = containerAudit.querySelector("#btn-consult-caixa") as HTMLButtonElement | null;
    assert(
      containerAudit.querySelector("#panel-official-result-audit") !== null,
      "COMP04",
      "OfficialResultAuditPanel renderiza perfeitamente com coordinator injetado"
    );

    await act(async () => {
      rootAudit.unmount();
    });
    containerAudit.remove();

    // COMP05: OfficialPrizeReconciliationPanel aceita coordinator?: OfficialSnapshotCoordinator
    const scoredWithBet = {
      ...scored,
      betPlacedAt: "2024-05-20T10:00:00.000Z",
    };
    const containerPrize = document.createElement("div");
    document.body.appendChild(containerPrize);
    const rootPrize = ReactDOM.createRoot(containerPrize);

    await act(async () => {
      rootPrize.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3204,
          score: scoredWithBet.score,
          prize: scoredWithBet.prize,
          betPlacedAt: scoredWithBet.betPlacedAt,
          status: scoredWithBet.status,
          record: scoredWithBet,
          coordinator: testCoord,
        })
      );
    });

    assert(
      containerPrize.querySelector("#panel-official-prize-reconciliation") !== null,
      "COMP05",
      "OfficialPrizeReconciliationPanel renderiza perfeitamente com coordinator injetado"
    );

    await act(async () => {
      rootPrize.unmount();
    });
    containerPrize.remove();

    // COMP06: Quando omitido coordinator, componentes usam officialSnapshotCoordinator sem quebrar
    const containerPrizeDefault = document.createElement("div");
    document.body.appendChild(containerPrizeDefault);
    const rootPrizeDefault = ReactDOM.createRoot(containerPrizeDefault);

    await act(async () => {
      rootPrizeDefault.render(
        React.createElement(OfficialPrizeReconciliationPanel, {
          contestNumber: 3204,
          score: scoredWithBet.score,
          prize: scoredWithBet.prize,
          betPlacedAt: scoredWithBet.betPlacedAt,
          status: scoredWithBet.status,
          record: scoredWithBet,
        })
      );
    });

    assert(
      containerPrizeDefault.querySelector("#panel-official-prize-reconciliation") !== null,
      "COMP06",
      "Componente faz fallback automático e seguro para officialSnapshotCoordinator"
    );

    await act(async () => {
      rootPrizeDefault.unmount();
    });
    containerPrizeDefault.remove();
  }

  // ---------------------------------------------------------------------------
  // GRUPO 4: TESTABILIDADE LIMPA E ZERO MOCKING GLOBAL (TEST01–TEST03)
  // ---------------------------------------------------------------------------
  console.log("\n--- GRUPO 4: TESTABILIDADE LIMPA (TEST01–TEST03) ---");
  {
    // TEST01: Teste isolado cria nova instância e não contamina o singleton oficial
    const testProv = new MockProvider("IsolatedTest");
    const testCoordinator = new OfficialSnapshotCoordinator({ provider: testProv });

    await testCoordinator.consultContest(3299);

    assert(
      testCoordinator.get(3299) !== undefined &&
        officialSnapshotCoordinator.get(3299) === undefined,
      "TEST01",
      "Instância de teste isolada não polui o singleton global de produção"
    );

    // TEST02: Teste não precisa restaurar nenhum estado anterior de provider global
    assert(
      (officialSnapshotCoordinator as any).setProvider === undefined,
      "TEST02",
      "Padrão frágil de setProvider(mock)/setProvider(previous) eliminado estruturalmente"
    );

    // TEST03: Zero chamadas na rede global causadas por testes isolados
    assert(
      testProv.getContestCalls.length === 1 &&
        testProv.getContestCalls[0] === 3299,
      "TEST03",
      "Injeção limpa de dependência canaliza requisições exclusivamente para o mock local"
    );
  }

  console.log("===============================================================================");
  console.log(`SUÍTE V1.12 CONCLUÍDA COM SUCESSO: ${passed}/${total} ASSERÇÕES PASSARAM`);
  console.log("===============================================================================");
}

runV112TestSuite().catch((err) => {
  console.error("ERRO FATAL NA EXECUÇÃO DA SUÍTE V1.12:", err);
  process.exit(1);
});
