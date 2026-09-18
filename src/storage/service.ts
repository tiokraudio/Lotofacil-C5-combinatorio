/**
 * Serviço de acesso à persistência local do Gerador Oficial C₅.
 * Fornece a instância padrão do repositório e formatadores para a UI.
 */
import { ContestRepository } from "./contestRepository.ts";

export const repository = new ContestRepository();

/**
 * Formata data ISO 8601 UTC para a hora local do navegador.
 * Exemplo: "17/09/2026, 19:35:42"
 */
export function formatLocalDate(isoString?: string): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);
  } catch {
    return isoString;
  }
}

/**
 * Dispara o download de um objeto serializável em formato JSON UTF-8 no navegador.
 */
export function downloadJsonFile(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Formata número com 2 dígitos (ex: 7 -> "07", 14 -> "14").
 */
export function pad2(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}
