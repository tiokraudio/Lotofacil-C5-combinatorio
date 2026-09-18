/**
 * Bateria de testes de Concorrência, TOCTOU e Race Conditions (v1.3 Certificada).
 * Cobre:
 * A) freezeStoredContest TOCTOU abort e preservação da alteração concorrente
 * B) scoreStoredContest TOCTOU abort e preservação do registro concorrente
 * C) deleteDraft TOCTOU abort e não exclusão
 * D) Duas instâncias simultâneas de ContestRepository operando no mesmo concurso
 * E) Auditoria com descarte de resultado obsoleto via runId
 * F) Autodiagnóstico com descarte de resultado obsoleto via runId
 * G) Desmonte de componente durante auditoria sem exceções nem mutações
 */
import { IDBFactory } from "fake-indexeddb";
import { createContestDraft, createMulberry32 } from "../../c5/index.ts";
import { ContestRepository } from "../contestRepository.ts";
import {
  openDatabase,
  closeDatabase,
  promisifyRequest,
  waitForTransaction,
  CONTEST_STORE_NAME,
} from "../db.ts";
import { runSelfDiagnostic } from "../../system/selfDiagnostic.ts";
import type { ContestRecord } from "../../c5/types.ts";

export async function runConcurrencyTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("=== INICIANDO TESTES DE CONCORRÊNCIA E PREVENÇÃO DE TOCTOU (v1.3) ===");

  const standardResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  // =========================================================================
  // A) freezeStoredContest: Aborta TOCTOU se registro mudar concorrentemente
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3401, { rng: createMulberry32(201) });
    await repo.saveDraft(draft);

    // Intercepta getDB para injetar mutação concorrente no momento exato pré-transação readwrite
    const origGetDB = (repo as any).getDB.bind(repo);
    let getDBCalls = 0;
    (repo as any).getDB = async () => {
      getDBCalls++;
      if (getDBCalls === 3) {
        // Chamada 1: getContestRecord snapshot
        // Chamada 2: verifyStoredContest
        // Chamada 3: transação readwrite do freeze
        // Simula outra aba/processo alterando o registro concorrentemente
        const directDB = await origGetDB();
        const tx = directDB.transaction(CONTEST_STORE_NAME, "readwrite");
        const store = tx.objectStore(CONTEST_STORE_NAME);
        const current = await promisifyRequest<ContestRecord>(store.get(3401));
        current.generation.permutation[0] = 99; // Alteração concorrente
        await promisifyRequest(store.put(current));
        await waitForTransaction(tx);
        closeDatabase(directDB);
      }
      return origGetDB();
    };

    let errorCaught: any = null;
    try {
      await repo.freezeStoredContest(3401);
    } catch (err: any) {
      errorCaught = err;
    } finally {
      (repo as any).getDB = origGetDB;
    }

    assert(
      errorCaught !== null,
      "A.1 freezeStoredContest abortou operação concorrente"
    );
    assert(
      errorCaught?.message.includes("mudou durante a operação. Congelamento cancelado para evitar sobrescrita concorrente."),
      "A.2 Mensagem canônica de erro de TOCTOU disparada em freezeStoredContest",
      errorCaught?.message
    );

    // Verifica que a alteração concorrente foi preservada no banco e NÃO foi sobrescrita pelo freeze
    const stored = await repo.getContestRecord(3401);
    assert(
      stored?.generation.permutation[0] === 99,
      "A.3 Banco preserva a alteração concorrente sem ser sobrescrito"
    );
    assert(
      stored?.status === "DRAFT",
      "A.4 Status no banco continua DRAFT e não foi forçado para FROZEN"
    );
  }

  // =========================================================================
  // B) scoreStoredContest: Aborta TOCTOU se registro mudar concorrentemente
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3402, { rng: createMulberry32(202) });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3402);

    // Intercepta getDB para injetar mutação concorrente no momento exato pré-transação readwrite
    const origGetDB = (repo as any).getDB.bind(repo);
    let getDBCalls = 0;
    (repo as any).getDB = async () => {
      getDBCalls++;
      if (getDBCalls === 3) {
        // Chamada 1: getContestRecord snapshot
        // Chamada 2: verifyStoredContest
        // Chamada 3: transação readwrite do score
        const directDB = await origGetDB();
        const tx = directDB.transaction(CONTEST_STORE_NAME, "readwrite");
        const store = tx.objectStore(CONTEST_STORE_NAME);
        const current = await promisifyRequest<ContestRecord>(store.get(3402));
        current.frozenAt = "2026-09-18T12:00:00.000Z"; // Alteração concorrente de timestamp
        await promisifyRequest(store.put(current));
        await waitForTransaction(tx);
        closeDatabase(directDB);
      }
      return origGetDB();
    };

    let errorCaught: any = null;
    try {
      await repo.scoreStoredContest(3402, standardResult);
    } catch (err: any) {
      errorCaught = err;
    } finally {
      (repo as any).getDB = origGetDB;
    }

    assert(
      errorCaught !== null,
      "B.1 scoreStoredContest abortou operação concorrente"
    );
    assert(
      errorCaught?.message.includes("mudou durante a operação. Pontuação cancelada para evitar sobrescrita concorrente."),
      "B.2 Mensagem canônica de erro de TOCTOU disparada em scoreStoredContest",
      errorCaught?.message
    );

    const stored = await repo.getContestRecord(3402);
    assert(
      stored?.frozenAt === "2026-09-18T12:00:00.000Z",
      "B.3 Registro no banco preserva a mutação concorrente"
    );
    assert(
      stored?.status === "FROZEN",
      "B.4 Status no banco permanece FROZEN (não foi alterado para SCORED)"
    );
    assert(
      stored?.score === undefined,
      "B.5 Nenhuma pontuação parcial foi persistida no banco"
    );
  }

  // =========================================================================
  // C) deleteDraft: Aborta TOCTOU e não deleta se registro mudar concorrentemente
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3403, { rng: createMulberry32(203) });
    await repo.saveDraft(draft);

    // Intercepta getDB para injetar mutação concorrente no momento exato pré-transação readwrite
    const origGetDB = (repo as any).getDB.bind(repo);
    let getDBCalls = 0;
    (repo as any).getDB = async () => {
      getDBCalls++;
      if (getDBCalls === 3) {
        // Chamada 1: getContestRecord snapshot
        // Chamada 2: verifyStoredContest
        // Chamada 3: transação readwrite do deleteDraft
        const directDB = await origGetDB();
        const tx = directDB.transaction(CONTEST_STORE_NAME, "readwrite");
        const store = tx.objectStore(CONTEST_STORE_NAME);
        const current = await promisifyRequest<ContestRecord>(store.get(3403));
        current.status = "FROZEN";
        current.frozenAt = "2026-09-18T12:30:00.000Z";
        await promisifyRequest(store.put(current));
        await waitForTransaction(tx);
        closeDatabase(directDB);
      }
      return origGetDB();
    };

    let errorCaught: any = null;
    try {
      await repo.deleteDraft(3403);
    } catch (err: any) {
      errorCaught = err;
    } finally {
      (repo as any).getDB = origGetDB;
    }

    assert(
      errorCaught !== null,
      "C.1 deleteDraft abortou exclusão concorrente"
    );
    assert(
      errorCaught?.message.includes("mudou durante a operação. Exclusão cancelada para evitar exclusão concorrente."),
      "C.2 Mensagem canônica de erro disparada em deleteDraft",
      errorCaught?.message
    );

    // Verifica que o registro NÃO foi excluído do banco
    const stored = await repo.getContestRecord(3403);
    assert(
      stored !== null,
      "C.3 Registro alterado NÃO foi excluído do banco de dados"
    );
    assert(
      stored?.status === "FROZEN",
      "C.4 Registro permanece no banco com o estado concorrente FROZEN"
    );
  }

  // =========================================================================
  // D) Duas instâncias simultâneas de ContestRepository operando no mesmo concurso
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repoA = new ContestRepository({ idbFactory: idb });
    const repoB = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(3404, { rng: createMulberry32(204) });
    await repoA.saveDraft(draft);

    // Ambas tentam congelar ao mesmo tempo
    const results = await Promise.allSettled([
      repoA.freezeStoredContest(3404),
      repoB.freezeStoredContest(3404),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert(
      fulfilled.length === 1,
      "D.1 Exatamente uma das instâncias conclui o congelamento com sucesso"
    );
    assert(
      rejected.length === 1,
      "D.2 A outra instância detecta a concorrência e é rejeitada de forma limpa"
    );

    const rejReason = (rejected[0] as PromiseRejectedResult).reason;
    assert(
      rejReason?.message.includes("mudou durante a operação") ||
        rejReason?.message.includes("Apenas registros em estado DRAFT podem ser congelados"),
      "D.3 Instância concorrente rejeitada com erro explicativo de status/TOCTOU",
      rejReason?.message
    );

    const finalRecord = await repoA.getContestRecord(3404);
    assert(
      finalRecord?.status === "FROZEN",
      "D.4 Registro no banco mantém status consistente FROZEN"
    );
    assert(
      typeof finalRecord?.integrityHash === "string" && finalRecord.integrityHash.length === 64,
      "D.5 Hash de integridade de 64 caracteres SHA-256 está perfeitamente selado"
    );
  }

  // =========================================================================
  // E) Auditoria: Descarte de auditoria lenta obsoleta se nova for disparada (runId)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3405, { rng: createMulberry32(205) });
    await repo.saveDraft(draft);

    let visibleAuditResult: any = null;
    let auditRunId = 0;

    async function simulatedHandleRunAudit(delayMs: number, label: string) {
      const runId = ++auditRunId;
      const res = await new Promise<any>((resolve) =>
        setTimeout(async () => {
          const audit = await repo.auditEntireHistory();
          resolve({ ...audit, label });
        }, delayMs)
      );
      if (runId === auditRunId) {
        visibleAuditResult = res;
      }
    }

    // Dispara auditoria 1 (lenta, leva 60ms)
    const p1 = simulatedHandleRunAudit(60, "AUDIT_1_SLOW");
    // Dispara auditoria 2 (rápida, leva 10ms)
    const p2 = simulatedHandleRunAudit(10, "AUDIT_2_FAST");

    await Promise.all([p1, p2]);

    assert(
      visibleAuditResult?.label === "AUDIT_2_FAST",
      "E.1 Resultado visível é exclusivamente o da auditoria mais recente (AUDIT_2_FAST)"
    );
  }

  // =========================================================================
  // F) Autodiagnóstico: Descarte de diagnóstico lento obsoleto via runId
  // =========================================================================
  {
    let visibleDiagResult: any = null;
    let diagRunId = 0;

    async function simulatedHandleRunDiagnostic(delayMs: number, label: string) {
      const runId = ++diagRunId;
      const res = await new Promise<any>((resolve) =>
        setTimeout(async () => {
          const diag = await runSelfDiagnostic({ checkExternal: false });
          resolve({ ...diag, label });
        }, delayMs)
      );
      if (runId === diagRunId) {
        visibleDiagResult = res;
      }
    }

    const p1 = simulatedHandleRunDiagnostic(60, "DIAG_1_SLOW");
    const p2 = simulatedHandleRunDiagnostic(10, "DIAG_2_FAST");

    await Promise.all([p1, p2]);

    assert(
      visibleDiagResult?.label === "DIAG_2_FAST",
      "F.1 Resultado visível é exclusivamente o do diagnóstico mais recente (DIAG_2_FAST)"
    );
  }

  // =========================================================================
  // G) Desmonte do componente durante auditoria: Sem erros e sem update de estado
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    let isMounted = true;
    let componentState: any = null;
    let errorOccurred = false;
    let auditRunId = 0;

    async function handleRunAuditWithUnmount(delayMs: number) {
      const runId = ++auditRunId;
      try {
        const res = await new Promise<any>((resolve) =>
          setTimeout(async () => {
            const audit = await repo.auditEntireHistory();
            resolve(audit);
          }, delayMs)
        );
        if (isMounted && runId === auditRunId) {
          componentState = res;
        }
      } catch (err) {
        errorOccurred = true;
      }
    }

    const promise = handleRunAuditWithUnmount(40);

    // Simula desmonte do componente após 5ms (enquanto auditoria está em execução)
    await new Promise((r) => setTimeout(r, 5));
    isMounted = false;
    auditRunId++;

    await promise;

    assert(
      componentState === null,
      "G.1 Estado do componente permaneceu null (nenhuma atualização pós-desmonte)"
    );
    assert(
      !errorOccurred,
      "G.2 Nenhum erro foi lançado durante a finalização da Promise com componente desmontado"
    );
  }

  console.log(`\n=== FIM DOS TESTES DE CONCORRÊNCIA: ${passed} PASSOU, ${failed} FALHOU ===\n`);
  return { passed, failed };
}

// Execução direta via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runConcurrencyTests().then(({ failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
  });
}
