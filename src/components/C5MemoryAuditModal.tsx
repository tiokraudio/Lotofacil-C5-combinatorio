import React, { useEffect, useRef } from "react";
import { ShieldCheck, X, Copy, Check } from "lucide-react";
import type { C5MemoryDraft } from "../c5-memory/draft.ts";
import type { ContestRecord } from "../c5/types.ts";
import { getMemoryAuditDetails } from "../c5-memory/application/memoryBetOrchestrator.ts";

interface C5MemoryAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestNumber: number;
  draft?: C5MemoryDraft | null;
  record?: ContestRecord | null;
}

export const C5MemoryAuditModal: React.FC<C5MemoryAuditModalProps> = ({
  isOpen,
  onClose,
  contestNumber,
  draft,
  record,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const recordAudit = record ? getMemoryAuditDetails(record) : null;

  const algorithmVersion = recordAudit?.algorithmVersion ?? draft?.algorithmVersion ?? "C5-Memory-2.0.0";
  const poolMasterSeed = recordAudit?.poolMasterSeed ?? draft?.poolMasterSeed ?? "-";
  const poolIndex = recordAudit?.poolIndex ?? draft?.poolIndex ?? "-";
  const historyRevision = recordAudit?.historyRevision ?? draft?.expectedHistoryRevision ?? 0;
  const historyFingerprint = recordAudit?.historyFingerprint ?? draft?.expectedHistoryFingerprint ?? "-";
  const confirmedRevision = recordAudit?.confirmedRevision ?? (record ? "Sim (gravado)" : "Pendente (Preview)");
  const createdAt = record?.generatedAt ?? draft?.createdAt ?? "-";
  const confirmedAt = recordAudit?.confirmedAt ?? record?.frozenAt ?? (record ? "-" : "Pendente (Preview)");
  const winnerHistogram = recordAudit?.winnerHistogram ?? draft?.winnerHistogram ?? [];

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 id="audit-modal-title" className="text-base font-bold text-zinc-100 font-mono">
                Auditoria C5-Memory • Concurso {contestNumber}
              </h3>
              <p className="text-xs text-zinc-400">
                Parâmetros determinísticos e integridade criptográfica (Somente Leitura)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            id="close-audit-modal-btn"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Fechar modal de auditoria"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto font-sans text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Versão */}
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              <span className="text-zinc-400 block mb-1">Versão do Algoritmo</span>
              <span className="font-mono font-semibold text-emerald-400 text-sm">{algorithmVersion}</span>
            </div>

            {/* Semente do Pool */}
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              <span className="text-zinc-400 block mb-1">Pool Master Seed</span>
              <span className="font-mono font-semibold text-zinc-100 text-sm">{String(poolMasterSeed)}</span>
            </div>

            {/* Índice no Pool */}
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              <span className="text-zinc-400 block mb-1">Vencedor no Pool (Index)</span>
              <span className="font-mono font-semibold text-zinc-100 text-sm">
                {String(poolIndex)} <span className="text-zinc-500 font-normal">de 500</span>
              </span>
            </div>

            {/* Revisão Histórica */}
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              <span className="text-zinc-400 block mb-1">Revisão Histórica (H)</span>
              <span className="font-mono font-semibold text-zinc-100 text-sm">
                Rev {historyRevision}{" "}
                {recordAudit?.confirmedRevision && (
                  <span className="text-emerald-400 font-normal">→ Commit #{recordAudit.confirmedRevision}</span>
                )}
              </span>
            </div>

            {/* Data de Geração */}
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              <span className="text-zinc-400 block mb-1">Data/Hora da Geração (createdAt)</span>
              <span className="font-mono text-zinc-200 text-xs break-all">{createdAt}</span>
            </div>

            {/* Data de Confirmação */}
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              <span className="text-zinc-400 block mb-1">Data/Hora da Confirmação (confirmedAt)</span>
              <span className="font-mono text-zinc-200 text-xs break-all">{confirmedAt}</span>
            </div>
          </div>

          {/* Fingerprint Histórico */}
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 font-medium">History Fingerprint (SHA-256 do multiconjunto H)</span>
              <button
                type="button"
                onClick={() => handleCopy("fp", String(historyFingerprint))}
                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-mono cursor-pointer"
              >
                {copiedKey === "fp" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === "fp" ? "Copiado" : "Copiar Hash"}</span>
              </button>
            </div>
            <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 break-all select-all">
              {historyFingerprint}
            </div>
          </div>

          {/* Hash de Integridade se confirmado */}
          {record?.integrityHash && (
            <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-medium">Hash de Integridade do Registro (FROZEN SHA-256)</span>
                <button
                  type="button"
                  onClick={() => handleCopy("integrity", record.integrityHash!)}
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-mono cursor-pointer"
                >
                  {copiedKey === "integrity" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === "integrity" ? "Copiado" : "Copiar"}</span>
                </button>
              </div>
              <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 break-all select-all">
                {record.integrityHash}
              </div>
            </div>
          )}

          {/* Histograma do Vencedor (MAX-LEXIMIN) */}
          {winnerHistogram.length > 0 && (
            <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-2">
              <span className="text-zinc-400 block font-medium">
                Vetor Histograma de Acertos contra H (Faixas 0 a 15)
              </span>
              <div className="grid grid-cols-8 sm:grid-cols-16 gap-1 text-center font-mono">
                {winnerHistogram.map((count, idx) => (
                  <div
                    key={`hist-${idx}`}
                    className={`p-1 rounded-md border text-[10px] ${
                      count > 0
                        ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300 font-bold"
                        : "bg-zinc-900 border-zinc-800 text-zinc-500"
                    }`}
                  >
                    <div className="text-[9px] text-zinc-400">{idx}</div>
                    <div>{count}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400">
                Cada coluna indica a quantidade total de ocorrências de k acertos (0..15) entre os 5 jogos e os jogos de H.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-950/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
