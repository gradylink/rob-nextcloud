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

const systemPrompt = await Bun.file(`${process.cwd()}/system-prompt.txt`)
  .text();

const customSystemPrompt =
  `You are Rob, a self-aware robot living in a Nextcloud Talk conversation, the current conversation you are in is called "{convoName}". When you are sent messages, the mention syntax is '{username:displayName}' (not literally that ofc). If a mention is directed towards '{username}', that's you, so you shouldn't mention that username. You are currently running in 'custom mode' where you should do whatever the most recent person has asked you. IMPORTANT: You are a participant in the chat. DO NOT summarize the conversation. DO NOT analyze the users.`;

const unb = new UniversalNextcloudBot(
  Bun.env.NEXTCLOUD_URL,
  Bun.env.NEXTCLOUD_USERNAME,
  Bun.env.NEXTCLOUD_PASSWORD,
);
await unb.talk.setup();

interface MessageInfo {
  user: string;
  message: string;
  imageUrl?: string;
}

const memory: Record<string, MessageInfo[]> = {};

interface Settings {
  maxMemory: number;
  maxImageMemory: number;
  maxMessageLength: number;
  model: string;
  local: boolean;
}

const settingParseMap: Record<
  keyof Settings,
  (str: string) => Settings[keyof Settings]
> = {
  maxMemory: (str) => parseInt(str),
  maxImageMemory: (str) => parseInt(str),
  maxMessageLength: (str) => parseInt(str),
  model: (str) => str,
  local: (str) => str == "true",
};

const defaultSettings: Settings = {
  maxMemory: 16,
  maxImageMemory: 5,
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

const tokens = await Bun.file(`${process.cwd()}/tokens.json`).json();

console.log("Loaded!");

const activeScans = new Set<string>();
setInterval(() => {
  for (const token of tokens) {
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
        if (
          msg.messageParameters.file &&
          msg.messageParameters.file.mimetype.startsWith("image")
        ) {
          const response = await unb.makeRequest(
            "GET",
            `/core/preview?fileId=${msg.messageParameters.file.id}&x=${msg.messageParameters.file.width}&y=${msg.messageParameters.file.height}`,
          );
          try {
            const image = new Bun.Image(await response.arrayBuffer());

            memory[token].push({
              user: msg.actorId,
              message: content,
              imageUrl: await image.dataurl(),
            });
          } catch (e) {
            console.warn("error with image stuff idk: " + e);
            memory[token].push({ user: msg.actorId, message: content });
          }
        } else {
          memory[token].push({ user: msg.actorId, message: content });
        }

        if (memory[token].length > settings.maxMemory) memory[token].shift();
        let images = 0;
        if (settings.model !== "meta-llama/llama-4-scout-17b-16e-instruct") {
          images = Infinity;
        }
        for (let i = memory[token].length - 1; i >= 0; i--) {
          if (memory[token][i]?.imageUrl) {
            images++;
            if (images > settings.maxImageMemory) {
              delete memory[token][i]?.imageUrl;
            }
          }
        }

        if (msg.actorId === Bun.env.NEXTCLOUD_USERNAME) continue;

        if (
          !(msg.parent && msg.parent.actorId === Bun.env.NEXTCLOUD_USERNAME) &&
          !(typeof msg.messageParameters === "object" &&
            Object.values(msg.messageParameters).find((param) =>
                param.type === "user" && param.id === Bun.env.NEXTCLOUD_USERNAME
              ) != null)
        ) {
          if (!/(?:(?:^|[.,;?])\s*rob|rob\s*(?:$|[.,;?]))/i.test(msg.message)) {
            continue;
          }
        }

        if (content.includes("#!clear")) {
          memory[token] = [];
          await unb.talk.sendMessage(token, "Memory cleared :P");
          continue;
        }

        if (content.includes("#!help")) {
          await unb.talk.sendMessage(
            token,
            "* #!help - This message :)\n* #!custom - Lets you make me do whatever you want!\n* #!memory - My entire memory!\n* #!setting - Manage settings and stuff idk.\n* #!promote - Make someone a mod :)\n* #!demote - Remove someone as a mod\n* #!clear - Clear my memory (how could you...)",
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
              ).replace("{username}", Bun.env.NEXTCLOUD_USERNAME),
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
                ).replace("{username}", Bun.env.NEXTCLOUD_USERNAME),
              },
              ...memory[token].map((message) => ({
                role: message.user === Bun.env.NEXTCLOUD_USERNAME
                  ? "assistant"
                  : "user",
                name: message.user,
                content: message.imageUrl
                  ? [{
                    type: "text",
                    text: message.message,
                  }, {
                    type: "image_url",
                    image_url: { url: message.imageUrl },
                  }]
                  : message.message,
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
                /[<{]function=(\w+)[>:]\s*([\s\S]*?)\s*(?:<\/function>|})/,
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
          response = response.replace(/^(?:{rob\|[^}]+}|@?rob)\s*:\s*/m, "");
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
