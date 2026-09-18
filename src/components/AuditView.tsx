import React, { useState } from "react";
import {
  ShieldCheck,
  Download,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileJson,
  Layers,
  Info,
} from "lucide-react";
import type { HistoryAuditResult } from "../storage/types.ts";
import { repository, downloadJsonFile } from "../storage/service.ts";
import { ImportBackupSection } from "./ImportBackupSection.tsx";

interface AuditViewProps {
  onImportSuccess?: () => void;
}

export const AuditView: React.FC<AuditViewProps> = ({ onImportSuccess }) => {
  const [auditResult, setAuditResult] = useState<HistoryAuditResult | null>(null);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const handleRunAudit = async () => {
    setIsAuditing(true);
    try {
      const result = await repository.auditEntireHistory();
      setAuditResult(result);
    } catch (err: any) {
      console.error("Erro na auditoria global:", err);
    } finally {
      setIsAuditing(false);
    }
  };

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
      setExportSuccessMsg(`Backup gerado com sucesso: ${filename} (${backupData.records.length} concursos)`);
    } catch (err: any) {
      console.error("Erro ao exportar backup:", err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Topo da Auditoria */}
      <div>
        <h2 className="text-2xl font-bold text-zinc-100 font-mono flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          <span>AUDITORIA DE INTEGRIDADE</span>
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1">
          Verificação matemática de invariantes C₅, assinaturas SHA-256 e pontuações do histórico.
        </p>
      </div>

      {/* Painel Principal de Auditoria Global */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">
              Auditoria Global do Histórico
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Valida cada registro de concurso quanto a colisão de sementes, integridade do hash de congelamento e exatidão das pontuações oficiais.
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
                <span className="text-xs text-zinc-400 block font-medium">Registros auditados</span>
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
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-xs text-zinc-400 block font-medium">Inválidos</span>
                <span
                  className={`text-2xl font-bold font-mono mt-1 block ${
                    auditResult.invalidRecords > 0 ? "text-red-400" : "text-zinc-400"
                  }`}
                >
                  {auditResult.invalidRecords}
                </span>
              </div>
            </div>

            {/* Banner de Conclusão */}
            {auditResult.valid ? (
              <div
                id="audit-status-ok-banner"
                className="p-5 rounded-xl bg-emerald-950/40 border border-emerald-500/50 flex items-center gap-4 text-emerald-200"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-900/60 border border-emerald-500 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-base font-bold font-mono text-emerald-300">
                    INTEGRIDADE DO HISTÓRICO: OK
                  </h4>
                  <p className="text-xs text-emerald-400/90 mt-0.5">
                    Todos os {auditResult.totalRecords} concursos persistidos foram auditados e estão 100% íntegros. Nenhuma adulteração matemática ou hash divergente detectado.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5 rounded-xl bg-red-950/40 border border-red-500/50 space-y-3 text-red-200">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-6 h-6 text-red-400 shrink-0" />
                  <h4 className="text-base font-bold font-mono text-red-300">
                    ALERTA: VIOLAÇÃO DE INTEGRIDADE DETECTADA NO BANCO LOCAL
                  </h4>
                </div>
                <p className="text-xs leading-relaxed">
                  Foram encontrados <strong>{auditResult.invalidRecords}</strong> concurso(s) com assinaturas criptográficas ou invariantes C₅ inconsistentes.
                </p>
                <div className="p-3 bg-zinc-950 rounded-lg border border-red-900/60 text-xs text-zinc-300 font-mono space-y-2">
                  {auditResult.records
                    .filter((r) => !r.valid)
                    .map((bad) => (
                      <div key={`bad-rec-${bad.contestNumber}`} className="p-2 border-b border-zinc-800 last:border-none">
                        <strong className="text-red-400">Concurso {bad.contestNumber} ({bad.status}):</strong>
                        <ul className="list-disc list-inside mt-1 text-zinc-400">
                          {bad.errors.map((e, idx) => (
                            <li key={`err-${bad.contestNumber}-${idx}`}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
                <p className="text-[11px] text-red-300/80 italic">
                  Aviso: O sistema não tenta reparar automaticamente registros violados para preservar a integridade forense da base.
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

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs text-zinc-300 max-w-xl leading-relaxed">
            O backup exportado inclui todos os concursos DRAFT, FROZEN e SCORED, suas sementes RNG, metadados ISO 8601, hashes SHA-256 e pontuações conferidas. O download é gerado diretamente no navegador em formato UTF-8 puro.
          </p>

          <button
            type="button"
            id="btn-export-backup"
            onClick={handleExportBackup}
            disabled={isExporting}
            className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold text-xs sm:text-sm tracking-wide border border-zinc-700 transition-colors inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
          >
            {isExporting ? (
              <div className="w-4 h-4 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
            ) : (
              <Download className="w-4 h-4 text-emerald-400" />
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
      </div>

      {/* Seção de Importação Segura */}
      <ImportBackupSection onImportSuccess={handleAfterImport} />
    </div>
  );
};
