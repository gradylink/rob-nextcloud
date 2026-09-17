import type { Settings } from "./settings.ts";

export const VISION_CAPABLE_MODEL = "qwen/qwen3.8-27b";

export interface MessageInfo {
  user: string;
  message: string;
  imageUrl?: string;
}

export class ConversationMemory {
  #byToken: Record<string, MessageInfo[]> = {};

  get(token: string): MessageInfo[] {
    return this.#byToken[token] ??= [];
  }

  clear(token: string): void {
    this.#byToken[token] = [];
  }

  push(token: string, entry: MessageInfo, settings: Settings): void {
    const messages = this.get(token);
    messages.push(entry);
    if (messages.length > settings.maxMemory) messages.shift();
    this.#trimImages(messages, settings);
  }

  #trimImages(messages: MessageInfo[], settings: Settings): void {
    const imagesAllowed = settings.model === VISION_CAPABLE_MODEL
      ? settings.maxImageMemory
      : Infinity;

    let seen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.imageUrl) {
        seen++;
        if (seen > imagesAllowed) delete messages[i]!.imageUrl;
      }
    }
  }
}
