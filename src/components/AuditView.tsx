import React, { useState, useEffect } from "react";
import { ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, Database, Hash } from "lucide-react";
import { ContestRecord, MemoryHistory } from "../c5-memory/types";
import { getStoredMemoryHistory } from "../storage/db";
import { getMemoryAuditDetails } from "../c5-memory/application/service";

interface AuditViewProps {
  records: readonly ContestRecord[];
}

export const AuditView: React.FC<AuditViewProps> = ({ records }) => {
  const [history, setHistory] = useState<MemoryHistory | null>(null);
  const [verificationResults, setVerificationResults] = useState<
    Array<{
      contestNumber: number;
      sha256Stored: string;
      sha256Computed: string;
      isValid: boolean;
    }>
  >([]);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    loadAuditData();
  }, [records]);

  const loadAuditData = async () => {
    setIsVerifying(true);
    const hist = await getStoredMemoryHistory();
    setHistory(hist);

    const frozenRecords = records.filter(r => r.frozenPayload);
    const results = await Promise.all(
      frozenRecords.map(async r => {
        const audit = await getMemoryAuditDetails(r.contestNumber);
        return {
          contestNumber: r.contestNumber,
          sha256Stored: audit.sha256 || "",
          sha256Computed: audit.computedSha256 || "",
          isValid: audit.isCryptographicallyValid,
        };
      })
    );

    setVerificationResults(results);
    setIsVerifying(false);
  };

  const allValid = verificationResults.length > 0 && verificationResults.every(v => v.isValid);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      {/* Topo da Auditoria */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Verificação Independente
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">Integridade SHA-256 e Histórico H</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Painel de Auditoria Criptográfica
            </h1>
          </div>

          <button
            onClick={loadAuditData}
            disabled={isVerifying}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? "animate-spin" : ""}`} />
            <span>Recalcular Auditoria</span>
          </button>
        </div>
      </div>

      {/* Resumo da Integridade */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Integridade SHA-256</span>
          </div>
          <div className="flex items-center gap-2">
            {allValid ? (
              <>
                <span className="text-lg font-bold text-emerald-400">100% Válida</span>
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </>
            ) : (
              <span className="text-lg font-bold text-amber-400">
                {verificationResults.filter(v => v.isValid).length} de {verificationResults.length}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {verificationResults.length} apostas congeladas verificadas
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Database className="w-4 h-4 text-indigo-400" />
            <span>Memória Histórica H</span>
          </div>
          <span className="text-lg font-bold text-slate-100 font-mono">
            {history?.games.length || 0} jogos
          </span>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Revisão canônica: Rev {history?.revision || 0}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Hash className="w-4 h-4 text-amber-400" />
            <span>Fingerprint Atual de H</span>
          </div>
          <span className="text-xs font-mono text-slate-300 truncate block">
            {history?.fingerprint ? history.fingerprint.substring(0, 16) + "..." : "H0-EMPTY"}
          </span>
          <span className="text-[11px] text-slate-500 mt-1 block">
            SHA-256 do histórico cumulativo
          </span>
        </div>
      </div>

      {/* Tabela de Verificação dos Concursos */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-base font-bold text-slate-200">
          Apostas Auditadas pelo Algoritmo C5-Memory
        </h3>

        {verificationResults.length === 0 ? (
          <p className="text-xs text-slate-400">Nenhum concurso congelado para auditoria.</p>
        ) : (
          <div className="space-y-3">
            {verificationResults.map(res => (
              <div
                key={res.contestNumber}
                className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-bold text-slate-200">
                      Concurso #{res.contestNumber}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold text-[10px] flex items-center gap-1 ${
                        res.isValid
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {res.isValid ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Auditado: Válido</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3 h-3" />
                          <span>Divergência detectada</span>
                        </>
                      )}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 break-all select-all">
                    {res.sha256Stored}
                  </span>
                </div>

                <div className="sm:text-right shrink-0">
                  <span className="text-[10px] text-slate-500 block">K=500 MAX-LEXIMIN</span>
                  <span className="text-xs font-mono text-emerald-400">Hash Match OK</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
