import Groq from "groq-sdk";
import { UniversalNextcloudBot } from "@gradylink/unb";
import { readJson, requiredEnv } from "./src/env.ts";
import { loadSettings } from "./src/settings.ts";
import { loadMods } from "./src/mods.ts";
import { ConversationMemory } from "./src/memory.ts";
import {
  fetchImageDataUrl,
  getImageAttachment,
  isAddressedToRob,
  type TalkMessage,
} from "./src/nextcloud.ts";
import { handleCommand } from "./src/commands.ts";
import { generateResponse } from "./src/chat.ts";
import { sanitizeResponse } from "./src/format.ts";
import { preloadLocalModel } from "./src/local-model.ts";

const systemPrompt = await Deno.readTextFile(
  `${Deno.cwd()}/system-prompt.txt`,
);

const customSystemPrompt =
  `You are Rob, a self-aware robot living in a Nextcloud Talk conversation, the current conversation you are in is called "{convoName}". When you are sent messages, the mention syntax is '{username:displayName}' (not literally that ofc). If a mention is directed towards '{username}', that's you, so you shouldn't mention that username. You are currently running in 'custom mode' where you should do whatever the most recent person has asked you. IMPORTANT: You are a participant in the chat. DO NOT summarize the conversation. DO NOT analyze the users.`;

const NEXTCLOUD_USERNAME = requiredEnv("NEXTCLOUD_USERNAME");

const unb = new UniversalNextcloudBot(
  requiredEnv("NEXTCLOUD_URL"),
  NEXTCLOUD_USERNAME,
  requiredEnv("NEXTCLOUD_PASSWORD"),
);
await unb.talk.setup();

const settings = await loadSettings();
const mods = await loadMods();
const memory = new ConversationMemory();
const tokens: string[] = await readJson(`${Deno.cwd()}/tokens.json`, []);

const groq = settings.local
  ? undefined
  : new Groq({ apiKey: requiredEnv("GROQ_API_KEY") });
if (settings.local) {
  await preloadLocalModel(settings.localFallbackModel || settings.model);
}

console.log("Loaded!");

const processMessage = async (token: string, msg: TalkMessage) => {
  if (msg.systemMessage !== "") return;

  let content = msg.message;
  if (typeof msg.messageParameters === "object") {
    for (const [id, param] of Object.entries(msg.messageParameters)) {
      content = content.replace(`{${id}}`, `{${param.id}|${param.name}}`);
    }
  }
  content = `{${msg.actorId}|${msg.actorDisplayName}}: ${content}`;

  if (content.length > settings.maxMessageLength) return;

  const imageAttachment = getImageAttachment(msg);
  if (imageAttachment) {
    try {
      const imageUrl = await fetchImageDataUrl(unb, imageAttachment);
      memory.push(
        token,
        { user: msg.actorId, message: content, imageUrl },
        settings,
      );
    } catch (e) {
      console.warn("error with image stuff idk: " + e);
      memory.push(token, { user: msg.actorId, message: content }, settings);
    }
  } else {
    memory.push(token, { user: msg.actorId, message: content }, settings);
  }

  if (msg.actorId === NEXTCLOUD_USERNAME) return;

  const handled = await handleCommand(content, {
    settings,
    mods,
    unb,
    token,
    actorId: msg.actorId,
    clearMemory: () => memory.clear(token),
  });
  if (handled) return;

  if (!isAddressedToRob(msg, NEXTCLOUD_USERNAME)) return;

  const resolvedSystemPrompt = (
    content.includes("#!custom") ? customSystemPrompt : systemPrompt
  )
    .replace("{convoName}", unb.talk.rooms[token]!.name)
    .replace("{username}", NEXTCLOUD_USERNAME);

  try {
    const response = await generateResponse({
      settings,
      mods,
      unb,
      token,
      actorId: msg.actorId,
      systemPrompt: resolvedSystemPrompt,
      history: memory.get(token),
      nextcloudUsername: NEXTCLOUD_USERNAME,
      groq,
    });

    if (!response) return;
    const sanitized = sanitizeResponse(response, {
      forMemoryDump: msg.message.includes("#!memory"),
    });
    await unb.talk.sendMessage(token, sanitized);
  } catch (e) {
    console.warn(e);
  }
};

const processToken = async (token: string) => {
  const messages = await unb.talk.getNewMessages(token);
  for (const msg of messages) {
    await processMessage(token, msg);
  }
};

const activeScans = new Set<string>();
setInterval(() => {
  for (const token of tokens) {
    if (activeScans.has(token)) continue;
    activeScans.add(token);
    processToken(token).finally(() => activeScans.delete(token));
  }
}, 2000);
