/**
 * C5-Memory 3.0 — Motor Combinatório e Seleção MAX-LEXIMIN
 * 
 * Regras e Invariantes:
 * 1. Exatamente 5 jogos por operação (cada jogo com 15 dezenas estritamente crescentes [1..25]).
 * 2. Preserva a lógica original do algoritmo: MAX-LEXIMIN e Distância de Johnson d(A, B) = 15 - |A ∩ B|.
 * 3. Se ainda não houver jogos anteriores gerados (H_gen vazio), utiliza os concursos oficiais anteriores
 *    como histórico de comparação para o scoring leximin (H_score = concursos oficiais).
 * 4. Rejeição de Inadmissibilidade Dura (Hard Exclusion):
 *    - Rejeita qualquer candidato onde qualquer jogo seja idêntico a um resultado oficial anterior (d = 0).
 *    - Rejeita qualquer candidato onde qualquer jogo seja idêntico a um jogo gerado anteriormente em H_gen (d = 0).
 * 5. Não confunde o histórico de pontuação leximin com a proibição de duplicatas.
 * 6. Sem métricas inventadas, probabilidades ilusórias ou garantias de prêmio.
 * 7. Congelamento criptográfico canônico SHA-256.
 * 8. Rastreamento e auditoria explícita da integridade da base oficial:
 *    - Só declara exclusão histórica completa se a cobertura estiver comprovada (3.816 concursos contíguos);
 *    - Se a base for parcial ou incompleta, emite notificação explícita de limitação.
 */

import { C5Game, MemoryHistory } from "./types";
import { StructuralPRNG, DEFAULT_POOL_SIZE_K } from "./engine210";
import { isStructuralC5 } from "./structuralC5";
import { computeLeximinProfile, compareLeximin } from "./math";
import { syncSha256 } from "./sha256";
import { formatGameCanonical } from "./history";
import {
  getAllOfficialLotofacilDraws,
  getOfficialDrawsCoverageStatus,
  OfficialDrawsCoverageStatus,
  isGameIdenticalToAnyOfficialDraw,
  isGameIdenticalToAnyPreviousGame,
  LatestOfficialContestReference,
} from "./officialDraws";

export const ALGORITHM_VERSION_3_0_0 = "C5-Memory-3.0" as const;

export interface StructuralPoolCandidate30 {
  readonly index: number;
  readonly permutation: readonly number[];
  readonly games: readonly C5Game[];
  readonly leximinScore: readonly number[];
}

export interface CandidateAdmissibilityMetrics30 {
  readonly totalEvaluated: number;
  readonly totalAdmissible: number;
  readonly rejectedDuplicateOfficialCount: number;
  readonly rejectedDuplicateGeneratedCount: number;
}

export interface StructuralPoolSelectionResult30 {
  readonly poolIndex: number;
  readonly games: readonly C5Game[];
  readonly leximinProfile: readonly number[];
  readonly candidatePermutation: readonly number[];
  readonly scoringHistorySource: "USER_GENERATED_GAMES" | "OFFICIAL_CONTEST_DRAWS";
  readonly scoringHistorySize: number;
  readonly officialCoverage: OfficialDrawsCoverageStatus;
  readonly isHistoricalExclusionComplete: boolean;
  readonly metrics: CandidateAdmissibilityMetrics30;
}

export interface Draft30 {
  readonly algorithmVersion: typeof ALGORITHM_VERSION_3_0_0;
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly leximinProfile: readonly number[];
  readonly generatedAt: string;
  readonly scoringHistorySource: "USER_GENERATED_GAMES" | "OFFICIAL_CONTEST_DRAWS";
  readonly scoringHistorySize: number;
  readonly officialCoverage: OfficialDrawsCoverageStatus;
  readonly isHistoricalExclusionComplete: boolean;
  readonly metrics: CandidateAdmissibilityMetrics30;
}

export interface FrozenMemoryPayload30 {
  readonly algorithmVersion: typeof ALGORITHM_VERSION_3_0_0;
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly officialReference?: LatestOfficialContestReference | null;
  readonly officialCoverage?: OfficialDrawsCoverageStatus;
  readonly isHistoricalExclusionComplete?: boolean;
  readonly sha256: string;
  readonly frozenAt: string;
}

/**
 * Deriva a seed mestre determinística para o motor 3.0
 */
export function derivePoolMasterSeed30(contestNumber: number, historyFingerprint: string): string {
  return syncSha256(`C5-POOL-MASTER-3.0:${contestNumber}:${historyFingerprint}`);
}

/**
 * Seleciona o melhor candidato C5 pelo critério MAX-LEXIMIN aplicando:
 * 1. Hard Exclusion contra Sorteios Oficiais (qualquer jogo com d = 0 é descartado imediatamente).
 * 2. Hard Exclusion contra Jogos Anteriores Gerados em H_gen (qualquer jogo com d = 0 é descartado imediatamente).
 * 3. Definição do histórico de pontuação (H_score):
 *    - Se H_gen não está vazio, H_score = H_gen.
 *    - Se H_gen está vazio, H_score = officialDraws.
 * 4. Validação e declaração explícita da cobertura da base histórica oficial.
 */
export function selectBestStructuralCandidate30MaxLeximin(
  poolMasterSeed: string,
  userHistoryGames: readonly C5Game[],
  officialDraws: readonly C5Game[] = getAllOfficialLotofacilDraws(),
  poolSizeK: number = DEFAULT_POOL_SIZE_K,
  coverageStatusOverride?: OfficialDrawsCoverageStatus,
  allUserRegisteredGames?: readonly C5Game[]
): StructuralPoolSelectionResult30 {
  const prng = new StructuralPRNG(poolMasterSeed);
  const coverage = coverageStatusOverride || getOfficialDrawsCoverageStatus();

  // Histórico de pontuação para o critério MAX-LEXIMIN
  const hasUserHistory = userHistoryGames.length > 0;
  const scoringHistory: readonly C5Game[] = hasUserHistory ? userHistoryGames : officialDraws;
  const scoringHistorySource = hasUserHistory ? "USER_GENERATED_GAMES" : "OFFICIAL_CONTEST_DRAWS";

  // Base B completa para verificação anti-duplicatas do usuário
  const userGamesToCheck =
    allUserRegisteredGames && allUserRegisteredGames.length > 0
      ? allUserRegisteredGames
      : userHistoryGames;

  let bestCandidate: StructuralPoolCandidate30 | null = null;
  let bestProfile: readonly number[] | null = null;

  let rejectedDuplicateOfficialCount = 0;
  let rejectedDuplicateGeneratedCount = 0;
  let totalAdmissible = 0;

  for (let k = 0; k < poolSizeK; k++) {
    const { permutation, games } = prng.generateStructuralCandidate5();

    // Invariante estrutural C5
    if (!isStructuralC5(games) || games.length !== 5) {
      throw new Error(`Invariante C5 violada no candidato ${k} do pool 3.0.`);
    }

    // Regra 1 (Base A): Rejeitar qualquer candidato contendo jogo idêntico a sorteio oficial
    let hasOfficialDrawDuplicate = false;
    for (let i = 0; i < games.length; i++) {
      if (isGameIdenticalToAnyOfficialDraw(games[i], officialDraws)) {
        hasOfficialDrawDuplicate = true;
        break;
      }
    }
    if (hasOfficialDrawDuplicate) {
      rejectedDuplicateOfficialCount++;
      continue;
    }

    // Regra 2 (Base B): Rejeitar qualquer candidato contendo jogo idêntico a jogo já gerado pelo usuário
    let hasPreviousGameDuplicate = false;
    if (userGamesToCheck.length > 0) {
      for (let i = 0; i < games.length; i++) {
        if (isGameIdenticalToAnyPreviousGame(games[i], userGamesToCheck)) {
          hasPreviousGameDuplicate = true;
          break;
        }
      }
    }
    if (hasPreviousGameDuplicate) {
      rejectedDuplicateGeneratedCount++;
      continue;
    }

    // Candidato admissível
    totalAdmissible++;

    // Cálculo do perfil leximin contra o conjunto de comparação definido via Distância de Johnson
    const profile = computeLeximinProfile(games, scoringHistory);

    // Comparação Leximin: em caso de empate, mantém o menor índice (tie-break estrito determinístico)
    if (bestProfile === null || compareLeximin(profile, bestProfile) > 0) {
      bestCandidate = {
        index: k,
        permutation,
        games,
        leximinScore: profile,
      };
      bestProfile = profile;
    }
  }

  if (!bestCandidate || !bestProfile) {
    throw new Error(
      `ALL_CANDIDATES_INADMISSIBLE: Nenhum dos ${poolSizeK} candidatos atendeu aos critérios de admissibilidade sem duplicatas.`
    );
  }

  // Declaração estrita de cobertura completa: apenas se coverage.isCompleteHistoricalCoverage for true
  const isHistoricalExclusionComplete = Boolean(coverage.isCompleteHistoricalCoverage);

  return {
    poolIndex: bestCandidate.index,
    games: bestCandidate.games,
    leximinProfile: bestProfile,
    candidatePermutation: bestCandidate.permutation,
    scoringHistorySource,
    scoringHistorySize: scoringHistory.length,
    officialCoverage: coverage,
    isHistoricalExclusionComplete,
    metrics: {
      totalEvaluated: poolSizeK,
      totalAdmissible,
      rejectedDuplicateOfficialCount,
      rejectedDuplicateGeneratedCount,
    },
  };
}

/**
 * Gera um Draft oficial para C5-Memory 3.0
 */
export function generateC5Draft30(
  contestNumber: number,
  history: MemoryHistory,
  officialDraws: readonly C5Game[] = getAllOfficialLotofacilDraws(),
  coverageStatusOverride?: OfficialDrawsCoverageStatus,
  allUserRegisteredGames?: readonly C5Game[]
): Draft30 {
  const poolMasterSeed = derivePoolMasterSeed30(contestNumber, history.fingerprint);
  const selection = selectBestStructuralCandidate30MaxLeximin(
    poolMasterSeed,
    history.games,
    officialDraws,
    DEFAULT_POOL_SIZE_K,
    coverageStatusOverride,
    allUserRegisteredGames
  );

  return {
    algorithmVersion: ALGORITHM_VERSION_3_0_0,
    contestNumber,
    games: selection.games,
    poolIndex: selection.poolIndex,
    poolMasterSeed,
    historyFingerprint: history.fingerprint,
    historyRevision: history.revision,
    leximinProfile: selection.leximinProfile,
    generatedAt: new Date().toISOString(),
    scoringHistorySource: selection.scoringHistorySource,
    scoringHistorySize: selection.scoringHistorySize,
    officialCoverage: selection.officialCoverage,
    isHistoricalExclusionComplete: selection.isHistoricalExclusionComplete,
    metrics: selection.metrics,
  };
}

/**
 * Congela um Draft 3.0 com payload SHA-256 canônico
 */
export function freezeDraft30(draft: Draft30): FrozenMemoryPayload30 {
  const gamesSerial = draft.games.map(formatGameCanonical).join("|");
  const payloadToHash = `C5-FROZEN:${draft.contestNumber}:${draft.poolIndex}:${draft.poolMasterSeed}:${draft.historyFingerprint}:${draft.historyRevision}:${gamesSerial}`;
  const sha256Hash = syncSha256(payloadToHash);

  return {
    algorithmVersion: ALGORITHM_VERSION_3_0_0,
    contestNumber: draft.contestNumber,
    games: draft.games,
    poolIndex: draft.poolIndex,
    poolMasterSeed: draft.poolMasterSeed,
    historyFingerprint: draft.historyFingerprint,
    historyRevision: draft.historyRevision,
    officialReference: draft.officialCoverage?.verifiedReference || null,
    officialCoverage: draft.officialCoverage,
    isHistoricalExclusionComplete: draft.isHistoricalExclusionComplete,
    sha256: sha256Hash,
    frozenAt: new Date().toISOString(),
  };
}
