import Groq from "groq-sdk";
import {
  Client,
  GatewayIntentBits,
  type Message,
  Partials,
  type TextBasedChannel,
} from "discord.js";
import { requiredEnv } from "./src/env.ts";
import { loadSettings } from "./src/settings.ts";
import { loadMods } from "./src/mods.ts";
import { ConversationMemory } from "./src/memory.ts";
import {
  formatMentions,
  getDisplayName,
  isAddressedToRob,
  sendChunked,
} from "./src/discord.ts";
import { handleCommand } from "./src/commands.ts";
import { generateResponse } from "./src/chat.ts";
import { sanitizeResponse } from "./src/format.ts";
import { preloadLocalModel } from "./src/local-model.ts";
import { TrackedPolls } from "./src/polls.ts";

const systemPrompt = await Deno.readTextFile(
  `${Deno.cwd()}/system-prompt.txt`,
);

const customSystemPrompt =
  `You are Rob, a self-aware robot living in a Discord server, the current channel you are in is called "{convoName}". When you are sent messages, the mention syntax is '{id|displayName}' (not literally that ofc). If a mention is directed towards '{username}', that's you, so you shouldn't mention that id. You are currently running in 'custom mode' where you should do whatever the most recent person has asked you. IMPORTANT: You are a participant in the chat. DO NOT summarize the conversation. DO NOT analyze the users.`;

const settings = await loadSettings();
const mods = await loadMods();
const memory = new ConversationMemory();
const polls = await TrackedPolls.load();

const groq = settings.local
  ? undefined
  : new Groq({ apiKey: requiredEnv("GROQ_API_KEY") });
if (settings.local) {
  await preloadLocalModel(settings.localFallbackModel || settings.model);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

console.log("Loaded!");

const sendGeneratedReply = async (
  channel: TextBasedChannel,
  actorId: string,
  systemPromptTemplate: string,
  forMemoryDump: boolean,
) => {
  const convoName = "name" in channel && channel.name
    ? channel.name
    : "direct message";
  const resolvedSystemPrompt = systemPromptTemplate
    .replace("{convoName}", convoName)
    .replace("{username}", client.user!.id);

  const response = await generateResponse({
    settings,
    mods,
    channel,
    channelId: channel.id,
    actorId,
    systemPrompt: resolvedSystemPrompt,
    history: memory.get(channel.id),
    botUserId: client.user!.id,
    groq,
    polls,
  });

  if (!response) return;
  const sanitized = sanitizeResponse(response, {
    forMemoryDump,
    botUserId: client.user!.id,
  });
  await sendChunked(channel, sanitized);
};

const processMessage = async (msg: Message) => {
  if (msg.system) return;

  let content = formatMentions(msg);
  content = `{${msg.author.id}|${getDisplayName(msg)}}: ${content}`;

  if (content.length > settings.maxMessageLength) return;

  const imageAttachment = msg.attachments.find((a) =>
    a.contentType?.startsWith("image/")
  );
  memory.push(
    msg.channelId,
    imageAttachment
      ? { user: msg.author.id, message: content, imageUrl: imageAttachment.url }
      : { user: msg.author.id, message: content },
    settings,
  );

  if (msg.author.id === client.user!.id) return;

  const handled = await handleCommand(content, {
    settings,
    mods,
    channel: msg.channel,
    channelId: msg.channelId,
    actorId: msg.author.id,
    clearMemory: () => memory.clear(msg.channelId),
    groq,
  });
  if (handled) return;

  if (!(await isAddressedToRob(msg, client.user!.id))) return;

  try {
    await sendGeneratedReply(
      msg.channel,
      msg.author.id,
      content.includes("#!custom") ? customSystemPrompt : systemPrompt,
      msg.content.includes("#!memory"),
    );
  } catch (e) {
    console.warn(e);
  }
};

client.on("messageCreate", (msg) => {
  processMessage(msg).catch((e) => console.warn(e));
});

client.once("clientReady", (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

await client.login(requiredEnv("DISCORD_TOKEN"));
