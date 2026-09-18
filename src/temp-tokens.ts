import { readJson, writeJson } from "./env.ts";

export interface TempToken {
  token: string;
  removeAt: number;
}

const PATH = `${Deno.cwd()}/temp-tokens.json`;

export class TemporaryTokens {
  #entries: TempToken[];

  private constructor(entries: TempToken[]) {
    this.#entries = entries;
  }

  static async load(): Promise<TemporaryTokens> {
    return new TemporaryTokens(await readJson<TempToken[]>(PATH, []));
  }

  #save(): Promise<void> {
    return writeJson(PATH, this.#entries);
  }

  async prune(): Promise<void> {
    const now = Date.now();
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((e) => e.removeAt > now);
    if (this.#entries.length !== before) await this.#save();
  }

  async add(token: string, removeAt: number): Promise<void> {
    this.#entries = this.#entries.filter((e) => e.token !== token);
    this.#entries.push({ token, removeAt });
    await this.#save();
  }

  tokens(): string[] {
    return this.#entries.map((e) => e.token);
  }
}
