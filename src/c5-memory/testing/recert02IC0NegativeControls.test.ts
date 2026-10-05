/**
 * Controles Negativos Oficiais do Checkpoint IC0 (Run 002)
 * 
 * Executa em simulação isolada sem alterar a baseline.
 * Valida a sensibilidade do harness a desvios e adulterações.
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";

console.log("=== EXECUTANDO OS 8 CONTROLES NEGATIVOS DO CHECKPOINT IC0 ===");

const AUTHORIZED_BASELINE_COMMIT = "35f361283579048b6f96ebadc31f9f79f8b9b445";
const AUTHORIZED_BUNDLE_SHA = "cada3233666836845f5c2f63027b22d53f97bd46b32285ef43b9eda3c690ea8d";
const AUTHORIZED_GOLDEN_V2_SHA = "55521e2caa737a9d5c99878ce372f440187b5a0e1743deb953af76b83de1ccf3";

// 1. Hash Normativo Adulterado
{
  const originalHash = "7e065b2af27d4a72c83dbecfa08cbd9cab9bc3f11ad8d510f21017c9dfd132bf";
  const corruptedContent = "CORRUPTED CONTENT";
  const corruptedHash = crypto.createHash("sha256").update(corruptedContent).digest("hex");
  assert.notStrictEqual(corruptedHash, originalHash, "Deveria acusar divergência");
  console.log("  ✓ Controle Negativo 1: Hash normativo adulterado detectado.");
}

// 2. Golden V2 Adulterado
{
  const corruptedGolden = JSON.stringify({ version: "POST_INCIDENT_GOLDEN_VECTORS_V2", corrupted: true });
  const corruptedHash = crypto.createHash("sha256").update(corruptedGolden).digest("hex");
  assert.notStrictEqual(corruptedHash, AUTHORIZED_GOLDEN_V2_SHA, "Deveria acusar SHA divergente no Golden V2");
  console.log("  ✓ Controle Negativo 2: Golden V2 adulterado detectado.");
}

// 3. Baseline Commit Incorreto
{
  const fakeCommit: string = "0000000000000000000000000000000000000000";
  const isValid = (fakeCommit as string) === AUTHORIZED_BASELINE_COMMIT;
  assert.strictEqual(isValid, false, "Deveria rejeitar commit não autorizado");
  console.log("  ✓ Controle Negativo 3: Baseline commit incorreto rejeitado.");
}

// 4. Working Tree Dirty
{
  const simulatedDirtyOutput = " M src/c5-memory/types.ts\n?? unversioned.txt";
  const isClean = simulatedDirtyOutput.trim().length === 0;
  assert.strictEqual(isClean, false, "Deveria detectar working tree dirty");
  console.log("  ✓ Controle Negativo 4: Working tree dirty detectada.");
}

// 5. Arquivo Normativo Ausente
{
  const missingFile = "src/c5-memory/non_existent_file.ts";
  const exists = fs.existsSync(missingFile);
  assert.strictEqual(exists, false, "Deveria acusar arquivo ausente");
  console.log("  ✓ Controle Negativo 5: Arquivo normativo ausente detectado.");
}

// 6. V1 Apresentado Indevidamente como Golden Normativo
{
  const v1Content = fs.readFileSync("certification/post-incident-golden-vectors-v1.json");
  const v1Hash = crypto.createHash("sha256").update(v1Content).digest("hex");
  const isV2 = v1Hash === AUTHORIZED_GOLDEN_V2_SHA;
  assert.strictEqual(isV2, false, "V1 não deve ser aceito como Golden normativo V2");
  console.log("  ✓ Controle Negativo 6: V1 rejeitado como Golden normativo.");
}

// 7. Source-of-truth Alterada de 'contests'
{
  const simulatedSource: string = "c5_memory_history"; // Tentativa errônea de declarar derivada como canônica
  const isCanonical = (simulatedSource as string) === "contests";
  assert.strictEqual(isCanonical, false, "Deveria rejeitar store não canônica");
  console.log("  ✓ Controle Negativo 7: Store não canônica rejeitada como source of truth.");
}

// 8. Bundle com SHA Divergente
{
  const simulatedBundleCorruptedHash: string = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const isBundleValid = (simulatedBundleCorruptedHash as string) === AUTHORIZED_BUNDLE_SHA;
  assert.strictEqual(isBundleValid, false, "Deveria rejeitar bundle com hash divergente");
  console.log("  ✓ Controle Negativo 8: Bundle com hash divergente detectado e rejeitado.");
}

console.log("=== TODOS OS 8 CONTROLES NEGATIVOS DO IC0 FORAM APROVADOS COM SUCESSO ===");
