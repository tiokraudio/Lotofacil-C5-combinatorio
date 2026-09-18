/**
 * Testes do Manifesto de Integridade Canônica C₅ (Versão 1.1).
 */
import {
  APPLICATION_MANIFEST,
  APP_VERSION,
  APP_NAME,
} from "../manifest.ts";
import { C5_ALGORITHM_VERSION } from "../../c5/version.ts";
import { C5_SLOTS } from "../../c5/constants.ts";
import fs from "fs";
import path from "path";

export function runManifestTests(): { passed: number; failed: number } {
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

  console.log("=== INICIANDO TESTES DO MANIFESTO E ARQUITETURA (MANIFEST.TEST) ===");

  // 1. Verificações de versão
  assert(APP_VERSION === "1.4.0", "1.1. APP_VERSION congelada exatamente em '1.4.0'");
  assert(
    C5_ALGORITHM_VERSION === "C5-1.0.0",
    "1.2. C5_ALGORITHM_VERSION congelada exatamente em 'C5-1.0.0'"
  );
  assert(
    APPLICATION_MANIFEST.appVersion === "1.4.0",
    "1.3. Manifesto reflete appVersion 1.4.0"
  );
  assert(
    APPLICATION_MANIFEST.algorithmVersion === "C5-1.0.0",
    "1.4. Manifesto reflete algorithmVersion C5-1.0.0"
  );
  assert(
    APPLICATION_MANIFEST.appName === APP_NAME,
    "1.5. Manifesto reflete nome oficial da aplicação"
  );

  // 2. Verificação de slots canônicos
  assert(
    APPLICATION_MANIFEST.canonicalSlots === C5_SLOTS,
    "2.1. Manifesto referencia os 25 slots canônicos da fonte certificada única"
  );
  assert(
    APPLICATION_MANIFEST.canonicalSlots.length === 25,
    "2.2. Total exato de 25 slots canônicos no manifesto"
  );

  // 3. Certificados estruturais
  const certs = APPLICATION_MANIFEST.structuralCertificates;
  assert(certs.gameCount === 5, "3.1. Certificado: gameCount = 5");
  assert(certs.gameSize === 15, "3.2. Certificado: gameSize = 15");
  assert(certs.numbers === 25, "3.3. Certificado: numbers = 25");
  assert(
    certs.occurrencesPerNumber === 3,
    "3.4. Certificado: occurrencesPerNumber = 3"
  );
  assert(
    certs.totalCombinations === 3_268_760,
    "3.5. Certificado: totalCombinations = 3.268.760"
  );
  assert(certs.coverage11Plus === 1_626_630, "3.6. Certificado: coverage11Plus = 1.626.630");
  assert(certs.coverage12Plus === 297_380, "3.7. Certificado: coverage12Plus = 297.380");
  assert(certs.coverage13Plus === 24_380, "3.8. Certificado: coverage13Plus = 24.380");
  assert(certs.coverage14Plus === 755, "3.9. Certificado: coverage14Plus = 755");
  assert(certs.coverage15 === 5, "3.10. Certificado: coverage15 = 5");

  const expectedIntersections = [7, 7, 7, 7, 7, 8, 8, 8, 8, 8];
  const intersectionsMatch =
    certs.pairwiseIntersections.length === 10 &&
    certs.pairwiseIntersections.every((v, i) => v === expectedIntersections[i]);
  assert(
    intersectionsMatch,
    "3.11. Certificado: pairwiseIntersections = [7,7,7,7,7,8,8,8,8,8]"
  );

  // 4. Checagem arquitetural: Módulos em src/c5/ NUNCA importam src/system/
  const c5Dir = path.resolve(process.cwd(), "src/c5");
  const c5Files = fs
    .readdirSync(c5Dir)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."));

  let c5ImportsSystem = false;
  const violatingFiles: string[] = [];

  for (const file of c5Files) {
    const content = fs.readFileSync(path.join(c5Dir, file), "utf-8");
    if (content.includes("/system") || content.includes("../system")) {
      c5ImportsSystem = true;
      violatingFiles.push(file);
    }
  }

  assert(
    !c5ImportsSystem,
    "4.1. Arquitetura estrita: nenhum módulo em src/c5 importa src/system",
    violatingFiles.join(", ")
  );

  // 5. Checagem de builder único no projeto
  // Apenas src/c5/canonicalBuilder.ts deve implementar a lógica rawGames.push(num) a partir de getPresentGameIndices
  const srcDir = path.resolve(process.cwd(), "src");
  function findFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        files.push(...findFiles(full));
      } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
    return files;
  }

  const allFiles = findFiles(srcDir);
  const builderImplementations: string[] = [];

  for (const file of allFiles) {
    const rel = path.relative(process.cwd(), file);
    if (rel === "src/system/tests/manifest.test.ts") continue;
    const content = fs.readFileSync(file, "utf-8");
    // Procuramos a lógica canônica de inserção dos 3 jogos a partir de getPresentGameIndices
    if (
      content.includes("getPresentGameIndices") &&
      content.includes("rawGames[gA].push")
    ) {
      builderImplementations.push(rel);
    }
  }

  assert(
    builderImplementations.length === 1 &&
      builderImplementations[0] === "src/c5/canonicalBuilder.ts",
    "5.1. Builder canônico único: exatamente 1 implementação no projeto inteiro",
    `Encontrado em: ${builderImplementations.join(", ")}`
  );

  console.log(
    `=== FIM DOS TESTES DO MANIFESTO: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("manifest.test.ts")) {
  const { failed } = runManifestTests();
  if (failed > 0) process.exit(1);
}
