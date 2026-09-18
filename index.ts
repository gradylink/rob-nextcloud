import Groq from "groq-sdk";
import { UniversalNextcloudBot } from "@gradylink/unb";
import { readJson, requiredEnv } from "./src/env.ts";
import { loadSettings } from "./src/settings.ts";
import { loadMods } from "./src/mods.ts";
import { ConversationMemory } from "./src/memory.ts";
import { isAddressedToRob, type TalkMessage } from "./src/nextcloud.ts";
import { handleCommand } from "./src/commands.ts";
import { generateResponse } from "./src/chat.ts";
import { sanitizeResponse } from "./src/format.ts";
import { preloadLocalModel } from "./src/local-model.ts";
import { scheduleDaily } from "./src/schedule.ts";
import { findTodaysBirthdays, markBirthdayAnnounced } from "./src/birthdays.ts";
import { TemporaryTokens } from "./src/temp-tokens.ts";

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

const sendGeneratedReply = async (
  token: string,
  actorId: string,
  systemPromptTemplate: string,
  forMemoryDump: boolean,
) => {
  const resolvedSystemPrompt = systemPromptTemplate
    .replace("{convoName}", unb.talk.rooms[token]!.name)
    .replace("{username}", NEXTCLOUD_USERNAME);

  const response = await generateResponse({
    settings,
    mods,
    unb,
    token,
    actorId,
    systemPrompt: resolvedSystemPrompt,
    history: memory.get(token),
    nextcloudUsername: NEXTCLOUD_USERNAME,
    groq,
  });

  if (!response) return;
  const sanitized = sanitizeResponse(response, { forMemoryDump });
  await unb.talk.sendMessage(token, sanitized);
};

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

  const imageAttachment = unb.talk.getImageAttachment(msg.messageParameters);
  if (imageAttachment) {
    try {
      const imageUrl = await unb.talk.fetchPreviewDataUrl(imageAttachment);
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
    groq,
  });
  if (handled) return;

  if (!isAddressedToRob(msg, NEXTCLOUD_USERNAME)) return;

  try {
    await sendGeneratedReply(
      token,
      msg.actorId,
      content.includes("#!custom") ? customSystemPrompt : systemPrompt,
      msg.message.includes("#!memory"),
    );
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

const TEMP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const temporaryTokens = await TemporaryTokens.load();
await temporaryTokens.prune();

const openOneToOneConversation = async (userId: string): Promise<string> => {
  const response = await unb.makeRequest(
    "POST",
    "/ocs/v2.php/apps/spreed/api/v4/room?format=json",
    JSON.stringify({ roomType: 1, invite: userId }),
  );
  const { token } = (await response.json()).ocs.data;
  await unb.talk.setup();
  return token;
};

const wishHappyBirthday = async (userId: string) => {
  const token = await openOneToOneConversation(userId);
  await temporaryTokens.add(token, Date.now() + TEMP_TOKEN_TTL_MS);

  const displayName = unb.talk.rooms[token]?.displayName ?? userId;
  memory.push(
    token,
    {
      user: "birthday",
      message:
        `Today is ${displayName}'s birthday! wish them a happy birthday :D`,
    },
    settings,
  );

  try {
    await sendGeneratedReply(token, userId, systemPrompt, false);
    await markBirthdayAnnounced(userId);
  } catch (e) {
    console.warn(`Failed to send birthday message to ${userId}: ${e}`);
  }
};

const checkBirthdays = async () => {
  if (!settings.birthdaysEnabled) return;
  const userIds = await findTodaysBirthdays(unb, tokens, NEXTCLOUD_USERNAME);
  for (const userId of userIds) {
    await wishHappyBirthday(userId);
  }
};

checkBirthdays();
scheduleDaily(8, 0, checkBirthdays);

const activeScans = new Set<string>();
setInterval(async () => {
  await temporaryTokens.prune();

  for (const token of [...tokens, ...temporaryTokens.tokens()]) {
    if (activeScans.has(token)) continue;
    activeScans.add(token);
    processToken(token).finally(() => activeScans.delete(token));
  }
}, 2000);
