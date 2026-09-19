import React, { useState, useRef, useEffect, useReducer } from "react";
import { Ball } from "./Ball.tsx";
import {
  Globe,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Edit3,
  RefreshCw,
  AlertTriangle,
  ArrowRightLeft,
} from "lucide-react";
import {
  LotteryFetchError,
  getLotteryProvider,
} from "../lottery/index.ts";
import {
  validateOfficialResult,
  createOfficialResultPreview,
} from "../sync/operationalState.ts";
import {
  officialResultPreviewReducer,
  INITIAL_OFFICIAL_PREVIEW_STATE,
  evaluateIncomingPreviewAction,
  canScoreOfficialPreview,
} from "../sync/officialResultPreviewState.ts";
import { ResultInputGrid } from "./ResultInputGrid.tsx";

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

  // Máquina de estados pura para prévias e divergências
  const [previewState, dispatch] = useReducer(
    officialResultPreviewReducer,
    INITIAL_OFFICIAL_PREVIEW_STATE
  );

  const { acceptedPreview, pendingPreview, error: fetchError } = previewState;

  // Serialização de requisições externas e proteção contra race condition
  const fetchRunIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Limpa estado se o contestNumber mudar
  useEffect(() => {
    dispatch({ type: "CLEAR" });
  }, [contestNumber]);

  /**
   * Consulta a fonte oficial CAIXA disparada exclusivamente por ação do usuário.
   * Regras estritas:
   * - Exatamente 1 chamada por clique.
   * - Descarte de respostas obsoletas via runId.
   * - Preservação do preview anterior se a nova consulta falhar.
   * - Detecção de concurso divergente.
   * - Detecção de resultado divergente com preservação de acceptedPreview e pendingPreview.
   * - Validação das 15 dezenas.
   */
  const handleFetchOfficial = async () => {
    const currentRunId = ++fetchRunIdRef.current;
    setIsFetching(true);

    try {
      const provider = getLotteryProvider();
      // Exatamente 1 chamada ao provider
      const response = await provider.getContest(contestNumber);

      // Verificação de desmonte e corrida assíncrona (External Race)
      if (!isMountedRef.current || currentRunId !== fetchRunIdRef.current) {
        return;
      }

      // Regra: Concurso Exato (Contest Mismatch)
      if (response.contestNumber !== contestNumber) {
        dispatch({
          type: "FETCH_FAILURE",
          error: `O resultado consultado pertence ao concurso ${response.contestNumber}, não ao concurso ${contestNumber}.`,
        });
        return;
      }

      // Validação rigorosa das 15 dezenas
      const validatedNumbers = validateOfficialResult(response.numbers);

      // Criação de snapshot imutável do preview recebido
      const incomingPreview = createOfficialResultPreview({
        contestNumber: response.contestNumber,
        numbers: validatedNumbers,
        drawDate: response.drawDate,
        fetchedAt: response.fetchedAt,
        source: response.source,
      });

      // Avaliação contra o estado atual para transição canônica
      const nextAction = evaluateIncomingPreviewAction(previewState, incomingPreview);
      dispatch(nextAction);
    } catch (err: any) {
      if (!isMountedRef.current || currentRunId !== fetchRunIdRef.current) {
        return;
      }

      // Preserva preview válido anterior e informa falha da atualização
      let errorMessage = "Não foi possível consultar a fonte oficial agora. Falha de rede ou conectividade.";
      if (err instanceof LotteryFetchError) {
        if (err.code === "NOT_FOUND") {
          errorMessage = `Resultado do concurso ${contestNumber} ainda não disponível na fonte oficial CAIXA.`;
        } else if (err.code === "TIMEOUT") {
          errorMessage = "Tempo limite da consulta excedido (10s). Verifique sua conexão e tente novamente.";
        } else if (
          err.code === "INVALID_PAYLOAD" ||
          err.code === "CONTEST_MISMATCH"
        ) {
          errorMessage = `A fonte respondeu, mas os dados são inválidos: ${err.message}. Nenhum resultado foi registrado.`;
        } else {
          errorMessage = `Não foi possível consultar o resultado: ${err.message}`;
        }
      }

      dispatch({ type: "FETCH_FAILURE", error: errorMessage });
    } finally {
      if (isMountedRef.current && currentRunId === fetchRunIdRef.current) {
        setIsFetching(false);
      }
    }
  };

  /**
   * Confirmação explícita do usuário para pontuar o concurso.
   * Utiliza exclusivamente acceptedPreview (Item 9).
   */
  const handleConfirmScore = async () => {
    if (!canScoreOfficialPreview(previewState) || !acceptedPreview) return;

    // Pontua com o snapshot exato de acceptedPreview
    await onSubmitResult([...acceptedPreview.numbers]);
  };

  const handleCancelPreview = () => {
    dispatch({ type: "CLEAR" });
  };

  const handleKeepPrevious = () => {
    dispatch({ type: "KEEP_PREVIOUS" });
  };

  const handleAcceptNew = () => {
    dispatch({ type: "ACCEPT_NEW" });
  };

  const isDivergent = pendingPreview !== null;
  const canScore = canScoreOfficialPreview(previewState);

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
            Obtenha as 15 dezenas oficiais publicadas pela CAIXA ou digite manualmente para conferência.
          </p>
        </div>

        {/* Abas de Escolha */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
          <button
            type="button"
            id="tab-mode-fetch"
            onClick={() => {
              setActiveTab("fetch");
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
              dispatch({ type: "CLEAR" });
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
          {!acceptedPreview && (
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/90 text-center space-y-4">
              <div className="space-y-1">
                <p className="text-sm text-zinc-200 font-medium">
                  Consulta de Resultado do Concurso {contestNumber}
                </p>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  A consulta recupera as 15 dezenas oficiais publicadas pela CAIXA e apresenta uma prévia para conferência antes de qualquer alteração.
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
                    {isFetching ? "CONSULTANDO RESULTADO..." : "CONSULTAR RESULTADO"}
                  </span>
                </button>
              </div>

              {/* Mensagem de Erro ou Indisponibilidade */}
              {fetchError && (
                <div
                  id="fetch-result-error-banner"
                  role="alert"
                  aria-live="polite"
                  className="mt-4 p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 text-left max-w-lg mx-auto"
                >
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="grow space-y-1">
                    <p className="font-semibold">{fetchError}</p>
                    <p className="text-zinc-400 text-[11px]">
                      Se o sorteio foi recente, aguarde alguns instantes ou use a aba "Digitar Manualmente".
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PRÉVIA OBRIGATÓRIA */}
          {acceptedPreview && (
            <div
              id="official-result-preview"
              className={`p-5 rounded-xl bg-zinc-950 border-2 ${
                isDivergent ? "border-amber-500/70" : "border-emerald-500/50"
              } space-y-5`}
            >
              {/* Header do Resultado Aceito/Atual */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>
                    {isDivergent
                      ? `RESULTADO ANTERIOR (ACEITO) — Concurso ${acceptedPreview.contestNumber}`
                      : `RESULTADO OFICIAL DISPONÍVEL — Concurso ${acceptedPreview.contestNumber}`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                  <span>Fonte: <strong className="text-zinc-200">{acceptedPreview.source}</strong></span>
                  {acceptedPreview.drawDate && (
                    <span>Data: <strong className="text-zinc-200">{acceptedPreview.drawDate}</strong></span>
                  )}
                  <span>Consulta: <strong className="text-zinc-200 font-mono text-[11px]">{new Date(acceptedPreview.fetchedAt).toLocaleTimeString("pt-BR")}</strong></span>
                </div>
              </div>

              {/* Dezenas Sorteadas de acceptedPreview */}
              <div id="accepted-preview-numbers-container">
                <p className="text-xs text-zinc-400 mb-2 font-mono font-medium">
                  {isDivergent ? "RESULTADO ANTERIOR (15 DEZENAS):" : "15 DEZENAS OFICIAIS (ORDEM CRESCENTE):"}
                </p>
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                  {acceptedPreview.numbers.map((num) => (
                    <Ball key={`accepted-ball-${num}`} number={num} variant="official" />
                  ))}
                </div>
              </div>

              {/* ALERTA DE DIVERGÊNCIA E EXIBIÇÃO DE NOVO RESULTADO */}
              {isDivergent && pendingPreview && (
                <div
                  id="divergence-warning-banner"
                  role="alert"
                  className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/60 text-amber-200 text-xs space-y-4"
                >
                  <div className="flex items-center gap-2 font-bold text-amber-300 text-sm">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    <span>DIVERGÊNCIA DETECTADA ENTRE CONSULTAS</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed">
                    A fonte oficial retornou um conjunto de dezenas diferente da consulta anterior para o concurso {acceptedPreview.contestNumber}.
                    A pontuação foi <strong>bloqueada preventivamente</strong>. Escolha explicitamente qual resultado você deseja adotar.
                  </p>

                  {/* NOVO RESULTADO RETORNADO */}
                  <div id="pending-preview-numbers-container" className="p-3.5 rounded-lg bg-zinc-900/90 border border-amber-500/40 space-y-2">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span className="font-mono font-semibold text-amber-300">
                        NOVO RESULTADO RETORNADO:
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Consulta: {new Date(pendingPreview.fetchedAt).toLocaleTimeString("pt-BR")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                      {pendingPreview.numbers.map((num) => (
                        <Ball key={`pending-ball-${num}`} number={num} variant="official" />
                      ))}
                    </div>
                  </div>

                  {/* Ações Explícitas de Resolução de Divergência */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      id="btn-keep-previous-preview"
                      onClick={handleKeepPrevious}
                      className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-xs transition-colors cursor-pointer border border-zinc-700 inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>MANTER RESULTADO ANTERIOR</span>
                    </button>
                    <button
                      type="button"
                      id="btn-accept-new-preview"
                      onClick={handleAcceptNew}
                      className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      <span>ACEITAR NOVO RESULTADO</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Aviso de Confirmação Obrigatória */}
              <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
                <p>
                  <strong>Atenção:</strong> A visualização desta prévia <em>não altera</em> o registro congelado nem recalcula pontuações no banco de dados.
                  Para conferir e gravar a pontuação das suas 5 apostas oficiais C₅, clique no botão de ação abaixo.
                </p>
              </div>

              {/* Erro de atualização caso tenha falhado mantendo o preview anterior */}
              {fetchError && (
                <div
                  id="fetch-update-error-banner"
                  role="alert"
                  className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2"
                >
                  <span>{fetchError} (Prévia válida anterior mantida para pontuação).</span>
                </div>
              )}

              {/* Botões de Ação da Prévia */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    id="btn-cancel-preview-result"
                    onClick={handleCancelPreview}
                    disabled={isLoading || isFetching}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>CANCELAR</span>
                  </button>
                  <button
                    type="button"
                    id="btn-refetch-result"
                    onClick={handleFetchOfficial}
                    disabled={isLoading || isFetching}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                    title="Realizar nova consulta na CAIXA"
                  >
                    {isFetching ? (
                      <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span>ATUALIZAR RESULTADO</span>
                  </button>
                </div>

                <button
                  type="button"
                  id="btn-confirm-score-official"
                  onClick={handleConfirmScore}
                  disabled={isLoading || isFetching || !canScore}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold tracking-wide transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 focus:ring-2 focus:ring-emerald-400"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>PONTUAR CONCURSO</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODO 2: Entrada Manual */}
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
