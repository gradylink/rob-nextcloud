import { readJson, writeJson } from "./env.ts";

export interface TrackedPoll {
  token: string;
  pollId: number;
  question: string;
  createdBy: string;
  createdAt: number;
}

const PATH = `${Deno.cwd()}/polls.json`;

export class TrackedPolls {
  #entries: TrackedPoll[];

  private constructor(entries: TrackedPoll[]) {
    this.#entries = entries;
  }

  static async load(): Promise<TrackedPolls> {
    return new TrackedPolls(await readJson<TrackedPoll[]>(PATH, []));
  }

  #save(): Promise<void> {
    return writeJson(PATH, this.#entries);
  }

  async add(poll: TrackedPoll): Promise<void> {
    this.#entries.push(poll);
    await this.#save();
  }

  async remove(token: string, pollId: number): Promise<void> {
    this.#entries = this.#entries.filter(
      (p) => !(p.token === token && p.pollId === pollId),
    );
    await this.#save();
  }

  inConversation(token: string): TrackedPoll[] {
    return this.#entries.filter((p) => p.token === token);
  }

  find(token: string, pollId: number): TrackedPoll | undefined {
    return this.#entries.find(
      (p) => p.token === token && p.pollId === pollId,
    );
  }
}
