import type { ChatCompletionTool } from "groq-sdk/resources/chat.mjs";
import { defaultSettings, type Settings, updateSetting } from "./settings.ts";
import { isMod, type Mods } from "./mods.ts";
import type { UniversalNextcloudBot } from "@gradylink/unb";
import { type Poll, PollResultMode, PollStatus } from "@gradylink/unb/talk";
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
  {
    type: "function",
    function: {
      name: "create_poll",
      description:
        "Creates a poll in the current conversation and starts tracking it, so it can be looked up, listed, or ended later.",
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
              "Maximum number of options a participant can vote for. Defaults to 1 (single choice). Use a higher number to allow multiple choice, or 0 for unlimited.",
          },
          resultMode: {
            type: "string",
            enum: ["public", "hidden"],
            description:
              "'public' (default) shows live results and who voted for what as votes come in. 'hidden' keeps results secret until the poll is ended.",
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
        "Lists every poll Rob has created in the current conversation, including their current status and results.",
    },
  },
  {
    type: "function",
    function: {
      name: "get_poll",
      description:
        "Gets the current state and results of a specific poll Rob created in this conversation.",
      parameters: {
        type: "object",
        properties: {
          pollId: {
            type: "integer",
            description: "The id of the poll, from create_poll or list_polls.",
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
        "Ends a poll Rob created in this conversation, so no more votes can be cast, and returns the final results.",
      parameters: {
        type: "object",
        properties: {
          pollId: {
            type: "integer",
            description: "The id of the poll, from create_poll or list_polls.",
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
  unb: UniversalNextcloudBot;
  token: string;
  actorId: string;
  polls: TrackedPolls;
}

const formatPoll = (poll: Poll): string => {
  const statusLabel = poll.status === PollStatus.Closed
    ? "closed"
    : poll.status === PollStatus.Draft
    ? "draft"
    : "open";
  const optionLines = poll.options
    .map((option, i) => {
      const count = poll.votes?.[`option-${i}`];
      return `  ${i}. ${option}${
        count !== undefined ? ` (${count} vote${count === 1 ? "" : "s"})` : ""
      }`;
    })
    .join("\n");
  const voters = poll.numVoters !== undefined
    ? `\nTotal voters: ${poll.numVoters}`
    : "";
  return `Poll #${poll.id}: "${poll.question}" [${statusLabel}]\n${optionLines}${voters}`;
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
      case "create_poll": {
        const args = JSON.parse(argsJson);
        if (
          typeof args.question !== "string" || !Array.isArray(args.options) ||
          args.options.length < 2
        ) {
          return "Error: A poll needs a question and at least two options.";
        }
        const pollId = await ctx.unb.talk.createPoll(ctx.token, {
          question: args.question,
          options: args.options,
          resultMode: args.resultMode === "hidden"
            ? PollResultMode.Hidden
            : PollResultMode.Public,
          maxVotes: typeof args.maxVotes === "number" ? args.maxVotes : 1,
          draft: false,
        });
        await ctx.polls.add({
          token: ctx.token,
          pollId,
          question: args.question,
          createdBy: ctx.actorId,
          createdAt: Date.now(),
        });
        return `Success: Created poll #${pollId}: "${args.question}"`;
      }
      case "list_polls": {
        const tracked = ctx.polls.inConversation(ctx.token);
        if (tracked.length === 0) {
          return "No polls have been created in this conversation.";
        }
        const results = await Promise.all(
          tracked.map(async (p) => {
            try {
              return formatPoll(
                await ctx.unb.talk.getPoll(ctx.token, p.pollId),
              );
            } catch {
              return `Poll #${p.pollId}: "${p.question}" [unavailable]`;
            }
          }),
        );
        return results.join("\n\n");
      }
      case "get_poll": {
        const args = JSON.parse(argsJson);
        try {
          return formatPoll(await ctx.unb.talk.getPoll(ctx.token, args.pollId));
        } catch {
          return `Error: Could not find poll #${args.pollId} in this conversation.`;
        }
      }
      case "end_poll": {
        const args = JSON.parse(argsJson);
        try {
          const poll = await ctx.unb.talk.closePoll(ctx.token, args.pollId);
          return `Success: Closed poll #${poll.id}.\n\n${formatPoll(poll)}`;
        } catch {
          return `Error: Could not close poll #${args.pollId}. It may not exist, or only its creator or a moderator can close it.`;
        }
      }
      default:
        return "";
    }
  } catch {
    return "Error: Failed to parse arguments JSON structure.";
  }
};
