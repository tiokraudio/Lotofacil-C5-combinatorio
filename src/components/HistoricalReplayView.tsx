import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Play,
  Pause,
  RotateCcw,
  Download,
  AlertTriangle,
  Database,
  FileCheck,
  Clock,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Lock,
  Layers,
  Activity,
  Award,
} from "lucide-react";
import { openDB } from "../storage/db";
import {
  inspectDatabaseState,
  createAndVerifyPreResetBackup,
  performControlledCleanup,
  validateOfficialHistoricalBase,
  runHistoricalReplaySequential,
  getReplayCheckpoint,
  REQUIRED_CONFIRMATION_TEXT,
  DatabaseInspectionReport,
  PreResetBackupReport,
  OfficialBaseValidationResult,
  ReplayProgressUpdate,
  HistoricalReplayFinalReport,
} from "../c5-memory/application/historicalReplayService";
import { loadAndValidateHistoricalDraws, loadOfficialDrawsFromStorage } from "../c5-memory/officialDraws";

interface HistoricalReplayViewProps {
  onNavigateToDashboard: () => void;
  onNavigateToGenerator: () => void;
  onRefreshAppState: () => void;
}

export const HistoricalReplayView: React.FC<HistoricalReplayViewProps> = ({
  onNavigateToDashboard,
  onNavigateToGenerator,
  onRefreshAppState,
}) => {
  // Estado de inspeção
  const [dbState, setDbState] = useState<DatabaseInspectionReport | null>(null);
  const [baseValidation, setBaseValidation] = useState<OfficialBaseValidationResult | null>(null);
  const [isLoadingInspection, setIsLoadingInspection] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Estado da etapa de backup e limpeza
  const [backupReport, setBackupReport] = useState<PreResetBackupReport | null>(null);
  const [isGeneratingBackup, setIsGeneratingBackup] = useState<boolean>(false);
  const [confirmationInput, setConfirmationInput] = useState<string>("");
  const [isCleaning, setIsCleaning] = useState<boolean>(false);

  // Estado da execução de reconstrução
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [pauseRequested, setPauseRequested] = useState<boolean>(false);
  const pauseRequestedRef = useRef<boolean>(false);
  const [liveProgress, setLiveProgress] = useState<ReplayProgressUpdate | null>(null);
  const [finalReport, setFinalReport] = useState<HistoricalReplayFinalReport | null>(null);

  // Carrega e atualiza a inspeção do banco e da base oficial
  const refreshInspection = async () => {
    setIsLoadingInspection(true);
    setActionError(null);
    try {
      const db = await openDB();
      await loadOfficialDrawsFromStorage(db);
      const state = await inspectDatabaseState(db);
      setDbState(state);

      const { draws } = loadAndValidateHistoricalDraws();
      if (draws.length > 0) {
        const val = validateOfficialHistoricalBase(draws);
        setBaseValidation(val);
      }
    } catch (err: any) {
      setActionError(err?.message || "Falha ao inspecionar o banco de dados.");
    } finally {
      setIsLoadingInspection(false);
    }
  };

  useEffect(() => {
    refreshInspection();
  }, []);

  // Handler: Gerar Backup Integral Pré-Reset
  const handleGenerateBackup = async () => {
    setIsGeneratingBackup(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const db = await openDB();
      const report = await createAndVerifyPreResetBackup(db);
      setBackupReport(report);
      setActionNotice(
        `Backup integral gerado e validado com sucesso! SHA-256: ${report.backupSha256.substring(0, 16)}...`
      );
    } catch (err: any) {
      setActionError(err?.message || "Erro ao gerar pacote de backup.");
    } finally {
      setIsGeneratingBackup(false);
    }
  };

  // Handler: Download do JSON de Backup
  const handleDownloadBackupJson = () => {
    if (!backupReport) return;
    const dataStr =
      "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupReport.backupPackage, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `c5_backup_pre_reset_${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Handler: Confirmar Limpeza Controlada
  const handleConfirmCleanup = async () => {
    if (!backupReport) {
      setActionError("É obrigatório gerar e validar o backup antes da limpeza.");
      return;
    }
    if (confirmationInput.trim() !== REQUIRED_CONFIRMATION_TEXT) {
      setActionError(`Digite exatamente a frase obrigatória: "${REQUIRED_CONFIRMATION_TEXT}"`);
      return;
    }

    setIsCleaning(true);
    setActionError(null);
    try {
      const db = await openDB();
      await performControlledCleanup(db, confirmationInput, backupReport.backupSha256);
      setConfirmationInput("");
      setBackupReport(null);
      setActionNotice("Limpeza controlada concluída com sucesso. Banco operacional limpo e pronto para reconstrução.");
      await refreshInspection();
      onRefreshAppState();
    } catch (err: any) {
      setActionError(err?.message || "Falha na limpeza controlada.");
    } finally {
      setIsCleaning(false);
    }
  };

  // Handler: Iniciar / Continuar Reconstrução Sequencial
  const handleStartOrResumeReplay = async () => {
    setActionError(null);
    setActionNotice(null);
    setIsReplaying(true);
    setPauseRequested(false);
    pauseRequestedRef.current = false;

    try {
      const db = await openDB();
      const { draws } = loadAndValidateHistoricalDraws();

      const result = await runHistoricalReplaySequential({
        db,
        officialDraws: draws,
        batchYieldInterval: 5,
        isPauseRequested: () => pauseRequestedRef.current,
        onProgress: update => {
          setLiveProgress(update);
        },
      });

      if ("paused" in result && result.paused) {
        setActionNotice(`Reconstrução pausada com segurança no concurso ${result.lastCompletedContest}.`);
      } else {
        const report = result as HistoricalReplayFinalReport;
        setFinalReport(report);
        setActionNotice("Reconstrução histórica concluída com integridade verificada!");
      }
      await refreshInspection();
      onRefreshAppState();
    } catch (err: any) {
      setActionError(err?.message || "Falha durante o processamento da reconstrução histórica.");
    } finally {
      setIsReplaying(false);
      setPauseRequested(false);
      pauseRequestedRef.current = false;
    }
  };

  // Handler: Pausar Reconstrução
  const handlePauseReplay = () => {
    setPauseRequested(true);
    pauseRequestedRef.current = true;
  };

  // Formatação de milissegundos para mm:ss ou hh:mm:ss
  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Cabeçalho da Seção */}
      <div className="border-b border-slate-800 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <span>Reconstrução Histórica Completa C5</span>
              <span className="text-xs font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                Procedimento Administrativo
              </span>
            </h1>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-3xl">
              Inicialização e simulação sequencial retrospectiva desde o concurso 1 até o último concurso oficial publicado.
              Preserva estritamente a Distância de Johnson, o motor combinatório MAX-LEXIMIN (K=500), PRNG Mulberry32 e as invariantes estruturais C5, garantindo zero vazamento temporal.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={refreshInspection}
              disabled={isReplaying}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Atualizar Diagnóstico
            </button>
          </div>
        </div>
      </div>

      {/* Alertas de Ação / Mensagens */}
      {actionError && (
        <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-4 text-xs text-rose-300 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-200">Atenção na Operação</p>
            <p className="mt-0.5">{actionError}</p>
          </div>
        </div>
      )}

      {actionNotice && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 text-xs text-emerald-300 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-emerald-200">Confirmação do Sistema</p>
            <p className="mt-0.5">{actionNotice}</p>
          </div>
        </div>
      )}

      {/* Painel de Diagnóstico em 4 Colunas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Situação do Banco de Dados */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">Banco Operacional</span>
            <Database className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-base font-bold font-mono ${
                dbState?.isClean ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {isLoadingInspection ? "Inspecionando..." : dbState?.isClean ? "Banco Limpo" : "Contém Apostas"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            {dbState ? (
              <>
                {dbState.operationalContestsCount} concursos reais · {dbState.replayContestsCount} simulados
              </>
            ) : (
              "Lendo IndexedDB..."
            )}
          </p>
        </div>

        {/* Card 2: Base Histórica Oficial */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">Sorteios Oficiais</span>
            <FileCheck className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-slate-100">
              {baseValidation?.totalDraws ? `${baseValidation.totalDraws} Concursos` : "Verificando..."}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">
            {baseValidation
              ? `#${baseValidation.firstContest} a #${baseValidation.lastContest} · ${
                  baseValidation.isContiguous ? "Sequência Contígua" : "Descontínua"
                }`
              : "Validando base oficial..."}
          </p>
        </div>

        {/* Card 3: Situação do Backup */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">Proteção & Backup</span>
            <Lock className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-base font-bold font-mono ${
                backupReport || dbState?.backupStatus === "EXPORTED_AND_VERIFIED"
                  ? "text-emerald-400"
                  : "text-slate-300"
              }`}
            >
              {backupReport
                ? "Pronto & Validado"
                : dbState?.backupStatus === "EXPORTED_AND_VERIFIED"
                ? "Backup Registrado"
                : "Não Realizado"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate font-mono">
            {backupReport?.backupSha256
              ? `SHA: ${backupReport.backupSha256.substring(0, 16)}...`
              : dbState?.backupSha256
              ? `SHA: ${dbState.backupSha256.substring(0, 16)}...`
              : "Backup obrigatório antes do reset"}
          </p>
        </div>

        {/* Card 4: Situação da Reconstrução */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">Estado da Rotina</span>
            <Layers className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-base font-bold font-mono ${
                dbState?.replayState === "COMPLETED"
                  ? "text-emerald-400"
                  : dbState?.replayState === "RUNNING"
                  ? "text-blue-400"
                  : dbState?.replayState === "PAUSED"
                  ? "text-amber-400"
                  : "text-slate-300"
              }`}
            >
              {isReplaying
                ? "Em Execução..."
                : dbState?.replayState === "COMPLETED"
                ? "Concluído"
                : dbState?.replayState === "PAUSED"
                ? "Pausado"
                : dbState?.replayState === "RESET_CONFIRMED"
                ? "Pronto para Iniciar"
                : "Não Iniciado"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">
            {dbState ? (
              <>
                Último: #{dbState.lastCompletedReplayContest} · H rev: #{dbState.historyRevision}
              </>
            ) : (
              "Aguardando..."
            )}
          </p>
        </div>
      </div>

      {/* SEÇÃO 1: Wizard de Proteção, Backup e Limpeza Controlada (Quando o banco não está limpo ou requer reset) */}
      {(!dbState?.isClean || dbState?.replayState === "COMPLETED") && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {dbState?.replayState === "COMPLETED"
                  ? "Reconstrução Concluída — Autorização para Nova Reconstrução Integral"
                  : "Etapa Prévia Obrigatória: Proteção, Backup e Limpeza do Banco Operacional"}
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                A inicialização histórica do C5 opera exclusivamente a partir do concurso 1 em um banco operacional limpo.
                Antes de qualquer remoção, um backup integral de todos os registros existentes é gerado e validado criptograficamente.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Preservado Rigorosamente
              </span>
              <ul className="text-slate-400 space-y-1 list-disc list-inside text-[11px]">
                <li>Resultados históricos oficiais (STORE_OFFICIAL_DRAWS)</li>
                <li>Estrutura física do IndexedDB (sem deleteDatabase)</li>
                <li>Motor MAX-LEXIMIN, Johnson e Mulberry32</li>
                <li>Arquivos de pesquisa e parâmetros matemáticos</li>
              </ul>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <span className="font-semibold text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Removido de Forma Controlada
              </span>
              <ul className="text-slate-400 space-y-1 list-disc list-inside text-[11px]">
                <li>Apostas e prévias anteriores em STORE_CONTESTS</li>
                <li>Histórico derivado antigo H em STORE_MEMORY_HISTORY</li>
                <li>Registros financeiros associados a apostas antigas</li>
              </ul>
            </div>
          </div>

          {/* Botão de Exportação de Backup */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              onClick={handleGenerateBackup}
              disabled={isGeneratingBackup}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isGeneratingBackup ? "Gerando Backup..." : "1. Gerar e Validar Backup Integral"}</span>
            </button>

            {backupReport && (
              <button
                onClick={handleDownloadBackupJson}
                className="px-4 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs font-semibold text-emerald-300 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar Backup JSON ({backupReport.contestsCount} concursos)</span>
              </button>
            )}
          </div>

          {/* Formulário de Confirmação Digitada */}
          {backupReport && (
            <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
              <div>
                <label htmlFor="confirm-clean-input" className="block text-xs font-medium text-slate-300">
                  Para autorizar a limpeza, digite exatamente:{" "}
                  <span className="font-mono text-emerald-400 select-all font-semibold">
                    {REQUIRED_CONFIRMATION_TEXT}
                  </span>
                </label>
                <div className="mt-2 flex flex-col sm:flex-row gap-3">
                  <input
                    id="confirm-clean-input"
                    type="text"
                    value={confirmationInput}
                    onChange={e => setConfirmationInput(e.target.value)}
                    placeholder={REQUIRED_CONFIRMATION_TEXT}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleConfirmCleanup}
                    disabled={isCleaning || confirmationInput.trim() !== REQUIRED_CONFIRMATION_TEXT}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isCleaning ? "Limpando..." : "2. Executar Limpeza e Preparar Reconstrução"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SEÇÃO 2: Painel de Controle e Execução da Reconstrução Histórica */}
      {dbState?.isClean && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Execução da Reconstrução Histórica Sequencial</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Processamento estrito: Gerar candidato C5 (K=500) → Congelar com SHA-256 → Conferir com Sorteio Oficial → Atualizar H → Salvar Checkpoint.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!isReplaying ? (
                <button
                  onClick={handleStartOrResumeReplay}
                  disabled={!baseValidation?.valid || dbState.replayState === "COMPLETED"}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {dbState.replayState === "PAUSED"
                      ? "Continuar Reconstrução"
                      : "Iniciar Reconstrução Completa"}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handlePauseReplay}
                  disabled={pauseRequested}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>{pauseRequested ? "Pausando..." : "Pausar Execução"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Barra de Progresso */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-mono">
                Concurso{" "}
                <strong className="text-white">
                  {liveProgress?.currentContest ?? dbState.lastCompletedReplayContest}
                </strong>{" "}
                de <strong className="text-white">{baseValidation?.totalDraws ?? 3816}</strong>
              </span>
              <span className="font-mono text-emerald-400 font-semibold">
                {liveProgress?.percentage ??
                  (baseValidation?.totalDraws
                    ? Math.round((dbState.lastCompletedReplayContest / baseValidation.totalDraws) * 100)
                    : 0)}
                %
              </span>
            </div>

            <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-emerald-600 to-indigo-500 h-full rounded-full transition-all duration-300"
                style={{
                  width: `${
                    liveProgress?.percentage ??
                    (baseValidation?.totalDraws
                      ? Math.round((dbState.lastCompletedReplayContest / baseValidation.totalDraws) * 100)
                      : 0)
                  }%`,
                }}
              />
            </div>
          </div>

          {/* Métricas Operacionais em Tempo Real */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs pt-1">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[11px] text-slate-400 block">Tempo Decorrido</span>
              <span className="font-mono text-slate-200 font-semibold text-sm">
                {liveProgress ? formatDuration(liveProgress.elapsedTimeMs) : "00:00"}
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[11px] text-slate-400 block">Tempo Restante (ETA)</span>
              <span className="font-mono text-emerald-400 font-semibold text-sm">
                {liveProgress?.estimatedRemainingTimeMs
                  ? formatDuration(liveProgress.estimatedRemainingTimeMs)
                  : "--:--"}
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[11px] text-slate-400 block">Velocidade Medida</span>
              <span className="font-mono text-slate-200 font-semibold text-sm">
                {liveProgress?.speedContestsPerSecond ?? 0} conc/s
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[11px] text-slate-400 block">Apostas Geradas</span>
              <span className="font-mono text-slate-200 font-semibold text-sm">
                {liveProgress?.totalSimulatedBets ?? dbState.lastCompletedReplayContest * 5}
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[11px] text-slate-400 block">Conferências</span>
              <span className="font-mono text-slate-200 font-semibold text-sm">
                {liveProgress?.totalConferences ?? dbState.lastCompletedReplayContest}
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[11px] text-slate-400 block">Melhor no Concurso</span>
              <span className="font-mono text-indigo-400 font-bold text-sm">
                {liveProgress?.latestBestHits ? `${liveProgress.latestBestHits} Acertos` : "--"}
              </span>
            </div>
          </div>

          {/* Distribuição dos Acertos Obtidos */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-3">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-indigo-400" />
              Distribuição Cumulativa de Premiações Simuladas (11 a 15 Acertos)
            </span>

            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              {[11, 12, 13, 14, 15].map(tier => {
                const count =
                  liveProgress?.hitDistribution[tier] ?? finalReport?.hitDistribution[tier] ?? 0;
                return (
                  <div
                    key={tier}
                    className={`rounded-lg p-2 border ${
                      tier === 15
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                        : tier === 14
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                        : "bg-slate-900 border-slate-800 text-slate-300"
                    }`}
                  >
                    <span className="block text-[10px] text-slate-400 font-semibold">
                      {tier} Acertos
                    </span>
                    <span className="text-sm font-bold font-mono">{count}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 italic">
              * Nota: Os acertos simulados correspondem estritamente à conferência histórica e não geram créditos ou registros financeiros reais.
            </p>
          </div>
        </div>
      )}

      {/* SEÇÃO 3: Relatório Final de Conclusão e Auditoria (§11) */}
      {(finalReport || dbState?.replayState === "COMPLETED") && (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  Relatório Oficial de Conclusão da Reconstrução Histórica
                </h3>
                <p className="text-xs text-emerald-400 font-mono">
                  Status: Integridade Criptográfica Verificada (100% de Aprovação)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onNavigateToDashboard}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-600/20"
              >
                <span>Ir para o Painel C5</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-400 text-[11px] block">Intervalo de Concursos</span>
              <span className="text-slate-100 font-bold text-sm">
                #1 ao #{finalReport?.finalContest ?? dbState?.lastCompletedReplayContest}
              </span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-400 text-[11px] block">Total de Apostas Geradas</span>
              <span className="text-slate-100 font-bold text-sm">
                {finalReport?.totalGamesGenerated ?? (dbState?.lastCompletedReplayContest ?? 0) * 5}
              </span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-400 text-[11px] block">Apostas Distintas (Zero Duplicatas)</span>
              <span className="text-emerald-400 font-bold text-sm">
                {finalReport?.totalDistinctGames ?? (dbState?.lastCompletedReplayContest ?? 0) * 5}
              </span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-400 text-[11px] block">Tempo Total Medido</span>
              <span className="text-slate-100 font-bold text-sm">
                {finalReport ? formatDuration(finalReport.totalMeasuredTimeMs) : "--:--"}
              </span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2 text-xs font-mono">
            <div>
              <span className="text-slate-400 text-[11px] block">Fingerprint Final do Histórico H:</span>
              <span className="text-emerald-400 break-all text-xs font-bold">
                {finalReport?.finalHistoryFingerprint ?? dbState?.historyFingerprint}
              </span>
            </div>
            {finalReport?.manifestSha256 && (
              <div>
                <span className="text-slate-400 text-[11px] block">Manifesto SHA-256 de Homologação:</span>
                <span className="text-indigo-400 break-all text-xs font-bold">
                  {finalReport.manifestSha256}
                </span>
              </div>
            )}
          </div>

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-300">
            <p className="font-semibold">Próximo Passo Operacional:</p>
            <p className="mt-0.5">
              O motor C5-Memory 3.0 agora pode prosseguir normalmente gerando a próxima aposta oficial para o concurso{" "}
              <strong>#{(finalReport?.finalContest ?? dbState?.lastCompletedReplayContest ?? 0) + 1}</strong>, considerando
              em seu histórico H todas as 5 apostas de cada um dos concursos oficiais reconstruídos.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
