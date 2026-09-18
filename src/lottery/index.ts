import { LotteryResultProvider } from "./types.ts";
import { CaixaLotteryProvider } from "./caixaProvider.ts";

export * from "./types.ts";
export * from "./validator.ts";
export * from "./caixaProvider.ts";
export * from "./fakeProvider.ts";

// Singleton do provider padrão da aplicação
let activeProvider: LotteryResultProvider = new CaixaLotteryProvider();

/**
 * Obtém o provider ativo configurado no sistema.
 */
export function getLotteryProvider(): LotteryResultProvider {
  return activeProvider;
}

/**
 * Permite injetar um provider alternativo (ex: em testes ou fallback customizado).
 */
export function setLotteryProvider(provider: LotteryResultProvider): void {
  activeProvider = provider;
}
