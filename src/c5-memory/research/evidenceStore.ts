/**
 * Gerenciador de Armazenamento e Persistência Incremental de Evidências Científicas (IC10-R1)
 * Protocolo: C5_MEMORY_210_RESEARCH_PROTOCOL_V2
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export function computeSha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(typeof content === "string" ? Buffer.from(content, "utf-8") : content).digest("hex");
}

export const EVIDENCE_BASE_DIR = "certification/c5-memory-v2/research/evidence-v2" as const;

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
  readonly poolHash?: string;
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

export interface IncrementalCheckpointFile {
  readonly protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2";
  readonly checkpointHorizon: number;
  readonly experiment: "EXPERIMENT_A" | "EXPERIMENT_B";
  readonly k: number;
  readonly completedSeedsCount: number;
  readonly records: readonly RawTrajectoryHorizonRecord[];
  readonly persistedAt: string;
}

export interface EvidenceManifest {
  readonly manifestVersion: "2.0.0";
  readonly protocolId: "C5_MEMORY_210_RESEARCH_PROTOCOL_V2";
  readonly protocolSha256: string;
  readonly experimentAModel: "CANONICAL_DETERMINISTIC_TRAJECTORY";
  readonly experimentBModel: "EXOGENOUS_REPLICATED_POOLS";
  readonly expectedTrajectoryCountA: number; // 5 (1 per K in [10, 20, 50, 100, 500])
  readonly expectedTrajectoryCountB: number; // 160 (32 seeds * 5 K)
  readonly persistedArtifacts: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly type: "TRAJECTORY_RAW" | "CHECKPOINT" | "AGGREGATE_SUMMARY";
  }[];
  readonly createdAt: string;
  readonly manifestSha256?: string;
}

/**
 * Valida o schema de um registro bruto de horizonte. Lança erro se qualquer campo obrigatório estiver ausente.
 */
export function validateTrajectoryRecordSchema(record: RawTrajectoryHorizonRecord): void {
  const requiredNumericFields: (keyof RawTrajectoryHorizonRecord)[] = [
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
    "delta15",
    "delta14Plus",
    "delta13Plus",
    "delta12Plus",
    "delta11Plus",
    "deltaPercent14Plus",
    "historyCardinality",
    "duplicateCount",
  ];

  if (!record.experiment || !["EXPERIMENT_A", "EXPERIMENT_B"].includes(record.experiment)) {
    throw new Error(`SCHEMA_ERROR: experiment inválido ou ausente: ${record.experiment}`);
  }

  if (typeof record.masterSeed !== "string" || record.masterSeed.length === 0) {
    throw new Error("SCHEMA_ERROR: masterSeed deve ser string não-vazia.");
  }

  for (const field of requiredNumericFields) {
    if (typeof record[field] !== "number" || isNaN(record[field] as number)) {
      throw new Error(`SCHEMA_ERROR: campo numérico ausente ou inválido: ${field}`);
    }
  }

  if (!record.timings || typeof record.timings.meanSelectionMs !== "number") {
    throw new Error("SCHEMA_ERROR: timings ausente ou inválido.");
  }
}

/**
 * Salva incrementalmente uma trajetória completa de um par (experimento, K, semente).
 */
export function persistTrajectoryEvidence(
  evidence: TrajectoryEvidenceFile,
  baseDir: string = EVIDENCE_BASE_DIR
): { readonly filePath: string; readonly sha256: string; readonly sizeBytes: number } {
  for (const t of Object.keys(evidence.horizonRecords)) {
    validateTrajectoryRecordSchema(evidence.horizonRecords[Number(t)]);
  }

  const subDir =
    evidence.experiment === "EXPERIMENT_A"
      ? path.join(baseDir, "raw", "experiment-a")
      : path.join(baseDir, "raw", "experiment-b");

  fs.mkdirSync(subDir, { recursive: true });

  const fileName =
    evidence.experiment === "EXPERIMENT_A"
      ? `canonical_k${evidence.k}.json`
      : `k${evidence.k}_seed${evidence.seedIndex ?? 0}.json`;

  const targetPath = path.join(subDir, fileName);
  const jsonContent = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(targetPath, jsonContent, "utf-8");

  const sha256 = computeSha256(jsonContent);
  const sizeBytes = Buffer.byteLength(jsonContent, "utf-8");

  return { filePath: targetPath, sha256, sizeBytes };
}

/**
 * Salva um checkpoint incremental para um determinado horizonte T e K.
 */
export function persistIncrementalCheckpoint(
  checkpoint: IncrementalCheckpointFile,
  baseDir: string = EVIDENCE_BASE_DIR
): { readonly filePath: string; readonly sha256: string; readonly sizeBytes: number } {
  for (const record of checkpoint.records) {
    validateTrajectoryRecordSchema(record);
  }

  const chkDir = path.join(baseDir, "checkpoints");
  fs.mkdirSync(chkDir, { recursive: true });

  const fileName = `checkpoint_${checkpoint.experiment.toLowerCase()}_k${checkpoint.k}_t${checkpoint.checkpointHorizon}.json`;
  const targetPath = path.join(chkDir, fileName);
  const jsonContent = JSON.stringify(checkpoint, null, 2);
  fs.writeFileSync(targetPath, jsonContent, "utf-8");

  const sha256 = computeSha256(jsonContent);
  const sizeBytes = Buffer.byteLength(jsonContent, "utf-8");

  return { filePath: targetPath, sha256, sizeBytes };
}

/**
 * Cria ou atualiza o manifesto formal de evidências V2.
 */
export function generateEvidenceManifest(
  baseDir: string = EVIDENCE_BASE_DIR,
  protocolSha256: string
): EvidenceManifest {
  const artifacts: {
    path: string;
    sizeBytes: number;
    sha256: string;
    type: "TRAJECTORY_RAW" | "CHECKPOINT" | "AGGREGATE_SUMMARY";
  }[] = [];

  function scanDir(dir: string, type: "TRAJECTORY_RAW" | "CHECKPOINT" | "AGGREGATE_SUMMARY") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full, type);
      } else if (ent.isFile() && ent.name.endsWith(".json") && !ent.name.startsWith("manifest")) {
        const raw = fs.readFileSync(full);
        artifacts.push({
          path: path.relative(process.cwd(), full),
          sizeBytes: raw.length,
          sha256: crypto.createHash("sha256").update(raw).digest("hex"),
          type,
        });
      }
    }
  }

  scanDir(path.join(baseDir, "raw"), "TRAJECTORY_RAW");
  scanDir(path.join(baseDir, "checkpoints"), "CHECKPOINT");

  const manifest: EvidenceManifest = {
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

  const manifestPath = path.join(baseDir, "manifest-evidence-v2.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  return manifest;
}
