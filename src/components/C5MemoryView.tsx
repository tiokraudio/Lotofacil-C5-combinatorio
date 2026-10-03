import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Lock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { ContestRecord, Draft, FrozenMemoryPayload, MemoryHistory } from "../c5-memory/types";
import { generateC5Draft, freezeDraft } from "../c5-memory/draft";
import { getStoredMemoryHistory, saveContestRecord, getContestRecord } from "../storage/db";
import { Ball } from "./Ball";

interface C5MemoryViewProps {
  currentContestNumber: number;
  onContestUpdated: () => void;
  onNavigateToConference: (contestNumber: number) => void;
}

export const C5MemoryView: React.FC<C5MemoryViewProps> = ({
  currentContestNumber,
  onContestUpdated,
  onNavigateToConference,
}) => {
  const [contestNumber, setContestNumber] = useState<number>(currentContestNumber);
  const [record, setRecord] = useState<ContestRecord | null>(null);
  const [history, setHistory] = useState<MemoryHistory | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setContestNumber(currentContestNumber);
  }, [currentContestNumber]);

  useEffect(() => {
    loadContestData(contestNumber);
  }, [contestNumber]);

  const loadContestData = async (cNum: number) => {
    setErrorMsg(null);
    try {
      const hist = await getStoredMemoryHistory();
      setHistory(hist);

      const existingRecord = await getContestRecord(cNum);
      if (existingRecord) {
        setRecord(existingRecord);
        setDraft(existingRecord.draft || null);
      } else {
        setRecord(null);
        setDraft(null);
      }
    } catch (err: any) {
      setErrorMsg("Erro ao carregar dados do concurso: " + err.message);
    }
  };

  const handleGenerate = async () => {
    if (!history) return;
    setIsGenerating(true);
    setErrorMsg(null);

    try {
      // Pequeno timeout para permitir render do estado de loading
      setTimeout(() => {
        try {
          const newDraft = generateC5Draft(contestNumber, history);
          setDraft(newDraft);

          const newRecord: ContestRecord = {
            contestNumber,
            contestDate: new Date().toISOString().split("T")[0],
            status: "PREVIEW",
            algorithmVersion: "C5-Memory-2.0.0",
            games: newDraft.games,
            draft: newDraft,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          saveContestRecord(newRecord).then(() => {
            setRecord(newRecord);
            setIsGenerating(false);
            onContestUpdated();
          });
        } catch (err: any) {
          setErrorMsg("Erro na geração combinatória: " + err.message);
          setIsGenerating(false);
        }
      }, 50);
    } catch (err: any) {
      setErrorMsg("Falha ao iniciar geração: " + err.message);
      setIsGenerating(false);
    }
  };

  const handleConfirmAndFreeze = async () => {
    if (!draft) return;
    try {
      const frozenPayload: FrozenMemoryPayload = freezeDraft(draft);
      const updatedRecord: ContestRecord = {
        contestNumber: draft.contestNumber,
        contestDate: record?.contestDate || new Date().toISOString().split("T")[0],
        status: "FROZEN",
        algorithmVersion: "C5-Memory-2.0.0",
        games: draft.games,
        draft,
        frozenPayload,
        createdAt: record?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveContestRecord(updatedRecord);
      setRecord(updatedRecord);
      onContestUpdated();
    } catch (err: any) {
      setErrorMsg("Erro ao congelar aposta: " + err.message);
    }
  };

  const handleDiscardPreview = async () => {
    setDraft(null);
    setRecord(null);
    onContestUpdated();
  };

  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleAdvanceToNextContest = () => {
    setContestNumber(prev => prev + 1);
  };

  const currentStatus = record?.status || (draft ? "PREVIEW" : "AVAILABLE");

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16">
      {/* Topo do Gerador */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Ciclo Diário Oficial
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">AVAILABLE → PREVIEW → FROZEN → COMPLETED</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Gerador C5-Memory-2.0.0
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Concurso:</span>
            <input
              type="number"
              value={contestNumber}
              onChange={e => setContestNumber(Math.max(1, Number(e.target.value)))}
              disabled={isGenerating || currentStatus === "PREVIEW"}
              className="bg-slate-950 border border-slate-700 text-slate-100 font-mono font-bold text-base rounded-lg px-3 py-1.5 w-28 text-center focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
        </div>

        {/* Stepper do Ciclo */}
        <div className="mt-6 pt-5 border-t border-slate-800 grid grid-cols-4 gap-2 text-center text-xs">
          {[
            { id: "AVAILABLE", label: "1. Disponível" },
            { id: "PREVIEW", label: "2. Prévia C5" },
            { id: "FROZEN", label: "3. Congelado" },
            { id: "COMPLETED", label: "4. Apurado" },
          ].map((st, idx) => {
            const isCurrent = currentStatus === st.id;
            const isDone =
              (st.id === "AVAILABLE" && currentStatus !== "AVAILABLE") ||
              (st.id === "PREVIEW" && (currentStatus === "FROZEN" || currentStatus === "COMPLETED")) ||
              (st.id === "FROZEN" && currentStatus === "COMPLETED");

            return (
              <div
                key={st.id}
                className={`py-2 px-1 rounded-lg border font-medium ${
                  isCurrent
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-bold"
                    : isDone
                    ? "bg-slate-800/40 border-slate-700/60 text-slate-400"
                    : "bg-slate-950/40 border-slate-900 text-slate-600"
                }`}
              >
                {st.label}
              </div>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Estado AVAILABLE: Botão de Geração */}
      {currentStatus === "AVAILABLE" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <Sparkles className="w-8 h-8" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-xl font-bold text-slate-100">
              Pronto para Gerar o Concurso {contestNumber}
            </h3>
            <p className="text-xs text-slate-400">
              Serão avaliados K=500 candidatos pelo critério MAX-LEXIMIN em relação aos {history?.games.length || 0} jogos registrados na memória histórica canônica (Revisão {history?.revision || 0}).
            </p>
          </div>

          <div>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-base transition-all shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Avaliando K=500 candidatos...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>Gerar C5 (Memory-2.0.0)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Estado PREVIEW: Visualização e Confirmação */}
      {currentStatus === "PREVIEW" && draft && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <span className="text-xs font-mono uppercase text-amber-400 font-bold tracking-wider">
                  Prévia Gerada — Aguardando Confirmação
                </span>
                <h3 className="text-xl font-bold text-slate-100 mt-0.5">
                  Concurso {draft.contestNumber}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDiscardPreview}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs cursor-pointer transition-colors"
                >
                  Descartar
                </button>
                <button
                  onClick={handleConfirmAndFreeze}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer transition-all"
                >
                  <Lock className="w-4 h-4" />
                  <span>Confirmar e Congelar Aposta (SHA-256)</span>
                </button>
              </div>
            </div>

            {/* Metadados do Draft */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 block">Índice no Pool:</span>
                <span className="font-mono text-slate-200 font-bold">#{draft.poolIndex} de K=500</span>
              </div>
              <div>
                <span className="text-slate-500 block">Perfil Leximin:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  [{draft.leximinProfile.join(", ")}]
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Revisão H:</span>
                <span className="font-mono text-slate-200">Rev {draft.historyRevision}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Fingerprint H:</span>
                <span className="font-mono text-slate-400 text-[11px]">
                  {draft.historyFingerprint.substring(0, 10)}...
                </span>
              </div>
            </div>
          </div>

          {/* Os 5 Jogos Gerados */}
          <div className="space-y-3">
            {draft.games.map((game, idx) => (
              <div
                key={idx}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center">
                    J{idx + 1}
                  </span>
                  <span className="text-xs font-medium text-slate-400">Jogo Oficial C5</span>
                </div>

                <div className="flex flex-wrap gap-1.5 justify-end">
                  {game.map(num => (
                    <Ball key={num} number={num} size="sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estado FROZEN: Aposta Congelada com Hash SHA-256 */}
      {currentStatus === "FROZEN" && record?.frozenPayload && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs uppercase font-mono text-emerald-400 font-bold">
                    Aposta Congelada Criptograficamente
                  </span>
                  <h3 className="text-xl font-bold text-slate-100">
                    Concurso {record.contestNumber}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => onNavigateToConference(record.contestNumber)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 cursor-pointer transition-all"
              >
                <span>Conferir Resultado Oficial</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Hash SHA-256 com Botão de Cópia */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Hash de Congelamento SHA-256 (Imutável):
                </span>
                <span className="text-[11px] text-slate-500">
                  {new Date(record.frozenPayload.frozenAt).toLocaleString("pt-BR")}
                </span>
              </div>

              <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
                <span className="font-mono text-xs text-emerald-400 select-all break-all flex-1">
                  {record.frozenPayload.sha256}
                </span>
                <button
                  onClick={() => handleCopySha(record.frozenPayload!.sha256)}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Copiar hash"
                >
                  {copiedHash ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Jogos Congelados */}
          <div className="space-y-3">
            {record.games.map((game, idx) => (
              <div
                key={idx}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center">
                    J{idx + 1}
                  </span>
                  <span className="text-xs font-medium text-slate-400">Aposta Registrada</span>
                </div>

                <div className="flex flex-wrap gap-1.5 justify-end">
                  {game.map(num => (
                    <Ball key={num} number={num} size="sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estado COMPLETED: Apurado com Opção de Avançar para N+1 */}
      {currentStatus === "COMPLETED" && record && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs uppercase font-mono text-purple-400 font-bold">
                Concurso Apurado e Concluído
              </span>
              <h3 className="text-xl font-bold text-slate-100">
                Concurso {record.contestNumber}
              </h3>
            </div>

            <button
              id="btn-next-cycle-from-completed"
              onClick={handleAdvanceToNextContest}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 cursor-pointer transition-all"
            >
              <span>Avançar para Concurso {record.contestNumber + 1}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Resultado e Acertos */}
          {record.officialResult && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <span className="text-xs text-slate-400 block">Resultado Oficial Sorteado:</span>
              <div className="flex flex-wrap gap-1.5">
                {record.officialResult.map(n => (
                  <Ball key={n} number={n} isOfficial size="sm" />
                ))}
              </div>
            </div>
          )}

          {/* Jogos com Acertos Destacados */}
          <div className="space-y-3">
            {record.games.map((game, idx) => {
              const hits = record.gameHits ? record.gameHits[idx] : 0;
              const isBest = hits === record.bestHits;
              return (
                <div
                  key={idx}
                  className={`border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md ${
                    isBest
                      ? "bg-slate-900/90 border-emerald-500/40"
                      : "bg-slate-900 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-slate-800 text-slate-200 font-mono font-bold text-xs flex items-center justify-center">
                      J{idx + 1}
                    </span>
                    <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                      isBest ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"
                    }`}>
                      {hits} acertos
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {game.map(num => {
                      const isHit = record.officialResult?.includes(num);
                      return <Ball key={num} number={num} isHit={isHit} size="sm" />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
