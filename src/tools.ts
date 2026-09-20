import type { ChatCompletionTool } from "groq-sdk/resources/chat.mjs";
import type { Message, TextBasedChannel } from "discord.js";
import { defaultSettings, type Settings, updateSetting } from "./settings.ts";
import { isMod, type Mods } from "./mods.ts";
import type { TrackedPolls } from "./polls.ts";

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
          userId: {
            type: "string",
            description:
              "The Discord user ID of the person you'd like to check, from the {id|name} mention format.",
          },
        },
        required: ["userId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_participants",
      description: "Gets the members of the current server (if applicable).",
    },
  },
  {
    type: "function",
    function: {
      name: "create_poll",
      description:
        "Creates a poll in the current channel and starts tracking it, so it can be looked up, listed, or ended later.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question the poll asks.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "At least two answer options for the poll.",
          },
          maxVotes: {
            type: "integer",
            description:
              "Set to a number greater than 1 to allow multiple choice. Defaults to 1 (single choice).",
          },
          durationHours: {
            type: "integer",
            description:
              "How many hours the poll should stay open for. Defaults to 24.",
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_polls",
      description:
        "Lists every poll Rob has created in the current channel, including their current status and results.",
    },
  },
  {
    type: "function",
    function: {
      name: "get_poll",
      description:
        "Gets the current state and results of a specific poll Rob created in this channel.",
      parameters: {
        type: "object",
        properties: {
          pollId: {
            type: "string",
            description:
              "The message id of the poll, from create_poll or list_polls.",
          },
        },
        required: ["pollId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_poll",
      description:
        "Ends a poll Rob created in this channel, so no more votes can be cast, and returns the final results.",
      parameters: {
        type: "object",
        properties: {
          pollId: {
            type: "string",
            description:
              "The message id of the poll, from create_poll or list_polls.",
          },
        },
        required: ["pollId"],
      },
    },
  },
];

export interface ToolContext {
  settings: Settings;
  mods: Mods;
  channel: TextBasedChannel;
  channelId: string;
  actorId: string;
  polls: TrackedPolls;
}

const formatPoll = (message: Message): string => {
  const poll = message.poll;
  if (!poll) return `Poll message ${message.id} no longer has poll data.`;

  const optionLines = [...poll.answers.values()]
    .map((answer) =>
      `  ${answer.id}. ${answer.text}${
        answer.voteCount !== undefined
          ? ` (${answer.voteCount} vote${answer.voteCount === 1 ? "" : "s"})`
          : ""
      }`
    )
    .join("\n");
  const statusLabel = poll.resultsFinalized ? "closed" : "open";

  return `Poll #${message.id}: "${poll.question.text}" [${statusLabel}]\n${optionLines}`;
};

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
        const info = ctx.mods[args.userId];
        return info
          ? `${args.userId} is a ${info.type}`
          : `${args.userId} is not a moderator or admin.`;
      }
      case "get_participants": {
        if (!("guild" in ctx.channel) || !ctx.channel.guild) {
          return "This isn't a server channel, so there's no member list.";
        }
        const members = await ctx.channel.guild.members.fetch();
        return members
          .map((m) => `{${m.id}|${m.displayName}}`)
          .join(", ");
      }
      case "create_poll": {
        const args = JSON.parse(argsJson);
        if (
          typeof args.question !== "string" || !Array.isArray(args.options) ||
          args.options.length < 2
        ) {
          return "Error: A poll needs a question and at least two options.";
        }
        if (!("send" in ctx.channel)) {
          return "Error: Can't create a poll here.";
        }
        const message = await ctx.channel.send({
          poll: {
            question: { text: args.question },
            answers: args.options.map((text: string) => ({ text })),
            duration: typeof args.durationHours === "number"
              ? args.durationHours
              : 24,
            allowMultiselect: typeof args.maxVotes === "number" &&
              args.maxVotes !== 1,
          },
        });
        await ctx.polls.add({
          channelId: ctx.channelId,
          messageId: message.id,
          question: args.question,
          createdBy: ctx.actorId,
          createdAt: Date.now(),
        });
        return `Success: Created poll #${message.id}: "${args.question}"`;
      }
      case "list_polls": {
        const tracked = ctx.polls.inConversation(ctx.channelId);
        if (tracked.length === 0) {
          return "No polls have been created in this channel.";
        }
        const results = await Promise.all(
          tracked.map(async (p) => {
            try {
              return formatPoll(
                await ctx.channel.messages.fetch(p.messageId),
              );
            } catch {
              return `Poll #${p.messageId}: "${p.question}" [unavailable]`;
            }
          }),
        );
        return results.join("\n\n");
      }
      case "get_poll": {
        const args = JSON.parse(argsJson);
        try {
          return formatPoll(
            await ctx.channel.messages.fetch(String(args.pollId)),
          );
        } catch {
          return `Error: Could not find poll #${args.pollId} in this channel.`;
        }
      }
      case "end_poll": {
        const args = JSON.parse(argsJson);
        try {
          const message = await ctx.channel.messages.fetch(
            String(args.pollId),
          );
          if (!message.poll) throw new Error("no poll on message");
          const ended = await message.poll.end();
          return `Success: Closed poll #${ended.id}.\n\n${
            formatPoll(ended)
          }`;
        } catch {
          return `Error: Could not close poll #${args.pollId}. It may not exist, or may already be closed.`;
        }
      }
      default:
        return "";
    }
  } catch {
    return "Error: Failed to parse arguments JSON structure.";
  }
};
