/**
 * Script de Materialização Dupla Independente e Promoção do Golden V3
 * Ordem Executiva IC1-R2
 */

import assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateGoldenVectorsV3 } from "./generatePostIncidentGoldenVectorsV3";

console.log("=== INICIANDO MATERIALIZAÇÃO DUPLA INDEPENDENTE DO GOLDEN V3 ===");

// 1. Processo A
console.log("Executando V3_GENERATION_A...");
const docA = generateGoldenVectorsV3();
const jsonA = JSON.stringify(docA, null, 2);
const tmpA = "/tmp/golden-v3-a.json";
fs.writeFileSync(tmpA, jsonA, "utf-8");
const hashA = crypto.createHash("sha256").update(fs.readFileSync(tmpA)).digest("hex");

// 2. Processo B
console.log("Executando V3_GENERATION_B...");
const docB = generateGoldenVectorsV3();
const jsonB = JSON.stringify(docB, null, 2);
const tmpB = "/tmp/golden-v3-b.json";
fs.writeFileSync(tmpB, jsonB, "utf-8");
const hashB = crypto.createHash("sha256").update(fs.readFileSync(tmpB)).digest("hex");

// 3. Comparação Byte a Byte e SHA-256
const isByteIdentical = jsonA === jsonB;
const isShaIdentical = hashA === hashB;

console.log(`V3_A_EQ_V3_B = ${isByteIdentical ? "YES" : "NO"}`);
console.log(`V3_SHA_A_EQ_SHA_B = ${isShaIdentical ? "YES" : "NO"}`);

assert.strictEqual(isByteIdentical, true, "V3_A e V3_B devem ser byte-idênticos");
assert.strictEqual(isShaIdentical, true, "SHA de V3_A e V3_B devem coincidir 100%");

// 4. Validação Rigorosa de Regex para todos os SHA-256
const shaRegex = /^[0-9a-f]{64}$/;
for (const m of docA.milestones) {
  assert(shaRegex.test(m.historyFingerprint), `historyFingerprint de H${m.milestoneIndex} deve ser SHA-256 canônico de 64 hex`);
  assert(shaRegex.test(m.poolMasterSeed), `poolMasterSeed de H${m.milestoneIndex} deve ser SHA-256 canônico de 64 hex`);
  assert(shaRegex.test(m.frozenPayloadSha256), `frozenPayloadSha256 de H${m.milestoneIndex} deve ser SHA-256 canônico de 64 hex`);
}
console.log("FULL_SHA256_VALIDATION = PASS (Todos os hashes obedecem estritamente a ^[0-9a-f]{64}$)");

// 5. Promoção Oficial para o Destino Normativo
const targetFile = path.resolve("certification/post-incident-golden-vectors-v3.json");
fs.writeFileSync(targetFile, jsonA, "utf-8");

const finalBytes = fs.readFileSync(targetFile);
const finalSha256 = crypto.createHash("sha256").update(finalBytes).digest("hex");
const finalByteLength = finalBytes.length;

// Limpeza dos arquivos temporários
fs.unlinkSync(tmpA);
fs.unlinkSync(tmpB);

console.log(`\nArquivo normativo criado com sucesso: ${targetFile}`);
console.log(`GOLDEN_V3_SHA256 = ${finalSha256}`);
console.log(`GOLDEN_V3_BYTES = ${finalByteLength}`);
console.log("=== MATERIALIZAÇÃO DUPLA E PROMOÇÃO CONCLUÍDAS COM SUCESSO ===");
