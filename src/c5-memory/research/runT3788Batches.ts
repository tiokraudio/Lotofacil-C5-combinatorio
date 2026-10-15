/**
 * C5-MEMORY — Driver Oficial de Execução Definitiva T3788 em Lotes
 * Protocolo: C5_MEMORY_210_RESEARCH_PROTOCOL_V2
 *
 * Executa as 165 trajetórias em lotes controlados com persistência incremental
 * de checkpoints em cada horizonte oficial [100, 500, 1000, 2000, 3788],
 * exportação de backups recuperáveis e rastreamento de progresso verificável.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as assert from "node:assert";
import {
  validateResearchProtocolV2Binding,
  ValidatedProtocolV2,
  FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
} from "./protocolValidator";
import {
  deriveOfficialMasterSeeds,
  ExecutionMode,
} from "./engine";
import {
  cleanOrphanedTmpFiles,
  persistTrajectoryEvidence,
  generateEvidenceManifestV2,
  generateAggregatesAndReportsV2,
  validateEvidenceCompletenessV2,
  EVIDENCE_BASE_DIR,
  TrajectoryEvidenceFile,
} from "./evidenceStore";
import { runSingleTrajectoryV2 } from "./runDefinitiveResearchV2";
import { createRecoverableExecutionBackup } from "./backupStore";

export interface T3788ProgressState {
  t3788Status: "IN_PROGRESS" | "COMPLETED";
  experimentACompleted: number;
  experimentBCompleted: number;
  rawCompleted: number;
  horizonRecordsCompleted: number;
  currentK: number;
  currentSeedIndex: number | null;
  lastPersistedCheckpoint: string | null;
  latestBackupSha256: string | null;
  latestBackupPath: string | null;
  updatedAt: string;
}

export function countCompletedEvidence(baseDir: string = EVIDENCE_BASE_DIR): {
  expACompleted: number;
  expBCompleted: number;
  totalRaw: number;
  totalHorizonRecords: number;
  lastCheckpoint: string | null;
} {
  const rawADir = path.join(baseDir, "raw", "experiment-a");
  const rawBDir = path.join(baseDir, "raw", "experiment-b");
  const chkDir = path.join(baseDir, "checkpoints");

  let expA = 0;
  let expB = 0;
  let totalHorizonRecords = 0;

  const kGrid = [10, 20, 50, 100, 500];
  const officialHorizons = [100, 500, 1000, 2000, 3788];

  if (fs.existsSync(rawADir)) {
    for (const k of kGrid) {
      const file = path.join(rawADir, `canonical_k${k}.json`);
      if (fs.existsSync(file)) {
        try {
          const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as TrajectoryEvidenceFile;
          if (raw.finalHorizon >= 3788 && officialHorizons.every((h) => raw.horizonRecords && raw.horizonRecords[h])) {
            expA++;
            totalHorizonRecords += officialHorizons.length;
          }
        } catch {}
      }
    }
  }

  if (fs.existsSync(rawBDir)) {
    for (const k of kGrid) {
      for (let s = 0; s < 32; s++) {
        const file = path.join(rawBDir, `k${k}_seed${s}.json`);
        if (fs.existsSync(file)) {
          try {
            const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as TrajectoryEvidenceFile;
            if (raw.finalHorizon >= 3788 && officialHorizons.every((h) => raw.horizonRecords && raw.horizonRecords[h])) {
              expB++;
              totalHorizonRecords += officialHorizons.length;
            }
          } catch {}
        }
      }
    }
  }

  let lastCheckpoint: string | null = null;
  if (fs.existsSync(chkDir)) {
    const chkFiles = fs.readdirSync(chkDir).filter((f) => f.startsWith("state_") && f.endsWith(".json"));
    if (chkFiles.length > 0) {
      chkFiles.sort();
      lastCheckpoint = chkFiles[chkFiles.length - 1];
    }
  }

  return {
    expACompleted: expA,
    expBCompleted: expB,
    totalRaw: expA + expB,
    totalHorizonRecords,
    lastCheckpoint,
  };
}

export function saveProgressState(
  state: T3788ProgressState,
  baseDir: string = EVIDENCE_BASE_DIR
): void {
  const progressPath = path.join(baseDir, "t3788_progress.json");
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify(state, null, 2), "utf-8");
}

export function exportBatchBackup(baseDir: string = EVIDENCE_BASE_DIR): {
  archivePath: string;
  archiveSha256: string;
} | null {
  const publicDir = path.resolve("public");
  fs.mkdirSync(publicDir, { recursive: true });
  const archivePath = path.join(publicDir, "c5-memory-t3788-execution-backup.tar.gz");

  try {
    const res = createRecoverableExecutionBackup({
      sourceDir: baseDir,
      outputTarGzPath: archivePath,
      publicDownloadPath: archivePath,
    });
    return {
      archivePath: res.archivePath,
      archiveSha256: res.archiveSha256,
    };
  } catch (err: any) {
    console.error("[BACKUP_EXPORT_ERROR] Não foi possível exportar backup:", err.message);
    return null;
  }
}

export async function runT3788BatchExecution(params: {
  readonly authorizedForT3788: boolean;
  readonly batch?: "EXP_A" | "EXP_B_K10" | "EXP_B_K20" | "EXP_B_K50" | "EXP_B_K100" | "EXP_B_K500" | "ALL";
  readonly baseDir?: string;
  readonly executionMode?: ExecutionMode;
  readonly maxTrajectoriesInRun?: number;
}): Promise<T3788ProgressState> {
  const {
    authorizedForT3788,
    batch = "ALL",
    baseDir = EVIDENCE_BASE_DIR,
    executionMode = "OPTIMIZED",
    maxTrajectoriesInRun,
  } = params;

  if (!authorizedForT3788) {
    throw new Error("T3788_UNAUTHORIZED: Execução de T3788 requer autorização explícita.");
  }

  const protocol: ValidatedProtocolV2 = validateResearchProtocolV2Binding();
  assert.strictEqual(
    protocol.calculatedSha256,
    FROZEN_RESEARCH_PROTOCOL_V2_SHA256,
    "Protocolo V2 deve coincidir rigorosamente com o hash congelado."
  );

  cleanOrphanedTmpFiles(baseDir);

  const kGrid = [...protocol.kGrid]; // [10, 20, 50, 100, 500]
  const horizons = [...protocol.horizons]; // [100, 500, 1000, 2000, 3788]
  const officialSeeds = deriveOfficialMasterSeeds(protocol.masterSeeds.masterSalt, protocol.masterSeeds.count);

  let trajectoriesExecutedThisRun = 0;
  let currentK = kGrid[0];
  let currentSeedIndex: number | null = null;
  let lastPersistedCheckpoint: string | null = null;

  // 1. EXECUÇÃO DO EXPERIMENTO A (5 trajetórias)
  if (batch === "ALL" || batch === "EXP_A") {
    console.log("\n>>> INICIANDO LOTE: EXPERIMENTO A (5 trajetórias canônicas)...");
    for (const k of kGrid) {
      if (maxTrajectoriesInRun !== undefined && trajectoriesExecutedThisRun >= maxTrajectoriesInRun) {
        break;
      }
      currentK = k;
      currentSeedIndex = null;

      const rawFile = path.join(baseDir, "raw", "experiment-a", `canonical_k${k}.json`);
      if (fs.existsSync(rawFile)) {
        try {
          const existing = JSON.parse(fs.readFileSync(rawFile, "utf-8")) as TrajectoryEvidenceFile;
          if (existing.finalHorizon >= 3788 && horizons.every((h) => existing.horizonRecords && existing.horizonRecords[h])) {
            console.log(`[EXP_A_SKIP] Trajetória Canônica K=${k} já concluída (RAW válido em disco).`);
            continue;
          }
        } catch {}
      }

      console.log(`[EXP_A_EXEC] Executando Trajetória Canônica K=${k} (horizontes 100..3788)...`);
      const res = runSingleTrajectoryV2({
        protocol,
        experiment: "EXPERIMENT_A",
        k,
        masterSeed: "CANONICAL_OPERATIONAL",
        targetHorizons: horizons,
        baseDir,
        resume: true,
        executionMode,
      });

      lastPersistedCheckpoint = `state_experiment_a_k${k}_canonical_t3788.json`;
      trajectoriesExecutedThisRun++;
      console.log(`[EXP_A_DONE] Canônica K=${k} concluída! ML Fingerprint: ${res.mlFinalFingerprint.slice(0, 16)}...`);
    }

    // Exporta backup do lote Exp A
    exportBatchBackup(baseDir);
  }

  // 2. EXECUÇÃO DO EXPERIMENTO B (160 trajetórias)
  const expBBatches: Array<{ targetBatch: string; k: number }> = [
    { targetBatch: "EXP_B_K10", k: 10 },
    { targetBatch: "EXP_B_K20", k: 20 },
    { targetBatch: "EXP_B_K50", k: 50 },
    { targetBatch: "EXP_B_K100", k: 100 },
    { targetBatch: "EXP_B_K500", k: 500 },
  ];

  for (const bInfo of expBBatches) {
    if (batch !== "ALL" && batch !== bInfo.targetBatch) {
      continue;
    }

    const k = bInfo.k;
    currentK = k;
    console.log(`\n>>> INICIANDO LOTE: EXPERIMENTO B K=${k} (32 sementes exógenas)...`);

    for (let s = 0; s < 32; s++) {
      if (maxTrajectoriesInRun !== undefined && trajectoriesExecutedThisRun >= maxTrajectoriesInRun) {
        break;
      }
      currentSeedIndex = s;

      const rawFile = path.join(baseDir, "raw", "experiment-b", `k${k}_seed${s}.json`);
      if (fs.existsSync(rawFile)) {
        try {
          const existing = JSON.parse(fs.readFileSync(rawFile, "utf-8")) as TrajectoryEvidenceFile;
          if (existing.finalHorizon >= 3788 && horizons.every((h) => existing.horizonRecords && existing.horizonRecords[h])) {
            console.log(`[EXP_B_SKIP] Trajetória K=${k} seed=${s} já concluída (RAW válido em disco).`);
            continue;
          }
        } catch {}
      }

      console.log(`[EXP_B_EXEC] Executando Trajetória K=${k} seed=${s} (horizontes 100..3788)...`);
      const res = runSingleTrajectoryV2({
        protocol,
        experiment: "EXPERIMENT_B",
        k,
        masterSeed: officialSeeds[s],
        seedIndex: s,
        targetHorizons: horizons,
        baseDir,
        resume: true,
        executionMode,
      });

      lastPersistedCheckpoint = `state_experiment_b_k${k}_s${s}_t3788.json`;
      trajectoriesExecutedThisRun++;
      console.log(`[EXP_B_DONE] K=${k} seed=${s} concluída! ML Fingerprint: ${res.mlFinalFingerprint.slice(0, 16)}...`);
    }

    // Exporta backup após cada K concluído
    exportBatchBackup(baseDir);
  }

  // 3. APURAÇÃO FINAL E STATUS
  const counts = countCompletedEvidence(baseDir);
  const backupRes = exportBatchBackup(baseDir);

  const isFullRunCompleted = counts.expACompleted === 5 && counts.expBCompleted === 160 && counts.totalRaw === 165;

  if (isFullRunCompleted) {
    console.log("\n>>> TODAS AS 165 TRAJETÓRIAS CONCLUÍDAS! GERANDO AGREGADOS E MANIFESTO DEFINITIVO...");
    generateAggregatesAndReportsV2(baseDir, protocol.calculatedSha256);
    const manifest = generateEvidenceManifestV2(baseDir, protocol.calculatedSha256);
    validateEvidenceCompletenessV2(baseDir, protocol.calculatedSha256, { requireFullRun: true });
    console.log(`[MANIFEST_GENERATED] SHA-256 do manifesto: ${manifest.manifestSha256}`);
  }

  const finalState: T3788ProgressState = {
    t3788Status: isFullRunCompleted ? "COMPLETED" : "IN_PROGRESS",
    experimentACompleted: counts.expACompleted,
    experimentBCompleted: counts.expBCompleted,
    rawCompleted: counts.totalRaw,
    horizonRecordsCompleted: counts.totalHorizonRecords,
    currentK,
    currentSeedIndex,
    lastPersistedCheckpoint: counts.lastCheckpoint ?? lastPersistedCheckpoint,
    latestBackupSha256: backupRes?.archiveSha256 ?? null,
    latestBackupPath: backupRes?.archivePath ?? null,
    updatedAt: new Date().toISOString(),
  };

  saveProgressState(finalState, baseDir);
  return finalState;
}

// Execução via CLI
if (process.argv[1]?.includes("runT3788Batches")) {
  const args = process.argv.slice(2);
  let batchArg: any = "ALL";
  let maxTrajArg: number | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch" && args[i + 1]) {
      batchArg = args[i + 1];
    }
    if (args[i] === "--max" && args[i + 1]) {
      maxTrajArg = parseInt(args[i + 1], 10);
    }
  }

  runT3788BatchExecution({
    authorizedForT3788: true,
    batch: batchArg,
    maxTrajectoriesInRun: maxTrajArg,
    executionMode: "OPTIMIZED",
  })
    .then((state) => {
      console.log("\n===============================================================================");
      console.log(" T3788 PROGRESS REPORT");
      console.log("===============================================================================");
      console.log(`T3788_STATUS = ${state.t3788Status}`);
      console.log(`EXPERIMENT_A_COMPLETED = ${state.experimentACompleted}`);
      console.log(`EXPERIMENT_B_COMPLETED = ${state.experimentBCompleted}`);
      console.log(`RAW_COMPLETED = ${state.rawCompleted}`);
      console.log(`HORIZON_RECORDS_COMPLETED = ${state.horizonRecordsCompleted}`);
      console.log(`CURRENT_K = ${state.currentK}`);
      console.log(`CURRENT_SEED_INDEX = ${state.currentSeedIndex ?? "NONE"}`);
      console.log(`LAST_PERSISTED_CHECKPOINT = ${state.lastPersistedCheckpoint ?? "NONE"}`);
      console.log(`LATEST_BACKUP_SHA256 = ${state.latestBackupSha256 ?? "NONE"}`);
      console.log("===============================================================================");
    })
    .catch((err: any) => {
      console.error("FATAL ERROR IN T3788 BATCH RUNNER:", err);
      process.exit(1);
    });
}
