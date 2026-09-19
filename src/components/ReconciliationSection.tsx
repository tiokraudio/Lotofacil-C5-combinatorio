import React, { useState, useRef, useEffect } from "react";
import {
  Globe,
  CheckCircle2,
  AlertTriangle,
  Clock,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import { Ball } from "./Ball.tsx";
import { getLotteryProvider, LotteryFetchError } from "../lottery/index.ts";
import { repository } from "../storage/service.ts";
import {
  reconcileOfficialResult,
  type ReconciliationStatus,
  type OfficialResultPreview,
  createOfficialResultPreview,
} from "../sync/operationalState.ts";
import {
  resolveTargetContest,
  validateResolvedExternalContest,
  deduplicateReconciledItems,
  generateReconciliationFeedback,
} from "../sync/reconciliationHelper.ts";

export interface ReconciledContestItem {
  contestNumber: number;
  localStatus: string;
  localResult: number[] | null;
  externalResult: number[] | null;
  reconciliationStatus: ReconciliationStatus;
  queriedAt: string;
  externalSource: string;
  errorMessage?: string;
}

export const ReconciliationSection: React.FC = () => {
  const [targetContestInput, setTargetContestInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reconciledItems, setReconciledItems] = useState<ReconciledContestItem[]>([]);
  const [feedback, setFeedback] = useState<{
    type: "info" | "warning" | "error" | "success";
    message: string;
  } | null>(null);

  const runIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Executa a reconciliação oficial garantindo no máximo 1 chamada ao provider por clique (Seção 3).
   */
  const handleReconcile = async () => {
    const currentRunId = ++runIdRef.current;
    setIsLoading(true);
    setFeedback(null);

    try {
      const allRecords = await repository.getAllContestRecords();

      // Determina qual concurso consultar: o informado no input ou o último registrado localmente
      let contestToQuery = resolveTargetContest(targetContestInput);

      const provider = getLotteryProvider();
      let externalData: any = null;
      let querySource = "CAIXA";
      let queryTimestamp = new Date().toISOString();

      // Exatamente 1 chamada externa por ação
      if (contestToQuery !== null) {
        externalData = await provider.getContest(contestToQuery);
      } else {
        externalData = await provider.getLatestContest();
      }

      if (!isMountedRef.current || currentRunId !== runIdRef.current) {
        return;
      }

      // Validação obrigatória: certifica que externalData.contestNumber é válido e corresponde ao alvo
      const targetContest = validateResolvedExternalContest(
        contestToQuery,
        externalData?.contestNumber
      );

      querySource = externalData.source || "CAIXA";
      queryTimestamp = externalData.fetchedAt || queryTimestamp;

      // Localiza registro local correspondente
      const localRecord =
        allRecords.find((r) => r.contestNumber === targetContest) || null;

      const preview = createOfficialResultPreview(externalData);
      const status = reconcileOfficialResult(localRecord, preview);

      const item: ReconciledContestItem = {
        contestNumber: targetContest,
        localStatus: localRecord ? localRecord.status : "SEM REGISTRO",
        localResult:
          localRecord?.officialResult || localRecord?.score?.result || null,
        externalResult: [...preview.numbers],
        reconciliationStatus: status,
        queriedAt: queryTimestamp,
        externalSource: querySource,
      };

      // Atualiza lista preservando as mais recentes no topo sem duplicatas
      setReconciledItems((prev) => deduplicateReconciledItems(item, prev));

      // Feedback determinístico baseado exclusivamente no targetContest resolvido
      setFeedback(generateReconciliationFeedback(targetContest, status));
    } catch (err: any) {
      if (!isMountedRef.current || currentRunId !== runIdRef.current) {
        return;
      }
      setFeedback({
        type: "error",
        message:
          err?.message ||
          "Não foi possível consultar a fonte oficial para reconciliação agora.",
      });
    } finally {
      if (isMountedRef.current && currentRunId === runIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  return (
    <div
      id="audit-reconciliation-section"
      className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-5"
    >
      {/* Topo da Seção */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-zinc-100 font-mono">
              RECONCILIAÇÃO COM FONTE OFICIAL (CAIXA)
            </h3>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Compara de forma estrita e determinística os resultados persistidos no histórico local com as apurações públicas da CAIXA.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            placeholder="Concurso (opcional)"
            value={targetContestInput}
            onChange={(e) => setTargetContestInput(e.target.value)}
            disabled={isLoading}
            className="w-36 px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-xl text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-hidden focus:border-emerald-500"
          />
          <button
            type="button"
            id="btn-run-reconciliation"
            onClick={handleReconcile}
            disabled={isLoading}
            className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {isLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span>VERIFICAR CAIXA</span>
          </button>
        </div>
      </div>

      {/* Feedback de Reconciliação */}
      {feedback && (
        <div
          id="reconciliation-feedback-banner"
          role="alert"
          className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
            feedback.type === "error"
              ? "bg-red-950/40 border-red-500/50 text-red-200"
              : feedback.type === "warning"
              ? "bg-amber-950/40 border-amber-500/50 text-amber-200"
              : "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
          }`}
        >
          {feedback.type === "error" ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          ) : feedback.type === "warning" ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <div className="grow">
            <p className="font-semibold">{feedback.message}</p>
          </div>
        </div>
      )}

      {/* Tabela / Cards de Reconciliação */}
      {reconciledItems.length > 0 ? (
        <div className="space-y-3">
          {reconciledItems.map((item) => (
            <div
              key={`reconciled-${item.contestNumber}`}
              id={`reconciled-contest-${item.contestNumber}`}
              className={`p-4 rounded-xl border space-y-3 ${
                item.reconciliationStatus === "MATCH"
                  ? "bg-zinc-950 border-emerald-500/40"
                  : item.reconciliationStatus === "MISMATCH"
                  ? "bg-red-950/30 border-red-500/60"
                  : "bg-zinc-950 border-zinc-800"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-zinc-850">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-sm text-zinc-100">
                    CONCURSO {item.contestNumber}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                    Estado Local: {item.localStatus}
                  </span>
                </div>

                {/* Status de Reconciliação Badge */}
                <div>
                  {item.reconciliationStatus === "MATCH" && (
                    <span
                      id={`badge-reconciliation-match-${item.contestNumber}`}
                      className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-[11px] font-mono font-bold flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>MATCH • CONSISTENTE</span>
                    </span>
                  )}
                  {item.reconciliationStatus === "MISMATCH" && (
                    <span
                      id={`badge-reconciliation-mismatch-${item.contestNumber}`}
                      className="px-2.5 py-1 rounded-full bg-red-950/80 border border-red-500 text-red-300 text-[11px] font-mono font-bold flex items-center gap-1"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                      <span>ALERTA DE RECONCILIAÇÃO • MISMATCH</span>
                    </span>
                  )}
                  {item.reconciliationStatus === "WAITING_EXTERNAL" && (
                    <span className="px-2.5 py-1 rounded-full bg-blue-950/80 border border-blue-500 text-blue-300 text-[11px] font-mono font-bold flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      <span>AGUARDANDO RESULTADO EXTERNO</span>
                    </span>
                  )}
                  {item.reconciliationStatus === "INVALID_EXTERNAL" && (
                    <span className="px-2.5 py-1 rounded-full bg-red-950/80 border border-red-500 text-red-300 text-[11px] font-mono font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      <span>RETORNO EXTERNO INVÁLIDO</span>
                    </span>
                  )}
                  {item.reconciliationStatus === "NOT_APPLICABLE" && (
                    <span className="px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400 text-[11px] font-mono font-medium">
                      NÃO APLICÁVEL
                    </span>
                  )}
                </div>
              </div>

              {/* Comparativo de Dezenas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Resultado Local */}
                <div className="space-y-1.5 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400 font-mono text-[11px] block">
                    RESULTADO ARMAZENADO (LOCAL):
                  </span>
                  {item.localResult && item.localResult.length === 15 ? (
                    <div className="flex flex-wrap gap-1">
                      {item.localResult.map((n) => (
                        <Ball key={`loc-${item.contestNumber}-${n}`} number={n} size="sm" variant="default" />
                      ))}
                    </div>
                  ) : (
                    <span className="text-zinc-500 italic text-[11px]">
                      Nenhum resultado pontuado localmente para este concurso.
                    </span>
                  )}
                </div>

                {/* Resultado Externo */}
                <div className="space-y-1.5 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400 font-mono text-[11px] block">
                    RESULTADO OFICIAL CAIXA (EXTERNO):
                  </span>
                  {item.externalResult && item.externalResult.length === 15 ? (
                    <div className="flex flex-wrap gap-1">
                      {item.externalResult.map((n) => (
                        <Ball key={`ext-${item.contestNumber}-${n}`} number={n} size="sm" variant="official" />
                      ))}
                    </div>
                  ) : (
                    <span className="text-zinc-500 italic text-[11px]">
                      Aguardando apuração da CAIXA.
                    </span>
                  )}
                </div>
              </div>

              {/* Mensagem Específica de Mismatch (Seção 30) */}
              {item.reconciliationStatus === "MISMATCH" && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/50 text-red-200 text-xs">
                  <p className="font-semibold">
                    Resultado armazenado difere do resultado retornado atualmente pela fonte oficial.
                  </p>
                  <p className="text-[11px] text-zinc-300 mt-1">
                    Regra de integridade: O sistema não sobrescreve nem altera automaticamente o concurso SCORED. O registro foi preservado intacto.
                  </p>
                </div>
              )}

              {/* Rodapé do Item com Metadados */}
              <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-500 pt-1">
                <span>Fonte: <strong>{item.externalSource}</strong></span>
                <span>Consulta: {new Date(item.queriedAt).toLocaleString("pt-BR")}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 rounded-xl bg-zinc-950/60 border border-zinc-800 text-center text-xs text-zinc-400">
          Nenhuma verificação de reconciliação realizada nesta sessão. Clique em "VERIFICAR CAIXA" acima para comparar o concurso desejado.
        </div>
      )}
    </div>
  );
};
