/**
 * PRNG Determinístico Certificado para C5-Memory
 */

export class DeterministicPRNG {
  private state: number;

  constructor(seedString: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seedString.length; i++) {
      h ^= seedString.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    this.state = h >>> 0;
  }

  // Gera inteiro de 32 bits sem sinal
  public nextUint32(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // Gera float em [0, 1)
  public nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  // Embaralha um array in-place deterministicamente (Fisher-Yates)
  public shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  // Gera um jogo único de 15 dezenas (1..25) ordenado crescentemente
  public generateGame(): number[] {
    const allBalls = Array.from({ length: 25 }, (_, i) => i + 1);
    this.shuffle(allBalls);
    const chosen = allBalls.slice(0, 15);
    return chosen.sort((a, b) => a - b);
  }

  // Gera um conjunto de 5 jogos únicos e válidos
  public generateCandidate5(): number[][] {
    const games: number[][] = [];
    const signatures = new Set<string>();

    while (games.length < 5) {
      const g = this.generateGame();
      const sig = g.join(",");
      if (!signatures.has(sig)) {
        signatures.add(sig);
        games.push(g);
      }
    }
    return games;
  }
}
