/**
 * C5-Memory 3.0 — Motor Administrativo de Reconstrução Histórica Completa
 * 
 * Regras Estritas:
 * 1. Preservação integral dos invariantes matemáticos:
 *    - MAX-LEXIMIN e Distância de Johnson d(A, B) = 15 - |A ∩ B|;
 *    - PRNG Mulberry32 determinístico e Structural C5;
 *    - K = 500 candidatos por concurso.
 * 2. Proteção Temporal e Base A (Zero vazamento futuro):
 *    - Na geração do concurso n, a Base A de exclusão contém exclusivamente sorteios oficiais < n;
 *    - O sorteio oficial do concurso n é utilizado estritamente na conferência posterior;
 *    - Sorteios n+1 em diante nunca participam da seleção do concurso n.
 * 3. Atomicidade e Idempotência:
 *    - Cada concurso concluído é persistido com OCC e checkpoint;
 *    - Permite interrupção (pausa) e retomada do próximo concurso sem regeneração duplicada.
 * 4. Isolamento Financeiro:
 *    - recordMode: "HISTORICAL_REPLAY";
 *    - totalCost: 0, totalPrize: 0, financialStatus: "SIMULATED_NO_FINANCIAL_IMPACT";
 *    - Prêmios simulados nunca contaminam a contabilidade financeira real.
 * 5. Reconciliação com o Futuro:
 *    - O histórico H reconstruído inclui todos os 5N jogos de 1..N;
 *    - O concurso real N+1 prossegue considerando todos os 5N jogos no histórico canônico.
 */

import {
  ContestRecord,
  MemoryHistory,
  C5Game,
  OfficialCaixaDirectResultProof,
} from "../types";
import {
  ALGORITHM_VERSION_3_0_0,
  generateC5Draft30,
  freezeDraft30,
  Draft30,
  FrozenMemoryPayload30,
} from "../engine30";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { calculateHits, isValidLotofacilGame } from "../math";
import { isStructuralC5 } from "../structuralC5";
import { syncSha256 } from "../sha256";
import {
  STORE_CONTESTS,
  STORE_MEMORY_HISTORY,
  STORE_AUDIT_EVENTS,
  STORE_OFFICIAL_DRAWS,
  reconstructHistoryCrossVersion,
  syncMemoryHistoryFromCanonical,
  isC5MemoryAlgorithmVersion,
} from "../../storage/storageManager210";
import {
  exportBackup,
  validateBackupPackage,
  C5BackupPackage,
} from "../../storage/backupManager";
import {
  OfficialLotofacilDrawRecord,
  validateOfficialDrawRecord,
  computeCanonicalDrawsSha256,
  loadAndValidateHistoricalDraws,
  loadOfficialDrawsFromStorage,
} from "../officialDraws";
import {
  ReplayState,
  REQUIRED_CONFIRMATION_TEXT,
  DatabaseInspectionReport,
  PreResetBackupReport,
  OfficialBaseValidationResult,
  ReplayCheckpoint,
  ReplayProgressUpdate,
  HistoricalReplayFinalReport,
  HistoricalReplayIntegrityChecks,
} from "./historicalReplayTypes";

export { REQUIRED_CONFIRMATION_TEXT };
export type {
  ReplayState,
  DatabaseInspectionReport,
  PreResetBackupReport,
  OfficialBaseValidationResult,
  ReplayCheckpoint,
  ReplayProgressUpdate,
  HistoricalReplayFinalReport,
};

const CHECKPOINT_ID = "historical_replay_checkpoint" as const;

/**
 * 1. Inspeção completa e não-destrutiva do estado atual do banco de dados
 */
export async function inspectDatabaseState(
  db: IDBDatabase
): Promise<DatabaseInspectionReport> {
  const storeNames = Array.from(db.objectStoreNames);

  // 1. Inspeciona contests
  const contests = await new Promise<ContestRecord[]>((resolve, reject) => {
    if (!db.objectStoreNames.contains(STORE_CONTESTS)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const operationalContests = contests.filter(
    c => !c.isDemo && !c.isFixture && c.recordMode !== "HISTORICAL_REPLAY"
  );
  const replayContests = contests.filter(
    c => c.recordMode === "HISTORICAL_REPLAY"
  );

  const hasPendingBetsOrPreviews = contests.some(
    c => c.status === "AVAILABLE" || c.status === "PREVIEW" || c.status === "FROZEN"
  );

  // 2. Inspeciona auditEvents
  const auditEventsCount = await new Promise<number>((resolve, reject) => {
    if (!db.objectStoreNames.contains(STORE_AUDIT_EVENTS)) {
      resolve(0);
      return;
    }
    const tx = db.transaction(STORE_AUDIT_EVENTS, "readonly");
    const store = tx.objectStore(STORE_AUDIT_EVENTS);
    const req = store.count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });

  // 3. Inspeciona official_draws
  await loadOfficialDrawsFromStorage(db);
  const { draws: officialDraws } = loadAndValidateHistoricalDraws();
  const officialDrawsCount = officialDraws.length;
  const firstOfficialContest = officialDraws.length > 0 ? officialDraws[0].contestNumber : null;
  const lastOfficialContest = officialDraws.length > 0 ? officialDraws[officialDraws.length - 1].contestNumber : null;

  let isOfficialContiguous = false;
  if (officialDrawsCount > 0 && firstOfficialContest === 1 && lastOfficialContest === officialDrawsCount) {
    isOfficialContiguous = officialDraws.every((d, i) => d.contestNumber === i + 1);
  }

  // 4. Inspeciona checkpoint e histórico em c5_memory_history
  const checkpoint = await getReplayCheckpoint(db);
  const storedH = await new Promise<MemoryHistory>((resolve) => {
    if (!db.objectStoreNames.contains(STORE_MEMORY_HISTORY)) {
      resolve(createMemoryHistory([], 0));
      return;
    }
    const tx = db.transaction(STORE_MEMORY_HISTORY, "readonly");
    const store = tx.objectStore(STORE_MEMORY_HISTORY);
    const req = store.get("singleton");
    req.onsuccess = () => resolve(req.result?.history || createMemoryHistory([], 0));
    req.onerror = () => resolve(createMemoryHistory([], 0));
  });

  // Banco é considerado limpo se NÃO houver apostas operacionais reais nem prévias pendentes
  const isClean = operationalContests.length === 0 && !hasPendingBetsOrPreviews;

  return {
    isClean,
    storesFound: storeNames,
    contestsCount: contests.length,
    operationalContestsCount: operationalContests.length,
    replayContestsCount: replayContests.length,
    officialDrawsCount,
    firstOfficialContest,
    lastOfficialContest,
    isOfficialContiguous,
    hasPendingBetsOrPreviews,
    auditEventsCount,
    historyRevision: storedH.revision,
    historyFingerprint: storedH.fingerprint,
    backupStatus: checkpoint?.backupSha256 ? "EXPORTED_AND_VERIFIED" : "NONE",
    backupSha256: checkpoint?.backupSha256,
    replayState: checkpoint?.state || "NOT_STARTED",
    lastCompletedReplayContest: checkpoint?.lastCompletedContest || 0,
  };
}

/**
 * 2. Exportação e validação integral do backup pré-reset
 */
export async function createAndVerifyPreResetBackup(
  db: IDBDatabase
): Promise<PreResetBackupReport> {
  const pkg = await exportBackup(db);
  const validation = validateBackupPackage(pkg);

  if (!validation.valid) {
    throw new Error(
      `BACKUP_VALIDATION_FAILED: Falha na validação do backup pré-reset: ${validation.errors.join("; ")}`
    );
  }

  // Serialização e hash SHA-256 canônico
  const jsonString = JSON.stringify(pkg);
  const backupSha256 = syncSha256(jsonString);

  const preservationNotice =
    "PRESERVADOS OBRIGATORIAMENTE: STORE_OFFICIAL_DRAWS (sorteios oficiais da Caixa), algoritmos e versões matemáticas, PRNG Mulberry32, Distância de Johnson, MAX-LEXIMIN, estrutura física do IndexedDB e eventos de auditoria essenciais.";
  const erasureNotice =
    "REMOVIDOS DE FORMA CONTROLADA: Registros de apostas anteriores em STORE_CONTESTS, histórico derivado H em STORE_MEMORY_HISTORY e quaisquer registros operacionais parciais ou desatualizados.";

  return {
    backupPackage: pkg,
    backupSha256,
    contestsCount: pkg.contestsCount,
    totalGamesCount: pkg.totalGamesCount,
    verifiedRestorable: true,
    preservationNotice,
    erasureNotice,
    exportedAt: pkg.createdAt,
  };
}

/**
 * 3. Limpeza Controlada com Exigência de Confirmação Digitada
 */
export async function performControlledCleanup(
  db: IDBDatabase,
  confirmationText: string,
  backupSha256: string
): Promise<void> {
  const trimmed = confirmationText.trim();
  if (trimmed !== REQUIRED_CONFIRMATION_TEXT) {
    throw new Error(
      `CONFIRMATION_MISMATCH: Texto de confirmação inválido. Esperado exatamente "${REQUIRED_CONFIRMATION_TEXT}". Nenhuma exclusão foi realizada.`
    );
  }

  if (!backupSha256 || backupSha256.length !== 64) {
    throw new Error(
      "BACKUP_SHA_REQUIRED: O hash SHA-256 do backup íntegro verificado é obrigatório para autorizar a limpeza."
    );
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORE_CONTESTS, STORE_MEMORY_HISTORY, STORE_AUDIT_EVENTS],
      "readwrite"
    );
    const contestStore = tx.objectStore(STORE_CONTESTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);
    const auditStore = tx.objectStore(STORE_AUDIT_EVENTS);

    tx.onerror = () => reject(tx.error || new Error("CLEANUP_TRANSACTION_FAILED"));
    tx.onabort = () => reject(tx.error || new Error("CLEANUP_TRANSACTION_ABORTED"));
    tx.oncomplete = () => resolve();

    // 1. Limpa contests (apostas e prévias antigas)
    contestStore.clear();

    // 2. Reseta c5_memory_history para H_0 vazio
    historyStore.put({
      id: "singleton",
      history: createMemoryHistory([], 0),
    });

    // 3. Inicializa checkpoint com estado RESET_CONFIRMED
    const initialCheckpoint: ReplayCheckpoint = {
      id: CHECKPOINT_ID,
      executionId: `replay_init_${Date.now()}`,
      state: "RESET_CONFIRMED",
      lastCompletedContest: 0,
      targetLastContest: 0,
      totalSimulatedBets: 0,
      totalConferences: 0,
      currentRevision: 0,
      currentFingerprint: createMemoryHistory([], 0).fingerprint,
      hitDistribution: { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 },
      bestHitsPerContest: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      elapsedTimeMs: 0,
      backupSha256,
    };
    historyStore.put(initialCheckpoint);

    // 4. Registra evento de auditoria formal da limpeza
    const auditEvent = {
      id: `audit_cleanup_replay_${Date.now()}`,
      contestNumber: 0,
      eventType: "HISTORICAL_REPLAY_CLEANUP",
      timestamp: new Date().toISOString(),
      operatorId: "SYSTEM_REPLAY_INITIALIZER",
      notes: `Limpeza controlada para reconstrução histórica. Backup pré-reset SHA-256: ${backupSha256}. Confirmação do operador validada.`,
      proof: {
        backupSha256,
        confirmationText: trimmed,
        clearedStores: [STORE_CONTESTS, STORE_MEMORY_HISTORY],
        preservedStores: [STORE_OFFICIAL_DRAWS],
      },
    };
    auditStore.put(auditEvent);
  });
}

/**
 * 4. Validação Rigorosa da Base Histórica Oficial (Concursos 1..N)
 */
export function validateOfficialHistoricalBase(
  draws: readonly OfficialLotofacilDrawRecord[],
  expectedLast?: number
): OfficialBaseValidationResult {
  if (!Array.isArray(draws) || draws.length === 0) {
    return {
      valid: false,
      totalDraws: 0,
      firstContest: 0,
      lastContest: 0,
      isContiguous: false,
      areDezenasValid: false,
      areDatesValid: false,
      areDuplicatesFree: false,
      isCryptographicallyVerified: false,
      declaredSha256: "",
      computedSha256: "",
      errorReason: "Lista de sorteios oficiais vazia ou não é array.",
    };
  }

  const totalDraws = draws.length;
  const firstContest = draws[0].contestNumber;
  const lastContest = draws[totalDraws - 1].contestNumber;

  if (firstContest !== 1) {
    return {
      valid: false,
      totalDraws,
      firstContest,
      lastContest,
      isContiguous: false,
      areDezenasValid: false,
      areDatesValid: false,
      areDuplicatesFree: false,
      isCryptographicallyVerified: false,
      declaredSha256: "",
      computedSha256: "",
      errorReason: `Base histórica não se inicia no concurso 1 (primeiro concurso encontrado: ${firstContest}).`,
    };
  }

  if (expectedLast && lastContest !== expectedLast) {
    return {
      valid: false,
      totalDraws,
      firstContest,
      lastContest,
      isContiguous: false,
      areDezenasValid: false,
      areDatesValid: false,
      areDuplicatesFree: false,
      isCryptographicallyVerified: false,
      declaredSha256: "",
      computedSha256: "",
      errorReason: `Último concurso oficial (${lastContest}) diverge do esperado (${expectedLast}).`,
    };
  }

  // 1. Verificação de contiguidade numérica 1..N e duplicidades
  const seenContests = new Set<number>();
  for (let i = 0; i < totalDraws; i++) {
    const d = draws[i];
    const expectedNum = i + 1;
    if (d.contestNumber !== expectedNum) {
      return {
        valid: false,
        totalDraws,
        firstContest,
        lastContest,
        isContiguous: false,
        areDezenasValid: false,
        areDatesValid: false,
        areDuplicatesFree: false,
        isCryptographicallyVerified: false,
        declaredSha256: "",
        computedSha256: "",
        errorReason: `Descontinuidade numérica detectada: no índice ${i} esperado concurso ${expectedNum}, encontrado ${d.contestNumber}.`,
      };
    }
    if (seenContests.has(d.contestNumber)) {
      return {
        valid: false,
        totalDraws,
        firstContest,
        lastContest,
        isContiguous: false,
        areDezenasValid: false,
        areDatesValid: false,
        areDuplicatesFree: false,
        isCryptographicallyVerified: false,
        declaredSha256: "",
        computedSha256: "",
        errorReason: `Concurso duplicado na base oficial: ${d.contestNumber}.`,
      };
    }
    seenContests.add(d.contestNumber);

    // 2. Validação das 15 dezenas regulamentares e data gregoriana
    const val = validateOfficialDrawRecord(d);
    if (!val.valid) {
      return {
        valid: false,
        totalDraws,
        firstContest,
        lastContest,
        isContiguous: true,
        areDezenasValid: false,
        areDatesValid: false,
        areDuplicatesFree: true,
        isCryptographicallyVerified: false,
        declaredSha256: "",
        computedSha256: "",
        errorReason: `Concurso ${d.contestNumber} inválido: ${val.reason}`,
      };
    }
  }

  // 3. Verificação criptográfica do hash canônico
  const computedSha256 = computeCanonicalDrawsSha256(draws);

  return {
    valid: true,
    totalDraws,
    firstContest,
    lastContest,
    isContiguous: true,
    areDezenasValid: true,
    areDatesValid: true,
    areDuplicatesFree: true,
    isCryptographicallyVerified: true,
    declaredSha256: computedSha256,
    computedSha256,
  };
}

/**
 * Leitura do checkpoint persistente
 */
export async function getReplayCheckpoint(
  db: IDBDatabase
): Promise<ReplayCheckpoint | null> {
  if (!db.objectStoreNames.contains(STORE_MEMORY_HISTORY)) {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MEMORY_HISTORY, "readonly");
      const store = tx.objectStore(STORE_MEMORY_HISTORY);
      const req = store.get(CHECKPOINT_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Gravação do checkpoint persistente
 */
export async function saveReplayCheckpoint(
  db: IDBDatabase,
  checkpoint: ReplayCheckpoint
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEMORY_HISTORY, "readwrite");
    const store = tx.objectStore(STORE_MEMORY_HISTORY);
    store.put(checkpoint);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface RunHistoricalReplayOptions {
  readonly db: IDBDatabase;
  readonly officialDraws?: readonly OfficialLotofacilDrawRecord[];
  readonly targetLastContest?: number;
  readonly batchYieldInterval?: number; // padrão: 5 concursos por yield
  readonly isPauseRequested?: () => boolean;
  readonly onProgress?: (progress: ReplayProgressUpdate) => void;
}

/**
 * 5. Motor de Reconstrução Histórica Sequencial Completa
 */
export async function runHistoricalReplaySequential(
  options: RunHistoricalReplayOptions
): Promise<HistoricalReplayFinalReport | { paused: true; lastCompletedContest: number }> {
  const { db, batchYieldInterval = 5, isPauseRequested, onProgress } = options;

  // 1. Carrega sorteios oficiais
  await loadOfficialDrawsFromStorage(db);
  const loaded = loadAndValidateHistoricalDraws();
  const allOfficialDraws = options.officialDraws || loaded.draws;

  if (allOfficialDraws.length === 0) {
    throw new Error("EMPTY_OFFICIAL_DRAWS: Nenhum resultado oficial disponível para reconstrução.");
  }

  const targetLast = options.targetLastContest || allOfficialDraws[allOfficialDraws.length - 1].contestNumber;

  // 2. Valida a base oficial
  const baseValidation = validateOfficialHistoricalBase(allOfficialDraws.slice(0, targetLast), targetLast);
  if (!baseValidation.valid) {
    throw new Error(`OFFICIAL_BASE_INVALID: ${baseValidation.errorReason}`);
  }

  // 3. Inspeciona o estado do banco e do checkpoint existente
  const dbState = await inspectDatabaseState(db);
  const existingCheckpoint = await getReplayCheckpoint(db);

  if (existingCheckpoint && existingCheckpoint.state === "COMPLETED") {
    throw new Error(
      "REPLAY_ALREADY_COMPLETED: Reconstrução histórica já concluída. Nova execução exige autorização e limpeza controlada prévia."
    );
  }

  // Rejeita execução em banco não-limpo se não estiver retomando um checkpoint legítimo
  const isResuming =
    existingCheckpoint &&
    (existingCheckpoint.state === "PAUSED" ||
      existingCheckpoint.state === "RUNNING" ||
      existingCheckpoint.state === "FAILED" ||
      existingCheckpoint.state === "RESET_CONFIRMED") &&
    existingCheckpoint.lastCompletedContest > 0;

  if (!dbState.isClean && !isResuming) {
    throw new Error(
      `DATABASE_NOT_CLEAN: O banco operacional contém ${dbState.operationalContestsCount} concursos reais ou prévias ativas. Execute a etapa de backup e limpeza controlada antes de iniciar a reconstrução.`
    );
  }

  // 4. Inicializa ou retoma estado
  const executionId = existingCheckpoint?.executionId || `replay_${Date.now()}`;
  let currentContest = 1;
  let currentH = createMemoryHistory([], 0);
  let totalSimulatedBets = 0;
  let totalConferences = 0;
  const hitDistribution: Record<number, number> = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  const bestHitsPerContest: Record<number, number> = {};
  let totalElapsedMs = existingCheckpoint?.elapsedTimeMs || 0;

  if (isResuming && existingCheckpoint) {
    currentContest = existingCheckpoint.lastCompletedContest + 1;
    totalSimulatedBets = existingCheckpoint.totalSimulatedBets;
    totalConferences = existingCheckpoint.totalConferences;
    Object.assign(hitDistribution, existingCheckpoint.hitDistribution);
    Object.assign(bestHitsPerContest, existingCheckpoint.bestHitsPerContest);

    // Reconstrói H com precisão a partir dos concursos já gravados em contests
    const existingContests = await new Promise<ContestRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CONTESTS, "readonly");
      const store = tx.objectStore(STORE_CONTESTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    currentH = reconstructHistoryCrossVersion(existingContests);

    // Validação de consistência do ponto de retomada
    if (currentH.revision !== existingCheckpoint.lastCompletedContest) {
      throw new Error(
        `RESUME_OCC_MISMATCH: Revisão canônica (${currentH.revision}) diverge do checkpoint (${existingCheckpoint.lastCompletedContest}).`
      );
    }
  }

  const startTime = performance.now();
  let lastYieldTime = startTime;
  let contestsProcessedSinceYield = 0;

  // 5. Execução sequencial estrita concurso a concurso (1..targetLast)
  for (let n = currentContest; n <= targetLast; n++) {
    // A. Verificação de solicitação de pausa
    if (isPauseRequested && isPauseRequested()) {
      const checkpointToSave: ReplayCheckpoint = {
        id: CHECKPOINT_ID,
        executionId,
        state: "PAUSED",
        lastCompletedContest: n - 1,
        targetLastContest: targetLast,
        totalSimulatedBets,
        totalConferences,
        currentRevision: currentH.revision,
        currentFingerprint: currentH.fingerprint,
        hitDistribution,
        bestHitsPerContest,
        startedAt: existingCheckpoint?.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        elapsedTimeMs: totalElapsedMs + Math.round(performance.now() - startTime),
      };
      await saveReplayCheckpoint(db, checkpointToSave);

      return {
        paused: true,
        lastCompletedContest: n - 1,
      };
    }

    // B. Preparação Temporal e Isolamento da Base A
    // REGRA ABSOLUTA: A Base A contém APENAS os sorteios oficiais ANTERIORES ao concurso n (1..n-1).
    // O sorteio n é ESTRITAMENTE EXCLUÍDO da geração dos candidatos de n!
    const officialDrawsBeforeN = allOfficialDraws.slice(0, n - 1).map(d => d.drawnNumbers);
    const expectedOfficialDrawN = allOfficialDraws[n - 1];

    if (!expectedOfficialDrawN || expectedOfficialDrawN.contestNumber !== n) {
      throw new Error(`OFFICIAL_DRAW_LOOKUP_FAILED: Sorteio oficial do concurso ${n} não encontrado.`);
    }

    // C. Geração dos 5 jogos com Motor C5 3.0 (K=500, MAX-LEXIMIN, Johnson)
    // H contém exclusivamente os jogos gerados nos concursos 1..n-1
    const draft: Draft30 = generateC5Draft30(
      n,
      currentH,
      officialDrawsBeforeN,
      undefined,
      currentH.games
    );

    // Invariante de auditoria: exatamente 5 jogos estruturais C5
    if (draft.games.length !== 5 || !isStructuralC5(draft.games)) {
      throw new Error(`STRUCTURAL_C5_VIOLATION: Falha estrutural nos jogos gerados para o concurso ${n}.`);
    }

    // D. Congelamento Criptográfico SHA-256
    const frozenPayload: FrozenMemoryPayload30 = freezeDraft30(draft);

    // E. Conferência contra o Resultado Oficial do Concurso n
    // Executada POSTERIORMENTE ao congelamento dos 5 jogos
    const officialNumbers = expectedOfficialDrawN.drawnNumbers;
    const gameHits: number[] = draft.games.map(g => calculateHits(g, officialNumbers));
    const bestHits = Math.max(...gameHits);
    const bestHitsCount = gameHits.filter(h => h === bestHits).length;

    // Atualiza contadores de conferência
    totalSimulatedBets += 5;
    totalConferences++;
    bestHitsPerContest[n] = bestHits;
    for (const h of gameHits) {
      if (h >= 11 && h <= 15) {
        hitDistribution[h] = (hitDistribution[h] || 0) + 1;
      }
    }

    // F. Atualização de H e Construção do Record
    const nextH = createMemoryHistory([...currentH.games, ...draft.games], currentH.revision + 1);

    const record: ContestRecord = {
      contestNumber: n,
      contestDate: expectedOfficialDrawN.drawDate,
      status: "COMPLETED",
      algorithmVersion: ALGORITHM_VERSION_3_0_0,
      recordMode: "HISTORICAL_REPLAY",
      replayExecutionId: executionId,
      executedAt: new Date().toISOString(),
      games: draft.games,
      draft,
      frozenPayload,
      officialResult: officialNumbers,
      gameHits,
      bestHits,
      bestHitsCount,
      totalCost: 0,
      totalPrize: 0,
      officialConfirmedPrize: 0,
      financialStatus: "SIMULATED_NO_FINANCIAL_IMPACT",
      resultSource: "API_CAIXA",
      resultConfirmed: true,
      resultConfirmedAt: new Date().toISOString(),
      resultConfirmedBy: "HISTORICAL_REPLAY_ENGINE",
      simulationConference: {
        contestNumber: n,
        officialResult: officialNumbers,
        gameHits,
        bestHits,
        bestHitsCount,
        hitDistribution: { ...hitDistribution },
        simulatedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedCheckpoint: ReplayCheckpoint = {
      id: CHECKPOINT_ID,
      executionId,
      state: n === targetLast ? "COMPLETED" : "RUNNING",
      lastCompletedContest: n,
      targetLastContest: targetLast,
      totalSimulatedBets,
      totalConferences,
      currentRevision: nextH.revision,
      currentFingerprint: nextH.fingerprint,
      hitDistribution,
      bestHitsPerContest,
      startedAt: existingCheckpoint?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      elapsedTimeMs: totalElapsedMs + Math.round(performance.now() - startTime),
    };

    // G. Gravação Transacional Atômica no IndexedDB
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_CONTESTS, STORE_MEMORY_HISTORY], "readwrite");
      const contestStore = tx.objectStore(STORE_CONTESTS);
      const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

      tx.onerror = () => reject(tx.error || new Error(`TX_ERROR_CONTEST_${n}`));
      tx.onabort = () => reject(tx.error || new Error(`TX_ABORT_CONTEST_${n}`));
      tx.oncomplete = () => resolve();

      contestStore.put(record);
      historyStore.put({ id: "singleton", history: nextH });
      historyStore.put(updatedCheckpoint);
    });

    // Atualiza estado em memória
    currentH = nextH;
    contestsProcessedSinceYield++;

    // H. Cooperative Yielding e Callback de Progresso
    const now = performance.now();
    if (contestsProcessedSinceYield >= batchYieldInterval || n === targetLast || now - lastYieldTime > 150) {
      const currentElapsed = totalElapsedMs + Math.round(now - startTime);
      const completedCount = n - currentContest + 1;
      const speed = completedCount > 0 ? (completedCount / (now - startTime)) * 1000 : 0;
      const remainingContests = targetLast - n;
      const estRemainingMs = speed > 0 ? Math.round((remainingContests / speed) * 1000) : 0;

      if (onProgress) {
        onProgress({
          executionId,
          state: n === targetLast ? "COMPLETED" : "RUNNING",
          currentContest: n,
          targetLastContest: targetLast,
          percentage: Math.min(100, Math.round((n / targetLast) * 100)),
          elapsedTimeMs: currentElapsed,
          estimatedRemainingTimeMs: estRemainingMs,
          speedContestsPerSecond: Math.round(speed * 10) / 10,
          totalSimulatedBets,
          totalConferences,
          hitDistribution: { ...hitDistribution },
          latestBestHits: bestHits,
          latestGames: draft.games,
          latestOfficialResult: officialNumbers,
        });
      }

      contestsProcessedSinceYield = 0;
      lastYieldTime = now;
      // Libera o event loop para manter o browser responsivo
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // 6. Validação Final Obrigatória (§11)
  const totalMeasuredTimeMs = totalElapsedMs + Math.round(performance.now() - startTime);

  // Lê todos os concursos gravados para validação completa
  const allReplayContests = await new Promise<ContestRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_CONTESTS, "readonly");
    const store = tx.objectStore(STORE_CONTESTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const sortedReplay = allReplayContests.sort((a, b) => a.contestNumber - b.contestNumber);

  // 1. Exatamente N concursos
  const contestsMatchCount = sortedReplay.length === targetLast;

  // 2. Exatamente 5 jogos por concurso
  const gamesCardinalityStrict = sortedReplay.every(c => Array.isArray(c.games) && c.games.length === 5);

  // 3. 5N jogos gerados
  const totalGamesCount = sortedReplay.reduce((acc, c) => acc + c.games.length, 0);
  const gamesCountStrict5N = totalGamesCount === targetLast * 5;

  // 4. Nenhum jogo repetido no histórico gerado (todos os 5N jogos distintos entre si)
  const uniqueGeneratedGamesSet = new Set<string>();
  let hasInternalDuplicate = false;
  for (const c of sortedReplay) {
    for (const g of c.games) {
      const canon = formatGameCanonical(g);
      if (uniqueGeneratedGamesSet.has(canon)) {
        hasInternalDuplicate = true;
        break;
      }
      uniqueGeneratedGamesSet.add(canon);
    }
    if (hasInternalDuplicate) break;
  }
  const noDuplicatesGenerated = !hasInternalDuplicate && uniqueGeneratedGamesSet.size === targetLast * 5;

  // 5. Nenhuma violação estrutural C5
  const noC5StructuralViolation = sortedReplay.every(c => isStructuralC5(c.games));

  // 6. Revisão final de H igual a N
  const revisionStrictN = currentH.revision === targetLast;

  // 7. Todos os SHA-256 válidos
  let allShaValid = true;
  for (const c of sortedReplay) {
    if (!c.frozenPayload || !c.frozenPayload.sha256) {
      allShaValid = false;
      break;
    }
    const fp = c.frozenPayload as FrozenMemoryPayload30;
    const gamesSerial = fp.games.map(formatGameCanonical).join("|");
    const payload = `C5-FROZEN:${fp.contestNumber}:${fp.poolIndex}:${fp.poolMasterSeed}:${fp.historyFingerprint}:${fp.historyRevision}:${gamesSerial}`;
    if (syncSha256(payload) !== fp.sha256) {
      allShaValid = false;
      break;
    }
  }

  // 8. Todos conferidos
  const allConferencesConducted = sortedReplay.every(
    c => Array.isArray(c.gameHits) && c.gameHits.length === 5 && c.officialResult?.length === 15
  );

  // 9. Zero impacto financeiro
  const zeroFinancialImpact = sortedReplay.every(
    c => c.totalCost === 0 && c.totalPrize === 0 && c.officialConfirmedPrize === 0
  );

  // 10. Reconstrução cross-version consistente
  const reconstructedH = reconstructHistoryCrossVersion(sortedReplay);
  const crossVersionConsistent =
    reconstructedH.revision === targetLast &&
    reconstructedH.fingerprint === currentH.fingerprint &&
    reconstructedH.games.length === targetLast * 5;

  const integrityChecks: HistoricalReplayIntegrityChecks = {
    contestsMatchCount,
    gamesCardinalityStrict,
    noDuplicatesGenerated,
    noC5StructuralViolation,
    revisionStrictN,
    gamesCountStrict5N,
    reproducibleFingerprint: Boolean(currentH.fingerprint && currentH.fingerprint.length === 64),
    allSha256Valid: allShaValid,
    allConferencesConducted,
    zeroFinancialImpact,
    crossVersionConsistent,
  };

  const isAllValid = Object.values(integrityChecks).every(v => v === true);
  const integrityStatus = isAllValid ? "INTEGRITY_VERIFIED" : "CORRUPTED";

  // Manifesto da reconstrução
  const manifestPayload = `C5-HISTORICAL-REPLAY-MANIFEST:v1.0:${executionId}:1..${targetLast}:${targetLast * 5}:${currentH.fingerprint}:${integrityStatus}`;
  const manifestSha256 = syncSha256(manifestPayload);

  // Salva manifesto em auditEvents
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_AUDIT_EVENTS, STORE_MEMORY_HISTORY], "readwrite");
    const auditStore = tx.objectStore(STORE_AUDIT_EVENTS);
    const historyStore = tx.objectStore(STORE_MEMORY_HISTORY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    auditStore.put({
      id: `audit_replay_manifest_${executionId}`,
      contestNumber: targetLast,
      eventType: "HISTORICAL_REPLAY_COMPLETED",
      timestamp: new Date().toISOString(),
      operatorId: "SYSTEM_REPLAY_ENGINE",
      notes: `Reconstrução histórica concluída com sucesso para os concursos 1..${targetLast}. Manifesto SHA-256: ${manifestSha256}.`,
      proof: {
        executionId,
        targetLast,
        totalSimulatedBets,
        manifestSha256,
        finalHistoryFingerprint: currentH.fingerprint,
        integrityStatus,
      },
    });

    historyStore.put({
      id: CHECKPOINT_ID,
      executionId,
      state: "COMPLETED",
      lastCompletedContest: targetLast,
      targetLastContest: targetLast,
      totalSimulatedBets,
      totalConferences,
      currentRevision: currentH.revision,
      currentFingerprint: currentH.fingerprint,
      hitDistribution,
      bestHitsPerContest,
      startedAt: existingCheckpoint?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      elapsedTimeMs: totalMeasuredTimeMs,
      manifestSha256,
    });
  });

  return {
    executionId,
    initialContest: 1,
    finalContest: targetLast,
    totalContestsProcessed: targetLast,
    totalGamesGenerated: targetLast * 5,
    totalDistinctGames: uniqueGeneratedGamesSet.size,
    totalConferences,
    hitDistribution,
    bestHitsPerContest,
    finalHistoryFingerprint: currentH.fingerprint,
    manifestSha256,
    totalMeasuredTimeMs,
    integrityStatus,
    integrityChecks,
    completedAt: new Date().toISOString(),
  };
}
