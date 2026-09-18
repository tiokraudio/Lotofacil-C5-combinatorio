/**
 * Teste massivo de robustez combinatória C₅.
 * Gera e valida independentemente 100.000 instâncias de C₅.
 * Critério obrigatório: 100.000 válidos, 0 inválidos.
 */
import { generateC5 } from "../generator.ts";
import { validateC5 } from "../validator.ts";
import { createMulberry32 } from "../random.ts";

export interface MassiveTestResult {
  total: number;
  valid: number;
  invalid: number;
  durationMs: number;
  ratePerSecond: number;
  firstFailure?: {
    index: number;
    errors: string[];
    permutation: number[];
  };
}

export function runMassiveTest(
  totalCount = 100_000,
  seed = 42
): MassiveTestResult {
  console.log(`=== INICIANDO TESTE MASSIVO DE ${totalCount.toLocaleString()} GERAÇÕES C₅ ===`);
  const rng = createMulberry32(seed);

  let valid = 0;
  let invalid = 0;
  let firstFailure: MassiveTestResult["firstFailure"] = undefined;

  const startTime = Date.now();
  const reportInterval = Math.max(1, Math.floor(totalCount / 5));

  for (let i = 1; i <= totalCount; i++) {
    const gen = generateC5(rng);
    const result = validateC5(gen);

    if (result.valid) {
      valid++;
    } else {
      invalid++;
      if (!firstFailure) {
        firstFailure = {
          index: i,
          errors: result.errors,
          permutation: gen.permutation,
        };
        console.error(
          `\n[FALHA DETECTADA NA GERAÇÃO ${i}]:\n` +
            result.errors.map((e) => ` - ${e}`).join("\n")
        );
        break;
      }
    }

    if (i % reportInterval === 0 || i === totalCount) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(i / (elapsed || 0.001));
      console.log(
        `  Progresso: ${i.toLocaleString()} / ${totalCount.toLocaleString()} (${Math.round((i / totalCount) * 100)}%) | ` +
          `Válidos: ${valid.toLocaleString()} | Inválidos: ${invalid} | Taxa: ${rate.toLocaleString()} gerações/s`
      );
    }
  }

  const totalDuration = Date.now() - startTime;
  const ratePerSecond = Math.round(totalCount / ((totalDuration || 1) / 1000));

  console.log("=== RESULTADO DO TESTE MASSIVO ===");
  console.log(`  Total Executado: ${totalCount.toLocaleString()}`);
  console.log(`  Total Válidos:   ${valid.toLocaleString()} (${((valid / totalCount) * 100).toFixed(2)}%)`);
  console.log(`  Total Inválidos: ${invalid}`);
  console.log(`  Tempo Total:     ${(totalDuration / 1000).toFixed(2)} s`);
  console.log(`  Taxa Média:      ${ratePerSecond.toLocaleString()} op/s`);
  console.log(`  Status:          ${invalid === 0 ? "APROVADO (0 falhas)" : "REPROVADO"}\n`);

  return {
    total: totalCount,
    valid,
    invalid,
    durationMs: totalDuration,
    ratePerSecond,
    firstFailure,
  };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("massive.test.ts")) {
  const result = runMassiveTest();
  if (result.invalid > 0) {
    process.exit(1);
  }
}
