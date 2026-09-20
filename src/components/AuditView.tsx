import React, { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  Download,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileJson,
  Layers,
  Info,
  Activity,
  Cpu,
  Database,
  Wifi,
  WifiOff,
  RefreshCw,
  FileText,
  Lock,
} from "lucide-react";
import type { HistoryAuditResult } from "../storage/types.ts";
import { repository, downloadJsonFile } from "../storage/service.ts";
import { generateDiagnosticFilename } from "../storage/contestRepository.ts";
import { ImportBackupSection } from "./ImportBackupSection.tsx";
import { ReconciliationSection } from "./ReconciliationSection.tsx";
import {
  runSelfDiagnostic,
  type SelfDiagnosticResult,
} from "../system/selfDiagnostic.ts";
import { APPLICATION_MANIFEST } from "../system/manifest.ts";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";

interface AuditViewProps {
  onImportSuccess?: () => void;
}

export const AuditView: React.FC<AuditViewProps> = ({ onImportSuccess }) => {
  const [auditResult, setAuditResult] = useState<HistoryAuditResult | null>(null);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isExportingDiagnostic, setIsExportingDiagnostic] = useState<boolean>(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);

  // Estados do Autodiagnóstico C₅
  const [diagResult, setDiagResult] = useState<SelfDiagnosticResult | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [includeExternal, setIncludeExternal] = useState<boolean>(true);

  // Controle de concorrência e descarte de resultados obsoletos (anti-race)
  const auditRunIdRef = useRef<number>(0);
  const diagRunIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  const handleRunDiagnostic = async () => {
    const runId = ++diagRunIdRef.current;
    setIsDiagnosing(true);
    try {
      const res = await runSelfDiagnostic({
        checkExternal: includeExternal,
      });
      if (isMountedRef.current && runId === diagRunIdRef.current) {
        setDiagResult(res);
      }
    } catch (err: unknown) {
      if (isMountedRef.current && runId === diagRunIdRef.current) {
        console.error("Erro ao executar autodiagnóstico:", err);
      }
    } finally {
      if (isMountedRef.current && runId === diagRunIdRef.current) {
        setIsDiagnosing(false);
      }
    }
  };

  const handleRunAudit = async () => {
    const runId = ++auditRunIdRef.current;
    setIsAuditing(true);
    setExportErrorMsg(null);
    try {
      const result = await repository.auditEntireHistory();
      if (isMountedRef.current && runId === auditRunIdRef.current) {
        setAuditResult(result);
      }
    } catch (err: any) {
      if (isMountedRef.current && runId === auditRunIdRef.current) {
        console.error("Erro na auditoria global:", err);
      }
    } finally {
      if (isMountedRef.current && runId === auditRunIdRef.current) {
        setIsAuditing(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    handleRunAudit();

    const unsub = refreshCoordinator.subscribe(() => {
      if (isMountedRef.current) {
        handleRunAudit();
      }
    });

    return () => {
      isMountedRef.current = false;
      auditRunIdRef.current++;
      diagRunIdRef.current++;
      unsub();
    };
  }, []);

  const handleAfterImport = async () => {
    if (onImportSuccess) {
      onImportSuccess();
    }
    // Re-audita a base automaticamente para refletir a nova integridade
    await handleRunAudit();
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    setExportSuccessMsg(null);
    setExportErrorMsg(null);
    try {
      const backupData = await repository.exportHistory();

      // Formatação do nome: c5-backup-YYYY-MM-DD-HHmmss.json
      const now = new Date();
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(
        now.getHours()
      )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `c5-backup-${timestamp}.json`;

      downloadJsonFile(backupData, filename);
      if (isMountedRef.current) {
        setExportSuccessMsg(`Backup gerado com sucesso: ${filename} (${backupData.records.length} concursos)`);
      }
    } catch (err: any) {
      console.error("Erro ao exportar backup:", err);
      if (isMountedRef.current) {
        setExportErrorMsg(err?.message || "Erro desconhecido ao exportar backup.");
      }
    } finally {
      if (isMountedRef.current) {
        setIsExporting(false);
      }
    }
  };

  const handleExportDiagnostic = async () => {
    setIsExportingDiagnostic(true);
    setExportSuccessMsg(null);
    setExportErrorMsg(null);
    try {
      const diagData = await repository.exportDiagnostic();
      const filename = generateDiagnosticFilename();
      downloadJsonFile(diagData, filename);
      if (isMountedRef.current) {
        setExportSuccessMsg(`Arquivo de diagnóstico exportado com sucesso: ${filename}`);
      }
    } catch (err: any) {
      console.error("Erro ao exportar diagnóstico:", err);
      if (isMountedRef.current) {
        setExportErrorMsg(err?.message || "Erro ao exportar arquivo de diagnóstico.");
      }
    } finally {
      if (isMountedRef.current) {
        setIsExportingDiagnostic(false);
      }
    }
  };

  const hasQuarantine = (auditResult?.quarantinedRecords ?? 0) > 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Topo da Auditoria */}
      <div>
        <h2 className="text-2xl font-bold text-zinc-100 font-mono flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          <span>AUDITORIA DE INTEGRIDADE</span>
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1">
          Verificação matemática de invariantes C₅, assinaturas SHA-256, isolamento lógico de quarentena e diagnósticos.
        </p>
      </div>

      {/* Painel de Autodiagnóstico da Aplicação e Motor C₅ */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-bold text-zinc-100">
                Autodiagnóstico do Sistema & Motor C₅
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                v{APPLICATION_MANIFEST.appVersion}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                {APPLICATION_MANIFEST.algorithmVersion}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Testa primitivas Web Crypto, amostragem RNG, conformidade com o Golden Standard C₅, integridade do IndexedDB e conectividade oficial.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer bg-zinc-950/60 px-3 py-2 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors">
              <input
                type="checkbox"
                checked={includeExternal}
                onChange={(e) => setIncludeExternal(e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-700 text-cyan-500 focus:ring-cyan-400"
              />
              <span>Consultar API CAIXA</span>
            </label>

            <button
              type="button"
              id="btn-run-self-diagnostic"
              onClick={handleRunDiagnostic}
              disabled={isDiagnosing}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs sm:text-sm tracking-wide transition-all shadow-md inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer focus:ring-2 focus:ring-cyan-400"
            >
              {isDiagnosing ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>EXECUTAR DIAGNÓSTICO</span>
            </button>
          </div>
        </div>

        {diagResult ? (
          <div className="space-y-6">
            {/* Status Geral */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Status do Motor Local</span>
                <span
                  className={`text-xl font-bold font-mono mt-1 block ${
                    diagResult.localStatus === "PASS"
                      ? "text-emerald-400"
                      : diagResult.localStatus === "WARN"
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {diagResult.localStatus}
                </span>
                <span className="text-[10px] text-zinc-500 block mt-0.5">
                  Criptografia, RNG, Golden, DB
                </span>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Status Global</span>
                <span
                  className={`text-xl font-bold font-mono mt-1 block ${
                    diagResult.globalStatus === "PASS"
                      ? "text-emerald-400"
                      : diagResult.globalStatus === "WARN"
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {diagResult.globalStatus}
                </span>
                <span className="text-[10px] text-zinc-500 block mt-0.5">
                  Inclui subsistema externo
                </span>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Tempo de Execução</span>
                <span className="text-xl font-bold font-mono text-zinc-200 mt-1 block">
                  {diagResult.durationMs}ms
                </span>
                <span className="text-[10px] text-zinc-500 block mt-0.5">
                  {new Date(diagResult.finishedAt).toLocaleTimeString()}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Histórico Auditado</span>
                <span className="text-xl font-bold font-mono text-zinc-200 mt-1 block">
                  {diagResult.historyAudit.validRecords}/{diagResult.historyAudit.totalRecords}
                </span>
                <span className="text-[10px] text-zinc-500 block mt-0.5">
                  {diagResult.historyAudit.quarantinedRecords === 0
                    ? "100% íntegro"
                    : `${diagResult.historyAudit.quarantinedRecords} em quarentena`}
                </span>
              </div>
            </div>

            {/* Lista dos Testes Individuais */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Verificações de Diagnóstico ({diagResult.checks.length} testes)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {diagResult.checks.map((chk) => {
                  const isPass = chk.status === "PASS";
                  const isWarn = chk.status === "WARN";
                  const isFail = chk.status === "FAIL";

                  const badgeClass = isPass
                    ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/60"
                    : isWarn
                    ? "bg-amber-950/60 text-amber-300 border-amber-800/60"
                    : isFail
                    ? "bg-red-950/60 text-red-300 border-red-800/60"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700";

                  return (
                    <div
                      key={chk.id}
                      className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800/90 flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-200">
                              {chk.name}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500">
                              {chk.durationMs}ms
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                            {chk.message}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border shrink-0 ${badgeClass}`}
                        >
                          {chk.status}
                        </span>
                      </div>

                      {chk.details && Object.keys(chk.details).length > 0 && (
                        <div className="mt-1 pt-2 border-t border-zinc-900 text-[11px] font-mono text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
                          {Object.entries(chk.details).map(([k, v]) => (
                            <span key={k}>
                              <span className="text-zinc-400">{k}:</span>{" "}
                              <span className="text-zinc-300">
                                {typeof v === "boolean" ? (v ? "true" : "false") : String(v)}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 rounded-xl bg-zinc-950/50 border border-zinc-800/80 text-center">
            <Activity className="w-8 h-8 text-cyan-500/60 mx-auto mb-2" />
            <p className="text-xs text-zinc-400">
              Clique em "EXECUTAR DIAGNÓSTICO" para inspecionar em tempo de execução o Web Crypto, RNG, Golden Standard, armazenamento local e conectividade da aplicação.
            </p>
          </div>
        )}
      </div>

      {/* Painel Principal de Auditoria Global */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">
              Auditoria Global do Histórico
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Valida cada registro de concurso quanto a conformidade estrutural, integridade criptográfica SHA-256 e exatidão das pontuações.
            </p>
          </div>

          <button
            type="button"
            id="btn-run-full-audit"
            onClick={handleRunAudit}
            disabled={isAuditing}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm tracking-wide transition-all shadow-md inline-flex items-center gap-2 self-start sm:self-auto disabled:opacity-50 cursor-pointer focus:ring-2 focus:ring-emerald-400"
          >
            {isAuditing ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span>AUDITAR TODO O HISTÓRICO</span>
          </button>
        </div>

        {/* Resultado da Auditoria Global */}
        {auditResult ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Total Auditado</span>
                <span className="text-2xl font-bold font-mono text-zinc-100 mt-1 block">
                  {auditResult.totalRecords}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Válidos</span>
                <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                  {auditResult.validRecords}
                </span>
              </div>
              <div
                className={`p-4 rounded-xl border transition-colors ${
                  hasQuarantine
                    ? "bg-amber-950/40 border-amber-500/60 text-amber-200"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs block font-medium">Em Quarentena</span>
                  {hasQuarantine && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse">
                      ISOLADO
                    </span>
                  )}
                </div>
                <span
                  className={`text-2xl font-bold font-mono mt-1 block ${
                    hasQuarantine ? "text-amber-400" : "text-zinc-400"
                  }`}
                >
                  {auditResult.quarantinedRecords}
                </span>
              </div>
            </div>

            {/* Banner de Conclusão */}
            {!hasQuarantine ? (
              <div
                id="audit-status-ok-banner"
                className="p-5 rounded-xl bg-emerald-950/40 border border-emerald-500/50 flex items-center gap-4 text-emerald-200"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-900/60 border border-emerald-500 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-base font-bold font-mono text-emerald-300">
                    INTEGRIDADE DO HISTÓRICO: 100% CONFORME
                  </h4>
                  <p className="text-xs text-emerald-400/90 mt-0.5">
                    Todos os {auditResult.totalRecords} concursos persistidos foram auditados e estão 100% íntegros. Nenhuma divergência estrutural, temporal ou criptográfica detectada.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5 rounded-xl bg-amber-950/30 border border-amber-500/50 space-y-4 text-amber-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
                    <div>
                      <h4 className="text-base font-bold font-mono text-amber-300">
                        REGISTROS EM QUARENTENA DETECTADOS ({auditResult.quarantinedRecords})
                      </h4>
                      <p className="text-xs text-amber-400/90 mt-0.5">
                        Registros com corrupção ou inconsistência estrutural foram isolados logicamente para proteger as métricas financeiras e de acertos.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="btn-export-diagnostic"
                    onClick={handleExportDiagnostic}
                    disabled={isExportingDiagnostic}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs tracking-wide transition-all shadow-md inline-flex items-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
                  >
                    {isExportingDiagnostic ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    <span>EXPORTAR DIAGNÓSTICO</span>
                  </button>
                </div>

                {/* Lista detalhada dos concursos em quarentena */}
                <div className="p-4 bg-zinc-950 rounded-xl border border-amber-900/60 space-y-3">
                  <h5 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Concursos Afetados e Evidências Preservadas
                  </h5>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {auditResult.quarantinedList && auditResult.quarantinedList.length > 0 ? (
                      auditResult.quarantinedList.map((q) => (
                        <div
                          key={`quarantine-${q.contestNumber}`}
                          className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-amber-400">
                              Concurso #{q.contestNumber}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 border border-zinc-700">
                              Status Persistido: {q.persistedStatus}
                            </span>
                          </div>
                          <ul className="list-disc list-inside text-zinc-400 text-[11px] space-y-0.5">
                            {q.reasons.map((r, rIdx) => (
                              <li key={`reason-${q.contestNumber}-${rIdx}`} className="text-red-400/90">
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                    ) : (
                      auditResult.records
                        .filter((r) => !r.valid)
                        .map((bad) => (
                          <div
                            key={`bad-fallback-${bad.contestNumber}`}
                            className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono space-y-1.5"
                          >
                            <span className="font-bold text-amber-400">
                              Concurso #{bad.contestNumber} ({bad.status})
                            </span>
                            <ul className="list-disc list-inside text-red-400/90 text-[11px] space-y-0.5">
                              {bad.errors.map((err, eIdx) => (
                                <li key={`err-fallback-${bad.contestNumber}-${eIdx}`}>{err}</li>
                              ))}
                            </ul>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-amber-300/80 italic leading-relaxed">
                  Regra de integridade: Nenhum dado corrompido é apagado ou normalizado automaticamente. O isolamento lógico impede freeze, pontuação e inclusão em estatísticas.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 rounded-xl bg-zinc-950/50 border border-zinc-800/80 text-center">
            <ShieldCheck className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
            <p className="text-xs text-zinc-400">
              Clique em "AUDITAR TODO O HISTÓRICO" para verificar a validade de todos os registros persistidos.
            </p>
          </div>
        )}
      </div>

      {/* Seção de Reconciliação com Fonte Oficial CAIXA (Seção 32) */}
      <ReconciliationSection />

      {/* Seção de Backup */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-zinc-800">
          <div className="p-2 rounded-xl bg-zinc-800 text-emerald-400 border border-zinc-700">
            <FileJson className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-100">
              Exportação de Backup Criptográfico
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Gera um arquivo JSON serializável completo com o histórico prospectivo auditado.
            </p>
          </div>
        </div>

        {/* Aviso de bloqueio se houver quarentena */}
        {hasQuarantine && (
          <div
            id="backup-blocked-warning"
            className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 text-amber-200 text-xs flex items-start gap-3"
          >
            <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-amber-300 block">
                EXPORTAÇÃO DE BACKUP BLOQUEADA
              </span>
              <p className="leading-relaxed">
                Backup bloqueado devido a registros corrompidos na base local. Exporte o diagnóstico para suporte técnico.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs text-zinc-300 max-w-xl leading-relaxed">
            O backup exportado inclui todos os concursos DRAFT, FROZEN e SCORED, suas sementes RNG, metadados ISO 8601, hashes SHA-256 e pontuações conferidas. O download é gerado diretamente no navegador em formato UTF-8 puro.
          </p>

          <button
            type="button"
            id="btn-export-backup"
            onClick={handleExportBackup}
            disabled={isExporting || hasQuarantine}
            className={`px-5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm tracking-wide border transition-colors inline-flex items-center gap-2 shrink-0 ${
              hasQuarantine
                ? "bg-zinc-800/50 text-zinc-500 border-zinc-800 cursor-not-allowed"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border-zinc-700 cursor-pointer"
            }`}
          >
            {isExporting ? (
              <div className="w-4 h-4 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
            ) : (
              <Download className={`w-4 h-4 ${hasQuarantine ? "text-zinc-600" : "text-emerald-400"}`} />
            )}
            <span>EXPORTAR BACKUP</span>
          </button>
        </div>

        {exportSuccessMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{exportSuccessMsg}</span>
          </div>
        )}

        {exportErrorMsg && (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/40 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{exportErrorMsg}</span>
          </div>
        )}
      </div>

      {/* Seção de Importação Segura */}
      <ImportBackupSection onImportSuccess={handleAfterImport} />
    </div>
  );
};

