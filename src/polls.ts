import { readJson, writeJson } from "./env.ts";

export interface TrackedPoll {
  channelId: string;
  messageId: string;
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

  async remove(channelId: string, messageId: string): Promise<void> {
    this.#entries = this.#entries.filter(
      (p) => !(p.channelId === channelId && p.messageId === messageId),
    );
    await this.#save();
  }

  inConversation(channelId: string): TrackedPoll[] {
    return this.#entries.filter((p) => p.channelId === channelId);
  }

  find(channelId: string, messageId: string): TrackedPoll | undefined {
    return this.#entries.find(
      (p) => p.channelId === channelId && p.messageId === messageId,
    );
  }
}
