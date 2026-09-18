/**
 * Bateria de testes do ciclo de vida, imutabilidade e transições do registro de concurso C₅.
 */
import {
  createContestDraft,
  freezeContestRecord,
  scoreFrozenContest,
  verifyScoreIntegrity,
} from "../record.ts";
import { verifyContestIntegrity } from "../integrity.ts";
import { createMulberry32 } from "../random.ts";
import { C5_ALGORITHM_VERSION } from "../version.ts";
import type { ContestRecord, Clock } from "../types.ts";

export async function runRecordTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("=== INICIANDO TESTES DO CICLO DE VIDA DO REGISTRO (RECORD.TEST) ===");

  const fixedDate1 = new Date("2026-09-17T10:00:00.000Z");
  const fixedDate2 = new Date("2026-09-17T10:05:00.000Z");
  const fixedDate3 = new Date("2026-09-17T20:30:00.000Z");

  const clock1: Clock = () => fixedDate1;
  const clock2: Clock = () => fixedDate2;
  const clock3: Clock = () => fixedDate3;

  // 1. Ciclo de Vida Completo: DRAFT -> FROZEN -> SCORED
  {
    const draft = createContestDraft(3200, {
      rng: createMulberry32(12345),
      clock: clock1,
      generationId: "a1111111-1111-4111-8111-111111111111",
    });

    const draftOk =
      draft.status === "DRAFT" &&
      draft.contestNumber === 3200 &&
      draft.generationId === "a1111111-1111-4111-8111-111111111111" &&
      draft.algorithmVersion === C5_ALGORITHM_VERSION &&
      draft.generatedAt === fixedDate1.toISOString() &&
      draft.frozenAt === undefined &&
      draft.integrityHash === undefined;

    assert(draftOk, "1.1. DRAFT criado com status correto, UUID e versão do algoritmo");

    const frozen = await freezeContestRecord(draft, { clock: clock2 });
    const frozenOk =
      frozen.status === "FROZEN" &&
      frozen.contestNumber === 3200 &&
      frozen.generationId === "a1111111-1111-4111-8111-111111111111" &&
      frozen.generatedAt === fixedDate1.toISOString() &&
      frozen.frozenAt === fixedDate2.toISOString() &&
      typeof frozen.integrityHash === "string" &&
      frozen.integrityHash.length === 64;

    assert(frozenOk, "1.2. FROZEN gerado com integridade, frozenAt e hash SHA-256 de 64 caracteres");

    const preScoreAudit = await verifyContestIntegrity(frozen);
    assert(
      preScoreAudit.valid && preScoreAudit.hashMatches && preScoreAudit.generationValid,
      "1.3. Auditoria de integridade do FROZEN passa com 100% de sucesso"
    );

    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scored = await scoreFrozenContest(frozen, officialResult, { clock: clock3 });
    const scoredOk =
      scored.status === "SCORED" &&
      scored.contestNumber === 3200 &&
      scored.generationId === "a1111111-1111-4111-8111-111111111111" &&
      scored.frozenAt === fixedDate2.toISOString() &&
      scored.scoredAt === fixedDate3.toISOString() &&
      scored.integrityHash === frozen.integrityHash &&
      scored.score !== undefined &&
      scored.officialResult !== undefined;

    assert(scoredOk, "1.4. Transição segura para SCORED preservando integridade, hash e geração");

    const postScoreGenAudit = await verifyContestIntegrity(scored);
    assert(
      postScoreGenAudit.valid && postScoreGenAudit.hashMatches,
      "1.5. Registro SCORED continua passando rigorosamente na auditoria de integridade da geração"
    );

    const scoreAudit = verifyScoreIntegrity(scored);
    assert(
      scoreAudit.valid && scoreAudit.scoreMatches && scoreAudit.officialResultValid,
      "1.6. Auditoria independente da pontuação (verifyScoreIntegrity) confirmada com sucesso"
    );
  }

  // 2. Testes de estados inválidos e transições ilegais
  {
    const draft = createContestDraft(3201, { rng: createMulberry32(111), clock: clock1 });
    const frozen = await freezeContestRecord(draft, { clock: clock2 });
    const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scored = await scoreFrozenContest(frozen, officialResult, { clock: clock3 });

    // 2.1 Congelar registro já FROZEN
    let err1 = false;
    try {
      await freezeContestRecord(frozen);
    } catch (e: any) {
      err1 = e.message.includes("apenas registros em estado DRAFT podem ser congelados");
    }
    assert(err1, "2.1. Rejeição ao tentar congelar registro já FROZEN");

    // 2.2 Congelar registro SCORED
    let err2 = false;
    try {
      await freezeContestRecord(scored);
    } catch (e: any) {
      err2 = e.message.includes("apenas registros em estado DRAFT podem ser congelados");
    }
    assert(err2, "2.2. Rejeição ao tentar congelar registro SCORED");

    // 2.3 Pontuar DRAFT diretamente
    let err3 = false;
    try {
      await scoreFrozenContest(draft, officialResult);
    } catch (e: any) {
      err3 = e.message.includes("apenas registros em estado FROZEN podem ser pontuados");
    }
    assert(err3, "2.3. Rejeição ao tentar pontuar registro em estado DRAFT");

    // 2.4 Pontuar SCORED novamente
    let err4 = false;
    try {
      await scoreFrozenContest(scored, officialResult);
    } catch (e: any) {
      err4 = e.message.includes("apenas registros em estado FROZEN podem ser pontuados");
    }
    assert(err4, "2.4. Rejeição ao tentar pontuar novamente registro já SCORED");

    // 2.5 Pontuar FROZEN com integridade adulterada
    let err5 = false;
    const tamperedFrozen: ContestRecord = {
      ...frozen,
      contestNumber: 9999, // adulterado
    };
    try {
      await scoreFrozenContest(tamperedFrozen, officialResult);
    } catch (e: any) {
      err5 = e.message.includes("Recusando pontuação: a integridade do registro congelado foi violada");
    }
    assert(err5, "2.5. Rejeição explícita ao tentar pontuar FROZEN com integridade violada");

    // 2.6 Criar concurso 0
    let err6 = false;
    try {
      createContestDraft(0);
    } catch (e: any) {
      err6 = e.message.includes("Número de concurso inválido");
    }
    assert(err6, "2.6. Rejeição de concurso 0");

    // 2.7 Criar concurso negativo
    let err7 = false;
    try {
      createContestDraft(-15);
    } catch (e: any) {
      err7 = e.message.includes("Número de concurso inválido");
    }
    assert(err7, "2.7. Rejeição de concurso negativo");

    // 2.8 Criar concurso decimal
    let err8 = false;
    try {
      createContestDraft(3201.5);
    } catch (e: any) {
      err8 = e.message.includes("Número de concurso inválido");
    }
    assert(err8, "2.8. Rejeição de concurso decimal");

    // 2.9 Criar concurso não numérico
    let err9 = false;
    try {
      createContestDraft("3201" as any);
    } catch (e: any) {
      err9 = e.message.includes("Número de concurso inválido");
    }
    assert(err9, "2.9. Rejeição de concurso não numérico");

    // 2.10 Congelar geração C5 corrompida
    let err10 = false;
    const draftCorrupt: ContestRecord = {
      ...createContestDraft(3202, { rng: createMulberry32(222) }),
      generation: {
        ...draft.generation,
        games: [
          [...draft.generation.games[0]].slice(0, 14), // corrompido
          [...draft.generation.games[1]],
          [...draft.generation.games[2]],
          [...draft.generation.games[3]],
          [...draft.generation.games[4]],
        ] as any,
      },
    };
    try {
      await freezeContestRecord(draftCorrupt);
    } catch (e: any) {
      err10 = e.message.includes("Tentativa de congelar geração com invariantes C5 violadas");
    }
    assert(err10, "2.10. Rejeição ao tentar congelar geração C5 matematicamente corrompida");
  }

  // 3. Testes de Imutabilidade
  {
    // A: Alterar DRAFT depois de congelar
    const draft = createContestDraft(3203, { rng: createMulberry32(333), clock: clock1 });
    const frozen = await freezeContestRecord(draft, { clock: clock2 });

    const originalJ1First = frozen.generation.games[0][0];
    const originalHash = frozen.integrityHash;

    // Mutamos o draft deliberadamente
    draft.generation.games[0][0] = 99;
    draft.generation.permutation[0] = 99;

    const frozenAudit = await verifyContestIntegrity(frozen);
    assert(
      frozen.generation.games[0][0] === originalJ1First &&
        frozen.integrityHash === originalHash &&
        frozenAudit.valid,
      "3.A. Imutabilidade: alterar DRAFT após freeze não afeta o registro FROZEN"
    );

    // B: Alterar array de officialResult após pontuação
    const resultInput = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scored = await scoreFrozenContest(frozen, resultInput, { clock: clock3 });

    // Mutamos o array de entrada externo
    resultInput[0] = 99;
    resultInput.push(100);

    const scoredResultUnchanged =
      scored.officialResult![0] === 1 &&
      scored.officialResult!.length === 15 &&
      verifyScoreIntegrity(scored).valid;

    assert(
      scoredResultUnchanged,
      "3.B. Imutabilidade: alterar array externo de resultado após score não afeta o registro SCORED"
    );

    // C: Alterar objeto retornado por verificação de integridade
    const auditObj = await verifyContestIntegrity(frozen);
    auditObj.errors.push("Fake error");
    (auditObj as any).valid = false;

    const secondAudit = await verifyContestIntegrity(frozen);
    assert(
      secondAudit.valid && secondAudit.errors.length === 0,
      "3.C. Imutabilidade: manipular resultado de auditoria anterior não contamina chamadas subsequentes"
    );
  }

  // 4. Determinismo do Hash SHA-256
  {
    const d1 = createContestDraft(3204, {
      rng: createMulberry32(444),
      clock: clock1,
      generationId: "fixed-uuid-hash-test",
    });
    const d2 = createContestDraft(3204, {
      rng: createMulberry32(444),
      clock: clock1,
      generationId: "fixed-uuid-hash-test",
    });

    const f1 = await freezeContestRecord(d1, { clock: clock2 });
    const f2 = await freezeContestRecord(d2, { clock: clock2 });

    const hashesMatch = f1.integrityHash === f2.integrityHash;

    // Se uma única dezena for trocada
    const d3 = createContestDraft(3204, {
      rng: createMulberry32(555), // semente diferente -> jogos diferentes
      clock: clock1,
      generationId: "fixed-uuid-hash-test",
    });
    const f3 = await freezeContestRecord(d3, { clock: clock2 });

    const differentHash = f1.integrityHash !== f3.integrityHash;

    assert(
      hashesMatch && differentHash,
      "4. Determinismo do SHA-256: idêntico com mesmos dados/timestamps, divergente se dezenas mudarem",
      `Hash: ${f1.integrityHash}`
    );
  }

  console.log(
    `=== FIM DOS TESTES DE REGISTRO: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("record.test.ts")) {
  runRecordTests().then(({ failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
  });
}
