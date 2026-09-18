/**
 * Bateria de Testes Unitários do Validador de Domínio e Adapter da CAIXA (Prompt 07)
 */
import {
  validateAndNormalizeOfficialResult,
  assertValidOfficialResult,
} from "../validator.ts";
import { adaptCaixaRawPayload } from "../caixaProvider.ts";
import { LotteryFetchError } from "../types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runValidatorTests(): Promise<void> {
  console.log("=== INICIANDO TESTES UNITÁRIOS DO VALIDADOR LOTOFÁCIL (VALIDATOR.TEST) ===");

  // Modelo de domínio puro com numbers: number[]
  const validDomainBaseline = {
    contestNumber: 3781,
    drawDate: "16/09/2026",
    numbers: [
      19, 16, 3, 8, 5,
      6, 13, 9, 11, 12,
      25, 21, 7, 22, 24,
    ],
  };

  // Payload bruto típico retornado pela CAIXA com listaDezenas: string[]
  const rawCaixaBaseline = {
    numero: 3781,
    dataApuracao: "16/09/2026",
    numeroConcursoProximo: 3782,
    dataProximoConcurso: "17/09/2026",
    acumulado: true,
    listaDezenas: [
      "19", "16", "03", "08", "05",
      "06", "13", "09", "11", "12",
      "25", "21", "07", "22", "24",
    ],
  };

  // 1. ✓ Resultado válido de domínio
  {
    const res = validateAndNormalizeOfficialResult(validDomainBaseline);
    assert(res.valid === true, "1. Resultado válido de domínio deve ser aprovado.");
    if (res.valid) {
      assert(res.data.contestNumber === 3781, "1. ContestNumber 3781 correto.");
      assert(res.data.drawDate === "16/09/2026", "1. DrawDate 16/09/2026 correto.");
      assert(res.data.numbers.length === 15, "1. Contém 15 dezenas.");
      const isSorted = res.data.numbers.every((v, i, a) => i === 0 || a[i - 1] < v);
      assert(isSorted, "1. Dezenas ordenadas estritamente em ordem crescente.");
      assert(res.data.numbers[0] === 3 && res.data.numbers[14] === 25, "1. Primeira e última dezena corretas.");
      assert(typeof res.data.fetchedAt === "string", "1. fetchedAt presente.");
    }
    console.log("  ✓ [PASS] 1. Resultado válido de domínio aprovado e normalizado com ordenação.");
  }

  // 2. ✗ 14 dezenas (insuficiente)
  {
    const payload = {
      ...validDomainBaseline,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.code === "INVALID_PAYLOAD", "2. 14 dezenas deve ser rejeitado.");
    console.log("  ✓ [PASS] 2. Payload com 14 dezenas rejeitado.");
  }

  // 3. ✗ 16 dezenas (excedente)
  {
    const payload = {
      ...validDomainBaseline,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.code === "INVALID_PAYLOAD", "3. 16 dezenas deve ser rejeitado.");
    console.log("  ✓ [PASS] 3. Payload com 16 dezenas rejeitado.");
  }

  // 4. ✗ Duplicata
  {
    const payload = {
      ...validDomainBaseline,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.error.includes("duplicadas"), "4. Dezenas duplicadas devem ser rejeitadas.");
    console.log("  ✓ [PASS] 4. Payload com dezenas duplicadas rejeitado.");
  }

  // 5. ✗ Zero (dezena 0)
  {
    const payload = {
      ...validDomainBaseline,
      numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.error.includes("fora do intervalo"), "5. Dezena 0 deve ser rejeitada.");
    console.log("  ✓ [PASS] 5. Payload contendo dezena 0 rejeitado.");
  }

  // 6. ✗ 26 (dezena fora do domínio 1..25)
  {
    const payload = {
      ...validDomainBaseline,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.error.includes("fora do intervalo"), "6. Dezena 26 deve ser rejeitada.");
    console.log("  ✓ [PASS] 6. Payload contendo dezena 26 rejeitado.");
  }

  // 7. ✗ Dezena decimal (não inteira)
  {
    const payload = {
      ...validDomainBaseline,
      numbers: [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.error.includes("não é um número inteiro"), "7. Dezena decimal deve ser rejeitada.");
    console.log("  ✓ [PASS] 7. Payload contendo dezena decimal rejeitado.");
  }

  // 8. ✗ String no validador de domínio (rejeição estrita de string)
  {
    const payload = {
      ...validDomainBaseline,
      numbers: ["03", 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    };
    const res = validateAndNormalizeOfficialResult(payload);
    assert(!res.valid && res.error.includes("exige números inteiros, mas recebeu string"), "8. Validador de domínio deve rejeitar strings.");
    console.log("  ✓ [PASS] 8. Validador de domínio rejeita estritamente strings.");
  }

  // 9. ✗ Concurso 0 ou negativo
  {
    const resZero = validateAndNormalizeOfficialResult({ ...validDomainBaseline, contestNumber: 0 });
    assert(!resZero.valid && resZero.error.includes("estritamente positivo"), "9. Concurso 0 deve ser rejeitado.");
    const resNeg = validateAndNormalizeOfficialResult({ ...validDomainBaseline, contestNumber: -10 });
    assert(!resNeg.valid && resNeg.error.includes("estritamente positivo"), "9. Concurso negativo deve ser rejeitado.");
    console.log("  ✓ [PASS] 9. Concurso 0 e negativo rejeitados.");
  }

  // 10. ✗ Concurso decimal
  {
    const resDec = validateAndNormalizeOfficialResult({ ...validDomainBaseline, contestNumber: 3781.5 });
    assert(!resDec.valid && resDec.error.includes("estritamente positivo"), "10. Concurso decimal deve ser rejeitado.");
    console.log("  ✓ [PASS] 10. Concurso decimal rejeitado.");
  }

  // 11. ✗ Concurso como string no modelo de domínio
  {
    const resStr = validateAndNormalizeOfficialResult({ ...validDomainBaseline, contestNumber: "3781" });
    assert(!resStr.valid && resStr.error.includes("deve ser numérico"), "11. Concurso string deve ser rejeitado.");
    console.log("  ✓ [PASS] 11. Concurso string rejeitado.");
  }

  // 12. ✗ Data inválida
  {
    const resBadDate = validateAndNormalizeOfficialResult({ ...validDomainBaseline, drawDate: "data-invalida" });
    assert(!resBadDate.valid && resBadDate.error.includes("inválida"), "12. Data inválida deve ser rejeitada.");
    console.log("  ✓ [PASS] 12. Data inválida rejeitada.");
  }

  // 13. ✗ Payload null ou undefined
  {
    const resNull = validateAndNormalizeOfficialResult(null);
    assert(!resNull.valid && resNull.error.includes("nulo"), "13. Payload null rejeitado.");
    const resUndef = validateAndNormalizeOfficialResult(undefined);
    assert(!resUndef.valid && resUndef.error.includes("indefinido"), "13. Payload undefined rejeitado.");
    console.log("  ✓ [PASS] 13. Payload null e undefined rejeitados.");
  }

  // 14. ✗ Array raiz
  {
    const resArray = validateAndNormalizeOfficialResult([1, 2, 3]);
    assert(!resArray.valid && resArray.error.includes("deve ser um objeto"), "14. Array na raiz rejeitado.");
    console.log("  ✓ [PASS] 14. Array raiz rejeitado.");
  }

  // 15. ✗ Campos ausentes
  {
    const resNoNum = validateAndNormalizeOfficialResult({ drawDate: "16/09/2026", numbers: validDomainBaseline.numbers });
    assert(!resNoNum.valid && resNoNum.error.includes("número do concurso ausente"), "15. Ausência de concurso rejeitada.");

    const resNoDezenas = validateAndNormalizeOfficialResult({ contestNumber: 3781, drawDate: "16/09/2026" });
    assert(!resNoDezenas.valid && resNoDezenas.error.includes("ausente ou não é um array"), "15. Ausência de dezenas rejeitada.");

    const resNoData = validateAndNormalizeOfficialResult({ contestNumber: 3781, numbers: validDomainBaseline.numbers });
    assert(!resNoData.valid && resNoData.error.includes("Data do sorteio está ausente"), "15. Ausência de data rejeitada.");
    console.log("  ✓ [PASS] 15. Campos ausentes rejeitados com especificidade.");
  }

  // 16. Proteção contra divergência de concurso (expectedContestNumber !== contestNumber)
  {
    const resMismatch = validateAndNormalizeOfficialResult(validDomainBaseline, 3782);
    assert(!resMismatch.valid, "16. Divergência de concurso detectada.");
    if (!resMismatch.valid) {
      assert(resMismatch.code === "CONTEST_MISMATCH", "16. Código CONTEST_MISMATCH.");
      assert(resMismatch.error.includes("solicitado o resultado do concurso 3782, porém a fonte externa retornou o concurso 3781"), "16. Mensagem de divergência clara.");
    }
    console.log("  ✓ [PASS] 16. Divergência entre concurso solicitado e retornado bloqueada.");
  }

  // 17. assertValidOfficialResult lança LotteryFetchError
  {
    let caught = false;
    try {
      assertValidOfficialResult({ contestNumber: -5 });
    } catch (e: any) {
      caught = true;
      assert(e instanceof LotteryFetchError, "17. Lança LotteryFetchError.");
      assert(e.code === "INVALID_PAYLOAD", "17. Código INVALID_PAYLOAD.");
    }
    assert(caught, "17. Exceção esperada lançada.");
    console.log("  ✓ [PASS] 17. assertValidOfficialResult lança LotteryFetchError estruturado.");
  }

  // 18. TESTE DO ADAPTER DA CAIXA (adaptCaixaRawPayload)
  // Converte explicitamente listaDezenas: string[] ("03" -> 3, "25" -> 25) para numbers: number[]
  {
    const adapted = adaptCaixaRawPayload(rawCaixaBaseline);
    assert(typeof adapted === "object" && adapted !== null, "18. Adapter retorna objeto.");
    const normalized = assertValidOfficialResult(adapted, 3781, "CAIXA");
    assert(normalized.contestNumber === 3781, "18. Concurso 3781 normalizado.");
    assert(normalized.numbers.length === 15, "18. 15 dezenas numéricas.");
    assert(normalized.numbers[0] === 3, "18. '03' convertido para 3.");
    assert(normalized.numbers[14] === 25, "18. '25' convertido para 25.");
    assert(normalized.nextContestNumber === 3782, "18. nextContestNumber 3782 mapeado.");
    assert(normalized.source === "CAIXA", "18. source é CAIXA.");
    console.log("  ✓ [PASS] 18. Adapter da CAIXA converte '03' -> 3 e '25' -> 25 com sucesso.");
  }

  // 19. Adapter da CAIXA rejeita valores espúrios ("abc")
  {
    const badCaixaPayload = {
      ...rawCaixaBaseline,
      listaDezenas: [
        "19", "16", "abc", "08", "05",
        "06", "13", "09", "11", "12",
        "25", "21", "07", "22", "24",
      ],
    };
    const adapted = adaptCaixaRawPayload(badCaixaPayload);
    let rejected = false;
    try {
      assertValidOfficialResult(adapted, 3781, "CAIXA");
    } catch (e: any) {
      rejected = true;
      assert(e instanceof LotteryFetchError, "19. Rejeição esperada para dezena 'abc'.");
    }
    assert(rejected, "19. Dezena não numérica 'abc' foi rejeitada na validação.");
    console.log("  ✓ [PASS] 19. Adapter + Validador rejeitam strings não numéricas ('abc').");
  }

  console.log("=== TODOS OS 19 TESTES DO VALIDADOR E ADAPTER PASSARAM COM SUCESSO ===");
}

runValidatorTests().catch((err) => {
  console.error("Erro fatal nos testes do validador:", err);
  process.exit(1);
});
