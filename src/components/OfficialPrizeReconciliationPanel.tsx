import React, { useState } from "react";
import { Award, RefreshCw, AlertTriangle, CheckCircle, HelpCircle } from "lucide-react";
import type { C5Score, PrizeRecord } from "../c5/types.ts";
import type {
  OfficialPrizeReference,
  LotteryResultProvider,
} from "../lottery/types.ts";
import { getLotteryProvider } from "../lottery/index.ts";
import {
  deriveExpectedPrize,
  deriveFinancialReconciliation,
} from "../sync/officialPrizeReconciliation.ts";
import { formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";

interface OfficialPrizeReconciliationPanelProps {
  contestNumber: number;
  score?: C5Score;
  prize?: PrizeRecord;
  lotteryProvider?: LotteryResultProvider;
  initialReference?: OfficialPrizeReference;
  onReferenceLoaded?: (reference: OfficialPrizeReference) => void;
}

export const OfficialPrizeReconciliationPanel: React.FC<
  OfficialPrizeReconciliationPanelProps
> = ({
  contestNumber,
  score,
  prize,
  lotteryProvider,
  initialReference,
  onReferenceLoaded,
}) => {
  const activeProvider = lotteryProvider ?? getLotteryProvider();
  const [reference, setReference] = useState<OfficialPrizeReference | undefined>(
    initialReference
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFetchOrRefresh = async (isRefresh: boolean) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = isRefresh
        ? activeProvider.refreshContest
          ? await activeProvider.refreshContest(contestNumber)
          : await activeProvider.getContest(contestNumber)
        : await activeProvider.getContest(contestNumber);

      if (result.prizeReference) {
        setReference(result.prizeReference);
        onReferenceLoaded?.(result.prizeReference);
      } else {
        setErrorMessage(
          "O concurso oficial foi localizado, mas a lista de rateio de prêmios não está disponível nesta consulta."
        );
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message || "Falha ao consultar a referência oficial da CAIXA."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const expectedPrize =
    score && reference ? deriveExpectedPrize(score, reference) : null;
  const reconciliation =
    score && reference
      ? deriveFinancialReconciliation(score, prize, reference)
      : null;

  return (
    <div
      id="panel-official-prize-reconciliation"
      className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-emerald-400" />
          <h4 className="text-sm font-semibold tracking-wider text-zinc-200 uppercase font-mono">
            Referência Oficial CAIXA & Reconciliação
          </h4>
          {reference && (
            <span
              id="badge-caixa-reference"
              className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-blue-950/80 border border-blue-500/40 text-blue-300"
            >
              REFERÊNCIA CAIXA
            </span>
          )}
        </div>

        {reference ? (
          <button
            type="button"
            id="btn-refresh-prize-reference"
            onClick={() => handleFetchOrRefresh(true)}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Atualizar rateio oficial da CAIXA ignorando cache de sessão"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-400 ${
                isLoading ? "animate-spin" : ""
              }`}
            />
            <span>{isLoading ? "Atualizando..." : "Atualizar Referência (Refresh)"}</span>
          </button>
        ) : (
          <button
            type="button"
            id="btn-fetch-prize-reference"
            onClick={() => handleFetchOrRefresh(false)}
            disabled={isLoading}
            className="px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:text-white bg-emerald-800/80 hover:bg-emerald-700 border border-emerald-600/60 rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
            <span>{isLoading ? "Consultando..." : "Consultar Referência CAIXA"}</span>
          </button>
        )}
      </div>

      {/* Alerta de erro de rede / refresh mantendo snapshot anterior */}
      {errorMessage && (
        <div
          id="msg-refresh-failure"
          className="p-3 rounded-lg bg-red-950/30 border border-red-500/40 text-xs text-red-300 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Não foi possível atualizar a referência oficial:</p>
            <p className="text-zinc-300">{errorMessage}</p>
            {reference && (
              <p className="text-[11px] text-zinc-400 italic">
                O snapshot anteriormente consultado foi preservado para visualização.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo com referência oficial disponível */}
      {reference && (
        <div className="space-y-4">
          <div>
            <div className="text-xs text-zinc-400 font-mono mb-2">
              Rateio Oficial por Faixa (Concurso {reference.contestNumber}):
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {reference.tiers.map((tier) => (
                <div
                  key={tier.hits}
                  id={`tier-hits-${tier.hits}`}
                  className="p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800/80 text-center space-y-1"
                >
                  <div className="text-[11px] font-mono font-bold text-zinc-300 uppercase">
                    {tier.hits} acertos
                  </div>
                  <div className="text-xs font-mono font-semibold text-emerald-400">
                    {formatBRLFromCents(tier.prizePerWinnerCents)}
                  </div>
                  <div className="text-[10px] text-zinc-400 font-mono">
                    {tier.winners.toLocaleString("pt-BR")} ganhador(es)
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Premiação calculada para os 5 jogos */}
          {expectedPrize && (
            <div className="p-3.5 rounded-lg bg-zinc-950/50 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-zinc-300 block">
                  Premiação calculada para seus 5 jogos:
                </span>
                <span className="text-[11px] text-zinc-400">
                  Baseado na conferência dos jogos e no rateio da CAIXA
                </span>
              </div>
              <div
                id="val-expected-prize"
                className="text-base font-mono font-bold text-emerald-300"
              >
                {formatBRLFromCents(expectedPrize.totalCents)}
              </div>
            </div>
          )}

          {/* Reconciliação Financeira */}
          {reconciliation && (
            <div
              id="panel-financial-reconciliation"
              className="p-4 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-3"
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-1.5">
                <span>Reconciliação Financeira</span>
              </div>

              {reconciliation.status === "PENDING_MANUAL_RECORD" && (
                <div
                  id="status-pending-manual"
                  className="text-xs text-amber-300 flex items-center gap-2 p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/30"
                >
                  <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Referência CAIXA disponível. Fechamento financeiro manual ainda não registrado.
                  </span>
                </div>
              )}

              {(reconciliation.status === "MATCH" ||
                reconciliation.status === "MISMATCH") && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                      <span className="text-zinc-400 block text-[11px]">
                        Referência CAIXA
                      </span>
                      <span
                        id="reconciliation-caixa-reference"
                        className="text-sm font-semibold text-zinc-200"
                      >
                        {formatBRLFromCents(
                          reconciliation.expectedPrizeCents ?? 0
                        )}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                      <span className="text-zinc-400 block text-[11px]">
                        Registrado manualmente
                      </span>
                      <span
                        id="reconciliation-manual-record"
                        className="text-sm font-semibold text-emerald-300"
                      >
                        {formatBRLFromCents(
                          reconciliation.recordedPrizeCents ?? 0
                        )}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                      <span className="text-zinc-400 block text-[11px]">
                        Diferença
                      </span>
                      <span
                        id="reconciliation-difference"
                        className={`text-sm font-semibold ${
                          reconciliation.differenceCents === 0
                            ? "text-zinc-300"
                            : "text-amber-300"
                        }`}
                      >
                        {formatSignedBRLFromCents(
                          reconciliation.differenceCents ?? 0
                        )}
                      </span>
                    </div>
                  </div>

                  {reconciliation.status === "MATCH" && (
                    <div
                      id="status-reconciliation-match"
                      className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Correspondência entre o valor calculado pela referência CAIXA e o registro manual.
                      </span>
                    </div>
                  )}

                  {reconciliation.status === "MISMATCH" && (
                    <div
                      id="status-reconciliation-mismatch"
                      className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/40 text-xs text-amber-200 flex items-center gap-2"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Divergência entre o valor de referência da CAIXA e o valor registrado manualmente.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!reference && !errorMessage && (
        <p className="text-xs text-zinc-400 leading-relaxed">
          Nenhuma consulta à CAIXA é feita automaticamente. Clique em "Consultar Referência CAIXA" para carregar as cotas oficiais de rateio deste concurso.
        </p>
      )}
    </div>
  );
};
