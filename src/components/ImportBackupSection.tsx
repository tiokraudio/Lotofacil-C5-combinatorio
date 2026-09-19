import React, { useState, useRef, DragEvent } from "react";
import {
  Upload,
  AlertOctagon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode,
  ArrowRight,
  RefreshCw,
  Info,
  ShieldAlert,
} from "lucide-react";
import type { ImportPlan, ImportExecutionResult } from "../storage/import.ts";
import {
  parseHistoryBackup,
  prepareHistoryImport,
  importHistory,
} from "../storage/import.ts";
import { repository } from "../storage/service.ts";
import { actionLockController } from "../system/actionLock.ts";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";
import { classifyOperationalError } from "../system/operationalErrors.ts";

interface ImportBackupSectionProps {
  onImportSuccess?: () => void;
}

export const ImportBackupSection: React.FC<ImportBackupSectionProps> = ({
  onImportSuccess,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  const [parseErrors, setParseErrors] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [successResult, setSuccessResult] = useState<ImportExecutionResult | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setParseErrors(null);
    setPlan(null);
    setCommitError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const processFile = async (file: File) => {
    resetState();
    setSuccessResult(null);

    // Validação de tipo e tamanho defensivo (10 MB)
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setParseErrors([
        `Extensão de arquivo inválida (${file.name}). O sistema aceita exclusivamente arquivos .json.`,
      ]);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setParseErrors([
        `O arquivo excede o limite máximo permitido de 10 MB (tamanho: ${(
          file.size /
          (1024 * 1024)
        ).toFixed(2)} MB).`,
      ]);
      return;
    }

    setIsValidating(true);
    try {
      const text = await file.text();
      const parsed = parseHistoryBackup(text);
      const generatedPlan = await prepareHistoryImport(parsed, repository);

      if (!generatedPlan.valid && generatedPlan.errors.length > 0) {
        setParseErrors(generatedPlan.errors);
      } else {
        setPlan(generatedPlan);
      }
    } catch (err: any) {
      setParseErrors([
        err?.message ?? "Falha inesperada ao processar o arquivo de backup.",
      ]);
    } finally {
      setIsValidating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleConfirmImport = async () => {
    if (!plan || !plan.valid || isCommitting || plan.newRecords === 0) {
      return;
    }

    if (!actionLockController.acquire("IMPORT")) {
      return; // Prevenção de duplo clique concorrente
    }

    setIsCommitting(true);
    setCommitError(null);

    try {
      // Passa o plano para que a proteção TOCTOU revalide contra o banco antes de gravar
      const result = await importHistory(plan, repository);
      setSuccessResult(result);
      setPlan(null);
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (err: any) {
      const classified = classifyOperationalError(err, "STORAGE_WRITE_FAILED");
      setCommitError(classified.userMessage);
    } finally {
      actionLockController.release("IMPORT");
      setIsCommitting(false);
    }
  };

  return (
    <div
      id="section-import-backup"
      className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-6"
    >
      {/* Cabeçalho da Seção */}
      <div className="flex items-center gap-3 pb-4 border-b border-zinc-800">
        <div className="p-2 rounded-xl bg-zinc-800 text-sky-400 border border-zinc-700">
          <Upload className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-zinc-100">
            Importação Segura de Backup
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Restaura concursos preservando a integridade criptográfica SHA-256 e impedindo conflitos.
          </p>
        </div>
      </div>

      {/* Lembrete Preventivo de Backup (Prompt 09 - Seção 27) */}
      <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs text-zinc-400 flex items-center gap-2.5">
        <Info className="w-4 h-4 text-sky-400 shrink-0" />
        <span>Recomendação: mantenha um backup recente antes de importar outro histórico.</span>
      </div>

      {/* Área de Seleção / Dropzone */}
      <div
        id="dropzone-import-backup"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`p-6 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center gap-3 ${
          isDragging
            ? "border-sky-400 bg-sky-950/20 text-sky-200"
            : "border-zinc-700 hover:border-zinc-600 bg-zinc-950/50 text-zinc-400"
        }`}
      >
        <input
          ref={fileInputRef}
          id="file-import-input"
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300">
          {isValidating ? (
            <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
          ) : (
            <FileCode className="w-6 h-6 text-zinc-400" />
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-zinc-200">
            {isValidating
              ? "Validando estrutura matemática e assinaturas..."
              : "Selecione ou arraste o arquivo JSON de backup"}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Aceita apenas backups oficiais (.json) com schemaVersion 1 e limite máximo de 10 MB.
          </p>
        </div>

        <button
          type="button"
          id="btn-trigger-import"
          onClick={() => fileInputRef.current?.click()}
          disabled={isValidating || isCommitting}
          className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold tracking-wide border border-zinc-700 transition-colors inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>SELECIONAR ARQUIVO JSON</span>
        </button>
      </div>

      {/* Banner de Erros no Arquivo (Inválido) */}
      {parseErrors && parseErrors.length > 0 && (
        <div
          id="import-invalid-error-banner"
          className="p-5 rounded-xl bg-red-950/40 border border-red-500/50 space-y-3 text-red-200 animate-in fade-in"
        >
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
            <h4 className="text-sm font-bold font-mono text-red-300">
              Backup inválido. Nenhum dado foi importado.
            </h4>
          </div>
          <p className="text-xs text-red-200/90 leading-relaxed">
            O arquivo fornecido falhou na verificação de integridade formal, matemática ou criptográfica.
          </p>
          <div className="p-3 bg-zinc-950 rounded-lg border border-red-900/60 max-h-48 overflow-y-auto">
            <ul id="import-error-list" className="list-disc list-inside text-xs text-zinc-300 font-mono space-y-1">
              {parseErrors.map((err, idx) => (
                <li key={`err-${idx}`}>{err}</li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={resetState}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
            >
              Descartar e Tentar Outro Arquivo
            </button>
          </div>
        </div>
      )}

      {/* Banner de Erro durante o Commit (ex: TOCTOU) */}
      {commitError && (
        <div
          id="import-commit-error-banner"
          className="p-4 rounded-xl bg-red-950/40 border border-red-500/50 flex items-start gap-3 text-red-200 animate-in fade-in"
        >
          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1 grow">
            <h4 className="text-sm font-bold font-mono text-red-300">
              Falha na Gravação da Importação
            </h4>
            <p className="text-xs text-red-200/90 leading-relaxed">{commitError}</p>
          </div>
          <button
            type="button"
            onClick={() => setCommitError(null)}
            className="text-zinc-400 hover:text-zinc-200 text-xs"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Banner de Sucesso Pós-Importação */}
      {successResult && (
        <div
          id="import-success-banner"
          className="p-5 rounded-xl bg-emerald-950/40 border border-emerald-500/50 space-y-3 text-emerald-200 animate-in fade-in"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-900/60 border border-emerald-500 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-bold font-mono text-emerald-300">
                Backup importado com sucesso.
              </h4>
              <p className="text-xs text-emerald-400/90 mt-0.5">
                {successResult.importedCount} registros importados • {successResult.skippedIdenticalCount} registros idênticos ignorados • {successResult.conflictCount} conflitos preservados • Integridade do histórico: OK
              </p>
            </div>
          </div>
          <div className="text-[11px] text-zinc-400 font-mono bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800">
            A auditoria global pós-importação confirmou {successResult.historyAudit.totalRecords}{" "}
            concurso(s) auditados sem nenhuma inconsistência ou adulteração.
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSuccessResult(null)}
              className="px-3 py-1.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/50 text-emerald-300 text-xs font-semibold border border-emerald-700/50 transition-colors"
            >
              Concluir
            </button>
          </div>
        </div>
      )}

      {/* Painel de Prévia Obrigatória */}
      {plan && (
        <div
          id="import-preview-panel"
          className="space-y-6 pt-2 border-t border-zinc-800 animate-in fade-in duration-200"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-zinc-200 font-mono flex items-center gap-2">
                <span>PRÉVIA DA IMPORTAÇÃO</span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                  Validação Concluída
                </span>
              </h4>
              <p className="text-xs text-zinc-400 mt-0.5">
                Revise as ações planejadas antes de autorizar a persistência no banco local.
              </p>
            </div>

            <button
              type="button"
              id="btn-cancel-import-top"
              onClick={resetState}
              disabled={isCommitting}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline self-start sm:self-auto cursor-pointer"
            >
              Descartar arquivo
            </button>
          </div>

          {/* Cards de Métricas da Prévia */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <span className="text-[11px] text-zinc-400 block font-medium">No Backup</span>
              <span
                id="preview-total-records"
                className="text-xl font-bold font-mono text-zinc-100 mt-0.5 block"
              >
                {plan.totalBackupRecords}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <span className="text-[11px] text-zinc-400 block font-medium">Novos a Importar</span>
              <span
                id="preview-new-records"
                className="text-xl font-bold font-mono text-emerald-400 mt-0.5 block"
              >
                {plan.newRecords}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <span className="text-[11px] text-zinc-400 block font-medium">Idênticos a Pular</span>
              <span
                id="preview-identical-records"
                className="text-xl font-bold font-mono text-zinc-300 mt-0.5 block"
              >
                {plan.identicalRecords}
              </span>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                plan.conflicts > 0
                  ? "bg-amber-950/30 border-amber-500/40"
                  : "bg-zinc-950 border-zinc-800"
              }`}
            >
              <span
                className={`text-[11px] block font-medium ${
                  plan.conflicts > 0 ? "text-amber-300" : "text-zinc-400"
                }`}
              >
                Conflitos Preservados
              </span>
              <span
                id="preview-conflicts-count"
                className={`text-xl font-bold font-mono mt-0.5 block ${
                  plan.conflicts > 0 ? "text-amber-400 font-bold" : "text-zinc-400"
                }`}
              >
                {plan.conflicts}
              </span>
            </div>
          </div>

          {/* Banner Informativo se Houver Conflito */}
          {plan.conflicts > 0 && (
            <div
              id="import-conflict-info-banner"
              className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 space-y-2 text-amber-200"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <h5 className="text-xs sm:text-sm font-bold font-mono text-amber-300">
                  {plan.conflicts} conflito(s) detectado(s) — registros locais preservados
                </h5>
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                A política estrita de persistência C₅ garante que nenhum registro local será sobrescrito ou alterado.
                Os concursos divergentes no backup serão ignorados e mantidos intactos no banco local.
              </p>
            </div>
          )}

          {/* Lista Resumida dos Concursos Afetados */}
          <div className="space-y-2">
            <span className="text-xs text-zinc-400 font-mono block">
              DETALHAMENTO DOS REGISTROS ANALISADOS:
            </span>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800/80">
              {plan.records.map((item) => {
                let badgeColor = "bg-zinc-800 text-zinc-300 border-zinc-700";
                let actionLabel = "PULAR (IDÊNTICO)";

                if (item.action === "IMPORT") {
                  badgeColor = "bg-emerald-950 text-emerald-300 border-emerald-600/60";
                  actionLabel = "IMPORTAR (NOVO)";
                } else if (item.action === "CONFLICT") {
                  badgeColor = "bg-amber-950 text-amber-300 border-amber-600/60";
                  actionLabel = "CONFLITO (PRESERVADO)";
                }

                return (
                  <div
                    key={`plan-item-${item.contestNumber}`}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-zinc-200">
                        Concurso {item.contestNumber}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-900 border border-zinc-700 text-zinc-400">
                        {item.backupStatus}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${badgeColor} self-start sm:self-auto`}
                      >
                        {actionLabel}
                      </span>
                      <span className="text-[11px] text-zinc-400 max-w-sm">
                        {item.reason}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Confirmação Explícita ou Bloqueio */}
          {plan.valid ? (
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-emerald-500/30 space-y-4">
              <div className="space-y-1">
                <h5 className="text-xs sm:text-sm font-bold font-mono text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Confirmação da Operação</span>
                </h5>
                <ul className="text-xs text-zinc-300 space-y-1 list-disc list-inside">
                  <li>
                    Importar <strong>{plan.newRecords}</strong> novo(s) registro(s)?
                  </li>
                  <li>
                    <strong>{plan.identicalRecords}</strong> registro(s) idêntico(s) serão ignorados.
                  </li>
                  {plan.conflicts > 0 && (
                    <li>
                      <strong>{plan.conflicts}</strong> conflito(s) não serão alterados (preservados).
                    </li>
                  )}
                  <li>
                    <strong>Nenhum registro existente será sobrescrito.</strong>
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  id="btn-cancel-import"
                  onClick={resetState}
                  disabled={isCommitting}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold tracking-wide transition-colors cursor-pointer disabled:opacity-50"
                >
                  CANCELAR
                </button>

                <button
                  type="button"
                  id="btn-confirm-import"
                  onClick={handleConfirmImport}
                  disabled={isCommitting || plan.newRecords === 0}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold font-mono tracking-wide transition-all shadow-md inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-emerald-400"
                >
                  {isCommitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>GRAVANDO REGISTROS...</span>
                    </>
                  ) : plan.newRecords === 0 ? (
                    <span>NENHUM NOVO REGISTRO A IMPORTAR</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>CONFIRMAR IMPORTAÇÃO</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                id="btn-cancel-import-blocked"
                onClick={resetState}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold tracking-wide transition-colors cursor-pointer"
              >
                CANCELAR E DESCARTAR
              </button>

              <button
                type="button"
                id="btn-confirm-import-disabled"
                disabled={true}
                className="px-5 py-2 rounded-xl bg-zinc-800 text-zinc-500 text-xs font-bold font-mono tracking-wide cursor-not-allowed border border-zinc-700/50 opacity-50"
              >
                BACKUP INVÁLIDO OU CORROMPIDO
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
