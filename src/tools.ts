import type { ChatCompletionTool } from "groq-sdk/resources/chat.mjs";
import { defaultSettings, type Settings, updateSetting } from "./settings.ts";
import { isMod, type Mods } from "./mods.ts";
import type { UniversalNextcloudBot } from "@gradylink/unb";

export const tools: ChatCompletionTool[] = [
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

export interface ToolContext {
  settings: Settings;
  mods: Mods;
  unb: UniversalNextcloudBot;
  token: string;
  actorId: string;
}

export const runTool = async (
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<string> => {
  try {
    switch (name) {
      case "change_setting": {
        if (!isMod(ctx.mods, ctx.actorId)) {
          return "Error: This user does not have permission to modify parameters.";
        }
        const args = JSON.parse(argsJson);
        if (!(args.key in ctx.settings)) {
          return `Error: ${args.key} is not a valid configuration setting.`;
        }
        await updateSetting(ctx.settings, args.key, args.value);
        return `Success: Changed ${args.key} to ${args.value}.`;
      }
      case "get_setting": {
        const args = JSON.parse(argsJson);
        if (!(args.key in ctx.settings)) {
          return `Error: ${args.key} is not a valid configuration setting.`;
        }
        return `The current value of ${args.key} is ${
          ctx.settings[args.key as keyof Settings]
        }.`;
      }
      case "is_mod": {
        const args = JSON.parse(argsJson);
        const info = ctx.mods[args.username];
        return info
          ? `${args.username} is a ${info.type}`
          : `${args.username} is not a moderator or admin.`;
      }
      case "get_participants": {
        const participants = await ctx.unb.talk.getParticipants(ctx.token);
        return participants
          .map((p) => `{${p.actorId}|${p.displayName}}`)
          .join(", ");
      }
      default:
        return "";
    }
  } catch {
    return "Error: Failed to parse arguments JSON structure.";
  }
};
