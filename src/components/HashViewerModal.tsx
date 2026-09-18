import React, { useState } from "react";
import { Check, Copy, ShieldCheck, X } from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import { formatLocalDate } from "../storage/service.ts";

interface HashViewerModalProps {
  isOpen: boolean;
  record: ContestRecord | null;
  onClose: () => void;
}

export const HashViewerModal: React.FC<HashViewerModalProps> = ({
  isOpen,
  record,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const modalRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;

    // Foco inicial no modal
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]');
    closeBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !record) return null;

  const handleCopy = async () => {
    if (!record.integrityHash) return;
    try {
      await navigator.clipboard.writeText(record.integrityHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback simples caso clipboard api falhe
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hash-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6"
      >
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="hash-modal-title" className="text-base font-semibold text-zinc-100">
                Auditoria de Integridade Criptográfica
              </h2>
              <p className="text-xs text-zinc-400">
                Concurso {record.contestNumber} • {record.algorithmVersion}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded-md"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          <div>
            <span className="text-zinc-400 block mb-1">Hash de Integridade Oficial (SHA-256):</span>
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-emerald-400 break-all select-all flex items-center justify-between gap-2">
              <span className="tracking-wider">{record.integrityHash || "Não congelado"}</span>
              {record.integrityHash && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md transition-colors"
                  title="Copiar Hash"
                  aria-label="Copiar Hash SHA-256"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
            <div>
              <span className="text-zinc-400 block font-medium">Generation ID:</span>
              <span className="font-mono text-zinc-200 break-all">{record.generationId}</span>
            </div>
            <div>
              <span className="text-zinc-400 block font-medium">Status do Registro:</span>
              <span className="font-semibold text-zinc-200">{record.status}</span>
            </div>
            <div>
              <span className="text-zinc-400 block font-medium">Gerado em:</span>
              <span className="text-zinc-200">{formatLocalDate(record.generatedAt)}</span>
            </div>
            <div>
              <span className="text-zinc-400 block font-medium">Congelado em:</span>
              <span className="text-zinc-200">{formatLocalDate(record.frozenAt)}</span>
            </div>
            {record.scoredAt && (
              <div>
                <span className="text-zinc-400 block font-medium">Pontuado em:</span>
                <span className="text-zinc-200">{formatLocalDate(record.scoredAt)}</span>
              </div>
            )}
            <div>
              <span className="text-zinc-400 block font-medium">Versão Algorítmica:</span>
              <span className="text-zinc-200">{record.algorithmVersion}</span>
            </div>
          </div>

          <p className="text-zinc-400 italic">
            O hash SHA-256 certifica a imutabilidade estrita das 5 apostas, sementes e metadados no momento do congelamento.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg border border-zinc-700"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
