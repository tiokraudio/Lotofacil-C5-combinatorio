/**
 * V1.11 — Componente de Auditoria Oficial Pós-Score e Detecção de Divergências
 * Arquivo: src/components/OfficialResultAuditPanel.tsx
 *
 * Superfície somente leitura para concursos SCORED.
 * Compara o officialResult histórico persistido com as 15 dezenas do snapshot CAIXA
 * atualmente observado na sessão através do OfficialSnapshotCoordinator.
 */

import React, { useState, useEffect } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import {
  OfficialSnapshotCoordinator,
  officialSnapshotCoordinator,
} from "../sync/officialSnapshotCoordinator.ts";
import {
  deriveOfficialResultAudit,
  type OfficialResultAudit,
} from "../sync/officialResultAudit.ts";

export interface OfficialResultAuditPanelProps {
  record: ContestRecord | null | undefined;
  coordinator?: OfficialSnapshotCoordinator;
}

export const OfficialResultAuditPanel: React.FC<OfficialResultAuditPanelProps> = ({
  record,
  coordinator,
}) => {
  // Elegibilidade: aplicável exclusivamente para concursos SCORED
  if (!record || record.status !== "SCORED") {
    return null;
  }

  const activeCoordinator = coordinator ?? officialSnapshotCoordinator;

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Inscrição reativa aos eventos do coordenador de snapshots
  useEffect(() => {
    const unsubscribe = activeCoordinator.subscribe((contestNumber) => {
      if (contestNumber === undefined || contestNumber === record.contestNumber) {
        setTick((t) => t + 1);
      }
    });
    return unsubscribe;
  }, [activeCoordinator, record.contestNumber]);

  const entry = activeCoordinator.get(record.contestNumber);
  const snapshot = entry?.snapshot;

  // Derivação pura em memória
  const audit: OfficialResultAudit = deriveOfficialResultAudit(record, snapshot);

  const handleConsultOrRefresh = async (isRefresh: boolean) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (isRefresh) {
        await activeCoordinator.refreshContest(record.contestNumber);
      } else {
        await activeCoordinator.consultContest(record.contestNumber);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message || "Falha ao consultar a referência oficial da CAIXA."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const formatNumbers = (nums?: readonly number[]) => {
    if (!nums || nums.length === 0) return "Nenhuma";
    return nums.map((n) => n.toString().padStart(2, "0")).join(", ");
  };

  return (
    <div
      id="panel-official-result-audit"
      className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 text-xs text-zinc-300 space-y-4 shadow-sm"
    >
      {/* Cabeçalho da Seção */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-zinc-100 uppercase tracking-wider font-mono">
            Auditoria CAIXA
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">
            (Concurso {record.contestNumber})
          </span>
        </div>

        {/* Status Badge */}
        <div>
          {audit.status === "MATCH" && (
            <span
              id="audit-status-badge"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold text-[11px]"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              CORRESPONDE
            </span>
          )}

          {audit.status === "MISMATCH" && (
            <span
              id="audit-status-badge"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-semibold text-[11px]"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              DIVERGÊNCIA DETECTADA
            </span>
          )}

          {audit.status === "REFERENCE_UNAVAILABLE" && (
            <span
              id="audit-status-badge"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 font-semibold text-[11px]"
            >
              REFERÊNCIA NÃO DISPONÍVEL
            </span>
          )}
        </div>
      </div>

      {/* Alerta de Erro de Conexão / Falha no Refresh (sem descartar snapshot anterior) */}
      {errorMessage && (
        <div
          id="msg-audit-refresh-failure"
          className="p-3 rounded-lg bg-red-950/30 border border-red-500/40 text-xs text-red-300 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Falha na consulta externa:</p>
            <p className="text-zinc-300">{errorMessage}</p>
            {snapshot && (
              <p className="text-[11px] text-zinc-400 italic">
                O snapshot anteriormente consultado foi preservado para auditoria.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo Dependente do Estado da Auditoria */}
      {audit.status === "REFERENCE_UNAVAILABLE" && (
        <div className="space-y-3 py-1">
          <p className="text-zinc-400">
            Referência CAIXA ainda não consultada nesta sessão.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              id="btn-audit-consult-caixa"
              onClick={() => handleConsultOrRefresh(false)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold transition-colors disabled:opacity-50 text-xs cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              {isLoading ? "Consultando..." : "Consultar CAIXA"}
            </button>
          </div>
        </div>
      )}

      {(audit.status === "MATCH" || audit.status === "MISMATCH") && (
        <div className="space-y-3">
          {/* Confronto de Resultados */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-800/80 space-y-1">
              <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider block">
                Resultado usado na conferência:
              </span>
              <p
                id="audit-persisted-result"
                className="font-mono text-zinc-100 font-medium tracking-wide"
              >
                {formatNumbers(audit.persistedResult)}
              </p>
              <span className="text-[10px] text-zinc-500 block">
                Origem: Histórico local persistido
              </span>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-800/80 space-y-1">
              <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider block">
                Referência CAIXA atual:
              </span>
              <p
                id="audit-current-result"
                className="font-mono text-zinc-100 font-medium tracking-wide"
              >
                {formatNumbers(audit.currentOfficialResult)}
              </p>
              <span className="text-[10px] text-zinc-500 block">
                Fonte: {audit.currentSource || "CAIXA"}
                {audit.currentFetchedAt && ` • ${new Date(audit.currentFetchedAt).toLocaleString("pt-BR")}`}
              </span>
            </div>
          </div>

          {/* Seção Específica para MISMATCH */}
          {audit.status === "MISMATCH" && (
            <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 space-y-2 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
                <div>
                  <span className="text-[11px] text-amber-300 font-semibold uppercase tracking-wider block">
                    Removidas:
                  </span>
                  <span
                    id="audit-removed-numbers"
                    className="text-amber-200 font-medium"
                  >
                    {formatNumbers(audit.removedNumbers)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-emerald-300 font-semibold uppercase tracking-wider block">
                    Adicionadas:
                  </span>
                  <span
                    id="audit-added-numbers"
                    className="text-emerald-200 font-medium"
                  >
                    {formatNumbers(audit.addedNumbers)}
                  </span>
                </div>
              </div>

              <p
                id="audit-immutable-notice"
                className="text-[11px] text-zinc-400 font-normal italic pt-1 border-t border-amber-500/20"
              >
                Nenhum dado histórico foi alterado.
              </p>
            </div>
          )}

          {/* Rodapé com Ação Explícita de Atualização e Metadados */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-zinc-500">
              {audit.currentFetchedAt
                ? `Referência consultada em ${new Date(audit.currentFetchedAt).toLocaleTimeString("pt-BR")}`
                : "Referência oficial da sessão"}
            </span>

            <button
              type="button"
              id="btn-audit-refresh-caixa"
              onClick={() => handleConsultOrRefresh(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors disabled:opacity-50 text-xs cursor-pointer border border-zinc-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Atualizando..." : "Atualizar CAIXA"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
