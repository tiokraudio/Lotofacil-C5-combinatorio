/**
 * Gerenciador de Armazenamento, Persistência Atômica e Completude de Evidências (IC10-R1 R2)
 * Protocolo: C5_MEMORY_210_RESEARCH_PROTOCOL_V2
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ArmExecutionState } from "./types";
import { ResearchArmExecutor } from "./engine";
import {
  FROZEN_RESEARCH_PROTOCOL_V2_ID,
  FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
} from "./protocolValidator";

export const EVIDENCE_BASE_DIR = "certification/c5-memory-v2/research/evidence-v2" as const;

export function computeSha256(content: string | Buffer): string {
  return crypto
    .createHash("sha256")
    .update(typeof content === "string" ? Buffer.from(content, "utf-8") : content)
    .digest("hex");
}

/**
 * Escrita atômica centralizada via .tmp no mesmo diretório seguida de fsync e rename atômico.
 */
export function atomicWriteFile(
  targetPath: string,
  content: string | Buffer
): { readonly sizeBytes: number; readonly sha256: string; readonly targetPath: string } {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const nonce = `${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = path.join(dir, `${path.basename(targetPath)}.tmp.${nonce}`);

  const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const sha256 = computeSha256(buffer);

  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, buffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, targetPath);
  return { sizeBytes: buffer.length, sha256, targetPath };
}

/**
 * Detecta e remove arquivos temporários residuais (.tmp), prevenindo sua inclusão em evidências válidas.
 */
export function cleanOrphanedTmpFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      removed.push(...cleanOrphanedTmpFiles(full));
    } else if (ent.isFile() && (ent.name.includes(".tmp.") || ent.name.endsWith(".tmp"))) {
      fs.unlinkSync(full);
      removed.push(full);
    }
  }
  return removed;
}

export interface RawTrajectoryHorizonRecord {
  readonly experiment: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly masterSeed: string;
  readonly k: number;
  readonly t: number;
  readonly baselineCoverage15: number;
  readonly baselineCoverage14Plus: number;
  readonly baselineCoverage13Plus: number;
  readonly baselineCoverage12Plus: number;
  readonly baselineCoverage11Plus: number;
  readonly mlCoverage15: number;
  readonly mlCoverage14Plus: number;
  readonly mlCoverage13Plus: number;
  readonly mlCoverage12Plus: number;
  readonly mlCoverage11Plus: number;
  readonly delta15: number;
  readonly delta14Plus: number;
  readonly delta13Plus: number;
  readonly delta12Plus: number;
  readonly delta11Plus: number;
  readonly deltaPercent14Plus: number;
  readonly historyCardinality: number;
  readonly duplicateCount: number;
  readonly poolHash: string; // F07: Obrigatório, hash SHA-256 válido
  readonly timings: {
    readonly meanSelectionMs: number;
    readonly p95SelectionMs: number;
    readonly maxSelectionMs: number;
  };
}

export interface TrajectoryEvidenceFile {
  readonly protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2";
  readonly protocolSha256: string;
  readonly experiment: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly replicationModel: "CANONICAL_DETERMINISTIC_TRAJECTORY" | "EXOGENOUS_REPLICATED_POOLS";
  readonly masterSeed: string;
  readonly seedIndex?: number;
  readonly k: number;
  readonly finalHorizon: number;
  readonly horizonRecords: Record<number, RawTrajectoryHorizonRecord>;
  readonly finalHistoryCardinality: number;
  readonly finalDuplicateCount: number;
  readonly baselineFinalFingerprint: string;
  readonly mlFinalFingerprint: string;
  readonly recordedAt: string;
  readonly fileSha256?: string;
}

export interface StateCheckpointFileV2 {
  readonly protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2";
  readonly protocolSha256: string;
  readonly experiment: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly replicationModel: "CANONICAL_DETERMINISTIC_TRAJECTORY" | "EXOGENOUS_REPLICATED_POOLS";
  readonly k: number;
  readonly masterSeed: string;
  readonly seedIndex?: number;
  readonly currentStep: number;
  readonly checkpointHorizon: number;
  readonly arms: {
    readonly baseline: ArmExecutionState;
    readonly maxLeximin: ArmExecutionState;
  };
  readonly horizonRecord: RawTrajectoryHorizonRecord;
  readonly integritySha256: string;
  readonly createdAt: string;
}

export interface EvidenceArtifactMeta {
  readonly path: string;
  readonly type: "TRAJECTORY_RAW" | "CHECKPOINT" | "AGGREGATE_SUMMARY";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly experiment?: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly k?: number;
  readonly seedIndex?: number;
  readonly masterSeed?: string;
  readonly horizon?: number;
}

export interface EvidenceManifestV2 {
  readonly manifestVersion: "2.0.0";
  readonly protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2";
  readonly protocolSha256: string;
  readonly experimentAModel: "CANONICAL_DETERMINISTIC_TRAJECTORY";
  readonly experimentBModel: "EXOGENOUS_REPLICATED_POOLS";
  readonly expectedTrajectoryCountA: 5;
  readonly expectedTrajectoryCountB: 160;
  readonly persistedArtifacts: readonly EvidenceArtifactMeta[];
  readonly createdAt: string;
  readonly manifestSha256?: string;
}

/**
 * Validação estrita de schema para registros brutos de horizonte (F07).
 */
export function validateTrajectoryRecordSchema(record: RawTrajectoryHorizonRecord): void {
  if (!record || typeof record !== "object") {
    throw new Error("SCHEMA_ERROR: Registro de horizonte nulo ou inválido.");
  }

  if (record.experiment !== "EXPERIMENT_A" && record.experiment !== "EXPERIMENT_B") {
    throw new Error(`SCHEMA_ERROR: experiment inválido ou ausente: ${record.experiment}`);
  }

  if (typeof record.masterSeed !== "string" || record.masterSeed.trim().length === 0) {
    throw new Error("SCHEMA_ERROR: masterSeed deve ser string não-vazia.");
  }

  // Validação de poolHash: deve ser hash SHA-256 hexadecimal válido de 64 caracteres
  if (
    typeof record.poolHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.poolHash)
  ) {
    throw new Error(
      `SCHEMA_ERROR: poolHash inválido. Deve ser string SHA-256 de 64 caracteres hexadecimais minúsculos: ${record.poolHash}`
    );
  }

  // Contagens e coberturas: números finitos >= 0
  const nonNegativeFields: (keyof RawTrajectoryHorizonRecord)[] = [
    "k",
    "t",
    "baselineCoverage15",
    "baselineCoverage14Plus",
    "baselineCoverage13Plus",
    "baselineCoverage12Plus",
    "baselineCoverage11Plus",
    "mlCoverage15",
    "mlCoverage14Plus",
    "mlCoverage13Plus",
    "mlCoverage12Plus",
    "mlCoverage11Plus",
    "historyCardinality",
    "duplicateCount",
  ];

  for (const field of nonNegativeFields) {
    const val = record[field];
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
      throw new Error(`SCHEMA_ERROR: campo ${field} deve ser número finito >= 0. Recebido: ${val}`);
    }
  }

  // Deltas: números finitos
  const deltaFields: (keyof RawTrajectoryHorizonRecord)[] = [
    "delta15",
    "delta14Plus",
    "delta13Plus",
    "delta12Plus",
    "delta11Plus",
    "deltaPercent14Plus",
  ];

  for (const field of deltaFields) {
    const val = record[field];
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new Error(`SCHEMA_ERROR: campo ${field} deve ser número finito. Recebido: ${val}`);
    }
  }

  // Timings: objetos com números finitos e invariantes max >= p95 >= 0, mean >= 0
  if (!record.timings || typeof record.timings !== "object") {
    throw new Error("SCHEMA_ERROR: timings ausente ou inválido.");
  }

  const { meanSelectionMs, p95SelectionMs, maxSelectionMs } = record.timings;
  if (!Number.isFinite(meanSelectionMs) || meanSelectionMs < 0) {
    throw new Error(`SCHEMA_ERROR: meanSelectionMs deve ser finito >= 0: ${meanSelectionMs}`);
  }
  if (!Number.isFinite(p95SelectionMs) || p95SelectionMs < 0) {
    throw new Error(`SCHEMA_ERROR: p95SelectionMs deve ser finito >= 0: ${p95SelectionMs}`);
  }
  if (!Number.isFinite(maxSelectionMs) || maxSelectionMs < 0) {
    throw new Error(`SCHEMA_ERROR: maxSelectionMs deve ser finito >= 0: ${maxSelectionMs}`);
  }
  if (maxSelectionMs < p95SelectionMs) {
    throw new Error(
      `SCHEMA_ERROR: Violação de invariante temporal: maxSelectionMs (${maxSelectionMs}) < p95SelectionMs (${p95SelectionMs})`
    );
  }
}

/**
 * Salva atomicamente a trajetória de evidência científica definitiva.
 */
export function persistTrajectoryEvidence(
  evidence: TrajectoryEvidenceFile,
  baseDir: string = EVIDENCE_BASE_DIR
): { readonly filePath: string; readonly sha256: string; readonly sizeBytes: number } {
  if (evidence.protocolId !== FROZEN_RESEARCH_PROTOCOL_V2_ID) {
    throw new Error(`PROTOCOL_MISMATCH: protocolId deve ser ${FROZEN_RESEARCH_PROTOCOL_V2_ID}`);
  }
  if (evidence.protocolSha256 !== FROZEN_RESEARCH_PROTOCOL_V2_SHA256) {
    throw new Error(`PROTOCOL_SHA_MISMATCH: protocolSha256 diverge do congelado.`);
  }

  for (const t of Object.keys(evidence.horizonRecords)) {
    validateTrajectoryRecordSchema(evidence.horizonRecords[Number(t)]);
  }

  const subDir =
    evidence.experiment === "EXPERIMENT_A"
      ? path.join(baseDir, "raw", "experiment-a")
      : path.join(baseDir, "raw", "experiment-b");

  const fileName =
    evidence.experiment === "EXPERIMENT_A"
      ? `canonical_k${evidence.k}.json`
      : `k${evidence.k}_seed${evidence.seedIndex ?? 0}.json`;

  const targetPath = path.join(subDir, fileName);
  const jsonContent = JSON.stringify(evidence, null, 2);
  const writeRes = atomicWriteFile(targetPath, jsonContent);

  return { filePath: targetPath, sha256: writeRes.sha256, sizeBytes: writeRes.sizeBytes };
}

/**
 * Calcula o hash causal de integridade de um checkpoint V2.
 */
export function calculateStateCheckpointIntegrity(params: {
  readonly protocolId: string;
  readonly protocolSha256: string;
  readonly experiment: string;
  readonly k: number;
  readonly masterSeed: string;
  readonly currentStep: number;
  readonly baselineStateSha: string;
  readonly maxLeximinStateSha: string;
}): string {
  const payload = JSON.stringify({
    protocolId: params.protocolId,
    protocolSha256: params.protocolSha256,
    experiment: params.experiment,
    k: params.k,
    masterSeed: params.masterSeed,
    currentStep: params.currentStep,
    baselineStateSha: params.baselineStateSha,
    maxLeximinStateSha: params.maxLeximinStateSha,
  });
  return computeSha256(payload);
}

/**
 * Salva atomicamente um checkpoint de estado completo retomável (F02 & F03).
 */
export function persistIncrementalStateCheckpoint(
  checkpoint: StateCheckpointFileV2,
  baseDir: string = EVIDENCE_BASE_DIR
): { readonly filePath: string; readonly sha256: string; readonly sizeBytes: number } {
  validateTrajectoryRecordSchema(checkpoint.horizonRecord);

  if (checkpoint.protocolId !== FROZEN_RESEARCH_PROTOCOL_V2_ID) {
    throw new Error(`CHECKPOINT_PROTOCOL_MISMATCH: Esperado ${FROZEN_RESEARCH_PROTOCOL_V2_ID}`);
  }
  if (checkpoint.protocolSha256 !== FROZEN_RESEARCH_PROTOCOL_V2_SHA256) {
    throw new Error("CHECKPOINT_PROTOCOL_SHA_MISMATCH: Hash do protocolo adulterado.");
  }

  const chkDir = path.join(baseDir, "checkpoints");
  const seedTag = checkpoint.seedIndex !== undefined ? `_s${checkpoint.seedIndex}` : "_canonical";
  const fileName = `state_${checkpoint.experiment.toLowerCase()}_k${checkpoint.k}${seedTag}_t${checkpoint.checkpointHorizon}.json`;
  const targetPath = path.join(chkDir, fileName);

  const jsonContent = JSON.stringify(checkpoint, null, 2);
  const writeRes = atomicWriteFile(targetPath, jsonContent);

  return { filePath: targetPath, sha256: writeRes.sha256, sizeBytes: writeRes.sizeBytes };
}

/**
 * Restaura e valida formalmente a execução a partir de um checkpoint físico (F03).
 * Aborta com erro fatal se houver adulteração em qualquer dimensão.
 */
export function restoreResearchExecutionV2(
  checkpointPathOrData: string | StateCheckpointFileV2,
  expectedProtocolSha: string = FROZEN_RESEARCH_PROTOCOL_V2_SHA256
): {
  readonly baselineArm: ResearchArmExecutor;
  readonly maxLeximinArm: ResearchArmExecutor;
  readonly checkpoint: StateCheckpointFileV2;
} {
  let checkpoint: StateCheckpointFileV2;
  if (typeof checkpointPathOrData === "string") {
    if (!fs.existsSync(checkpointPathOrData)) {
      throw new Error(`RESTORE_ERROR: Arquivo de checkpoint não encontrado: ${checkpointPathOrData}`);
    }
    const raw = fs.readFileSync(checkpointPathOrData, "utf-8");
    checkpoint = JSON.parse(raw);
  } else {
    checkpoint = checkpointPathOrData;
  }

  if (checkpoint.protocolId !== FROZEN_RESEARCH_PROTOCOL_V2_ID) {
    throw new Error(`RESTORE_ERROR: protocolId inválido (${checkpoint.protocolId})`);
  }
  if (checkpoint.protocolSha256 !== expectedProtocolSha) {
    throw new Error(
      `RESTORE_ERROR: protocolSha256 diverge (${checkpoint.protocolSha256} !== ${expectedProtocolSha})`
    );
  }

  const expectedIntegrity = calculateStateCheckpointIntegrity({
    protocolId: checkpoint.protocolId,
    protocolSha256: checkpoint.protocolSha256,
    experiment: checkpoint.experiment,
    k: checkpoint.k,
    masterSeed: checkpoint.masterSeed,
    currentStep: checkpoint.currentStep,
    baselineStateSha: checkpoint.arms.baseline.stateSha256,
    maxLeximinStateSha: checkpoint.arms.maxLeximin.stateSha256,
  });

  if (expectedIntegrity !== checkpoint.integritySha256) {
    throw new Error(
      `RESTORE_INTEGRITY_VIOLATION: integritySha256 adulterado (${checkpoint.integritySha256} !== ${expectedIntegrity})`
    );
  }

  if (
    checkpoint.arms.baseline.currentStep !== checkpoint.currentStep ||
    checkpoint.arms.maxLeximin.currentStep !== checkpoint.currentStep
  ) {
    throw new Error("RESTORE_STEP_MISMATCH: currentStep nos braços diverge do checkpoint.");
  }

  if (
    checkpoint.arms.baseline.history.length !== checkpoint.currentStep * 5 ||
    checkpoint.arms.maxLeximin.history.length !== checkpoint.currentStep * 5
  ) {
    throw new Error("RESTORE_HISTORY_CORRUPTION: Quantidade de jogos no histórico não satisfaz |H| = 5t.");
  }

  // Verifica integridade dos bitsets
  const baseBitSha = computeSha256(checkpoint.arms.baseline.bitsetBase64);
  if (baseBitSha !== checkpoint.arms.baseline.bitsetSha256) {
    throw new Error("RESTORE_BITSET_CORRUPTION: Bitset do Baseline adulterado.");
  }
  const mlBitSha = computeSha256(checkpoint.arms.maxLeximin.bitsetBase64);
  if (mlBitSha !== checkpoint.arms.maxLeximin.bitsetSha256) {
    throw new Error("RESTORE_BITSET_CORRUPTION: Bitset do MaxLeximin adulterado.");
  }

  validateTrajectoryRecordSchema(checkpoint.horizonRecord);

  const baselineArm = ResearchArmExecutor.restoreFromState(checkpoint.arms.baseline);
  const maxLeximinArm = ResearchArmExecutor.restoreFromState(checkpoint.arms.maxLeximin);

  return { baselineArm, maxLeximinArm, checkpoint };
}

/**
 * Gera e grava atomicamente o manifesto de evidências V2, calculando SHA não-autorreferencial (F04).
 */
export function generateEvidenceManifestV2(
  baseDir: string = EVIDENCE_BASE_DIR,
  protocolSha256: string = FROZEN_RESEARCH_PROTOCOL_V2_SHA256
): EvidenceManifestV2 {
  // Limpa .tmp órfãos antes da catalogação
  cleanOrphanedTmpFiles(baseDir);

  const artifacts: EvidenceArtifactMeta[] = [];

  function scanDir(dir: string, type: "TRAJECTORY_RAW" | "CHECKPOINT" | "AGGREGATE_SUMMARY") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full, type);
      } else if (
        ent.isFile() &&
        ent.name.endsWith(".json") &&
        !ent.name.includes(".tmp.") &&
        !ent.name.endsWith(".tmp") &&
        !ent.name.startsWith("manifest")
      ) {
        const raw = fs.readFileSync(full);
        const fileSha = crypto.createHash("sha256").update(raw).digest("hex");
        let parsed: any = null;
        try {
          parsed = JSON.parse(raw.toString("utf-8"));
        } catch {
          // ignore parsing error here
        }

        artifacts.push({
          path: path.relative(process.cwd(), full),
          type,
          sizeBytes: raw.length,
          sha256: fileSha,
          experiment: parsed?.experiment,
          k: parsed?.k,
          seedIndex: parsed?.seedIndex,
          masterSeed: parsed?.masterSeed,
          horizon: parsed?.finalHorizon ?? parsed?.checkpointHorizon,
        });
      }
    }
  }

  scanDir(path.join(baseDir, "raw"), "TRAJECTORY_RAW");
  scanDir(path.join(baseDir, "checkpoints"), "CHECKPOINT");

  // Ordena artefatos de maneira determinística por path
  artifacts.sort((a, b) => a.path.localeCompare(b.path));

  const partialManifest: Omit<EvidenceManifestV2, "manifestSha256"> = {
    manifestVersion: "2.0.0",
    protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2",
    protocolSha256,
    experimentAModel: "CANONICAL_DETERMINISTIC_TRAJECTORY",
    experimentBModel: "EXOGENOUS_REPLICATED_POOLS",
    expectedTrajectoryCountA: 5,
    expectedTrajectoryCountB: 160,
    persistedArtifacts: artifacts,
    createdAt: new Date().toISOString(),
  };

  const canonicalManifestPayload = JSON.stringify(partialManifest, null, 2);
  const manifestSha256 = computeSha256(canonicalManifestPayload);

  const completeManifest: EvidenceManifestV2 = {
    ...partialManifest,
    manifestSha256,
  };

  const manifestPath = path.join(baseDir, "manifest-evidence-v2.json");
  atomicWriteFile(manifestPath, JSON.stringify(completeManifest, null, 2));

  return completeManifest;
}

export const generateEvidenceManifest = generateEvidenceManifestV2;

export interface CompletenessReport {
  readonly passed: boolean;
  readonly aTrajectoriesFound: number;
  readonly bTrajectoriesFound: number;
  readonly aExpectedTrajectories: 5;
  readonly bExpectedTrajectories: 160;
  readonly missingTrajectories: readonly string[];
  readonly duplicateTrajectories: readonly string[];
  readonly unexpectedTrajectories: readonly string[];
  readonly missingHorizons: readonly string[];
  readonly corruptedFiles: readonly string[];
}

/**
 * Gate Formal de Completude e Cardinalidade de Evidências V2 (F04 & F06).
 */
export function validateEvidenceCompletenessV2(
  baseDir: string = EVIDENCE_BASE_DIR,
  expectedProtocolSha: string = FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
  options: { readonly requireFullRun?: boolean } = { requireFullRun: false }
): CompletenessReport {
  cleanOrphanedTmpFiles(baseDir);

  const manifestPath = path.join(baseDir, "manifest-evidence-v2.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`COMPLETENESS_GATE_FAILED: Manifesto ${manifestPath} ausente.`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
  const manifest: EvidenceManifestV2 = JSON.parse(manifestRaw);

  if (manifest.protocolId !== FROZEN_RESEARCH_PROTOCOL_V2_ID) {
    throw new Error(`COMPLETENESS_GATE_FAILED: protocolId do manifesto diverge.`);
  }
  if (manifest.protocolSha256 !== expectedProtocolSha) {
    throw new Error(`COMPLETENESS_GATE_FAILED: protocolSha256 do manifesto diverge.`);
  }

  // Verifica o SHA-256 não-autorreferencial do manifesto
  const copyWithoutSha = { ...manifest, manifestSha256: undefined };
  delete (copyWithoutSha as any).manifestSha256;
  const expectedManifestSha = computeSha256(JSON.stringify(copyWithoutSha, null, 2));
  if (manifest.manifestSha256 !== expectedManifestSha) {
    throw new Error(
      `COMPLETENESS_GATE_FAILED: SHA do manifesto adulterado (${manifest.manifestSha256} !== ${expectedManifestSha})`
    );
  }

  const corruptedFiles: string[] = [];
  for (const art of manifest.persistedArtifacts) {
    if (!fs.existsSync(art.path)) {
      corruptedFiles.push(`MISSING_FILE: ${art.path}`);
      continue;
    }
    const rawBytes = fs.readFileSync(art.path);
    const diskSha = crypto.createHash("sha256").update(rawBytes).digest("hex");
    if (diskSha !== art.sha256) {
      corruptedFiles.push(`SHA_MISMATCH: ${art.path} (disco: ${diskSha}, manifesto: ${art.sha256})`);
    }
  }

  if (corruptedFiles.length > 0) {
    throw new Error(`COMPLETENESS_GATE_FAILED: Arquivos corrompidos detectados: ${corruptedFiles.join(", ")}`);
  }

  const kGrid = [10, 20, 50, 100, 500];
  const expectedHorizons = [100, 500, 1000, 2000, 3788];

  const rawArtifacts = manifest.persistedArtifacts.filter(a => a.type === "TRAJECTORY_RAW");
  const aSeen = new Set<number>(); // K
  const bSeen = new Set<string>(); // K:seedIndex
  const missingHorizons: string[] = [];
  const duplicateTrajectories: string[] = [];
  const unexpectedTrajectories: string[] = [];

  for (const art of rawArtifacts) {
    const fullPath = path.isAbsolute(art.path) ? art.path : path.join(process.cwd(), art.path);
    const rawData = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as TrajectoryEvidenceFile;

    if (rawData.experiment === "EXPERIMENT_A") {
      if (!kGrid.includes(rawData.k)) {
        unexpectedTrajectories.push(`Exp A: K não autorizado (${rawData.k})`);
      }
      if (aSeen.has(rawData.k)) {
        duplicateTrajectories.push(`Exp A K=${rawData.k}`);
      }
      aSeen.add(rawData.k);

      // Verifica horizons
      for (const h of expectedHorizons) {
        if (!rawData.horizonRecords[h]) {
          missingHorizons.push(`Exp A K=${rawData.k} t=${h}`);
        }
      }
    } else if (rawData.experiment === "EXPERIMENT_B") {
      if (!kGrid.includes(rawData.k)) {
        unexpectedTrajectories.push(`Exp B: K não autorizado (${rawData.k})`);
      }
      const sIdx = rawData.seedIndex ?? -1;
      if (sIdx < 0 || sIdx >= 32) {
        unexpectedTrajectories.push(`Exp B: seedIndex fora da faixa 0..31 (${sIdx})`);
      }
      const key = `${rawData.k}:${sIdx}`;
      if (bSeen.has(key)) {
        duplicateTrajectories.push(`Exp B K=${rawData.k} seed=${sIdx}`);
      }
      bSeen.add(key);

      // Verifica horizons
      for (const h of expectedHorizons) {
        if (!rawData.horizonRecords[h]) {
          missingHorizons.push(`Exp B K=${rawData.k} seed=${sIdx} t=${h}`);
        }
      }
    }
  }

  const missingTrajectories: string[] = [];
  if (options.requireFullRun) {
    for (const k of kGrid) {
      if (!aSeen.has(k)) missingTrajectories.push(`Exp A K=${k}`);
      for (let s = 0; s < 32; s++) {
        if (!bSeen.has(`${k}:${s}`)) missingTrajectories.push(`Exp B K=${k} seed=${s}`);
      }
    }
  }

  const passed =
    corruptedFiles.length === 0 &&
    duplicateTrajectories.length === 0 &&
    unexpectedTrajectories.length === 0 &&
    (!options.requireFullRun || (missingTrajectories.length === 0 && missingHorizons.length === 0));

  if (!passed) {
    throw new Error(
      `COMPLETENESS_GATE_FAILED: Falha na validação de integridade/cardinalidade de evidências: ` +
      `corruptedFiles=${corruptedFiles.length}, ` +
      `duplicateTrajectories=${duplicateTrajectories.length}, ` +
      `unexpectedTrajectories=${unexpectedTrajectories.length}, ` +
      `missingTrajectories=${missingTrajectories.length}, ` +
      `missingHorizons=${missingHorizons.length}`
    );
  }

  return {
    passed,
    aTrajectoriesFound: aSeen.size,
    bTrajectoriesFound: bSeen.size,
    aExpectedTrajectories: 5,
    bExpectedTrajectories: 160,
    missingTrajectories,
    duplicateTrajectories,
    unexpectedTrajectories,
    missingHorizons,
    corruptedFiles,
  };
}
