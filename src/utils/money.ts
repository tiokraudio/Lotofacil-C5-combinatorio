/**
 * Utilitários de conversão, formatação e validação financeira em Real (BRL).
 * Todos os valores internos da V1.8 são estritamente inteiros em centavos.
 */

/**
 * Converte centavos inteiros para string monetária BRL padrão.
 * Exemplo: 123456 -> "R$ 1.234,56", 0 -> "R$ 0,00"
 */
export function formatBRLFromCents(amountCents: number): string {
  if (!Number.isFinite(amountCents)) {
    return "R$ 0,00";
  }
  const value = amountCents / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
 * Converte centavos inteiros para string monetária com sinal explícito de lucro/prejuízo.
 * Exemplo: 123456 -> "+ R$ 1.234,56", -1750 -> "- R$ 17,50", 0 -> "R$ 0,00"
 */
export function formatSignedBRLFromCents(amountCents: number): string {
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    return "R$ 0,00";
  }
  const isPositive = amountCents > 0;
  const absFormatted = formatBRLFromCents(Math.abs(amountCents));
  return isPositive ? `+ ${absFormatted}` : `- ${absFormatted}`;
}

/**
 * Converte uma entrada de texto em Real (BRL) para centavos inteiros estritamente validados.
 *
 * Exemplos aceitos:
 *  - "0" -> 0
 *  - "0,00" -> 0
 *  - "10" -> 1000
 *  - "10,50" -> 1050
 *  - "10,5" -> 1050
 *  - "17,50" -> 1750
 *  - "1.234,56" -> 123456
 *  - "R$ 1.234,56" -> 123456
 *
 * Rejeições obrigatórias:
 *  - Vazio ou apenas espaços
 *  - Valores negativos ("-1", "-0,01")
 *  - Mais de 2 casas decimais ("10,999")
 *  - Múltiplos separadores decimais ("1,2,3")
 *  - Letras ou caracteres inválidos fora de "R$" ("abc")
 *  - NaN, Infinity
 *  - Valores maiores que Number.MAX_SAFE_INTEGER
 */
export function parseBRLToCents(rawInput: string): number {
  if (typeof rawInput !== "string") {
    throw new Error("Entrada de valor monetário deve ser uma string.");
  }

  let cleaned = rawInput.trim();
  if (!cleaned) {
    throw new Error("Valor monetário não pode ser vazio.");
  }

  // Remove prefixo "R$" ou "r$" se presente
  if (cleaned.toUpperCase().startsWith("R$")) {
    cleaned = cleaned.slice(2).trim();
  }

  if (!cleaned) {
    throw new Error("Valor monetário não pode ser vazio.");
  }

  // Não permite sinal negativo
  if (cleaned.includes("-")) {
    throw new Error("Valor do prêmio não pode ser negativo.");
  }

  // Rejeita strings perigosas como NaN, Infinity
  const lower = cleaned.toLowerCase();
  if (lower.includes("nan") || lower.includes("inf")) {
    throw new Error("Valor monetário inválido (NaN/Infinity).");
  }

  // Remove separadores de milhar (ponto ".")
  // Ex: "1.234,56" -> "1234,56"
  // Mas se tiver ponto como decimal em formato americano, precisamos validar:
  // Se contiver vírgula e ponto, o ponto deve ser separador de milhar e a vírgula o decimal.
  // Se contiver apenas ponto: se tiver mais de 2 dígitos após o ponto, pode ser milhar (ex: 1.000).
  // Se tiver 1 ou 2 dígitos após o ponto (ex: 10.50), o usuário digitou no formato americano.
  let integerPartStr = "";
  let decimalPartStr = "";

  if (cleaned.includes(",")) {
    // Formato brasileiro padrão
    const parts = cleaned.split(",");
    if (parts.length > 2) {
      throw new Error("Formato inválido: múltiplos separadores decimais.");
    }
    // Remove pontos de milhar da parte inteira
    integerPartStr = parts[0].replace(/\./g, "");
    decimalPartStr = parts[1];
  } else if (cleaned.includes(".")) {
    // Pode ser milhar "1.000" ou decimal americano "10.50"
    const parts = cleaned.split(".");
    if (parts.length === 2) {
      if (parts[1].length === 3 && parts[0].length >= 1) {
        // Ex: "1.000" -> milhar
        integerPartStr = parts[0] + parts[1];
        decimalPartStr = "";
      } else {
        // Ex: "10.50" ou "1234.5" -> decimal
        integerPartStr = parts[0];
        decimalPartStr = parts[1];
      }
    } else {
      // Múltiplos pontos -> pontos de milhar, ex: "1.000.000"
      integerPartStr = cleaned.replace(/\./g, "");
      decimalPartStr = "";
    }
  } else {
    // Apenas inteiros
    integerPartStr = cleaned;
    decimalPartStr = "";
  }

  // Valida que a parte inteira e decimal contêm apenas dígitos
  if (integerPartStr.length === 0) {
    integerPartStr = "0";
  }

  if (!/^\d+$/.test(integerPartStr)) {
    throw new Error(`Caracteres não numéricos detectados no valor: "${rawInput}".`);
  }

  if (decimalPartStr.length > 0) {
    if (!/^\d+$/.test(decimalPartStr)) {
      throw new Error(`Caracteres não numéricos detectados nas casas decimais: "${rawInput}".`);
    }
    if (decimalPartStr.length > 2) {
      throw new Error("Valor monetário não pode ter mais de 2 casas decimais.");
    }
  }

  // Normaliza decimal para 2 dígitos
  if (decimalPartStr.length === 1) {
    decimalPartStr = `${decimalPartStr}0`;
  } else if (decimalPartStr.length === 0) {
    decimalPartStr = "00";
  }

  // Combina inteiros e centavos
  // Remove zeros à esquerda da parte inteira para evitar problemas de parsing
  const cleanInt = integerPartStr.replace(/^0+/, "") || "0";
  const centsStr = cleanInt === "0" ? decimalPartStr.replace(/^0+/, "") || "0" : `${cleanInt}${decimalPartStr}`;

  const cents = Number(centsStr);

  if (!Number.isSafeInteger(cents)) {
    throw new Error("Valor monetário excede o limite seguro de inteiros (MAX_SAFE_INTEGER).");
  }

  if (cents < 0) {
    throw new Error("Valor do prêmio não pode ser negativo.");
  }

  return cents;
}
