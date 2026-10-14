/**
 * C5-MEMORY — INTEGRATION RUN 002
 * T3788 — OPERATIONAL READINESS CERTIFICATION R1.4
 *
 * Objetivo: certificar e auditar a infraestrutura de execução recuperável,
 * com foco na substituição da inspeção textual por VALIDAÇÃO ESTRUTURAL BINÁRIA
 * dos cabeçalhos TAR, baterias de testes negativos obrigatórios (symlink,
 * path traversal real, caminho absoluto, quebra de linha no nome, entradas duplicadas
 * e path traversal no manifesto), garantindo segurança absoluta antes de autorizar T3788.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as assert from "node:assert";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { execSync } from "node:child_process";
import {
  atomicWriteFile,
  cleanOrphanedTmpFiles,
  persistIncrementalStateCheckpoint,
  restoreResearchExecutionV2,
  EVIDENCE_BASE_DIR,
  TrajectoryEvidenceFile,
  computeSha256,
} from "../research/evidenceStore";
import {
  validateResearchProtocolV2Binding,
  FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
} from "../research/protocolValidator";
import {
  runSingleTrajectoryV2,
  acquireTrajectoryLock,
} from "../research/runDefinitiveResearchV2";
import { ResearchArmExecutor } from "../research/engine";
import {
  createRecoverableExecutionBackup,
  restoreRecoverableExecutionBackup,
  parseAndValidateTarEntries,
  serializeManifestForChecksum,
  verifyExternalBackupTransfer,
  BackupManifest,
} from "../research/backupStore";

export interface OperationalReadinessResultR14 {
  STRUCTURAL_TAR_VALIDATION: "PASS" | "FAIL";
  SYMLINK_REJECTED: "PASS" | "FAIL";
  REAL_PATH_TRAVERSAL_REJECTED: "PASS" | "FAIL";
  ABSOLUTE_PATH_REJECTED: "PASS" | "FAIL";
  NEWLINE_FILENAME_REJECTED: "PASS" | "FAIL";
  DUPLICATE_ENTRY_REJECTED: "PASS" | "FAIL";
  MANIFEST_PATH_TRAVERSAL_REJECTED: "PASS" | "FAIL";
  RESTORED_RESULT_EXACT_MATCH: "PASS" | "FAIL";
  T3788_EXECUTED: "NO";
  T3788_AUTHORIZED: "NO";
  IC11_STARTED: "NO";
}

/**
 * Construtor sintético de arquivos TAR.GZ binários para testes negativos.
 * Permite injetar metadados específicos de cabeçalho diretamente nos blocos de 512 bytes.
 */
function createSyntheticTarGz(
  entries: Array<{
    name: string;
    typeflag?: string;
    content?: Buffer | string;
    linkname?: string;
  }>
): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    const contentBuf = Buffer.isBuffer(entry.content)
      ? entry.content
      : typeof entry.content === "string"
      ? Buffer.from(entry.content, "utf-8")
      : Buffer.alloc(0);

    // Name (bytes 0..100)
    header.write(entry.name, 0, Math.min(100, Buffer.byteLength(entry.name)), "utf-8");
    // Mode (bytes 100..108)
    header.write("0000644\0", 100, 8, "ascii");
    // UID (bytes 108..116)
    header.write("0000000\0", 108, 8, "ascii");
    // GID (bytes 116..124)
    header.write("0000000\0", 116, 8, "ascii");
    // Size (bytes 124..136)
    const sizeOctal = contentBuf.length.toString(8).padStart(11, "0") + " ";
    header.write(sizeOctal, 124, 12, "ascii");
    // MTime (bytes 136..148)
    header.write("00000000000 ", 136, 12, "ascii");
    // Typeflag (byte 156)
    header.write(entry.typeflag || "0", 156, 1, "ascii");
    // Linkname (bytes 157..257)
    if (entry.linkname) {
      header.write(entry.linkname, 157, Math.min(100, Buffer.byteLength(entry.linkname)), "utf-8");
    }
    // Magic (bytes 257..263)
    header.write("ustar\0", 257, 6, "ascii");
    // Version (bytes 263..265)
    header.write("00", 263, 2, "ascii");

    // Checksum calculation (bytes 148..156)
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += header[i];
    }
    const chksumStr = sum.toString(8).padStart(6, "0") + "\0 ";
    header.write(chksumStr, 148, 8, "ascii");

    blocks.push(header);

    if (contentBuf.length > 0) {
      const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
      const dataBlock = Buffer.alloc(paddedSize, 0);
      contentBuf.copy(dataBlock, 0);
      blocks.push(dataBlock);
    }
  }

  // Dois blocos finais de 512 bytes nulos indicam EOF do TAR
  blocks.push(Buffer.alloc(1024, 0));

  const tarBuffer = Buffer.concat(blocks);
  return zlib.gzipSync(tarBuffer);
}

export async function runOperationalReadinessCertificationR14(): Promise<OperationalReadinessResultR14> {
  console.log("===============================================================================");
  console.log(" C5-MEMORY — T3788 OPERATIONAL READINESS CERTIFICATION R1.4");
  console.log("===============================================================================");

  // ---------------------------------------------------------------------------
  // 1. INVARIANTES DO PROTOCOLO CIENTÍFICO V2
  // ---------------------------------------------------------------------------
  console.log("\n--- [SEÇÃO 1] INVARIANTES CIENTÍFICAS E HORIZONTES OFICIAIS ---");
  const protocol = validateResearchProtocolV2Binding();
  assert.strictEqual(
    protocol.calculatedSha256,
    FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
    "Protocolo V2 deve coincidir rigorosamente com o hash congelado."
  );

  const officialHorizons = protocol.horizons;
  assert.deepStrictEqual(
    officialHorizons,
    [100, 500, 1000, 2000, 3788],
    "Horizontes oficiais devem ser rigorosamente [100, 500, 1000, 2000, 3788]"
  );

  const testTempBase = path.join("/tmp", `c5m-operational-readiness-${Date.now()}`);
  fs.mkdirSync(testTempBase, { recursive: true });

  try {
    const testSalt = "R1_4_OPERATIONAL_AUDIT_SALT";
    const testK = 10;
    const testSeedIndex = 777;
    const testHorizons = [10, 20];

    // -------------------------------------------------------------------------
    // 2. REFERÊNCIA CONTÍNUA E EXECUÇÃO FONTE PARA BACKUP
    // -------------------------------------------------------------------------
    console.log("\n--- [SEÇÃO 2] EXECUÇÃO DA REFERÊNCIA CONTÍNUA E FONTE ---");
    const dirContinuous = path.join(testTempBase, "ref_continuous");
    const resContinuous = runSingleTrajectoryV2({
      protocol,
      experiment: "EXPERIMENT_B",
      k: testK,
      masterSeed: testSalt,
      seedIndex: testSeedIndex,
      targetHorizons: testHorizons,
      baseDir: dirContinuous,
      resume: false,
      executionMode: "OPTIMIZED",
    });

    const sourceExecutionDir = path.join(testTempBase, "source_execution");
    runSingleTrajectoryV2({
      protocol,
      experiment: "EXPERIMENT_B",
      k: testK,
      masterSeed: testSalt,
      seedIndex: testSeedIndex,
      targetHorizons: [10],
      baseDir: sourceExecutionDir,
      resume: false,
      executionMode: "OPTIMIZED",
    });

    // -------------------------------------------------------------------------
    // 3. CRIAÇÃO DE BACKUP RECUPERÁVEL E VALIDAÇÃO ESTRUTURAL
    // -------------------------------------------------------------------------
    console.log("\n--- [SEÇÃO 3] CRIAÇÃO DE BACKUP E VALIDAÇÃO ESTRUTURAL ---");
    const archiveTarGzPath = path.join(testTempBase, "backups", "c5-memory-execution-backup.tar.gz");
    const publicDownloadPath = path.resolve("public", "c5-memory-execution-backup.tar.gz");

    const backupResult = createRecoverableExecutionBackup({
      sourceDir: sourceExecutionDir,
      outputTarGzPath: archiveTarGzPath,
      publicDownloadPath,
    });

    const targetCleanDir = path.join(testTempBase, "clean_restore");
    const structuralAnalysis = parseAndValidateTarEntries(archiveTarGzPath, targetCleanDir);

    assert.ok(structuralAnalysis.totalEntries > 0, "Deve haver entradas no TAR.");
    assert.ok(structuralAnalysis.safeFiles.length > 0, "Deve haver arquivos regulares mapeados.");
    assert.strictEqual(
      structuralAnalysis.entries.every((e) => e.isRegularFile || e.isDirectory),
      true,
      "Todas as entradas devem ser estritamente arquivos regulares ou diretórios."
    );

    console.log(`TOTAL_ENTRIES_PARSED_STRUCTURALLY     = ${structuralAnalysis.totalEntries}`);
    console.log(`SAFE_FILES_COUNT                      = ${structuralAnalysis.safeFiles.length}`);
    console.log("STRUCTURAL_TAR_VALIDATION             = PASS");

    // -------------------------------------------------------------------------
    // 4. BATERIA DE TESTES NEGATIVOS OBRIGATÓRIOS
    // -------------------------------------------------------------------------
    console.log("\n--- [SEÇÃO 4] BATERIA DE TESTES NEGATIVOS OBRIGATÓRIOS ---");

    // 4.1 Link simbólico malicioso
    console.log("4.1 Testando rejeição de link simbólico malicioso...");
    const symlinkTarGz = path.join(testTempBase, "bad_symlink.tar.gz");
    fs.writeFileSync(
      symlinkTarGz,
      createSyntheticTarGz([
        { name: "backup_manifest.json", typeflag: "0", content: "{}" },
        { name: "evil_symlink", typeflag: "2", linkname: "/etc/passwd" },
      ])
    );
    assert.throws(
      () =>
        restoreRecoverableExecutionBackup({
          archivePath: symlinkTarGz,
          targetCleanDir: path.join(testTempBase, "bad_clean_1"),
        }),
      /TAR_SAFETY_VIOLATION: Link simbólico proibido/,
      "Link simbólico deve ser rejeitado estruturalmente."
    );
    console.log("SYMLINK_REJECTED                      = PASS");

    // 4.2 Caminho real contendo '../'
    console.log("4.2 Testando rejeição de path traversal real com '../'...");
    const traversalTarGz = path.join(testTempBase, "bad_traversal.tar.gz");
    fs.writeFileSync(
      traversalTarGz,
      createSyntheticTarGz([
        { name: "backup_manifest.json", typeflag: "0", content: "{}" },
        { name: "checkpoints/../../evil_escape.json", typeflag: "0", content: "payload" },
      ])
    );
    assert.throws(
      () =>
        restoreRecoverableExecutionBackup({
          archivePath: traversalTarGz,
          targetCleanDir: path.join(testTempBase, "bad_clean_2"),
        }),
      /TAR_SAFETY_VIOLATION: Tentativa de path traversal contendo '\.\.' rejeitada/,
      "Path traversal contendo '..' deve ser rejeitado estruturalmente."
    );
    console.log("REAL_PATH_TRAVERSAL_REJECTED          = PASS");

    // 4.3 Caminho absoluto
    console.log("4.3 Testando rejeição de caminho absoluto...");
    const absoluteTarGz = path.join(testTempBase, "bad_absolute.tar.gz");
    fs.writeFileSync(
      absoluteTarGz,
      createSyntheticTarGz([
        { name: "backup_manifest.json", typeflag: "0", content: "{}" },
        { name: "/etc/shadow_dump.txt", typeflag: "0", content: "payload" },
      ])
    );
    assert.throws(
      () =>
        restoreRecoverableExecutionBackup({
          archivePath: absoluteTarGz,
          targetCleanDir: path.join(testTempBase, "bad_clean_3"),
        }),
      /TAR_SAFETY_VIOLATION: Caminho absoluto proibido no backup/,
      "Caminho absoluto deve ser rejeitado estruturalmente."
    );
    console.log("ABSOLUTE_PATH_REJECTED                = PASS");

    // 4.4 Entrada TAR com nome contendo quebra de linha
    console.log("4.4 Testando rejeição de nome contendo quebra de linha...");
    const newlineTarGz = path.join(testTempBase, "bad_newline.tar.gz");
    fs.writeFileSync(
      newlineTarGz,
      createSyntheticTarGz([
        { name: "backup_manifest.json", typeflag: "0", content: "{}" },
        { name: "checkpoints/state\ninjection.json", typeflag: "0", content: "payload" },
      ])
    );
    assert.throws(
      () =>
        restoreRecoverableExecutionBackup({
          archivePath: newlineTarGz,
          targetCleanDir: path.join(testTempBase, "bad_clean_4"),
        }),
      /TAR_SAFETY_VIOLATION: Nome de entrada contém quebra de linha proibida/,
      "Nome contendo quebra de linha deve ser rejeitado estruturalmente."
    );
    console.log("NEWLINE_FILENAME_REJECTED             = PASS");

    // 4.5 Caminhos duplicados
    console.log("4.5 Testando rejeição de caminhos duplicados...");
    const duplicateTarGz = path.join(testTempBase, "bad_duplicate.tar.gz");
    fs.writeFileSync(
      duplicateTarGz,
      createSyntheticTarGz([
        { name: "backup_manifest.json", typeflag: "0", content: "{}" },
        { name: "checkpoints/state_sample.json", typeflag: "0", content: "payload 1" },
        { name: "checkpoints/state_sample.json", typeflag: "0", content: "payload 2" },
      ])
    );
    assert.throws(
      () =>
        restoreRecoverableExecutionBackup({
          archivePath: duplicateTarGz,
          targetCleanDir: path.join(testTempBase, "bad_clean_5"),
        }),
      /TAR_SAFETY_VIOLATION: Entrada duplicada rejeitada/,
      "Entradas duplicadas no arquivo TAR devem ser rejeitadas."
    );
    console.log("DUPLICATE_ENTRY_REJECTED              = PASS");

    // 4.6 Manifesto com caminho fora do diretório permitido
    console.log("4.6 Testando rejeição de manifesto com caminho fora do destino...");
    const evilManifest: BackupManifest = {
      backupVersion: "1.0.0",
      createdAt: new Date().toISOString(),
      sourceBaseDir: "/tmp",
      fileCount: 1,
      totalBytes: 7,
      files: [
        {
          relativePath: "../../evil_manifest_escape.json",
          sizeBytes: 7,
          sha256: computeSha256("payload"),
        },
      ],
    };
    const evilManifestPayload = serializeManifestForChecksum(evilManifest);
    const evilManifestWithSha: BackupManifest = {
      ...evilManifest,
      manifestSha256: computeSha256(evilManifestPayload),
    };
    const badManifestTarGz = path.join(testTempBase, "bad_manifest_path.tar.gz");
    fs.writeFileSync(
      badManifestTarGz,
      createSyntheticTarGz([
        {
          name: "backup_manifest.json",
          typeflag: "0",
          content: JSON.stringify(evilManifestWithSha, null, 2),
        },
        { name: "sample.json", typeflag: "0", content: "payload" },
      ])
    );
    assert.throws(
      () =>
        restoreRecoverableExecutionBackup({
          archivePath: badManifestTarGz,
          targetCleanDir: path.join(testTempBase, "bad_clean_6"),
        }),
      /MANIFEST_PATH_SAFETY_VIOLATION/,
      "Caminho no manifesto fora do diretório de destino deve ser rejeitado."
    );
    console.log("MANIFEST_PATH_TRAVERSAL_REJECTED      = PASS");

    // -------------------------------------------------------------------------
    // 5. RESTAURAÇÃO ÍNTEGRA E RETOMADA DETERMINÍSTICA
    // -------------------------------------------------------------------------
    console.log("\n--- [SEÇÃO 5] RESTAURAÇÃO ÍNTEGRA E RETOMADA DETERMINÍSTICA ---");
    const restoreResult = restoreRecoverableExecutionBackup({
      archivePath: archiveTarGzPath,
      targetCleanDir,
    });
    assert.strictEqual(restoreResult.allFileHashesMatch, true);
    assert.strictEqual(restoreResult.manifestVerified, true);

    const resRestored = runSingleTrajectoryV2({
      protocol,
      experiment: "EXPERIMENT_B",
      k: testK,
      masterSeed: testSalt,
      seedIndex: testSeedIndex,
      targetHorizons: testHorizons,
      baseDir: targetCleanDir,
      resume: true,
      executionMode: "OPTIMIZED",
    });

    assert.strictEqual(resRestored.finalHorizon, 20);
    assert.strictEqual(
      resContinuous.baselineFinalFingerprint,
      resRestored.baselineFinalFingerprint,
      "baselineFinalFingerprint deve coincidir 100%"
    );
    assert.strictEqual(
      resContinuous.mlFinalFingerprint,
      resRestored.mlFinalFingerprint,
      "mlFinalFingerprint deve coincidir 100%"
    );

    for (const h of testHorizons) {
      const recCont = resContinuous.horizonRecords[h];
      const recRestored = resRestored.horizonRecords[h];
      assert.strictEqual(recCont.baselineCoverage14Plus, recRestored.baselineCoverage14Plus);
      assert.strictEqual(recCont.mlCoverage14Plus, recRestored.mlCoverage14Plus);
      assert.strictEqual(recCont.delta14Plus, recRestored.delta14Plus);
      assert.strictEqual(recCont.historyCardinality, recRestored.historyCardinality);
      assert.strictEqual(recCont.poolHash, recRestored.poolHash);
    }
    console.log("RESTORED_RESULT_EXACT_MATCH           = PASS");

    console.log("\n===============================================================================");
    console.log(" OPERATIONAL READINESS R1.4: PASS");
    console.log("===============================================================================");

    return {
      STRUCTURAL_TAR_VALIDATION: "PASS",
      SYMLINK_REJECTED: "PASS",
      REAL_PATH_TRAVERSAL_REJECTED: "PASS",
      ABSOLUTE_PATH_REJECTED: "PASS",
      NEWLINE_FILENAME_REJECTED: "PASS",
      DUPLICATE_ENTRY_REJECTED: "PASS",
      MANIFEST_PATH_TRAVERSAL_REJECTED: "PASS",
      RESTORED_RESULT_EXACT_MATCH: "PASS",
      T3788_EXECUTED: "NO",
      T3788_AUTHORIZED: "NO",
      IC11_STARTED: "NO",
    };
  } finally {
    try {
      fs.rmSync(testTempBase, { recursive: true, force: true });
    } catch {}
  }
}

if (process.argv[1]?.includes("run002T3788OperationalReadinessCertification")) {
  runOperationalReadinessCertificationR14()
    .then((res) => {
      console.log("\n===============================================================================");
      console.log(" RELATÓRIO FINAL OPERATIONAL READINESS R1.4");
      console.log("===============================================================================");
      console.log(`STRUCTURAL_TAR_VALIDATION = ${res.STRUCTURAL_TAR_VALIDATION}`);
      console.log(`SYMLINK_REJECTED = ${res.SYMLINK_REJECTED}`);
      console.log(`REAL_PATH_TRAVERSAL_REJECTED = ${res.REAL_PATH_TRAVERSAL_REJECTED}`);
      console.log(`ABSOLUTE_PATH_REJECTED = ${res.ABSOLUTE_PATH_REJECTED}`);
      console.log(`NEWLINE_FILENAME_REJECTED = ${res.NEWLINE_FILENAME_REJECTED}`);
      console.log(`DUPLICATE_ENTRY_REJECTED = ${res.DUPLICATE_ENTRY_REJECTED}`);
      console.log(`MANIFEST_PATH_TRAVERSAL_REJECTED = ${res.MANIFEST_PATH_TRAVERSAL_REJECTED}`);
      console.log(`RESTORED_RESULT_EXACT_MATCH = ${res.RESTORED_RESULT_EXACT_MATCH}\n`);
      console.log(`T3788_EXECUTED = ${res.T3788_EXECUTED}`);
      console.log(`T3788_AUTHORIZED = ${res.T3788_AUTHORIZED}`);
      console.log(`IC11_STARTED = ${res.IC11_STARTED}`);
    })
    .catch((e: any) => {
      console.error("FATAL ERROR IN OPERATIONAL READINESS R1.4:", e);
      process.exit(1);
    });
}
