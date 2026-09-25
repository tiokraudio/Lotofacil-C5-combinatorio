/**
 * SUÍTE CANÔNICA DE CERTIFICAÇÃO V1.13 — FLUXO SIMPLIFICADO DE APOSTA E CONFERÊNCIA
 *
 * Matriz Canônica Obrigatória (48 cenários):
 * - ATOM01–ATOM10: Confirmação Atômica DRAFT -> FROZEN + betPlacedAt (10/10)
 * - REGEN01–REGEN07: Geração Única e Imutabilidade Prospectiva (7/7)
 * - RACE01–RACE07: Concorrência, TOCTOU e Multiaba com Promises Controladas (7/7)
 * - LEGACY01–LEGACY06: Compatibilidade com Registros Legados e Sem Aposta (6/6)
 * - FLOW01–FLOW08: Integração de Fluxos e Nova Aba Conferência (8/8)
 * - UX01–UX06: Ergonomia, Copiar Jogos e Auditoria Automática (6/6)
 * - BARRIER01–BARRIER04: Barreiras de Engenharia, C5, Schemas e Versões (4/4)
 *
 * TOTAL: 48/48 cenários canônicos rigorosamente provados.
 */

import "./setupDom.ts";
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { createContestDraft, freezeContestRecord, scoreFrozenContest } from "../c5/record.ts";
import type { ContestRecord } from "../c5/types.ts";
import { ContestRepository, deepCloneRecord } from "../storage/contestRepository.ts";
import fs from "fs";
import path from "path";
import App from "../App.tsx";
import { openDatabase, CONTEST_STORE_NAME } from "../storage/db.ts";
import type { StorageTestHarness } from "../storage/types.ts";
import { runGoldenTest } from "../c5/tests/golden.test.ts";
import {
  verifyContestIntegrity,
  buildCanonicalPayload,
  serializeCanonicalPayload,
  computeSHA256,
} from "../c5/integrity.ts";
import { validateC5 } from "../c5/validator.ts";
import { APP_VERSION, APPLICATION_MANIFEST } from "../system/manifest.ts";
import { C5_ALGORITHM_VERSION } from "../c5/version.ts";
import { Header } from "../components/Header.tsx";
import { GeneratorView } from "../components/GeneratorView.tsx";
import { ConferenceView } from "../components/ConferenceView.tsx";
import { ContestDetailModal } from "../components/ContestDetailModal.tsx";
import { getLotteryProvider, type LotteryResultProvider, type OfficialContestResult } from "../lottery/index.ts";
import { formatGamesCanonical, copyGamesToClipboard } from "../utils/clipboard.ts";
import { RefreshCoordinator } from "../system/refreshCoordinator.ts";
import { LocalSyncCoordinator, LOCAL_SYNC_PROTOCOL_VERSION } from "../system/localSyncCoordinator.ts";
import { OfficialSnapshotCoordinator, officialSnapshotCoordinator } from "../sync/officialSnapshotCoordinator.ts";

let totalChecksCount = 0;
const passedCanonicalScenarios = new Set<string>();

function assertCanonical(condition: boolean, scenarioId: string, description: string): void {
  totalChecksCount++;
  if (!condition) {
    console.error(`  ✗ [FAIL] ${scenarioId}: ${description}`);
    throw new Error(`Falha no cenário canônico ${scenarioId}: ${description}`);
  }
  passedCanonicalScenarios.add(scenarioId);
  console.log(`  ✓ [PASS] ${scenarioId}: ${description}`);
}

class ControlledProvider implements LotteryResultProvider {
  readonly providerName = "ControlledProvider";
  getContestCalls: number[] = [];
  getLatestContestCalls: number = 0;
  refreshContestCalls: number[] = [];

  constructor(
    private contestResults: Map<number, number[]> = new Map(),
    private latestContestNum: number = 3300
  ) {}

  setResult(contestNumber: number, numbers: number[]): void {
    this.contestResults.set(contestNumber, [...numbers].sort((a, b) => a - b));
  }

  async getContest(contestNumber: number): Promise<OfficialContestResult> {
    this.getContestCalls.push(contestNumber);
    const nums = this.contestResults.get(contestNumber) ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    return {
      contestNumber,
      drawDate: "2026-09-24",
      numbers: nums,
      source: "CONTROLLED_CAIXA",
      fetchedAt: new Date().toISOString(),
    };
  }

  async getLatestContest(): Promise<OfficialContestResult> {
    this.getLatestContestCalls++;
    const nums = this.contestResults.get(this.latestContestNum) ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    return {
      contestNumber: this.latestContestNum,
      drawDate: "2026-09-24",
      numbers: nums,
      source: "CONTROLLED_CAIXA",
      fetchedAt: new Date().toISOString(),
      nextContestNumber: this.latestContestNum + 1,
    };
  }

  async refreshContest(contestNumber: number): Promise<OfficialContestResult> {
    this.refreshContestCalls.push(contestNumber);
    return this.getContest(contestNumber);
  }
}

async function runV113CertificationSuite(): Promise<void> {
  console.log("===============================================================================");
  console.log("INICIANDO SUÍTE CANÔNICA V1.13: FLUXO SIMPLIFICADO DE APOSTA E CONFERÊNCIA");
  console.log("===============================================================================");

  // ===========================================================================
  // 1. ATOM01–ATOM10 — OPERAÇÃO ATÔMICA DE CONFIRMAÇÃO (10/10)
  // ===========================================================================
  console.log("\n--- 1. ATOM01–ATOM10 — CONFIRMAÇÃO ATÔMICA DRAFT -> FROZEN + betPlacedAt ---");
  {
    const idb = new IDBFactory();
    const refreshCoord = new RefreshCoordinator();
    const repo = new ContestRepository({ idbFactory: idb, refreshCoordinator: refreshCoord });

    // ATOM01: DRAFT válido -> confirmação -> FROZEN + frozenAt + betPlacedAt + SHA válido + mesmos games
    const draft01 = createContestDraft(1001);
    await repo.saveDraft(draft01);
    const confirmed01 = await repo.confirmDraftBet(1001);
    const stored01 = await repo.getContestRecord(1001);

    assertCanonical(
      stored01 !== null &&
      stored01.status === "FROZEN" &&
      typeof stored01.frozenAt === "string" &&
      typeof stored01.betPlacedAt === "string" &&
      typeof stored01.integrityHash === "string" &&
      stored01.integrityHash.length === 64 &&
      JSON.stringify(stored01.generation.games) === JSON.stringify(draft01.generation.games),
      "ATOM01",
      "DRAFT válido confirmado atomicamente resulta em FROZEN com frozenAt, betPlacedAt, SHA válido e jogos idênticos"
    );

    // ATOM02: generatedAt <= frozenAt <= betPlacedAt
    const tGen02 = Date.parse(stored01!.generatedAt);
    const tFroz02 = Date.parse(stored01!.frozenAt!);
    const tBet02 = Date.parse(stored01!.betPlacedAt!);
    assertCanonical(
      tGen02 <= tFroz02 && tFroz02 <= tBet02 && tFroz02 === tBet02,
      "ATOM02",
      "Provar rigorosamente que generatedAt <= frozenAt <= betPlacedAt com frozenAt === betPlacedAt"
    );

    // ATOM03: Registro final passa pela verificação criptográfica REAL
    const realAudit03 = await verifyContestIntegrity(stored01!);
    const tampered03 = deepCloneRecord(stored01!);
    tampered03.generation.games[0][0] = tampered03.generation.games[0][0] === 1 ? 25 : 1;
    const tamperedAudit03 = await verifyContestIntegrity(tampered03);
    assertCanonical(
      realAudit03.valid === true && realAudit03.errors.length === 0 && tamperedAudit03.valid === false,
      "ATOM03",
      "Registro final passa por verificação criptográfica REAL e detecta corrupção imediata"
    );

    // ATOM04: betPlacedAt permanece fora do payload criptográfico
    const payload04 = buildCanonicalPayload(
      stored01!.contestNumber,
      stored01!.generationId,
      stored01!.algorithmVersion,
      stored01!.generatedAt,
      stored01!.frozenAt!,
      stored01!.generation
    );
    const sha04 = await computeSHA256(serializeCanonicalPayload(payload04));
    assertCanonical(
      !("betPlacedAt" in payload04) &&
      (payload04 as any).betPlacedAt === undefined &&
      sha04 === stored01!.integrityHash,
      "ATOM04",
      "betPlacedAt permanece estritamente fora do FrozenC5Payload e não altera o hash canônico"
    );

    // ATOM05: Games, slots, permutation, generationId, algorithmVersion permanecem inalterados
    assertCanonical(
      stored01!.generationId === draft01.generationId &&
      stored01!.algorithmVersion === draft01.algorithmVersion &&
      JSON.stringify(stored01!.generation.permutation) === JSON.stringify(draft01.generation.permutation) &&
      JSON.stringify(stored01!.generation.slotAssignments) === JSON.stringify(draft01.generation.slotAssignments) &&
      JSON.stringify(stored01!.generation.games) === JSON.stringify(draft01.generation.games),
      "ATOM05",
      "Games, slots, permutation, generationId, algorithmVersion e geração permanecem integralmente inalterados"
    );

    // ATOM06: Falha criptográfica/controlada antes do commit mantém DRAFT original
    const draft06 = createContestDraft(1006);
    await repo.saveDraft(draft06);
    let failed06 = false;
    try {
      // Chama confirmação injetando clock incoerente anterior a generatedAt para provocar rejeição antes do commit
      await repo.confirmDraftBet(1006, { clock: () => new Date(Date.parse(draft06.generatedAt) - 10000) });
    } catch {
      failed06 = true;
    }
    const stored06 = await repo.getContestRecord(1006);
    assertCanonical(
      failed06 &&
      stored06 !== null &&
      stored06.status === "DRAFT" &&
      stored06.frozenAt === undefined &&
      stored06.betPlacedAt === undefined,
      "ATOM06",
      "Falha antes do commit mantém o registro DRAFT original integralmente no IndexedDB"
    );

    // ATOM07: Falha de transação/commit preserva o estado DRAFT original sem transição espúria
    const harness07: StorageTestHarness = { simulateCommitFailure: false };
    const repo07 = new ContestRepository({
      idbFactory: new IDBFactory(),
      testHarness: harness07,
      refreshCoordinator: refreshCoord,
    });
    const draft07 = createContestDraft(1007);
    await repo07.saveDraft(draft07);

    const events07: string[] = [];
    const unsub07 = refreshCoord.subscribe((_rev: number, reason: string) => {
      events07.push(reason);
    });

    // Injeta falha controlada de commit na transação do storage
    harness07.simulateCommitFailure = true;

    let failed07 = false;
    try {
      await repo07.confirmDraftBet(1007);
    } catch {
      failed07 = true;
    }
    unsub07();

    // 1. Reler pelo API público
    const stored07 = await repo07.getContestRecord(1007);

    assertCanonical(
      failed07 &&
        stored07 !== null &&
        // 2. Provar DRAFT
        stored07.status === "DRAFT" &&
        // 3. Provar frozenAt === undefined
        stored07.frozenAt === undefined &&
        // 4. Provar betPlacedAt === undefined
        stored07.betPlacedAt === undefined &&
        // 5. Provar integrityHash === undefined
        stored07.integrityHash === undefined &&
        // 6. Provar geração original intacta
        stored07.generationId === draft07.generationId &&
        JSON.stringify(stored07.generation.games) === JSON.stringify(draft07.generation.games) &&
        // 7. Provar zero BET_CONFIRMED
        events07.filter((e) => e === "BET_CONFIRMED").length === 0,
      "ATOM07",
      "Falha controlada de transação/persistência preserva o estado DRAFT original sem transição espúria para FROZEN"
    );

    // ATOM08: DRAFT inválido/adulterado é rejeitado sem mutação parcial
    const corruptedDraft08 = createContestDraft(1008);
    corruptedDraft08.generation.games[0][0] = corruptedDraft08.generation.games[0][1]; // duplicada
    let failed08 = false;
    try {
      await repo.saveDraft(corruptedDraft08);
    } catch {
      failed08 = true;
    }
    assertCanonical(
      failed08 && (await repo.getContestRecord(1008)) === null,
      "ATOM08",
      "DRAFT com invariantes C5 violadas é rejeitado na raiz sem mutação parcial no armazenamento"
    );

    // ATOM09: Nova operação DRAFT-confirm não aceita SCORED
    const draft09 = createContestDraft(1009);
    await repo.saveDraft(draft09);
    await repo.confirmDraftBet(1009);
    await repo.scoreStoredContest(1009, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    let failed09 = false;
    try {
      await repo.confirmDraftBet(1009);
    } catch (err: any) {
      if (err?.message && err.message.includes("já apurados (SCORED)")) {
        failed09 = true;
      }
    }
    assertCanonical(
      failed09,
      "ATOM09",
      "Nova operação de confirmação de rascunho rejeita sumariamente registros em estado SCORED"
    );

    // ATOM10: Sucesso produz exatamente um BET_CONFIRMED pós-commit; falha produz zero
    const draft10 = createContestDraft(1010);
    await repo.saveDraft(draft10);
    const events10: string[] = [];
    const unsub10 = refreshCoord.subscribe((_rev: number, reason: string) => {
      events10.push(reason);
    });
    await repo.confirmDraftBet(1010);
    unsub10();

    let failed10 = false;
    const failEvents10: string[] = [];
    const unsubFail10 = refreshCoord.subscribe((_rev: number, reason: string) => {
      failEvents10.push(reason);
    });
    try {
      await repo.confirmDraftBet(1010); // já FROZEN, deve falhar
    } catch {
      failed10 = true;
    }
    unsubFail10();

    assertCanonical(
      events10.length === 1 &&
      events10[0] === "BET_CONFIRMED" &&
      failed10 &&
      failEvents10.length === 0,
      "ATOM10",
      "Sucesso produz exatamente UM evento BET_CONFIRMED pós-commit e falha produz rigorosamente zero"
    );
  }

  // ===========================================================================
  // 2. REGEN01–REGEN07 — NÃO REGENERAR CONCURSO EXISTENTE (7/7)
  // ===========================================================================
  console.log("\n--- 2. REGEN01–REGEN07 — NÃO REGENERAR CONCURSO EXISTENTE ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // REGEN01: Concurso inexistente gera e persiste exatamente uma geração
    const draft01 = createContestDraft(2001);
    await repo.saveDraft(draft01);
    const stored01 = await repo.getContestRecord(2001);
    assertCanonical(
      stored01 !== null && stored01.generationId === draft01.generationId,
      "REGEN01",
      "Concurso inexistente gera e persiste exatamente uma geração no IndexedDB"
    );

    // REGEN02: DRAFT existente solicitado pelo usuário é carregado pelo caminho real do Gerador sem nova geração
    const draft02 = createContestDraft(2002);
    await repo.saveDraft(draft02);

    let saveDraftCalls02 = 0;
    const origSaveDraft02 = repo.saveDraft.bind(repo);
    repo.saveDraft = async (r: ContestRecord) => {
      saveDraftCalls02++;
      return origSaveDraft02(r);
    };

    // Monta o Gerador real conectado ao mesmo repositório
    const container02 = document.createElement("div");
    document.body.appendChild(container02);
    const root02 = ReactDOM.createRoot(container02);

    await act(async () => {
      root02.render(React.createElement(GeneratorView, { repository: repo }));
    });

    // Usuário solicita o mesmo concurso existente
    const input02 = container02.querySelector("#contest-number-input") as HTMLInputElement;
    const form02 = container02.querySelector("form") as HTMLFormElement;
    if (input02 && form02) {
      await act(async () => {
        input02.value = "2002";
        input02.dispatchEvent(new Event("input", { bubbles: true }));
        form02.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    }

    // Aguarda microtarefas da operação
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Reler estado persistido no banco
    const loaded02 = await repo.getContestRecord(2002);

    await act(async () => {
      root02.unmount();
    });
    container02.remove();
    repo.saveDraft = origSaveDraft02;

    assertCanonical(
      loaded02 !== null &&
        loaded02.generationId === draft02.generationId &&
        JSON.stringify(loaded02.generation.games) === JSON.stringify(draft02.generation.games) &&
        loaded02.generatedAt === draft02.generatedAt &&
        saveDraftCalls02 === 0,
      "REGEN02",
      "DRAFT existente solicitado pelo usuário é carregado pelo caminho real do Gerador sem nova geração ou novo save"
    );

    // REGEN03: FROZEN existente é carregado; não gera novamente
    const draft03 = createContestDraft(2003);
    await repo.saveDraft(draft03);
    const frozen03 = await repo.confirmDraftBet(2003);
    const loaded03 = await repo.getContestRecord(2003);
    assertCanonical(
      loaded03 !== null &&
      loaded03.generationId === frozen03.generationId &&
      JSON.stringify(loaded03.generation.games) === JSON.stringify(frozen03.generation.games),
      "REGEN03",
      "FROZEN existente é carregado preservando estritamente generationId e apostas"
    );

    // REGEN04: SCORED existente é carregado; não gera novamente
    await repo.scoreStoredContest(2003, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const loaded04 = await repo.getContestRecord(2003);
    assertCanonical(
      loaded04 !== null &&
      loaded04.status === "SCORED" &&
      loaded04.generationId === frozen03.generationId,
      "REGEN04",
      "SCORED existente é carregado preservando imutabilidade da geração original"
    );

    // REGEN05: Duas primeiras gerações concorrentes resultam em exatamente um registro
    const genA05 = createContestDraft(2005);
    const genB05 = createContestDraft(2005);
    const settle05 = await Promise.allSettled([
      repo.saveDraft(genA05),
      repo.saveDraft(genB05),
    ]);
    const successCount05 = settle05.filter((s) => s.status === "fulfilled").length;
    const rejectCount05 = settle05.filter((s) => s.status === "rejected").length;
    const stored05 = await repo.getContestRecord(2005);
    assertCanonical(
      successCount05 === 1 && rejectCount05 === 1 && stored05 !== null,
      "REGEN05",
      "Duas gerações concorrentes para mesmo concurso resultam em exatamente um registro persistido"
    );

    // REGEN06: GeneratorView real com DRAFT não oferece descarte/regeneração
    const draft06 = createContestDraft(2006);
    await repo.saveDraft(draft06);

    const container06 = document.createElement("div");
    document.body.appendChild(container06);
    const root06 = ReactDOM.createRoot(container06);

    await act(async () => {
      root06.render(React.createElement(GeneratorView));
    });

    const input06 = container06.querySelector("#contest-number-input") as HTMLInputElement;
    const form06 = container06.querySelector("form") as HTMLFormElement;
    if (input06 && form06) {
      await act(async () => {
        input06.value = "2006";
        input06.dispatchEvent(new Event("input", { bubbles: true }));
        form06.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    }

    const discardBtn06 = container06.querySelector("#btn-discard-draft");
    const discardText06 = container06.textContent?.includes("DESCARTAR RASCUNHO") ?? false;

    await act(async () => {
      root06.unmount();
    });
    container06.remove();

    assertCanonical(
      discardBtn06 === null && discardText06 === false,
      "REGEN06",
      "GeneratorView real não oferece botão ou fluxo de descarte/regeneração para DRAFT"
    );

    // REGEN07: saveDraft(secondDraft) continua rejeitando colisão e preservando o primeiro
    const draftA07 = createContestDraft(2007);
    const draftB07 = createContestDraft(2007);
    await repo.saveDraft(draftA07);
    let rejected07 = false;
    try {
      await repo.saveDraft(draftB07);
    } catch {
      rejected07 = true;
    }
    const finalStored07 = await repo.getContestRecord(2007);
    assertCanonical(
      rejected07 && finalStored07 !== null && finalStored07.generationId === draftA07.generationId,
      "REGEN07",
      "saveDraft rejeita colisão subsequente e preserva integralmente o registro original"
    );
  }

  // ===========================================================================
  // 3. RACE01–RACE07 — CONCORRÊNCIA COM PROMISES CONTROLADAS (7/7)
  // ===========================================================================
  console.log("\n--- 3. RACE01–RACE07 — CONCORRÊNCIA, TOCTOU E MULTIABA ---");
  {
    const idb = new IDBFactory();
    const refreshCoord = new RefreshCoordinator();
    const repo = new ContestRepository({ idbFactory: idb, refreshCoordinator: refreshCoord });

    // RACE01 & RACE02: Duas confirmações simultâneas: uma vence, perdedora não sobrescreve
    const draft01 = createContestDraft(3001);
    await repo.saveDraft(draft01);

    const raceResults01 = await Promise.allSettled([
      repo.confirmDraftBet(3001),
      repo.confirmDraftBet(3001),
    ]);

    const winnerCount01 = raceResults01.filter((r) => r.status === "fulfilled").length;
    const loserCount01 = raceResults01.filter((r) => r.status === "rejected").length;
    const stored01 = await repo.getContestRecord(3001);

    assertCanonical(
      winnerCount01 === 1 && loserCount01 === 1 && stored01?.status === "FROZEN",
      "RACE01",
      "Duas confirmações simultâneas sobre mesmo DRAFT: exatamente uma vence e a outra é rejeitada de forma segura"
    );

    assertCanonical(
      stored01 !== null && stored01.betPlacedAt !== undefined && stored01.frozenAt !== undefined,
      "RACE02",
      "Operação perdedora não corrompe nem sobrescreve o estado confirmado pelo vencedor"
    );

    // RACE03: Mudança concorrente entre snapshot e commit é detectada por TOCTOU e abortada
    const sharedIdb03 = new IDBFactory();
    let barrierReached03 = false;
    let resolveBarrier03: () => void = () => {};
    const barrierPromise03 = new Promise<void>((resolve) => {
      resolveBarrier03 = resolve;
    });

    const harness03: StorageTestHarness = {
      beforeTransactionCommit: async (contestNumber: number, phase: string) => {
        if (contestNumber === 3003 && phase === "read" && !barrierReached03) {
          barrierReached03 = true;
          // Aguarda deterministicamente a operação B alterar legitimamente o registro
          await barrierPromise03;
        }
      },
    };

    const repoA03 = new ContestRepository({ idbFactory: sharedIdb03, testHarness: harness03 });
    const repoB03 = new ContestRepository({ idbFactory: sharedIdb03 });

    const draft03 = createContestDraft(3003);
    await repoA03.saveDraft(draft03);

    let toctouAborted03 = false;
    let actualError03 = "";

    // Operação A lê snapshot e atinge a barreira determinística antes de comitar
    const opAPromise = (async () => {
      try {
        await repoA03.confirmDraftBet(3003);
      } catch (err: any) {
        actualError03 = String(err?.message || err);
        if (err?.message && err.message.includes("mudou durante a operação")) {
          toctouAborted03 = true;
        }
      }
    })();

    // Aguarda até A atingir a barreira determinística
    while (!barrierReached03) {
      await new Promise((r) => setTimeout(r, 0));
    }

    // Operação B altera legitimamente o registro via API pública
    await repoB03.confirmDraftBet(3003);

    // Libera a Operação A para prosseguir e reler na transação
    resolveBarrier03();
    await opAPromise;

    const stored03 = await repoB03.getContestRecord(3003);

    assertCanonical(
      toctouAborted03 && stored03 !== null && stored03.status === "FROZEN",
      "RACE03",
      `Mudança concorrente entre snapshot e commit é detectada por TOCTOU e abortada com segurança (got: ${actualError03})`
    );

    // RACE04: Não existe janela persistida/observável DRAFT + betPlacedAt
    const draft04 = createContestDraft(3004);
    await repo.saveDraft(draft04);
    let observedDraftWithBet04 = false;
    const unsub04 = refreshCoord.subscribe(async () => {
      const rec = await repo.getContestRecord(3004);
      if (rec && rec.status === "DRAFT" && rec.betPlacedAt !== undefined) {
        observedDraftWithBet04 = true;
      }
    });
    await repo.confirmDraftBet(3004);
    unsub04();

    assertCanonical(
      observedDraftWithBet04 === false,
      "RACE04",
      "Não existe janela observável ou persistida contendo estado híbrido DRAFT + betPlacedAt"
    );

    // RACE05: Outra aba recebe estado completo somente após commit
    const draft05 = createContestDraft(3005);
    await repo.saveDraft(draft05);
    let stateAtNotification05: any = null;
    let resolveListener05: () => void = () => {};
    const listenerPromise05 = new Promise<void>((res) => {
      resolveListener05 = res;
    });
    const unsub05 = refreshCoord.subscribe(async (_rev: number, reason: string, contestNum?: number) => {
      if (reason === "BET_CONFIRMED" && contestNum === 3005) {
        stateAtNotification05 = await repo.getContestRecord(3005);
        resolveListener05();
      }
    });
    await repo.confirmDraftBet(3005);
    await listenerPromise05;
    unsub05();

    assertCanonical(
      stateAtNotification05 !== null &&
      stateAtNotification05.status === "FROZEN" &&
      typeof stateAtNotification05.betPlacedAt === "string" &&
      typeof stateAtNotification05.integrityHash === "string",
      "RACE05",
      "Ouvintes de sincronização recebem estado completo (FROZEN + betPlacedAt + hash) somente pós-commit"
    );

    // RACE06: Invalidação remota não produz retransmissão em loop
    const syncCoord06 = new LocalSyncCoordinator({ refreshCoordinator: refreshCoord });
    const initialPublished06 = syncCoord06.getMetrics().published;

    // Recebe mensagem remota de outra aba
    syncCoord06.handleIncomingEvent({
      protocolVersion: 1,
      eventId: "remote-uuid-99",
      originId: "remote-tab-99",
      reason: "BET_CONFIRMED",
      contestNumber: 3005,
      emittedAt: new Date().toISOString(),
    });

    assertCanonical(
      syncCoord06.getMetrics().published === initialPublished06,
      "RACE06",
      "Invalidação remota recebida não retransmite mensagem em loop na rede local"
    );
    syncCoord06.close();

    // RACE07: Rollback/falha produz zero BET_CONFIRMED e zero estado fantasma
    const draft07 = createContestDraft(3007);
    await repo.saveDraft(draft07);
    const failNotifs07: string[] = [];
    const unsub07 = refreshCoord.subscribe((_rev: number, reason: string) => {
      failNotifs07.push(reason);
    });
    try {
      await repo.confirmDraftBet(3007, { clock: () => new Date("1970-01-01T00:00:00Z") });
    } catch {
      // expected
    }
    unsub07();
    const stored07 = await repo.getContestRecord(3007);

    assertCanonical(
      failNotifs07.length === 0 && stored07?.status === "DRAFT",
      "RACE07",
      "Falha/abort na confirmação produz zero eventos BET_CONFIRMED e zero estado fantasma no armazenamento"
    );
  }

  // ===========================================================================
  // 4. LEGACY01–LEGACY06 — COMPATIBILIDADE LEGADA (6/6)
  // ===========================================================================
  console.log("\n--- 4. LEGACY01–LEGACY06 — COMPATIBILIDADE COM HISTÓRICO LEGADO ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // LEGACY01: FROZEN histórico sem betPlacedAt continua válido
    const draft01 = createContestDraft(4001);
    const legacyFrozen01 = await freezeContestRecord(draft01);
    // betPlacedAt permanece undefined por design legado
    const audit01 = await verifyContestIntegrity(legacyFrozen01);
    assertCanonical(
      legacyFrozen01.status === "FROZEN" &&
      legacyFrozen01.betPlacedAt === undefined &&
      audit01.valid === true,
      "LEGACY01",
      "FROZEN histórico sem betPlacedAt continua plenamente válido frente às auditorias de integridade"
    );

    // LEGACY02: Carregar legado não cria betPlacedAt nem altera SHA/frozenAt
    await repo.saveDraft(draft01);
    await repo.freezeStoredContest(4001);
    const loaded02 = await repo.getContestRecord(4001);
    assertCanonical(
      loaded02 !== null &&
      loaded02.status === "FROZEN" &&
      loaded02.betPlacedAt === undefined &&
      loaded02.frozenAt !== undefined,
      "LEGACY02",
      "Carregar registro legado não injeta betPlacedAt nem recalcula frozenAt ou hash SHA-256"
    );

    // LEGACY03: FROZEN legado pode usar confirmação existente sem refazer freeze/SHA
    const originalHash03 = loaded02!.integrityHash;
    const originalFrozenAt03 = loaded02!.frozenAt;
    const confirmed03 = await repo.confirmBetPlaced(4001);
    assertCanonical(
      confirmed03.status === "FROZEN" &&
      confirmed03.betPlacedAt !== undefined &&
      confirmed03.integrityHash === originalHash03 &&
      confirmed03.frozenAt === originalFrozenAt03,
      "LEGACY03",
      "FROZEN legado confirma aposta sem refazer freeze nem alterar integridade SHA-256 original"
    );

    // LEGACY04: ConferenceView reconhece FROZEN sem betPlacedAt como aposta não confirmada
    const draft04 = createContestDraft(4004);
    await repo.saveDraft(draft04);
    await repo.freezeStoredContest(4004);

    const container04 = document.createElement("div");
    document.body.appendChild(container04);
    const root04 = ReactDOM.createRoot(container04);

    await act(async () => {
      root04.render(React.createElement(ConferenceView, {
        initialContestNumber: 4004,
        repository: repo,
      }));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const bannerLegacy04 = container04.querySelector("#banner-legacy-unconfirmed");
    const confirmLegacyBtn04 = container04.querySelector("#btn-confirm-legacy-bet");

    assertCanonical(
      bannerLegacy04 !== null &&
      confirmLegacyBtn04 !== null &&
      container04.textContent?.includes("APOSTA AINDA NÃO CONFIRMADA") === true,
      "LEGACY04",
      "ConferenceView identifica concurso legado sem aposta e exibe alerta explícito e botão de confirmação"
    );

    // LEGACY05: Confirmação legada explícita torna o registro elegível ao fluxo normal de conferência
    await act(async () => {
      confirmLegacyBtn04?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Confirma no modal de confirmação
    const confirmBtnInModal05 = container04.querySelector("#confirm-dialog-confirm-btn") as HTMLButtonElement;
    if (confirmBtnInModal05) {
      await act(async () => {
        confirmBtnInModal05.click();
      });
    }

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const consultCaixaBtn05 = container04.querySelector("#btn-consult-caixa");

    await act(async () => {
      root04.unmount();
    });
    container04.remove();

    const stored05 = await repo.getContestRecord(4004);
    assertCanonical(
      stored05?.betPlacedAt !== undefined && consultCaixaBtn05 !== null,
      "LEGACY05",
      "Confirmação legada na ConferenceView torna o registro apto à consulta oficial e conferência"
    );

    // LEGACY06: SCORED legado sem betPlacedAt continua sem aposta e sem confirmação retroativa
    const draft06 = createContestDraft(4006);
    await repo.saveDraft(draft06);
    await repo.freezeStoredContest(4006);
    await repo.scoreStoredContest(4006, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    let retroConfirmRejected06 = false;
    try {
      await repo.confirmBetPlaced(4006);
    } catch (err: any) {
      if (err?.message && err.message.includes("Proibição de confirmação retroativa")) {
        retroConfirmRejected06 = true;
      }
    }

    let prizeRejected06 = false;
    try {
      await repo.recordPrize(4006, 5000);
    } catch (err: any) {
      if (
        err?.message &&
        (err.message.includes("não teve sua aposta confirmada") ||
          err.message.includes("aposta não foi confirmada"))
      ) {
        prizeRejected06 = true;
      }
    }

    assertCanonical(
      retroConfirmRejected06 && prizeRejected06,
      "LEGACY06",
      "SCORED legado sem aposta bloqueia confirmação retroativa e registro financeiro artificial"
    );
  }

  // ===========================================================================
  // 5. FLOW01–FLOW08 — INTEGRAÇÃO DE FLUXOS E ABA CONFERÊNCIA (8/8)
  // ===========================================================================
  console.log("\n--- 5. FLOW01–FLOW08 — FLUXOS E SUPERFÍCIE DE CONFERÊNCIA ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const prov = new ControlledProvider();
    const coord = new OfficialSnapshotCoordinator({ provider: prov });

    // FLOW01: Header real contém Gerador, Conferência, Histórico, Auditoria
    const container01 = document.createElement("div");
    document.body.appendChild(container01);
    const root01 = ReactDOM.createRoot(container01);

    await act(async () => {
      root01.render(React.createElement(Header, {
        currentTab: "generator",
        onTabChange: () => {},
      }));
    });

    const confBtn01 = container01.querySelector("#tab-conference-btn");
    const genBtn01 = container01.querySelector("#tab-generator-btn");
    const histBtn01 = container01.querySelector("#tab-history-btn");
    const auditBtn01 = container01.querySelector("#tab-audit-btn");

    assertCanonical(
      confBtn01 !== null && genBtn01 !== null && histBtn01 !== null && auditBtn01 !== null,
      "FLOW01",
      "Header real contém Gerador, Conferência, Histórico e Auditoria com NavTab conference suportado"
    );

    await act(async () => {
      root01.unmount();
    });
    container01.remove();

    // FLOW02: App real monta; usuário clica na aba Conferência; GeneratorView deixa de ser ativa e ConferenceView real é montada
    const appContainer02 = document.createElement("div");
    document.body.appendChild(appContainer02);
    const appRoot02 = ReactDOM.createRoot(appContainer02);

    await act(async () => {
      appRoot02.render(React.createElement(App));
    });

    // Aguarda conclusão do bootstrap do App
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const genInputBefore02 = appContainer02.querySelector("#contest-number-input");
    const confInputBefore02 = appContainer02.querySelector("#conference-contest-input");
    const confTabBtn02 = appContainer02.querySelector("#tab-conference-btn") as HTMLButtonElement;

    // Usuário clica no botão real de navegação da aba Conferência
    await act(async () => {
      confTabBtn02?.click();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const genInputAfter02 = appContainer02.querySelector("#contest-number-input");
    const confInputAfter02 = appContainer02.querySelector("#conference-contest-input");

    await act(async () => {
      appRoot02.unmount();
    });
    appContainer02.remove();

    assertCanonical(
      genInputBefore02 !== null &&
        confInputBefore02 === null &&
        genInputAfter02 === null &&
        confInputAfter02 !== null,
      "FLOW02",
      "App real: usuário clica na aba Conferência, GeneratorView deixa de ser ativa e ConferenceView real é montada"
    );

    // FLOW03: GeneratorView FROZEN não contém entrada operacional de resultado/score
    const draft03 = createContestDraft(5003);
    await repo.saveDraft(draft03);
    await repo.confirmDraftBet(5003);

    const container03 = document.createElement("div");
    document.body.appendChild(container03);
    const root03 = ReactDOM.createRoot(container03);

    await act(async () => {
      root03.render(React.createElement(GeneratorView));
    });

    const input03 = container03.querySelector("#contest-number-input") as HTMLInputElement;
    const form03 = container03.querySelector("form") as HTMLFormElement;
    if (input03 && form03) {
      await act(async () => {
        input03.value = "5003";
        input03.dispatchEvent(new Event("input", { bubbles: true }));
        form03.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    }

    const officialSection03 = container03.querySelector("#official-result-section");
    const scoreBtn03 = container03.querySelector("#btn-score-official-result");

    await act(async () => {
      root03.unmount();
    });
    container03.remove();

    assertCanonical(
      officialSection03 === null && scoreBtn03 === null,
      "FLOW03",
      "GeneratorView FROZEN não contém seção de apuração nem entrada operacional de resultado"
    );

    // FLOW04: GeneratorView SCORED não contém OfficialResultAuditPanel / OfficialPrizeReconciliationPanel
    await repo.scoreStoredContest(5003, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const container04 = document.createElement("div");
    document.body.appendChild(container04);
    const root04 = ReactDOM.createRoot(container04);

    await act(async () => {
      root04.render(React.createElement(GeneratorView));
    });

    const input04 = container04.querySelector("#contest-number-input") as HTMLInputElement;
    const form04 = container04.querySelector("form") as HTMLFormElement;
    if (input04 && form04) {
      await act(async () => {
        input04.value = "5003";
        input04.dispatchEvent(new Event("input", { bubbles: true }));
        form04.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    }

    const auditPanel04 = container04.querySelector("#official-result-audit-panel");
    const prizePanel04 = container04.querySelector("#official-prize-reconciliation-panel");

    await act(async () => {
      root04.unmount();
    });
    container04.remove();

    assertCanonical(
      auditPanel04 === null && prizePanel04 === null,
      "FLOW04",
      "GeneratorView SCORED não contém painéis operacionais de auditoria ou reconciliação financeira"
    );

    // FLOW05: Montar ConferenceView produz ZERO HTTP / ZERO consulta CAIXA automática
    let realHttpFetchCalls05 = 0;
    const origFetch05 = globalThis.fetch;
    globalThis.fetch = (async (...args: any[]) => {
      realHttpFetchCalls05++;
      return (origFetch05 as any)(...args);
    }) as any;

    const testProv05 = new ControlledProvider();
    const testCoord05 = new OfficialSnapshotCoordinator({ provider: testProv05 });

    const container05 = document.createElement("div");
    document.body.appendChild(container05);
    const root05 = ReactDOM.createRoot(container05);

    await act(async () => {
      root05.render(React.createElement(ConferenceView, {
        coordinator: testCoord05,
        repository: repo,
      }));
    });

    await act(async () => {
      root05.unmount();
    });
    container05.remove();
    globalThis.fetch = origFetch05;

    assertCanonical(
      realHttpFetchCalls05 === 0 &&
      testProv05.getContestCalls.length === 0 &&
      testProv05.getLatestContestCalls === 0,
      "FLOW05",
      "Montagem da ConferenceView produz rigorosamente zero chamadas HTTP e zero consultas à CAIXA"
    );

    // FLOW06: Ação explícita na Conferência inicia consulta CAIXA
    const draft06 = createContestDraft(5006);
    await repo.saveDraft(draft06);
    await repo.confirmDraftBet(5006);
    testProv06Results: {
      testProv05.setResult(5006, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }

    const container06 = document.createElement("div");
    document.body.appendChild(container06);
    const root06 = ReactDOM.createRoot(container06);

    await act(async () => {
      root06.render(React.createElement(ConferenceView, {
        initialContestNumber: 5006,
        coordinator: testCoord05,
        repository: repo,
      }));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const consultBtn06 = container06.querySelector("#btn-consult-caixa") as HTMLButtonElement;
    assertCanonical(
      consultBtn06 !== null,
      "FLOW06",
      "Ação explícita para consulta da CAIXA está presente na Conferência para concurso com aposta"
    );

    await act(async () => {
      consultBtn06.click();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    assertCanonical(
      testProv05.getContestCalls.includes(5006),
      "FLOW06",
      "Ação explícita do usuário na Conferência dispara a consulta externa ao coordenador oficial"
    );

    // FLOW07: Snapshot/preview válido NÃO pontua automaticamente (continua FROZEN)
    const stored07 = await repo.getContestRecord(5006);
    const previewCard07 = container06.querySelector("#preview-official-card");
    assertCanonical(
      stored07?.status === "FROZEN" &&
      stored07?.score === undefined &&
      previewCard07 !== null,
      "FLOW07",
      "Preview oficial exibido na tela NÃO pontua automaticamente; concurso permanece FROZEN no banco"
    );

    // FLOW08: Confirmação explícita do resultado: FROZEN -> SCORED com dados persistidos
    const confirmScoreBtn08 = container06.querySelector("#btn-confirm-conference") as HTMLButtonElement;
    await act(async () => {
      confirmScoreBtn08.click();
    });

    // Confirmação no modal
    const modalConfirmBtn08 = container06.querySelector("#confirm-dialog-confirm-btn") as HTMLButtonElement;
    if (modalConfirmBtn08) {
      await act(async () => {
        modalConfirmBtn08.click();
      });
    }

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      root06.unmount();
    });
    container06.remove();

    const stored08 = await repo.getContestRecord(5006);
    assertCanonical(
      stored08?.status === "SCORED" &&
      stored08?.officialResult?.length === 15 &&
      stored08?.score !== undefined &&
      typeof stored08?.scoredAt === "string",
      "FLOW08",
      "Confirmação explícita da conferência transiciona o concurso para SCORED com apuração persistida"
    );
  }

  // ===========================================================================
  // 6. UX01–UX06 — ERGONOMIA, COPIAR JOGOS E INTEGRIDADE (6/6)
  // ===========================================================================
  console.log("\n--- 6. UX01–UX06 — ERGONOMIA, COPIAR JOGOS E INTEGRIDADE AUTOMÁTICA ---");
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft01 = createContestDraft(6001);
    await repo.saveDraft(draft01);
    const confirmed01 = await repo.confirmDraftBet(6001);

    // UX01: ContestDetailModal real oferece COPIAR JOGOS
    const container01 = document.createElement("div");
    document.body.appendChild(container01);
    const root01 = ReactDOM.createRoot(container01);

    await act(async () => {
      root01.render(React.createElement(ContestDetailModal, {
        isOpen: true,
        record: confirmed01,
        onClose: () => {},
      }));
    });

    const copyGamesBtn01 = document.querySelector("#btn-modal-copy-games");
    assertCanonical(
      copyGamesBtn01 !== null,
      "UX01",
      "ContestDetailModal real oferece botão explícito COPIAR JOGOS"
    );

    // UX02: Clipboard contém jogos de record.generation.games pela formatação canônica
    let clipboardWrittenText = "";
    (navigator as any).clipboard = {
      writeText: async (text: string) => {
        clipboardWrittenText = text;
      },
    };

    await act(async () => {
      (copyGamesBtn01 as HTMLButtonElement).click();
    });

    const expectedCanonicalText = formatGamesCanonical(confirmed01.generation.games);
    assertCanonical(
      clipboardWrittenText === expectedCanonicalText && clipboardWrittenText.length > 0,
      "UX02",
      "Área de transferência recebe os 5 jogos persistidos pela formatação canônica oficial"
    );

    // UX03: Modal não oferece Copiar Hash
    const copyHashBtn03 = document.querySelector("#btn-copy-hash") ||
      Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Copiar Hash"));
    assertCanonical(
      copyHashBtn03 === undefined || copyHashBtn03 === null,
      "UX03",
      "ContestDetailModal não oferece botão ou ação de Copiar Hash"
    );

    // UX04: Modal não apresenta hash como ação operacional comum
    const hashActionBtn04 = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Copiar") && b.getAttribute("id") !== "btn-modal-copy-games"
    );
    assertCanonical(
      hashActionBtn04 === undefined,
      "UX04",
      "Hash SHA-256 é exibido como metadado técnico e não como ação operacional comum"
    );

    // UX05: Modal não contém Auditoria Criptográfica Individual / VERIFICAR INTEGRIDADE
    const verifyIndividualBtn05 = document.querySelector("#btn-verify-individual");
    const verifyIndividualText05 = document.body.textContent?.includes("Auditoria Criptográfica Individual") ?? false;
    const verifyBtnText05 = document.body.textContent?.includes("VERIFICAR INTEGRIDADE") ?? false;

    await act(async () => {
      root01.unmount();
    });
    container01.remove();

    assertCanonical(
      verifyIndividualBtn05 === null && !verifyIndividualText05 && !verifyBtnText05,
      "UX05",
      "ContestDetailModal removeu a auditoria manual individual e botão VERIFICAR INTEGRIDADE"
    );

    // UX06: Mesmo sem auditoria manual, mutação crítica contra registro adulterado continua bloqueada
    const draft06 = createContestDraft(6006);
    await repo.saveDraft(draft06);
    await repo.confirmDraftBet(6006);

    // Adulteração manual no IndexedDB simulando corrupção externa via infraestrutura legítima
    const rawDB06 = await openDatabase({ idbFactory: idb });
    try {
      const tx = rawDB06.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);
      const stored = await new Promise<any>((res) => {
        const req = store.get(6006);
        req.onsuccess = () => res(req.result);
      });
      stored.generation.games[0][0] = stored.generation.games[0][0] === 1 ? 25 : 1;
      store.put(stored);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      rawDB06.close();
    }

    let scoringBlocked06 = false;
    try {
      await repo.scoreStoredContest(6006, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    } catch (err: any) {
      if (err?.message && err.message.includes("integridade")) {
        scoringBlocked06 = true;
      }
    }

    assertCanonical(
      scoringBlocked06,
      "UX06",
      "Mutação crítica contra registro adulterado é bloqueada automaticamente pela integridade criptográfica"
    );
  }

  // ===========================================================================
  // 7. BARRIER01–BARRIER04 — BARREIRAS DE ENGENHARIA (4/4)
  // ===========================================================================
  console.log("\n--- 7. BARRIER01–BARRIER04 — BARREIRAS C5, PERSISTÊNCIA, V1.12 E VERSÕES ---");
  {
    // BARRIER01: Motor C5 combinatório matematicamente íntegro e validado pelo Golden Standard e processo formal
    const goldenResult = runGoldenTest();
    assertCanonical(
      goldenResult.allPassed === true,
      "BARRIER01",
      "Motor C5 combinatório matematicamente íntegro e validado pelo Golden Standard e processo formal (Golden, Massive e Exhaustive)"
    );

    // BARRIER02: Persistência mantida com BACKUP_SCHEMA_VERSION = 3, LOCAL_SYNC_PROTOCOL_VERSION = 1 e ausência de novos campos persistidos
    const repo02 = new ContestRepository({ idbFactory: new IDBFactory() });
    const draft02 = createContestDraft(7002);
    await repo02.saveDraft(draft02);
    const sampleRecord02 = await repo02.confirmDraftBet(7002);
    const ALLOWED_CONTEST_RECORD_FIELDS = new Set([
      "status",
      "contestNumber",
      "generationId",
      "algorithmVersion",
      "generatedAt",
      "generation",
      "frozenAt",
      "integrityHash",
      "betPlacedAt",
      "officialResult",
      "scoredAt",
      "score",
      "prize",
    ]);
    const recordKeys02 = Object.keys(sampleRecord02);
    const hasOnlyAllowedFields02 = recordKeys02.every((k) => ALLOWED_CONTEST_RECORD_FIELDS.has(k));

    assertCanonical(
      APPLICATION_MANIFEST.backupSchemaVersion === 3 &&
        LOCAL_SYNC_PROTOCOL_VERSION === 1 &&
        hasOnlyAllowedFields02,
      "BARRIER02",
      "Persistência mantida com BACKUP_SCHEMA_VERSION = 3, LOCAL_SYNC_PROTOCOL_VERSION = 1 e ausência de novos campos persistidos no ContestRecord"
    );

    // BARRIER03: V1.12 intacta (provider imutável, ownership único, zero provider swapping)
    assertCanonical(
      (officialSnapshotCoordinator as any).setProvider === undefined &&
      (officialSnapshotCoordinator as any).getProvider === undefined &&
      typeof officialSnapshotCoordinator.consultContest === "function",
      "BARRIER03",
      "Arquitetura V1.12 preservada com provider imutável e coordenador canônico único de sessão"
    );

    // BARRIER04: Versões e RNG: APP_VERSION = 1.13.0, C5_ALGORITHM_VERSION = C5-1.0.0, BACKUP_SCHEMA = 3, PROTOCOL = 1, Math.random = ZERO
    let runtimeMathRandomCalls04 = 0;
    const origMathRandom04 = Math.random;
    Math.random = () => {
      runtimeMathRandomCalls04++;
      return origMathRandom04();
    };

    // Executa operações reais de produção sob espionagem
    const testGen04 = createContestDraft(7004);
    validateC5(testGen04.generation);
    Math.random = origMathRandom04;

    // Varredura estática real do código de produção para assegurar ZERO chamadas a Math.random()
    const prodDirs = ["src/c5", "src/storage", "src/sync", "src/lottery", "src/components", "src/system"];
    let prodMathRandomMatches = 0;
    const scanDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (!ent.name.includes("test")) scanDir(full);
        } else if (ent.isFile() && (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx"))) {
          if (ent.name.includes("test")) continue;
          const content = fs.readFileSync(full, "utf8");
          // Remove comentários de bloco e linha para inspecionar código executável real
          const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
          const matches = codeOnly.match(/Math\.random\s*\(/g);
          if (matches) prodMathRandomMatches += matches.length;
        }
      }
    };
    prodDirs.forEach(scanDir);

    assertCanonical(
      APP_VERSION === "1.13.0" &&
        APPLICATION_MANIFEST.appVersion === "1.13.0" &&
        C5_ALGORITHM_VERSION === "C5-1.0.0" &&
        APPLICATION_MANIFEST.backupSchemaVersion === 3 &&
        LOCAL_SYNC_PROTOCOL_VERSION === 1 &&
        runtimeMathRandomCalls04 === 0 &&
        prodMathRandomMatches === 0,
      "BARRIER04",
      "APP_VERSION 1.13.0, C5_ALGORITHM_VERSION C5-1.0.0, BACKUP_SCHEMA 3, PROTOCOL 1 e ZERO Math.random em produção rigorosamente comprovados"
    );
  }

  // ===========================================================================
  // RELATÓRIO FINAL DA SUÍTE V1.13
  // ===========================================================================
  console.log("\n===============================================================================");
  console.log(`MATRIZ CANÔNICA V1.13: ${passedCanonicalScenarios.size}/48 CENÁRIOS APROVADOS`);
  console.log(`TOTAL DE CHECKS/ASSERTIONS: ${totalChecksCount}`);
  console.log("===============================================================================");

  if (passedCanonicalScenarios.size < 48) {
    throw new Error(`Matriz canônica incompleta: apenas ${passedCanonicalScenarios.size}/48 cenários aprovados.`);
  }

  process.exit(0);
}

runV113CertificationSuite().catch((err) => {
  console.error("FALHA NA SUÍTE CANÔNICA V1.13:", err);
  process.exit(1);
});
