/**
 * Utilitário operacional para cópia formatada dos 5 jogos do C₅ (Prompt 09 - Seção 13).
 */

export function formatGamesForClipboard(games: number[][]): string {
  return games
    .map((game, index) => {
      const formattedNumbers = [...game]
        .sort((a, b) => a - b)
        .map((n) => String(n).padStart(2, "0"))
        .join(" ");
      return `Jogo ${index + 1}: ${formattedNumbers}`;
    })
    .join("\n");
}

export async function copyGamesToClipboard(games: number[][]): Promise<{
  success: boolean;
  message: string;
}> {
  const text = formatGamesForClipboard(games);

  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, message: "5 jogos copiados." };
    } catch {
      // Fallback abaixo
    }
  }

  return {
    success: false,
    message: "Não foi possível copiar automaticamente. Selecione os jogos manualmente.",
  };
}
