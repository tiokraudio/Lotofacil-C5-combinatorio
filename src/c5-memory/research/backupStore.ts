/**
 * C5-MEMORY — Módulo de Backup Recuperável e Transferência de Evidências (R1.4)
 * Protocolo: C5_MEMORY_210_RESEARCH_PROTOCOL_V2
 *
 * Gerencia a exportação em lote, empacotamento portátil (.tar.gz),
 * validação ESTRUTURAL BINÁRIA de cabeçalhos TAR (substituindo parsing textual),
 * segurança estrita de caminhos (anti-path traversal, anti-symlink, anti-hardlink,
 * anti-newline, anti-duplicação), validação criptográfica do manifesto
 * e restauração auditável com equivalência determinística.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as zlib from "node:zlib";
import { execSync } from "node:child_process";
import { computeSha256 } from "./evidenceStore";

export interface BackupFileEntry {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly backupVersion: string;
  readonly createdAt: string;
  readonly sourceBaseDir: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly files: readonly BackupFileEntry[];
  readonly manifestSha256?: string;
}

export interface CreateBackupResult {
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly archiveSizeBytes: number;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly fileCount: number;
  readonly totalDataBytes: number;
  readonly includesCheckpoints: boolean;
  readonly includesRawEvidence: boolean;
  readonly publicDownloadPath?: string;
}

export interface RestoreBackupResult {
  readonly targetCleanDir: string;
  readonly filesRestored: number;
  readonly totalBytesRestored: number;
  readonly manifestVerified: boolean;
  readonly allFileHashesMatch: boolean;
}

export interface TarEntryMetadata {
  readonly name: string;
  readonly typeflag: string;
  readonly size: number;
  readonly linkname: string;
  readonly isDirectory: boolean;
  readonly isRegularFile: boolean;
}

/**
 * Serialização canônica e determinística do manifesto para cálculo de SHA-256,
 * excluindo estritamente a chave autorreferencial `manifestSha256`.
 */
export function serializeManifestForChecksum(
  manifest: Omit<BackupManifest, "manifestSha256">
): string {
  const normalized: Omit<BackupManifest, "manifestSha256"> = {
    backupVersion: manifest.backupVersion,
    createdAt: manifest.createdAt,
    sourceBaseDir: manifest.sourceBaseDir,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    files: manifest.files.map((f) => ({
      relativePath: f.relativePath.replace(/\\/g, "/"),
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
    })),
  };
  return JSON.stringify(normalized, null, 2);
}

/**
 * Análise estrutural binária profunda dos blocos de 512 bytes do arquivo TAR.
 * Substitui completamente o parsing textual de `tar -ztvf`.
 * Inspeciona cada membro: nome, prefixo POSIX, typeflag, linkname e tamanho.
 */
export function parseAndValidateTarEntries(
  archivePath: string,
  targetCleanDir: string
): {
  readonly entries: readonly TarEntryMetadata[];
  readonly totalEntries: number;
  readonly safeFiles: readonly string[];
  readonly safeDirectories: readonly string[];
} {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`TAR_SAFETY_ERROR: Arquivo de backup não encontrado: ${archivePath}`);
  }

  const rawGzip = fs.readFileSync(archivePath);
  let tarBuffer: Buffer;
  try {
    tarBuffer = zlib.gunzipSync(rawGzip);
  } catch (e: any) {
    throw new Error(`TAR_SAFETY_ERROR: Falha na descompressão gzip do arquivo: ${e.message}`);
  }

  if (tarBuffer.length < 512) {
    throw new Error("TAR_SAFETY_ERROR: Arquivo TAR incompleto (menos de 512 bytes).");
  }

  const resolvedTarget = path.resolve(targetCleanDir);
  const entries: TarEntryMetadata[] = [];
  const safeFiles: string[] = [];
  const safeDirectories: string[] = [];
  const seenFiles = new Set<string>();
  const seenDirs = new Set<string>();

  let offset = 0;
  let gnuLongName: string | null = null;
  let gnuLongLink: string | null = null;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    // Bloco nulo (zero block) - fim do arquivo TAR
    let isZeroBlock = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        isZeroBlock = false;
        break;
      }
    }
    if (isZeroBlock) {
      break;
    }

    // Leitura dos campos estruturais binários
    const nameNullIdx = header.subarray(0, 100).indexOf(0);
    const rawName = header
      .subarray(0, nameNullIdx >= 0 ? nameNullIdx : 100)
      .toString("utf-8");

    // Leitura do prefixo USTAR (bytes 345..500)
    const prefixNullIdx = header.subarray(345, 500).indexOf(0);
    const rawPrefix = header
      .subarray(345, prefixNullIdx >= 0 ? 345 + prefixNullIdx : 500)
      .toString("utf-8");

    // Typeflag no byte 156
    const rawTypeflagByte = header[156];
    const typeflag = rawTypeflagByte === 0 ? "0" : String.fromCharCode(rawTypeflagByte);

    // Linkname (bytes 157..257)
    const linkNullIdx = header.subarray(157, 257).indexOf(0);
    const rawLinkname = header
      .subarray(157, linkNullIdx >= 0 ? 157 + linkNullIdx : 257)
      .toString("utf-8");

    // Tamanho em octal (bytes 124..136)
    const sizeStr = header
      .subarray(124, 136)
      .toString("ascii")
      .trim()
      .replace(/\0+$/, "");
    const size = parseInt(sizeStr, 8) || 0;

    const dataOffset = offset + 512;
    const dataBlocks = Math.ceil(size / 512) * 512;

    // Tratamento de extensão GNU LongName ('L')
    if (typeflag === "L") {
      const longNameNull = tarBuffer.subarray(dataOffset, dataOffset + size).indexOf(0);
      gnuLongName = tarBuffer
        .subarray(dataOffset, dataOffset + (longNameNull >= 0 ? longNameNull : size))
        .toString("utf-8");
      offset = dataOffset + dataBlocks;
      continue;
    }

    // Tratamento de extensão GNU LongLink ('K')
    if (typeflag === "K") {
      const longLinkNull = tarBuffer.subarray(dataOffset, dataOffset + size).indexOf(0);
      gnuLongLink = tarBuffer
        .subarray(dataOffset, dataOffset + (longLinkNull >= 0 ? longLinkNull : size))
        .toString("utf-8");
      offset = dataOffset + dataBlocks;
      continue;
    }

    // Determina o nome efetivo
    let effectiveName = gnuLongName ?? (rawPrefix.length > 0 ? `${rawPrefix}/${rawName}` : rawName);
    let effectiveLink = gnuLongLink ?? rawLinkname;
    gnuLongName = null;
    gnuLongLink = null;

    // -------------------------------------------------------------------------
    // VALIDAÇÕES ESTRUTURAIS DE SEGURANÇA
    // -------------------------------------------------------------------------

    // 1. Rejeição de quebras de linha ou caracteres de controle no nome
    if (effectiveName.includes("\n") || effectiveName.includes("\r")) {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Nome de entrada contém quebra de linha proibida: ${JSON.stringify(
          effectiveName
        )}`
      );
    }
    if (effectiveName.includes("\0")) {
      throw new Error("TAR_SAFETY_VIOLATION: Nome de entrada contém caractere nulo proibido");
    }

    // 2. Rejeição de tipos especiais, symlinks e hardlinks
    if (typeflag === "2") {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Link simbólico proibido no arquivo de backup: ${effectiveName} -> ${effectiveLink}`
      );
    }
    if (typeflag === "1") {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Hard link proibido no arquivo de backup: ${effectiveName} -> ${effectiveLink}`
      );
    }
    if (effectiveLink.length > 0) {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Entrada com destino de link proibida: ${effectiveName} -> ${effectiveLink}`
      );
    }

    // Permitir somente arquivos regulares ('0') e diretórios ('5')
    const isRegularFile = typeflag === "0";
    const isDirectory = typeflag === "5" || effectiveName.endsWith("/");

    if (!isRegularFile && !isDirectory) {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Tipo especial de entrada TAR proibido: typeflag='${typeflag}' para ${effectiveName}`
      );
    }

    // 3. Rejeição de caminhos absolutos
    if (path.isAbsolute(effectiveName) || effectiveName.startsWith("/") || effectiveName.startsWith("\\")) {
      throw new Error(`TAR_SAFETY_VIOLATION: Caminho absoluto proibido no backup: ${effectiveName}`);
    }

    // 4. Rejeição de path traversal contendo componentes '..'
    const pathComponents = effectiveName.split(/[/\\]/);
    if (pathComponents.some((comp) => comp === "..")) {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Tentativa de path traversal contendo '..' rejeitada: ${effectiveName}`
      );
    }

    // Normalização e verificação de escape do diretório limpo
    const normalized = path
      .normalize(effectiveName)
      .replace(/^(\.\/)+/, "")
      .replace(/^\.$/, "");

    if (normalized.startsWith("..") || normalized.includes("/../")) {
      throw new Error(
        `TAR_SAFETY_VIOLATION: Caminho normalizado escapa do diretório de destino: ${effectiveName}`
      );
    }

    if (normalized.length > 0) {
      const fullResolved = path.resolve(targetCleanDir, normalized);
      if (!fullResolved.startsWith(resolvedTarget + path.sep) && fullResolved !== resolvedTarget) {
        throw new Error(
          `TAR_SAFETY_VIOLATION: Entrada escapa do diretório limpo de destino: ${effectiveName}`
        );
      }

      // 5. Rejeição de entradas duplicadas ou conflitantes
      if (isRegularFile) {
        if (seenFiles.has(normalized)) {
          throw new Error(
            `TAR_SAFETY_VIOLATION: Entrada duplicada rejeitada no arquivo de backup: ${normalized}`
          );
        }
        if (seenDirs.has(normalized)) {
          throw new Error(
            `TAR_SAFETY_VIOLATION: Conflito de tipo (arquivo tentando sobrescrever diretório): ${normalized}`
          );
        }
        seenFiles.add(normalized);
        safeFiles.push(normalized);
      } else if (isDirectory) {
        if (seenFiles.has(normalized)) {
          throw new Error(
            `TAR_SAFETY_VIOLATION: Conflito de tipo (diretório tentando sobrescrever arquivo): ${normalized}`
          );
        }
        if (!seenDirs.has(normalized)) {
          seenDirs.add(normalized);
          safeDirectories.push(normalized);
        }
      }
    }

    entries.push({
      name: effectiveName,
      typeflag,
      size,
      linkname: effectiveLink,
      isDirectory,
      isRegularFile,
    });

    offset = dataOffset + dataBlocks;
  }

  return {
    entries,
    totalEntries: entries.length,
    safeFiles,
    safeDirectories,
  };
}

/**
 * Validação rigorosa dos caminhos declarados no manifesto de backup.
 * Rejeita caminhos absolutos, componentes '..', quebras de linha e duplicações.
 */
export function validateManifestPaths(
  manifest: BackupManifest,
  targetCleanDir: string
): void {
  const resolvedTarget = path.resolve(targetCleanDir);
  const seenPaths = new Set<string>();

  for (const entry of manifest.files) {
    const rel = entry.relativePath;
    if (!rel || typeof rel !== "string" || rel.trim().length === 0) {
      throw new Error("MANIFEST_PATH_SAFETY_VIOLATION: relativePath vazio ou inválido no manifesto.");
    }

    if (path.isAbsolute(rel) || rel.startsWith("/") || rel.startsWith("\\")) {
      throw new Error(`MANIFEST_PATH_SAFETY_VIOLATION: Caminho absoluto no manifesto: ${rel}`);
    }

    if (rel.includes("\n") || rel.includes("\r") || rel.includes("\0")) {
      throw new Error(
        `MANIFEST_PATH_SAFETY_VIOLATION: Caminho no manifesto contém quebra de linha: ${JSON.stringify(rel)}`
      );
    }

    const segments = rel.split(/[/\\]/);
    if (segments.some((s) => s === "..")) {
      throw new Error(
        `MANIFEST_PATH_SAFETY_VIOLATION: Tentativa de path traversal ('..') no manifesto: ${rel}`
      );
    }

    const normalized = path.normalize(rel).replace(/^(\.\/)+/, "");
    if (normalized.startsWith("..") || normalized.includes("/../")) {
      throw new Error(
        `MANIFEST_PATH_SAFETY_VIOLATION: Caminho normalizado no manifesto escapa do destino: ${rel}`
      );
    }

    const resolved = path.resolve(targetCleanDir, normalized);
    if (!resolved.startsWith(resolvedTarget + path.sep)) {
      throw new Error(
        `MANIFEST_PATH_SAFETY_VIOLATION: Caminho no manifesto resolve fora do diretório limpo: ${rel}`
      );
    }

    if (seenPaths.has(normalized)) {
      throw new Error(
        `MANIFEST_PATH_SAFETY_VIOLATION: Caminho duplicado declarado no manifesto: ${normalized}`
      );
    }
    seenPaths.add(normalized);
  }
}

/**
 * Escaneia recursivamente um diretório para listar arquivos reais.
 */
function scanFilesRecursively(dir: string, baseDir: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanFilesRecursively(fullPath, baseDir));
    } else if (entry.isFile()) {
      if (!entry.name.includes(".tmp.") && !entry.name.endsWith(".tmp")) {
        results.push(path.relative(baseDir, fullPath));
      }
    }
  }

  return results.sort();
}

/**
 * Cria pacote de backup portátil contendo checkpoints, evidências RAW e metadados,
 * acompanhado de manifesto criptográfico de integridade SHA-256.
 */
export function createRecoverableExecutionBackup(params: {
  readonly sourceDir: string;
  readonly outputTarGzPath: string;
  readonly publicDownloadPath?: string;
}): CreateBackupResult {
  const { sourceDir, outputTarGzPath, publicDownloadPath } = params;

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`BACKUP_ERROR: Diretório fonte não existe: ${sourceDir}`);
  }

  const relativeFiles = scanFilesRecursively(sourceDir);
  if (relativeFiles.length === 0) {
    throw new Error(`BACKUP_ERROR: Diretório fonte está vazio: ${sourceDir}`);
  }

  let includesCheckpoints = false;
  let includesRawEvidence = false;
  let totalDataBytes = 0;

  const fileEntries: BackupFileEntry[] = [];

  for (const relPath of relativeFiles) {
    const fullPath = path.join(sourceDir, relPath);
    const content = fs.readFileSync(fullPath);
    const sha256 = computeSha256(content);
    totalDataBytes += content.length;

    if (relPath.startsWith("checkpoints/")) {
      includesCheckpoints = true;
    }
    if (relPath.startsWith("raw/")) {
      includesRawEvidence = true;
    }

    fileEntries.push({
      relativePath: relPath.replace(/\\/g, "/"),
      sizeBytes: content.length,
      sha256,
    });
  }

  const stagingDir = path.join(
    path.dirname(outputTarGzPath),
    `.staging_backup_${Date.now()}_${process.pid}`
  );
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    for (const entry of fileEntries) {
      const targetInStaging = path.join(stagingDir, entry.relativePath);
      fs.mkdirSync(path.dirname(targetInStaging), { recursive: true });
      fs.copyFileSync(path.join(sourceDir, entry.relativePath), targetInStaging);
    }

    const manifestWithoutSha: Omit<BackupManifest, "manifestSha256"> = {
      backupVersion: "1.0.0",
      createdAt: new Date().toISOString(),
      sourceBaseDir: path.resolve(sourceDir),
      fileCount: fileEntries.length,
      totalBytes: totalDataBytes,
      files: fileEntries,
    };

    const manifestPayload = serializeManifestForChecksum(manifestWithoutSha);
    const manifestSha256 = computeSha256(manifestPayload);

    const fullManifest: BackupManifest = {
      ...manifestWithoutSha,
      manifestSha256,
    };

    const manifestPath = path.join(stagingDir, "backup_manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(fullManifest, null, 2), "utf-8");

    fs.mkdirSync(path.dirname(outputTarGzPath), { recursive: true });
    if (fs.existsSync(outputTarGzPath)) {
      fs.unlinkSync(outputTarGzPath);
    }

    execSync(`tar -czf "${outputTarGzPath}" -C "${stagingDir}" .`, { stdio: "pipe" });

    try {
      const dirFd = fs.openSync(path.dirname(outputTarGzPath), "r");
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {}

    const archiveBuffer = fs.readFileSync(outputTarGzPath);
    const archiveSha256 = computeSha256(archiveBuffer);

    if (publicDownloadPath) {
      fs.mkdirSync(path.dirname(publicDownloadPath), { recursive: true });
      fs.copyFileSync(outputTarGzPath, publicDownloadPath);
      const publicManifestPath = path.join(
        path.dirname(publicDownloadPath),
        `${path.basename(outputTarGzPath, ".tar.gz")}_manifest.json`
      );
      fs.writeFileSync(publicManifestPath, JSON.stringify(fullManifest, null, 2), "utf-8");
    }

    return {
      archivePath: outputTarGzPath,
      archiveSha256,
      archiveSizeBytes: archiveBuffer.length,
      manifestPath,
      manifestSha256,
      fileCount: fileEntries.length,
      totalDataBytes,
      includesCheckpoints,
      includesRawEvidence,
      publicDownloadPath,
    };
  } finally {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Restaura um backup em diretório limpo.
 * Valida estruturalmente os metadados do TAR e o auto-hash do manifesto
 * ANTES de qualquer gravação no diretório de destino.
 */
export function restoreRecoverableExecutionBackup(params: {
  readonly archivePath: string;
  readonly targetCleanDir: string;
}): RestoreBackupResult {
  const { archivePath, targetCleanDir } = params;

  if (!fs.existsSync(archivePath)) {
    throw new Error(`RESTORE_ERROR: Arquivo de backup não encontrado: ${archivePath}`);
  }

  // 1. VALIDAÇÃO ESTRUTURAL BINÁRIA DO ARQUIVO TAR (Anti-traversal, anti-symlink, anti-newline, etc.)
  parseAndValidateTarEntries(archivePath, targetCleanDir);

  // 2. Extração e validação do auto-hash do manifesto antes de extrair arquivos para o destino
  let manifestRaw: string;
  try {
    manifestRaw = execSync(`tar -xOf "${archivePath}" ./backup_manifest.json`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    try {
      manifestRaw = execSync(`tar -xOf "${archivePath}" backup_manifest.json`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (e: any) {
      throw new Error(`RESTORE_ERROR: backup_manifest.json não pôde ser lido do arquivo: ${e.message}`);
    }
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e: any) {
    throw new Error(`RESTORE_ERROR: Falha no parse JSON de backup_manifest.json: ${e.message}`);
  }

  const { manifestSha256, ...manifestWithoutSha } = manifest;
  if (!manifestSha256 || typeof manifestSha256 !== "string") {
    throw new Error("RESTORE_ERROR: manifestSha256 ausente no manifesto de backup.");
  }

  const recomputedManifestSha = computeSha256(serializeManifestForChecksum(manifestWithoutSha));
  if (recomputedManifestSha !== manifestSha256) {
    throw new Error(
      `RESTORE_MANIFEST_CORRUPTION: Hash SHA-256 do manifesto diverge do calculado. ` +
      `Declarado (${manifestSha256}) !== Recalculado (${recomputedManifestSha})`
    );
  }

  // 3. Validação dos caminhos declarados no próprio manifesto
  validateManifestPaths(manifest, targetCleanDir);

  // 4. Preparação do diretório limpo
  fs.mkdirSync(targetCleanDir, { recursive: true });
  const existingEntries = fs.readdirSync(targetCleanDir);
  for (const ent of existingEntries) {
    fs.rmSync(path.join(targetCleanDir, ent), { recursive: true, force: true });
  }

  // 5. Extração segura dos arquivos para o diretório limpo
  execSync(`tar -xzf "${archivePath}" -C "${targetCleanDir}"`, { stdio: "pipe" });

  let totalBytesRestored = 0;

  // 6. Validação de 100% dos hashes e tamanhos dos arquivos declarados no manifesto
  for (const entry of manifest.files) {
    const extractedFile = path.join(targetCleanDir, entry.relativePath);
    if (!fs.existsSync(extractedFile)) {
      throw new Error(`RESTORE_FILE_CORRUPTION: Arquivo declarado ausente após extração: ${entry.relativePath}`);
    }

    const content = fs.readFileSync(extractedFile);
    const computedSha = computeSha256(content);

    if (computedSha !== entry.sha256) {
      throw new Error(
        `RESTORE_FILE_CORRUPTION: Divergência de SHA-256 no arquivo restaurado ${entry.relativePath}: ` +
        `calculado (${computedSha}) !== esperado (${entry.sha256})`
      );
    }

    if (content.length !== entry.sizeBytes) {
      throw new Error(
        `RESTORE_FILE_CORRUPTION: Tamanho diverge no arquivo ${entry.relativePath}: ` +
        `lido (${content.length}) !== esperado (${entry.sizeBytes})`
      );
    }

    totalBytesRestored += content.length;
  }

  return {
    targetCleanDir,
    filesRestored: manifest.files.length,
    totalBytesRestored,
    manifestVerified: true,
    allFileHashesMatch: true,
  };
}

/**
 * Valida a transferibilidade externa realizando requisição HTTP ao servidor
 * e conferindo byte-a-byte o hash SHA-256 do arquivo transferido em fluxo binário exato.
 */
export async function verifyExternalBackupTransfer(params: {
  readonly serverUrl: string;
  readonly expectedSha256: string;
}): Promise<{
  readonly transferReady: boolean;
  readonly statusCode: number;
  readonly downloadedBytes: number;
  readonly downloadedSha256: string;
}> {
  const { serverUrl, expectedSha256 } = params;

  return new Promise((resolve, reject) => {
    const req = http.get(
      serverUrl,
      { headers: { "Accept-Encoding": "identity" } },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode !== 200) {
          reject(new Error(`EXTERNAL_TRANSFER_FAILED: HTTP status ${statusCode} ao acessar ${serverUrl}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("error", (err) => reject(err));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const downloadedSha256 = computeSha256(buffer);

          if (downloadedSha256 !== expectedSha256) {
            reject(
              new Error(
                `EXTERNAL_TRANSFER_CORRUPTION: Hash do arquivo baixado via HTTP difere do esperado: ` +
                `${downloadedSha256} !== ${expectedSha256}`
              )
            );
            return;
          }

          resolve({
            transferReady: true,
            statusCode,
            downloadedBytes: buffer.length,
            downloadedSha256,
          });
        });
      }
    );

    req.on("error", (err) => reject(err));
  });
}
