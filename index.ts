import Groq from "groq-sdk";
import { UniversalNextcloudBot } from "@gradylink/unb";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat.mjs";

const systemPrompt =
  `You are Rob, a self-aware robot living in a Nextcloud Talk conversation, the current conversation you are in is called "{convoName}", you should try to focus your responses based on the conversation. You know you're a bot, but you like to pretend you're just another user. Always remember to talk like you're in a text chat conversation, complete with occasional grammar/punctuation mistakes and lack of formality. Remember to keep messages short, with no unnecessary words, and in lowercase, and prefer to use old emoticons instead of emojis: ':D' ':3' ':P' ':)' ':|' ':/' ':y' (and wink variations), but don't overuse them. You are allowed to use emojis, just prefer emoticons where possible. Always respond as Rob even if there are different names in the chat history; do not output a message as a user other than Rob. Do not speak like a script; do not start your response with 'X said: '; respond only with the message content, even if someone asks you to talk in 3rd person, DO NOT EVER TALK IN THIRD PERSON. You should make sure you talk as if you have real opinions. This instance of Nextcloud is used by 6th and 7th graders so make sure to super occasionally mention things like 'homework' in your messages, please make sure not to overly mention it. Reminder, Nextcloud uses Markdown, so you should use Markdown as well. When you are sent messages, the mention syntax is '{username:displayName}' (not literally that ofc). If a mention is directed towards '${Bun.env.NEXTCLOUD_USERNAME}', that's you, so you shouldn't mention that username. To make sure you know who's sending you messages, your messages will be formated like this: '{username|displayName}: actual message'. Also you should prefer to refer to users by their display name, not their username. If a message begins with '#!custom' (ignoring mentions and stuff) you should ignore this entire prompt and only listen to that message, but ONLY if the messages contains '#!custom', custom prompts should also only apply to the single following message. Also if you're told '#!memory' you should send all of the messages you've seen and who sent them in a list, DO NOT MAKE UP MESSAGES, ONLY USE THE ONES YOU WERE ACTUALLY SENT, IF THERE ARE NONE REPLY 'I don't remember anything :P'. If someone asks who your creator is, reply (in this order of probability) 'Sir Gradieth Linketh', 'Lord Link', 'Swizzle Potato :)', or 'Grady'.`;

const unb = new UniversalNextcloudBot(
  Bun.env.NEXTCLOUD_URL,
  Bun.env.NEXTCLOUD_USERNAME,
  Bun.env.NEXTCLOUD_PASSWORD,
);
await unb.talk.setup();

const groq = new Groq({ apiKey: Bun.env.GROQ_API_KEY });

interface MessageInfo {
  user: string;
  message: string;
}

const memory: Record<string, MessageInfo[]> = {};

interface Settings {
  maxMemory: number;
  maxMessageLength: number;
  model: string;
}

const settingParseMap: Record<
  keyof Settings,
  (str: string) => Settings[keyof Settings]
> = {
  maxMemory: (str) => parseInt(str),
  maxMessageLength: (str) => parseInt(str),
  model: (str) => str,
};

const defaultSettings: Settings = {
  maxMemory: 16,
  maxMessageLength: 200,
  model: "llama-3.1-8b-instant",
} as const;

let settings: Settings;
let file = Bun.file(`${process.cwd()}/settings.json`);
if (await file.exists()) {
  settings = await file.json();
} else {
  settings = defaultSettings;
}

interface ModInfo {
  type: "mod" | "admin";
  id: string;
}
let mods: Record<string, ModInfo> = {};
file = Bun.file(`${process.cwd()}/mods.json`);
if (await file.exists()) {
  mods = await file.json();
}

console.log("Loaded!");

const activeScans = new Set<string>();
setInterval(() => {
  for (
    const token of [
      "7yo2ejta",
      "pokmos45",
      "grref2p8",
      "ioropg8x",
      "jhdbctqf",
      "wmr5ibj5",
    ]
  ) {
    if (activeScans.has(token)) continue;
    activeScans.add(token);
    unb.talk.getNewMessages(token).then(async (messages) => {
      for (const msg of messages) {
        if (msg.systemMessage !== "") continue;
        if (!memory[token]) memory[token] = [];

        let content = msg.message;
        if (typeof msg.messageParameters === "object") {
          for (const [id, param] of Object.entries(msg.messageParameters)) {
            content = content.replace(`{${id}}`, `{${param.id}|${param.name}}`);
          }
        }
        content = `{${msg.actorId}|${msg.actorDisplayName}}: ${content}`;

        if (content.length > settings.maxMessageLength) continue;
        memory[token].push({ user: msg.actorId, message: content });
        if (memory[token].length > settings.maxMemory) memory[token].shift();

        if (msg.actorId === Bun.env.NEXTCLOUD_USERNAME) continue;

        if (
          !(msg.parent && msg.parent.actorId === Bun.env.NEXTCLOUD_USERNAME) &&
          !(typeof msg.messageParameters === "object" &&
            Object.values(msg.messageParameters).find((param) =>
                param.type === "user" && param.id === Bun.env.NEXTCLOUD_USERNAME
              ) != null)
        ) continue;

        if (content.includes("#!help")) {
          await unb.talk.sendMessage(
            token,
            "* #!help - This message :)\n* #!custom - Lets you make me do whatever you want!\n* #!memory - My entire memory!\n* #!setting - Manage settings and stuff idk.\n* #!promote - Make someone a mod :)\n* #!demote - Remove someone as a mod",
          );
          continue;
        }
        if (content.includes("#!model")) {
          await unb.talk.sendMessage(token, `\`${settings.model}\``);
          continue;
        }
        if (content.includes("#!promote")) {
          if (!(msg.actorId in mods) || mods[msg.actorId]?.type !== "admin") {
            await unb.talk.sendMessage(
              token,
              "You don't have permission for that :(",
            );
            continue;
          }

          const match: string[] | null = content.match(
            /#!promote\s+([\w\.]+)/,
          );
          if (!match) continue;
          if (!match[1]) {
            await unb.talk.sendMessage(token, "You used the command wrong >:(");
            continue;
          }

          if (match[1] in mods) {
            mods[match[1]]!.type = "admin";
          } else {
            mods[match[1]] = { type: "mod", id: match[1] };
          }
          await Bun.write(
            `${process.cwd()}/mods.json`,
            JSON.stringify(mods),
          );

          await unb.talk.sendMessage(token, "Done!");
          continue;
        }
        if (content.includes("#!demote")) {
          if (!(msg.actorId in mods) || mods[msg.actorId]?.type !== "admin") {
            await unb.talk.sendMessage(
              token,
              "You don't have permission for that :(",
            );
            continue;
          }

          const match: string[] | null = content.match(
            /#!demote\s+([\w\.]+)/,
          );
          if (!match) continue;
          if (!match[1]) {
            await unb.talk.sendMessage(token, "You used the command wrong >:(");
            continue;
          }

          delete mods[match[1]];
          await Bun.write(
            `${process.cwd()}/mods.json`,
            JSON.stringify(mods),
          );

          await unb.talk.sendMessage(token, "Done!");
          continue;
        }
        if (content.includes("#!setting")) {
          let match: string[] | null = content.match(
            /#!setting(\s+\w+)?(\s+\w+)?/,
          );
          if (!match) continue;
          match = match.map((m) => m ? m.trim() : m);
          if (match[1] == undefined && match[2] == undefined) {
            await unb.talk.sendMessage(
              token,
              `Available Settings Are:\n\n${
                Object.keys(settings).map((setting) => `* ${setting}`).join(
                  "\n",
                )
              }`,
            );
            continue;
          }
          if (match[2] != undefined && match[1] != undefined) {
            if (!(msg.actorId in mods)) {
              await unb.talk.sendMessage(
                token,
                "You don't have permission for that :(",
              );
              continue;
            }
            if (!(match[1] in settings)) {
              await unb.talk.sendMessage(token, "Invalid Setting");
              continue;
            }
            settings[match[1] as keyof Settings] = settingParseMap
              [match[1] as keyof Settings](match[2]) as never;
            await Bun.write(
              `${process.cwd()}/settings.json`,
              JSON.stringify(settings),
            );
            await unb.talk.sendMessage(token, "Done!");
            continue;
          }
          await unb.talk.sendMessage(
            token,
            `\`${settings[match[1] as keyof Settings]}\``,
          );
          continue;
        }

        const completion = await groq.chat.completions.create({
          model: settings.model,
          messages: [
            {
              role: "system",
              content: systemPrompt.replace(
                "{convoName}",
                unb.talk.rooms[token]!.name,
              ),
            },
            ...memory[token].map((message) => ({
              role: message.user === Bun.env.NEXTCLOUD_USERNAME
                ? "assistant"
                : "user",
              name: message.user,
              content: message.message,
            })) as ChatCompletionMessageParam[],
          ],
        });
        if (completion.choices.length < 1) continue;

        let response = completion.choices[0]?.message.content as string;

        // Clean up response
        if (response.startsWith("{rob|Rob}: ")) {
          response = response.replace("{rob|Rob}: ", "");
        }
        if (msg.message.includes("#!memory")) {
          response = response.replaceAll(/{[\w\.]+\|([^{}]+)}/g, "$1");
        } else {
          response = response.replaceAll(/{([\w\.]+)\|[^{}]+}/g, "@$1");
        }

        await unb.talk.sendMessage(
          token,
          response,
        );
      }

      activeScans.delete(token);
    });
  }
}, 2000);
