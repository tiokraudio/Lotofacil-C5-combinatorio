import React, { useState } from "react";
import { Ball } from "./Ball.tsx";
import {
  Globe,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Edit3,
} from "lucide-react";
import {
  OfficialContestResult,
  LotteryFetchError,
  getLotteryProvider,
} from "../lottery/index.ts";
import { ResultInputGrid } from "./ResultInputGrid.tsx";
import { formatLocalDate } from "../storage/service.ts";

interface OfficialResultSectionProps {
  contestNumber: number;
  isLoading?: boolean;
  onSubmitResult: (result: number[]) => Promise<void>;
}

export const OfficialResultSection: React.FC<OfficialResultSectionProps> = ({
  contestNumber,
  isLoading = false,
  onSubmitResult,
}) => {
  const [activeTab, setActiveTab] = useState<"fetch" | "manual">("fetch");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<OfficialContestResult | null>(null);

  const handleFetchOfficial = async () => {
    setIsFetching(true);
    setFetchError(null);
    setPreviewResult(null);

    try {
      const provider = getLotteryProvider();
      const result = await provider.getContest(contestNumber);
      setPreviewResult(result);
    } catch (err: any) {
      if (err instanceof LotteryFetchError) {
        if (err.code === "NOT_FOUND") {
          setFetchError(
            `Resultado do concurso ${contestNumber} ainda não disponível na fonte consultada.`
          );
        } else if (err.code === "TIMEOUT") {
          setFetchError(
            "Tempo limite da consulta excedido (10s). Verifique sua conexão e tente novamente."
          );
        } else if (err.code === "INVALID_PAYLOAD" || err.code === "CONTEST_MISMATCH") {
          setFetchError(
            `A fonte respondeu, mas os dados são inválidos: ${err.message}. Nenhum resultado foi registrado.`
          );
        } else {
          setFetchError(
            `Não foi possível consultar o resultado: ${err.message}`
          );
        }
      } else {
        setFetchError(
          "Não foi possível consultar o resultado oficial (falha de rede ou conectividade)."
        );
      }
    } finally {
      setIsFetching(false);
    }
  };

  const handleConfirmPreview = async () => {
    if (!previewResult) return;
    await onSubmitResult(previewResult.numbers);
    setPreviewResult(null);
  };

  const handleCancelPreview = () => {
    setPreviewResult(null);
    setFetchError(null);
  };

  return (
    <div
      id="official-result-section"
      className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl space-y-5"
    >
      {/* Header com Alternância de Modo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2 font-mono">
            <span>REGISTRAR RESULTADO OFICIAL</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-950/80 border border-blue-500/50 text-blue-300 font-sans">
              Concurso {contestNumber}
            </span>
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Obtenha as 15 dezenas oficiais diretamente do portal da CAIXA ou informe manualmente.
          </p>
        </div>

        {/* Abas de Escolha */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
          <button
            type="button"
            id="tab-mode-fetch"
            onClick={() => {
              setActiveTab("fetch");
              setFetchError(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "fetch"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Consultar CAIXA</span>
          </button>
          <button
            type="button"
            id="tab-mode-manual"
            onClick={() => {
              setActiveTab("manual");
              setPreviewResult(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "manual"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Digitar Manualmente</span>
          </button>
        </div>
      </div>

      {/* MODO 1: Consulta Externa via Provider */}
      {activeTab === "fetch" && (
        <div className="space-y-4">
          {!previewResult && (
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/90 text-center space-y-4">
              <div className="space-y-1">
                <p className="text-sm text-zinc-200 font-medium">
                  Consulta de Resultado do Concurso {contestNumber}
                </p>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  A consulta recupera as 15 dezenas oficiais publicadas pela CAIXA e apresenta uma prévia para conferência antes de gravar.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  id="btn-fetch-official-result"
                  onClick={handleFetchOfficial}
                  disabled={isFetching || isLoading}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm tracking-wide transition-all shadow-md hover:shadow-emerald-950/40 inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isFetching ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Globe className="w-4 h-4" />
                  )}
                  <span>
                    {isFetching ? "CONSULTANDO RESULTADO..." : "BUSCAR RESULTADO OFICIAL"}
                  </span>
                </button>
              </div>

              {/* Mensagem de Erro ou Indisponibilidade */}
              {fetchError && (
                <div
                  id="fetch-result-error-banner"
                  className="mt-4 p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 text-left max-w-lg mx-auto"
                >
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="grow space-y-1">
                    <p className="font-semibold">{fetchError}</p>
                    <p className="text-zinc-400 text-[11px]">
                      Se o concurso acabou de ser realizado, aguarde alguns minutos ou utilize a aba "Digitar Manualmente".
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFetchError(null)}
                    className="text-zinc-400 hover:text-zinc-200 text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PRÉVIA OBRIGATÓRIA ANTES DA CONFIRMAÇÃO */}
          {previewResult && (
            <div
              id="official-result-preview"
              className="p-5 rounded-xl bg-zinc-950 border-2 border-emerald-500/50 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Resultado Oficial Encontrado — Concurso {previewResult.contestNumber}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-400">
                  <span>Fonte: <strong className="text-zinc-200">{previewResult.source}</strong></span>
                  <span>Data: <strong className="text-zinc-200">{previewResult.drawDate}</strong></span>
                </div>
              </div>

              {/* Dezenas Sorteadas */}
              <div>
                <p className="text-xs text-zinc-400 mb-2 font-mono">
                  15 DEZENAS SORTEADAS (ORDEM CRESCENTE):
                </p>
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                  {previewResult.numbers.map((num) => (
                    <Ball key={`preview-ball-${num}`} number={num} variant="official" />
                  ))}
                </div>
              </div>

              {/* Aviso de Confirmação Obrigatória */}
              <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
                <p>
                  <strong>Atenção:</strong> Este resultado ainda <em>não alterou</em> o registro congelado.
                  Para conferir e gravar a pontuação das suas 5 apostas oficiais C₅, clique no botão de confirmação abaixo.
                </p>
              </div>

              {/* Botões de Ação da Prévia */}
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  id="btn-cancel-preview-result"
                  onClick={handleCancelPreview}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>CANCELAR</span>
                </button>
                <button
                  type="button"
                  id="btn-confirm-score-official"
                  onClick={handleConfirmPreview}
                  disabled={isLoading}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold tracking-wide transition-all shadow-md cursor-pointer flex items-center gap-2"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>CONFIRMAR E PONTUAR APOSTAS</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODO 2: Entrada Manual (Preserva a Grade de 01 a 25) */}
      {activeTab === "manual" && (
        <div id="manual-result-container">
          <ResultInputGrid
            contestNumber={contestNumber}
            isLoading={isLoading}
            onSubmitResult={onSubmitResult}
          />
        </div>
      )}
    </div>
  );
};
