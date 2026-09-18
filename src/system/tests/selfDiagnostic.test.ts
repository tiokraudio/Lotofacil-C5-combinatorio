/**
 * Testes Unitários e Integrados do Autodiagnóstico C₅ (Versão 1.1).
 */
import { runSelfDiagnostic } from "../selfDiagnostic.ts";
import { ContestRepository } from "../../storage/contestRepository.ts";
import { createContestDraft } from "../../c5/record.ts";
import { createMulberry32 } from "../../c5/random.ts";
import type { LotteryResultProvider, OfficialContestResult } from "../../lottery/types.ts";
import type { C5Generation } from "../../c5/types.ts";
import { IDBFactory } from "fake-indexeddb";

// Provider Fake para testes da CAIXA
class MockLotteryProvider implements LotteryResultProvider {
  readonly providerName = "Mock CAIXA Provider";
  constructor(
    private readonly behavior:
      | { type: "success"; contestNumber: number; nextContestNumber: number }
      | { type: "timeout" }
      | { type: "http503" }
      | { type: "network_offline" }
  ) {}

  clearCache(): void {}

  async getLatestContest(): Promise<OfficialContestResult> {
    if (this.behavior.type === "success") {
      return {
        contestNumber: this.behavior.contestNumber,
        drawDate: "2026-09-18",
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        source: "MOCK_CAIXA",
        nextContestNumber: this.behavior.nextContestNumber,
        fetchedAt: new Date().toISOString(),
      };
    }
    if (this.behavior.type === "timeout") {
      throw new Error("Timeout ao conectar com a CAIXA (10.000ms excedidos)");
    }
    if (this.behavior.type === "http503") {
      throw new Error("HTTP 503: Serviço temporariamente indisponível");
    }
    throw new Error("Falha de rede: Dispositivo offline (ENOTFOUND)");
  }

  async getContest(contestNumber: number): Promise<OfficialContestResult> {
    return this.getLatestContest();
  }
}

export async function runSelfDiagnosticTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  console.log("=== INICIANDO TESTES DO AUTODIAGNÓSTICO (SELFDIAGNOSTIC.TEST) ===");

  // 1. Diagnóstico padrão limpo (Histórico vazio, sem chamada externa)
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      repository: repo,
      checkExternal: false,
    });

    assert(diag.appVersion === "1.1.0", "1.1. Versão da aplicação reportada como 1.1.0");
    assert(
      diag.algorithmVersion === "C5-1.0.0",
      "1.2. Versão do algoritmo reportada como C5-1.0.0"
    );
    assert(diag.localStatus === "PASS", "1.3. localStatus limpo = PASS");
    assert(
      diag.globalStatus === "WARN",
      "1.4. globalStatus em modo offline/sem verificação externa = WARN"
    );

    const goldenCheck = diag.checks.find((c) => c.id === "golden_runtime");
    assert(goldenCheck?.status === "PASS", "1.5. Check Golden runtime = PASS");

    const interCheck = diag.checks.find((c) => c.id === "named_intersections");
    assert(interCheck?.status === "PASS", "1.6. Check Interseções nomeadas = PASS");

    const valCheck = diag.checks.find((c) => c.id === "validator_c5");
    assert(valCheck?.status === "PASS", "1.7. Check Validator C5 = PASS");

    const cryptoCheck = diag.checks.find((c) => c.id === "web_crypto");
    assert(cryptoCheck?.status === "PASS", "1.8. Check Web Crypto = PASS");

    const rngCheck = diag.checks.find((c) => c.id === "rng_smoke");
    assert(rngCheck?.status === "PASS", "1.9. Check RNG Smoke = PASS");

    const idbCheck = diag.checks.find((c) => c.id === "indexeddb_storage");
    assert(idbCheck?.status === "PASS", "1.10. Check IndexedDB = PASS");

    const histCheck = diag.checks.find((c) => c.id === "history_audit");
    assert(histCheck?.status === "PASS", "1.11. Check Histórico vazio = PASS");
  }

  // 2. Diagnóstico com Histórico Íntegro Populado (DRAFT + FROZEN + SCORED)
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Cria e persiste 1 DRAFT
    await repo.saveDraft(createContestDraft(3400, { rng: createMulberry32(10) }));
    // Cria, persiste e congela 1 concurso
    await repo.saveDraft(createContestDraft(3401, { rng: createMulberry32(20) }));
    await repo.freezeStoredContest(3401);
    // Cria, persiste, congela e pontua 1 concurso
    await repo.saveDraft(createContestDraft(3402, { rng: createMulberry32(30) }));
    await repo.freezeStoredContest(3402);
    await repo.scoreStoredContest(3402, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      repository: repo,
      checkExternal: false,
    });

    assert(diag.localStatus === "PASS", "2.1. localStatus com histórico íntegro = PASS");
    assert(diag.historyAudit.totalRecords === 3, "2.2. Total de registros auditados = 3");
    assert(diag.historyAudit.validRecords === 3, "2.3. Total de registros válidos = 3");
    assert(diag.historyAudit.invalidRecords === 0, "2.4. Total de registros inválidos = 0");
    assert(diag.historyAudit.valid === true, "2.5. Histórico auditEntireHistory aprovado");
  }

  // 3. Diagnóstico com Histórico Corrompido
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    await repo.saveDraft(createContestDraft(3450, { rng: createMulberry32(40) }));
    const frozen = await repo.freezeStoredContest(3450);

    // Corrompe diretamente o registro no store
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = idb.open("c5-official-generator", 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });

    const corrupted = JSON.parse(JSON.stringify(frozen));
    corrupted.generation.games[0][0] = 99; // violação de integridade e hash
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["contestRecords"], "readwrite");
      tx.objectStore("contestRecords").put(corrupted);
      tx.oncomplete = () => {
        db.close();
        res();
      };
      tx.onerror = () => rej(tx.error);
    });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      repository: repo,
      checkExternal: false,
    });

    assert(
      diag.localStatus === "WARN",
      "3.1. localStatus com histórico corrompido = WARN (alerta de integridade)"
    );
    assert(diag.historyAudit.valid === false, "3.2. Histórico marcado como inválido");
    assert(diag.historyAudit.invalidRecords === 1, "3.3. 1 registro corrompido identificado");
  }

  // 4. Injeção de Falha no Golden Standard (Builder Adulterado)
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const corruptedBuilder = (perm: number[]): C5Generation => {
      return {
        permutation: perm,
        slotAssignments: {},
        games: [
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // duplicado, viola Golden e interseção
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        ],
      };
    };

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      repository: repo,
      builderOverride: corruptedBuilder,
      checkExternal: false,
    });

    assert(diag.localStatus === "FAIL", "4.1. localStatus com falha no Golden = FAIL");
    assert(diag.globalStatus === "FAIL", "4.2. globalStatus com falha no Golden = FAIL");

    const goldenCheck = diag.checks.find((c) => c.id === "golden_runtime");
    assert(goldenCheck?.status === "FAIL", "4.3. Check Golden = FAIL sob adulteração");

    const interCheck = diag.checks.find((c) => c.id === "named_intersections");
    assert(interCheck?.status === "FAIL", "4.4. Check Interseções = FAIL sob adulteração");
  }

  // 5. Injeção de Falha no Web Crypto (recurso ausente)
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      repository: repo,
      cryptoOverride: {
        getRandomValues: undefined, // Simula ambiente sem CSPRNG
      },
      checkExternal: false,
    });

    assert(diag.localStatus === "FAIL", "5.1. localStatus com falha no Web Crypto = FAIL");
    const cryptoCheck = diag.checks.find((c) => c.id === "web_crypto");
    assert(cryptoCheck?.status === "FAIL", "5.2. Check Web Crypto = FAIL quando ausente");
  }

  // 6. Injeção de Falha no IndexedDB (open lança erro)
  {
    const brokenIdb: Partial<IDBFactory> = {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => {
          if (req.onerror) req.onerror({} as any);
        }, 0);
        return req;
      },
    };

    const diag = await runSelfDiagnostic({
      idbFactory: brokenIdb as IDBFactory,
      checkExternal: false,
    });

    assert(diag.localStatus === "FAIL", "6.1. localStatus com falha no IndexedDB = FAIL");
    const idbCheck = diag.checks.find((c) => c.id === "indexeddb_storage");
    assert(idbCheck?.status === "FAIL", "6.2. Check IndexedDB = FAIL quando indisponível");
  }

  // 7. Teste da CAIXA: Sucesso (PASS)
  {
    const idb = new IDBFactory();
    const mockProvider = new MockLotteryProvider({
      type: "success",
      contestNumber: 3350,
      nextContestNumber: 3351,
    });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      lotteryProvider: mockProvider,
      checkExternal: true,
    });

    assert(diag.localStatus === "PASS", "7.1. localStatus com CAIXA online = PASS");
    assert(diag.globalStatus === "PASS", "7.2. globalStatus com CAIXA online = PASS");
    assert(diag.external?.reachable === true, "7.3. CAIXA reachable = true");
    assert(diag.external?.status === "PASS", "7.4. Status externo da CAIXA = PASS");
    assert(
      diag.external?.latestContestNumber === 3350,
      "7.5. latestContestNumber reportado corretamente (3350)"
    );
  }

  // 8. Teste da CAIXA: Timeout (UNAVAILABLE - Não deve derrubar localStatus)
  {
    const idb = new IDBFactory();
    const mockProvider = new MockLotteryProvider({ type: "timeout" });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      lotteryProvider: mockProvider,
      checkExternal: true,
    });

    assert(
      diag.localStatus === "PASS",
      "8.1. localStatus com CAIXA em timeout CONTINUA PASS (independência do motor local)"
    );
    assert(
      diag.globalStatus === "WARN",
      "8.2. globalStatus com CAIXA em timeout = WARN"
    );
    assert(diag.external?.reachable === false, "8.3. CAIXA reachable = false");
    assert(
      diag.external?.status === "UNAVAILABLE",
      "8.4. Status da CAIXA sob timeout = UNAVAILABLE"
    );
  }

  // 9. Teste da CAIXA: HTTP 503 (UNAVAILABLE)
  {
    const idb = new IDBFactory();
    const mockProvider = new MockLotteryProvider({ type: "http503" });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      lotteryProvider: mockProvider,
      checkExternal: true,
    });

    assert(diag.localStatus === "PASS", "9.1. localStatus com CAIXA 503 CONTINUA PASS");
    assert(
      diag.external?.status === "UNAVAILABLE",
      "9.2. Status da CAIXA sob 503 = UNAVAILABLE"
    );
  }

  // 10. Teste da CAIXA: Offline (UNAVAILABLE)
  {
    const idb = new IDBFactory();
    const mockProvider = new MockLotteryProvider({ type: "network_offline" });

    const diag = await runSelfDiagnostic({
      idbFactory: idb,
      lotteryProvider: mockProvider,
      checkExternal: true,
    });

    assert(diag.localStatus === "PASS", "10.1. localStatus com dispositivo offline CONTINUA PASS");
    assert(
      diag.external?.status === "UNAVAILABLE",
      "10.2. Status da CAIXA offline = UNAVAILABLE"
    );
  }

  console.log(
    `=== FIM DOS TESTES DO AUTODIAGNÓSTICO: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("selfDiagnostic.test.ts")) {
  runSelfDiagnosticTests().then(({ failed }) => {
    if (failed > 0) process.exit(1);
  });
}
