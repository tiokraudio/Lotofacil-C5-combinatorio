/**
 * Bateria de testes de auditoria de integridade e detecção de adulteração em registros FROZEN.
 * Utiliza Web Crypto API nativa para recálculo de SHA-256.
 */
import { createContestDraft, freezeContestRecord } from "../record.ts";
import {
  computeSHA256,
  verifyContestIntegrity,
  buildCanonicalPayload,
  serializeCanonicalPayload,
} from "../integrity.ts";
import { createMulberry32 } from "../random.ts";
import { C5_SLOTS } from "../constants.ts";
import type { ContestRecord, Clock } from "../types.ts";

export async function runIntegrityTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("=== INICIANDO TESTES DE ADULTERAÇÃO E INTEGRIDADE (INTEGRITY.TEST) ===");

  // VETORES OFICIAIS NIST DE SHA-256 (Web Crypto)
  const emptyHash = await computeSHA256("");
  assert(
    emptyHash === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "NIST 1. Vetor oficial SHA-256('') confere exatamente com o padrão"
  );

  const abcHash = await computeSHA256("abc");
  assert(
    abcHash === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "NIST 2. Vetor oficial SHA-256('abc') confere exatamente com o padrão"
  );

  const fixedDate1 = new Date("2026-09-17T10:00:00.000Z");
  const fixedDate2 = new Date("2026-09-17T10:05:00.000Z");
  const clock1: Clock = () => fixedDate1;
  const clock2: Clock = () => fixedDate2;

  // Cria um registro FROZEN autêntico de referência
  const baseDraft = createContestDraft(3210, {
    rng: createMulberry32(777),
    clock: clock1,
    generationId: "auth-uuid-777",
  });
  const baseline = await freezeContestRecord(baseDraft, { clock: clock2 });

  // Confirmação de compatibilidade do payload canônico
  const payload = buildCanonicalPayload(
    baseline.contestNumber,
    baseline.generationId,
    baseline.algorithmVersion,
    baseline.generatedAt,
    baseline.frozenAt!,
    baseline.generation
  );
  const serialized = serializeCanonicalPayload(payload);
  const recomputedHash = await computeSHA256(serialized);
  assert(
    recomputedHash === baseline.integrityHash,
    "NIST 3. Cômputo Web Crypto preserva estritamente o hash canônico determinístico"
  );

  // 0. Confirmação do baseline autêntico
  const baseAudit = await verifyContestIntegrity(baseline);
  assert(
    baseAudit.valid && baseAudit.hashMatches && baseAudit.generationValid && baseAudit.errors.length === 0,
    "0. Baseline autêntico é 100% íntegro e válido"
  );

  // 1. Adulteração de contestNumber
  {
    const tampered: ContestRecord = {
      ...baseline,
      contestNumber: baseline.contestNumber + 1,
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "1. Adulteração de 'contestNumber' detectada com quebra de integridade",
      `stored: ${audit.storedHash.slice(0, 10)}..., calculated: ${audit.calculatedHash.slice(0, 10)}...`
    );
  }

  // 2. Adulteração de generationId
  {
    const tampered: ContestRecord = {
      ...baseline,
      generationId: "tampered-uuid-hacked",
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "2. Adulteração de 'generationId' detectada com quebra de integridade"
    );
  }

  // 3. Adulteração de algorithmVersion
  {
    const tampered: ContestRecord = {
      ...baseline,
      algorithmVersion: "C5-2.0.0-unauthorized",
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "3. Adulteração de 'algorithmVersion' detectada com quebra de integridade"
    );
  }

  // 4. Adulteração de generatedAt
  {
    const tampered: ContestRecord = {
      ...baseline,
      generatedAt: "2026-09-17T09:59:59.000Z",
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "4. Adulteração de 'generatedAt' detectada com quebra de integridade"
    );
  }

  // 5. Adulteração de frozenAt
  {
    const tampered: ContestRecord = {
      ...baseline,
      frozenAt: "2026-09-17T10:05:01.000Z",
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "5. Adulteração de 'frozenAt' detectada com quebra de integridade"
    );
  }

  // 6. Adulteração de permutation
  {
    const tamperedPermutation = [...baseline.generation.permutation];
    // Inverte duas dezenas na permutação
    const temp = tamperedPermutation[0];
    tamperedPermutation[0] = tamperedPermutation[1];
    tamperedPermutation[1] = temp;

    const tampered: ContestRecord = {
      ...baseline,
      generation: {
        ...baseline.generation,
        permutation: tamperedPermutation,
      },
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "6. Adulteração de 'permutation' detectada com quebra de integridade"
    );
  }

  // 7. Adulteração de slotAssignments
  {
    const tamperedSlots = { ...baseline.generation.slotAssignments };
    // Troca as dezenas de dois slots canônicos
    const s1 = C5_SLOTS[0];
    const s2 = C5_SLOTS[1];
    const temp = tamperedSlots[s1];
    tamperedSlots[s1] = tamperedSlots[s2];
    tamperedSlots[s2] = temp;

    const tampered: ContestRecord = {
      ...baseline,
      generation: {
        ...baseline.generation,
        slotAssignments: tamperedSlots,
      },
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && (!audit.hashMatches || !audit.generationValid),
      "7. Adulteração de 'slotAssignments' detectada com quebra de integridade e/ou invariante C5"
    );
  }

  // 8. Adulteração de games (alteração de uma única dezena no jogo J1)
  {
    const tamperedGames: [number[], number[], number[], number[], number[]] = [
      [...baseline.generation.games[0]],
      [...baseline.generation.games[1]],
      [...baseline.generation.games[2]],
      [...baseline.generation.games[3]],
      [...baseline.generation.games[4]],
    ];
    // Altera uma dezena em J1 (substituindo por dezena que não estava nele)
    const inJ1 = new Set(tamperedGames[0]);
    const notInJ1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
      .find((n) => !inJ1.has(n))!;
    tamperedGames[0][0] = notInJ1;
    tamperedGames[0].sort((a, b) => a - b);

    const tampered: ContestRecord = {
      ...baseline,
      generation: {
        ...baseline.generation,
        games: tamperedGames,
      },
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && (!audit.hashMatches || !audit.generationValid),
      "8. Adulteração em 'games' (dezenas) detectada com quebra de integridade e/ou invariante"
    );
  }

  // 9. Ausência de integrityHash
  {
    const tampered: ContestRecord = {
      ...baseline,
      integrityHash: undefined,
    };
    const audit = await verifyContestIntegrity(tampered);
    assert(
      !audit.valid && !audit.hashMatches,
      "9. Ausência de integrityHash resulta em rejeição de integridade"
    );
  }

  // 10. Tentativa de verificar integridade de um DRAFT
  {
    const draft = createContestDraft(3211, { rng: createMulberry32(888) });
    const audit = await verifyContestIntegrity(draft);
    assert(
      !audit.valid && audit.errors.some((e) => e.includes("Requer FROZEN ou SCORED")),
      "10. Auditoria recusa registro em estado DRAFT com mensagem explicativa"
    );
  }

  console.log(
    `=== FIM DOS TESTES DE INTEGRIDADE: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("integrity.test.ts")) {
  runIntegrityTests().then(({ failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
  });
}
