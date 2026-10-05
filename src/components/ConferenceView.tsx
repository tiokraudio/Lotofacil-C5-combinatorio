import React, { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Save, ArrowRight, RotateCcw } from "lucide-react";
import { ContestRecord } from "../c5-memory/types";
import {
  getAllContestRecordsUI,
  getMemoryOperationalStateUI,
  scoreContestOperationUI,
} from "../c5-memory/application/uiService";
import { Ball } from "./Ball";

interface ConferenceViewProps {
  initialContestNumber?: number;
  onContestUpdated: () => void;
  onNavigateToDashboard: () => void;
}

export const ConferenceView: React.FC<ConferenceViewProps> = ({
  initialContestNumber,
  onContestUpdated,
  onNavigateToDashboard,
}) => {
  const [contests, setContests] = useState<ContestRecord[]>([]);
  const [selectedContestNumber, setSelectedContestNumber] = useState<number>(
    initialContestNumber || 3505
  );
  const [currentRecord, setCurrentRecord] = useState<ContestRecord | null>(null);
  const [selectedBalls, setSelectedBalls] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadContests();
  }, []);

  useEffect(() => {
    if (initialContestNumber) {
      setSelectedContestNumber(initialContestNumber);
    }
  }, [initialContestNumber]);

  useEffect(() => {
    loadSelectedContest(selectedContestNumber);
  }, [selectedContestNumber]);

  const loadContests = async () => {
    const list = await getAllContestRecordsUI();
    const sorted = list.sort((a, b) => b.contestNumber - a.contestNumber);
    setContests(sorted);
    if (sorted.length > 0 && !initialContestNumber) {
      setSelectedContestNumber(sorted[0].contestNumber);
    }
  };

  const loadSelectedContest = async (cNum: number) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const state = await getMemoryOperationalStateUI(cNum);
      if (state.status !== "AVAILABLE" || state.draft || state.frozenPayload) {
        const rec: ContestRecord = {
          contestNumber: state.contestNumber,
          contestDate: new Date().toISOString().split("T")[0],
          status: state.status,
          algorithmVersion: state.algorithmVersion as any,
          games: state.games,
          draft: state.draft as any,
          frozenPayload: state.frozenPayload as any,
          officialResult: state.officialResult,
          gameHits: state.gameHits,
          bestHits: state.bestHits,
          bestHitsCount: state.bestHitsCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setCurrentRecord(rec);
        if (rec.officialResult && rec.officialResult.length === 15) {
          setSelectedBalls([...rec.officialResult]);
        } else {
          setSelectedBalls([]);
        }
      } else {
        setCurrentRecord(null);
        setSelectedBalls([]);
      }
    } catch {
      setCurrentRecord(null);
      setSelectedBalls([]);
    }
  };

  const toggleBall = (num: number) => {
    if (selectedBalls.includes(num)) {
      setSelectedBalls(selectedBalls.filter(n => n !== num));
    } else {
      if (selectedBalls.length < 15) {
        setSelectedBalls([...selectedBalls, num].sort((a, b) => a - b));
      }
    }
  };

  const handleClear = () => {
    setSelectedBalls([]);
  };

  const handleSaveResult = async () => {
    if (!currentRecord) return;
    if (selectedBalls.length !== 15) {
      setErrorMsg("Selecione exatamente 15 dezenas para o resultado oficial.");
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const updatedRecord = await scoreContestOperationUI(currentRecord.contestNumber, selectedBalls);
      setCurrentRecord(updatedRecord);
      setSuccessMsg("Concurso conferido com sucesso e registrado na memória histórica!");
      onContestUpdated();
      loadContests();
    } catch (err: any) {
      setErrorMsg("Erro ao salvar resultado: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16">
      {/* Topo da Conferência */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-indigo-400 font-semibold">
                Conferência Oficial
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">Apuração e Cálculo de Acertos</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Conferir Resultados C5
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Concurso:</span>
            <select
              value={selectedContestNumber}
              onChange={e => setSelectedContestNumber(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 text-slate-100 font-mono font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              {contests.map(c => (
                <option key={c.contestNumber} value={c.contestNumber}>
                  #{c.contestNumber} ({c.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={onNavigateToDashboard}
            className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 ml-4"
          >
            <span>Ver no Painel</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid de Seleção das 15 Dezenas Oficiais */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-100">
              Selecione as 15 Dezenas Sorteadas (1 a 25)
            </h3>
            <p className="text-xs text-slate-400">
              {selectedBalls.length} de 15 dezenas selecionadas
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
            <button
              id="btn-save-official-result"
              data-testid="btn-save-result"
              onClick={handleSaveResult}
              disabled={selectedBalls.length !== 15 || isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? "Gravando..." : "Salvar Apuração"}</span>
            </button>
          </div>
        </div>

        {/* 25 Bolas Clicáveis */}
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 sm:gap-3 py-2 justify-items-center">
          {Array.from({ length: 25 }, (_, i) => i + 1).map(n => {
            const isSelected = selectedBalls.includes(n);
            return (
              <Ball
                key={n}
                number={n}
                isSelected={isSelected}
                size="md"
                onClick={() => toggleBall(n)}
              />
            );
          })}
        </div>
      </div>

      {/* Jogos do Concurso e Acertos em Tempo Real */}
      {currentRecord && currentRecord.games && currentRecord.games.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-slate-200">
            Conferência dos 5 Jogos do Concurso {currentRecord.contestNumber}
          </h3>

          <div className="space-y-3">
            {currentRecord.games.map((game, idx) => {
              const liveHits = game.filter(n => selectedBalls.includes(n)).length;
              const isHigh = liveHits >= 11;
              return (
                <div
                  key={idx}
                  className={`border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md ${
                    isHigh
                      ? "bg-slate-900/90 border-emerald-500/40"
                      : "bg-slate-900 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-slate-800 text-slate-200 font-mono font-bold text-xs flex items-center justify-center">
                      J{idx + 1}
                    </span>
                    <span
                      className={`text-xs font-bold font-mono px-2.5 py-1 rounded-md ${
                        liveHits >= 11
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {liveHits} acertos
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {game.map(num => {
                      const isHit = selectedBalls.includes(num);
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
