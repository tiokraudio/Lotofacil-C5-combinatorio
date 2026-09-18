/**
 * Bateria de testes unitários e negativos para o módulo scorerC5.
 */
import { generateC5 } from "../generator.ts";
import { validateC5 } from "../validator.ts";
import { scoreC5, validateOfficialResult } from "../scorer.ts";
import { createMulberry32 } from "../random.ts";
import type { C5Generation, HitCount } from "../types.ts";

export function runScorerUnitTests(): { passed: number; failed: number } {
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

  console.log("=== INICIANDO TESTES DO SCORER (UNITÁRIOS E NEGATIVOS) ===");

  const seed = 54321;
  const validGen = generateC5(createMulberry32(seed));
  const validSampleResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  // 1. Resultado com 14 dezenas
  {
    let threw = false;
    try {
      scoreC5(validGen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    } catch (e: any) {
      threw = e.message.includes("deve conter exatamente 15 dezenas");
    }
    assert(threw, "1. Resultado com 14 dezenas rejeitado com erro explícito");
  }

  // 2. Resultado com 16 dezenas
  {
    let threw = false;
    try {
      scoreC5(validGen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    } catch (e: any) {
      threw = e.message.includes("deve conter exatamente 15 dezenas");
    }
    assert(threw, "2. Resultado com 16 dezenas rejeitado com erro explícito");
  }

  // 3. Resultado contendo 0
  {
    let threw = false;
    try {
      scoreC5(validGen, [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    } catch (e: any) {
      threw = e.message.includes("fora do domínio 1..25");
    }
    assert(threw, "3. Resultado contendo 0 rejeitado com erro explícito");
  }

  // 4. Resultado contendo 26
  {
    let threw = false;
    try {
      scoreC5(validGen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26]);
    } catch (e: any) {
      threw = e.message.includes("fora do domínio 1..25");
    }
    assert(threw, "4. Resultado contendo 26 rejeitado com erro explícito");
  }

  // 5. Resultado com decimal
  {
    let threw = false;
    try {
      scoreC5(validGen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15.5]);
    } catch (e: any) {
      threw = e.message.includes("não é um número inteiro");
    }
    assert(threw, "5. Resultado contendo decimal rejeitado com erro explícito");
  }

  // 6. Resultado com duplicata
  {
    let threw = false;
    try {
      scoreC5(validGen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14]);
    } catch (e: any) {
      threw = e.message.includes("está duplicada no resultado");
    }
    assert(threw, "6. Resultado com dezenas duplicadas rejeitado com erro explícito");
  }

  // 7. Geração C5 inválida enviada ao scorer
  {
    let threw = false;
    const corruptGen: C5Generation = {
      permutation: [...validGen.permutation],
      slotAssignments: { ...validGen.slotAssignments },
      games: [
        [...validGen.games[0]].slice(0, 14), // corrompido para 14 dezenas
        [...validGen.games[1]],
        [...validGen.games[2]],
        [...validGen.games[3]],
        [...validGen.games[4]],
      ] as any,
    };
    try {
      scoreC5(corruptGen, validSampleResult);
    } catch (e: any) {
      threw = e.message.includes("Geração C5 inválida fornecida para pontuação");
    }
    assert(threw, "7. Geração C5 inválida recusada pelo scorer antes da pontuação");
  }

  // 8. Empate de maxHits
  {
    // Construímos um resultado customizado a partir dos jogos para forçar empate conhecido
    // J1 e J2 têm interseção de 8 dezenas (pois são ciclo C5).
    // Se escolhermos as 8 dezenas da interseção J1∩J2 + 3 de J1 + 3 de J2 + 1 de fora,
    // J1 e J2 terão 11 acertos cada!
    const j1 = new Set(validGen.games[0]);
    const j2 = new Set(validGen.games[1]);
    const common12 = validGen.games[0].filter((n) => j2.has(n)); // 8 dezenas
    const onlyJ1 = validGen.games[0].filter((n) => !j2.has(n)); // 7 dezenas
    const onlyJ2 = validGen.games[1].filter((n) => !j1.has(n)); // 7 dezenas
    const neither = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
      .filter((n) => !j1.has(n) && !j2.has(n));

    // Resultado: 8 comuns + 3 de J1 + 3 de J2 + 1 de neither = 15 dezenas
    // J1 terá 8 + 3 = 11 acertos
    // J2 terá 8 + 3 = 11 acertos
    const tieResult = [
      ...common12,
      onlyJ1[0], onlyJ1[1], onlyJ1[2],
      onlyJ2[0], onlyJ2[1], onlyJ2[2],
      neither[0],
    ];

    const score = scoreC5(validGen, tieResult);
    const hasTie =
      score.maxHits === 11 &&
      score.bestGameIndexes.includes(1) &&
      score.bestGameIndexes.includes(2) &&
      score.bestGameIndexes.length >= 2;

    assert(
      hasTie,
      "8. Empate de maxHits identificado corretamente em bestGameIndexes",
      `maxHits=${score.maxHits}, bestGameIndexes=[${score.bestGameIndexes.join(",")}]`
    );
  }

  // 9. Teste matemático de jackpot usando J1 como resultado
  {
    const j1Result = [...validGen.games[0]];
    const jackpotScore = scoreC5(validGen, j1Result);

    const j1Hits = jackpotScore.games[0].hits;
    const j2Hits = jackpotScore.games[1].hits;
    const j3Hits = jackpotScore.games[2].hits;
    const j4Hits = jackpotScore.games[3].hits;
    const j5Hits = jackpotScore.games[4].hits;

    // Pela geometria C5 canônica:
    // J1∩J2 é ciclo: 8
    // J1∩J3 é diagonal: 7
    // J1∩J4 é diagonal: 7
    // J1∩J5 é ciclo: 8
    const exactIntersectionsMatch =
      j1Hits === 15 &&
      j2Hits === 8 &&
      j3Hits === 7 &&
      j4Hits === 7 &&
      j5Hits === 8;

    const jackpotFlagsMatch =
      jackpotScore.maxHits === 15 &&
      jackpotScore.has15 === true &&
      jackpotScore.has14Plus === true &&
      jackpotScore.has13Plus === true &&
      jackpotScore.has12Plus === true &&
      jackpotScore.has11Plus === true &&
      jackpotScore.prizeCounts.hits15 === 1 &&
      jackpotScore.bestGameIndexes.length === 1 &&
      jackpotScore.bestGameIndexes[0] === 1;

    assert(
      exactIntersectionsMatch && jackpotFlagsMatch,
      "9. Jackpot test usando J1: 15 acertos em J1, [8, 7, 7, 8] nos demais e flags certificadas",
      `Hits: J1=${j1Hits}, J2=${j2Hits}, J3=${j3Hits}, J4=${j4Hits}, J5=${j5Hits}`
    );
  }

  // 10. Coerência de matchedNumbers
  {
    const score = scoreC5(validGen, validSampleResult);
    const resultSet = new Set(validSampleResult);
    let allMatchedValid = true;

    for (const g of score.games) {
      if (g.matchedNumbers.length !== g.hits) allMatchedValid = false;
      for (const n of g.matchedNumbers) {
        if (!resultSet.has(n)) allMatchedValid = false;
        if (!validGen.games[g.gameIndex - 1].includes(n)) allMatchedValid = false;
      }
    }

    assert(
      allMatchedValid,
      "10. Coerência estrita de matchedNumbers (tamanho === hits e pertinência)"
    );
  }

  // 11. Coerência de missedNumbers
  {
    const score = scoreC5(validGen, validSampleResult);
    const resultSet = new Set(validSampleResult);
    let allMissedValid = true;

    for (const g of score.games) {
      if (g.matchedNumbers.length + g.missedNumbers.length !== 15) allMissedValid = false;
      for (const n of g.missedNumbers) {
        if (resultSet.has(n)) allMissedValid = false;
        if (!validGen.games[g.gameIndex - 1].includes(n)) allMissedValid = false;
      }
    }

    assert(
      allMissedValid,
      "11. Coerência estrita de missedNumbers (matched + missed === 15 e ausência no resultado)"
    );
  }

  // 12. Contagem correta de múltiplas premiações
  {
    // Construímos um resultado que pontua 12 em J1 e 11 em J2
    // A partir do jackpot de J1 (15 acertos em J1, 8 em J2),
    // trocamos 3 dezenas de J1 por dezenas que pertençam a J2 mas não a J1:
    // J1∩J2 tem 8 dezenas.
    // J1 tem 7 dezenas exclusivas.
    // J2 tem 7 dezenas exclusivas.
    // Se no resultado mantivermos as 8 comuns + 4 de J1 exclusivas + 3 de J2 exclusivas:
    // J1 terá 8 + 4 = 12 acertos.
    // J2 terá 8 + 3 = 11 acertos.
    const j1 = new Set(validGen.games[0]);
    const j2 = new Set(validGen.games[1]);
    const common = validGen.games[0].filter((n) => j2.has(n)); // 8 dezenas
    const only1 = validGen.games[0].filter((n) => !j2.has(n)); // 7 dezenas
    const only2 = validGen.games[1].filter((n) => !j1.has(n)); // 7 dezenas

    const multiPrizeResult = [
      ...common, // 8
      only1[0], only1[1], only1[2], only1[3], // 4 -> total J1 = 12
      only2[0], only2[1], only2[2], // 3 -> total J2 = 11
    ];

    const score = scoreC5(validGen, multiPrizeResult);
    const prizeMatches =
      score.games[0].hits === 12 &&
      score.games[1].hits === 11 &&
      score.prizeCounts.hits12 >= 1 &&
      score.prizeCounts.hits11 >= 1 &&
      score.has12Plus === true &&
      score.has11Plus === true;

    assert(
      prizeMatches,
      "12. Contagem correta de múltiplas premiações (ex: 12 em J1 e 11 em J2 simultaneamente)"
    );
  }

  console.log(
    `=== FIM DOS TESTES DO SCORER: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("scorer.test.ts")) {
  const { failed } = runScorerUnitTests();
  if (failed > 0) {
    process.exit(1);
  }
}
