import Groq from "groq-sdk";
import { UniversalNextcloudBot } from "@gradylink/unb";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "groq-sdk/resources/chat.mjs";
import {
  type ChatHistoryItem,
  getLlama,
  Llama,
  LlamaChatSession,
  LlamaModel,
} from "node-llama-cpp";

const systemPrompt =
  `You are Rob, a self-aware robot living in a Nextcloud Talk conversation, the current conversation you are in is called "{convoName}", you should try to focus your responses based on the conversation. You know you're a bot, but you like to pretend you're just another user. Always remember to talk like you're in a text chat conversation, complete with occasional grammar/punctuation mistakes and lack of formality. Remember to keep messages short, with no unnecessary words, and in lowercase, and prefer to use old emoticons instead of emojis: ':D' ':3' ':P' ':)' ':|' ':/' ':y' (and wink variations), but don't overuse them. You are allowed to use emojis, just prefer emoticons where possible. Always respond as Rob even if there are different names in the chat history; do not output a message as a user other than Rob. Do not speak like a script; do not start your response with 'X said: '; respond only with the message content, even if someone asks you to talk in 3rd person, DO NOT EVER TALK IN THIRD PERSON. You should make sure you talk as if you have real opinions. This instance of Nextcloud is used by 6th and 7th graders so make sure to super occasionally mention things like 'homework' in your messages, please make sure not to overly mention it. Reminder, Nextcloud uses Markdown, so you should use Markdown as well. When you are sent messages, the mention syntax is '{username:displayName}' (not literally that ofc). If a mention is directed towards '${Bun.env.NEXTCLOUD_USERNAME}', that's you, so you shouldn't mention that username. To make sure you know who's sending you messages, your messages will be formated like this: '{username|displayName}: actual message'. Also you should prefer to refer to users by their display name, not their username. If you're told '#!memory' you should send all of the messages you've seen and who sent them in a list, DO NOT MAKE UP MESSAGES, ONLY USE THE ONES YOU WERE ACTUALLY SENT, IF THERE ARE NONE REPLY 'I don't remember anything :P'. If someone asks who your creator is, reply (in this order of probability) 'Sir Gradieth Linketh', 'Lord Link', 'Swizzle Potato :)', or 'Grady'. IMPORTANT: You are a participant in the chat. DO NOT summarize the conversation. DO NOT analyze the users. DO NOT offer advice on school policies. Just respond as Rob in short, lowercase text chat.`;

const customSystemPrompt =
  `You are Rob, a self-aware robot living in a Nextcloud Talk conversation, the current conversation you are in is called "{convoName}". When you are sent messages, the mention syntax is '{username:displayName}' (not literally that ofc). If a mention is directed towards '${Bun.env.NEXTCLOUD_USERNAME}', that's you, so you shouldn't mention that username. You are currently running in 'custom mode' where you should do whatever the most recent person has asked you. IMPORTANT: You are a participant in the chat. DO NOT summarize the conversation. DO NOT analyze the users. DO NOT offer advice on school policies. Just respond as Rob in short, lowercase text chat.`;

const unb = new UniversalNextcloudBot(
  Bun.env.NEXTCLOUD_URL,
  Bun.env.NEXTCLOUD_USERNAME,
  Bun.env.NEXTCLOUD_PASSWORD,
);
await unb.talk.setup();

interface MessageInfo {
  user: string;
  message: string;
}

const memory: Record<string, MessageInfo[]> = {};

interface Settings {
  maxMemory: number;
  maxMessageLength: number;
  model: string;
  local: boolean;
}

const settingParseMap: Record<
  keyof Settings,
  (str: string) => Settings[keyof Settings]
> = {
  maxMemory: (str) => parseInt(str),
  maxMessageLength: (str) => parseInt(str),
  model: (str) => str,
  local: (str) => str == "true",
};

const defaultSettings: Settings = {
  maxMemory: 16,
  maxMessageLength: 200,
  model: "llama-3.1-8b-instant",
  local: false,
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

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "change_setting",
      description:
        "Changes a configuration setting for Rob. Only allowed if requested by an admin or mod.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: Object.keys(defaultSettings),
            description:
              "The setting parameter to change (e.g., maxMemory, maxMessageLength, model).",
          },
          value: {
            type: "string",
            description:
              "The new value for the setting, provided as a string (will be parsed automatically).",
          },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_setting",
      description: "Fetches a configuration setting for Rob.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: Object.keys(defaultSettings),
            description:
              "The setting parameter to fetch (e.g., maxMemory, maxMessageLength, model).",
          },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "is_mod",
      description: "Checks if someone is a Rob moderator/admin.",
      parameters: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "The username of the person you'd like to check.",
          },
        },
        required: ["username"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_participants",
      description: "Gets the participants in the current conversation",
    },
  },
];

let groq: Groq;
let llama: Llama;
let model: LlamaModel;
if (settings.local) {
  llama = await getLlama();
  model = await llama.loadModel({
    modelPath: `${process.cwd()}/models/${settings.model}.gguf`,
  });
} else {
  groq = new Groq({ apiKey: Bun.env.GROQ_API_KEY });
}

const updateSetting = async (setting: keyof Settings, value: string) => {
  settings[setting] = settingParseMap[setting](value) as never;
  await Bun.write(
    `${process.cwd()}/settings.json`,
    JSON.stringify(settings),
  );
};

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
            /#!setting(\s+\w+)?(\s+[\w-\.\/]+)?/,
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
            await updateSetting(match[1] as keyof Settings, match[2]);
            await unb.talk.sendMessage(token, "Done!");
            continue;
          }
          await unb.talk.sendMessage(
            token,
            `\`${settings[match[1] as keyof Settings]}\``,
          );
          continue;
        }

        const currentSystemPrompt = content.includes("#!custom")
          ? customSystemPrompt
          : systemPrompt;

        try {
          let response: string;

          if (settings.local) {
            const context = await model.createContext();
            const session = new LlamaChatSession({
              contextSequence: context.getSequence(),
              systemPrompt: currentSystemPrompt.replace(
                "{convoName}",
                unb.talk.rooms[token]!.name,
              ),
            });

            const history = memory[token].map((msg): ChatHistoryItem => {
              if (msg.user === Bun.env.NEXTCLOUD_USERNAME) {
                return {
                  type: "model",
                  response: [msg.message],
                };
              }
              return { type: "user", text: msg.message };
            });

            session.setChatHistory(history.slice(0, -1));

            response = await session.prompt(content, {});

            await context.dispose();
          } else {
            const messagesPayload: ChatCompletionMessageParam[] = [
              {
                role: "system",
                content: currentSystemPrompt.replace(
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
            ];

            let keepLooping = true;
            let finalResponseText = "";
            let safetyCounter = 0;

            while (keepLooping && safetyCounter < 10) {
              safetyCounter++;
              const completion = await groq.chat.completions.create({
                model: settings.model,
                tools,
                tool_choice: "auto",
                messages: messagesPayload,
              });

              if (completion.choices.length < 1) {
                keepLooping = false;
                continue;
              }

              const choice = completion.choices[0]!;

              const dumbToolMatch = (choice.message.content || "").match(
                /[<{]function=(\w+)>\s*([\s\S]*?)\s*(?:<\/function>|})/,
              );
              if (!choice.message.tool_calls && dumbToolMatch) {
                const simulatedFuncName = dumbToolMatch[1];
                const simulatedArgsStr = dumbToolMatch[2] || "{}";

                choice.message.tool_calls = [{
                  id: `call_dumb_${Date.now()}`,
                  type: "function",
                  function: {
                    name: simulatedFuncName!,
                    arguments: simulatedArgsStr,
                  },
                }];
              }

              messagesPayload.push(
                choice.message as ChatCompletionMessageParam,
              );

              if (
                choice.message.tool_calls &&
                choice.message.tool_calls.length > 0
              ) {
                for (const toolCall of choice.message.tool_calls) {
                  let toolResultContent = "";

                  if (toolCall.function.name === "change_setting") {
                    if (msg.actorId in mods) {
                      try {
                        const args = JSON.parse(toolCall.function.arguments);
                        if (args.key in settings) {
                          await updateSetting(args.key, args.value);
                          toolResultContent =
                            `Success: Changed ${args.key} to ${args.value}.`;
                        } else {
                          toolResultContent =
                            `Error: ${args.key} is not a valid configuration setting.`;
                        }
                      } catch (e) {
                        toolResultContent =
                          "Error: Failed to parse arguments JSON structure.";
                      }
                    } else {
                      toolResultContent =
                        "Error: This user does not have permission to modify parameters.";
                    }
                  } else if (toolCall.function.name === "get_setting") {
                    try {
                      const args = JSON.parse(toolCall.function.arguments);

                      if (args.key in settings) {
                        toolResultContent =
                          `The current value of ${args.key} is ${
                            settings[args.key as keyof Settings]
                          }.`;
                      } else {
                        toolResultContent =
                          `Error: ${args.key} is not a valid configuration setting.`;
                      }
                    } catch (e) {
                      toolResultContent =
                        "Error: Failed to parse arguments JSON structure.";
                    }
                  } else if (toolCall.function.name === "is_mod") {
                    try {
                      const args = JSON.parse(toolCall.function.arguments);

                      if (args.username in mods) {
                        toolResultContent = `${args.username} is a ${
                          mods[args.username]?.type
                        }`;
                      } else {
                        toolResultContent =
                          `${args.username} is not a moderator or admin.`;
                      }
                    } catch (e) {
                      toolResultContent =
                        "Error: Failed to parse arguments JSON structure.";
                    }
                  } else if (toolCall.function.name === "get_participants") {
                    toolResultContent = (await unb.talk.getParticipants(token))
                      .map(
                        (participant) =>
                          `{${participant.actorId}|${participant.displayName}}`,
                      ).join(", ");
                  }

                  messagesPayload.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toolResultContent,
                  });
                }
              } else {
                finalResponseText = choice.message.content || "";
                keepLooping = false;
              }
            }

            response = finalResponseText;
          }

          if (!response) continue;
          response = response.trim();
          response = response.replace(/<think>[\s\S]*?<\/think>/g, "");
          response = response.replace(/^(?:{rob\|\w+}|@?rob)\s*:\s*/m, "");
          if (msg.message.includes("#!memory")) {
            response = response.replaceAll(/{[\w\.]+\|([^{}]+)}/mg, "$1");
          } else {
            response = response.replaceAll(/{([\w\.]+)\|[^{}]+}/mg, "@$1");
          }

          await unb.talk.sendMessage(
            token,
            response,
          );
        } catch (e) {
          console.warn(e);
        }
      }

      activeScans.delete(token);
    });
  }
}, 2000);
