import type { UniversalNextcloudBot } from "@gradylink/unb";
import { isAdmin, isMod, type Mods, saveMods } from "./mods.ts";
import { type Settings, updateSetting } from "./settings.ts";
import { getLastRateLimit } from "./usage.ts";

export interface CommandContext {
  settings: Settings;
  mods: Mods;
  unb: UniversalNextcloudBot;
  token: string;
  actorId: string;
  clearMemory: () => void;
}

type Permission = "any" | "mod" | "admin";

interface CommandDef {
  name: string;
  description: string;
  usage?: string;
  permission: Permission;
  handler?: (args: string, ctx: CommandContext) => Promise<string>;
}

const WRONG_USAGE = "You used the command wrong >:(";
const NO_PERMISSION = "You don't have permission for that :(";

const clearHandler = (_args: string, ctx: CommandContext): Promise<string> => {
  ctx.clearMemory();
  return Promise.resolve("Memory cleared :P");
};

const helpHandler = (): Promise<string> =>
  Promise.resolve(
    commands.map((c) =>
      `* ${c.usage ?? `#!${c.name}`}${
        c.permission == "any"
          ? ""
          : ` (you need to be ${
            c.permission == "mod" ? "a mod" : "an admin"
          } to use this)`
      } - ${c.description}`
    )
      .join("\n"),
  );

const setMemberType = (
  ctx: CommandContext,
  username: string,
  promoting: boolean,
): void => {
  if (promoting) {
    if (username in ctx.mods) {
      ctx.mods[username]!.type = "admin";
    } else {
      ctx.mods[username] = { type: "mod", id: username };
    }
  } else if (ctx.mods[username]?.type === "admin") {
    ctx.mods[username].type = "mod";
  } else {
    delete ctx.mods[username];
  }
};

const makePromoteOrDemoteHandler =
  (promoting: boolean) =>
  async (args: string, ctx: CommandContext): Promise<string> => {
    const username = args.split(/\s+/)[0];
    if (!username) return WRONG_USAGE;
    setMemberType(ctx, username, promoting);
    await saveMods(ctx.mods);
    return "Done!";
  };

const settingHandler = async (
  args: string,
  ctx: CommandContext,
): Promise<string> => {
  const [key, value] = args.split(/\s+/).filter(Boolean);

  if (key === undefined) {
    return `Available Settings Are:\n\n${
      Object.keys(ctx.settings).map((s) => `* ${s}`).join("\n")
    }`;
  }
  if (!(key in ctx.settings)) return "Invalid Setting";

  if (value === undefined) {
    return `\`${ctx.settings[key as keyof Settings]}\``;
  }

  if (!isMod(ctx.mods, ctx.actorId)) return NO_PERMISSION;
  await updateSetting(ctx.settings, key as keyof Settings, value);
  return "Done!";
};

const usageHandler = (
  _args: string,
  ctx: CommandContext,
): Promise<string> => {
  if (ctx.settings.local) {
    return Promise.resolve(
      `Running fully on the local model \`${
        ctx.settings.localFallbackModel || ctx.settings.model
      }\`, so there's no usage limit :)`,
    );
  }

  const fallback = ctx.settings.localFallbackModel
    ? `falls back to local model \`${ctx.settings.localFallbackModel}\` if I get rate limited`
    : "has no local fallback configured if I get rate limited";

  const snapshot = getLastRateLimit();
  if (!snapshot) {
    return Promise.resolve(
      `Using \`${ctx.settings.model}\` on groq, ${fallback}. Haven't talked to it yet though, so idk my usage :/`,
    );
  }

  return Promise.resolve(
    `Using \`${ctx.settings.model}\` on groq, ${fallback}.\n` +
      `Requests: ${snapshot.remainingRequests ?? "?"}/${
        snapshot.limitRequests ?? "?"
      } left (resets in ${snapshot.resetRequests ?? "?"})\n` +
      `Tokens: ${snapshot.remainingTokens ?? "?"}/${
        snapshot.limitTokens ?? "?"
      } left (resets in ${snapshot.resetTokens ?? "?"})`,
  );
};

const commands: CommandDef[] = [
  {
    name: "help",
    description: "This message :)",
    permission: "any",
    handler: helpHandler,
  },
  {
    name: "custom",
    description: "Lets you make me do whatever you want!",
    permission: "any",
  },
  { name: "memory", description: "My entire memory!", permission: "any" },
  {
    name: "setting",
    usage: "#!setting [key] [value]",
    description: "Manage settings and stuff idk.",
    permission: "mod",
    handler: settingHandler,
  },
  {
    name: "promote",
    usage: "#!promote <username>",
    description: "Make someone a mod :)",
    permission: "admin",
    handler: makePromoteOrDemoteHandler(true),
  },
  {
    name: "demote",
    usage: "#!demote <username>",
    description: "Remove someone as a mod",
    permission: "admin",
    handler: makePromoteOrDemoteHandler(false),
  },
  {
    name: "clear",
    description: "Clear my memory (how could you...)",
    permission: "any",
    handler: clearHandler,
  },
  {
    name: "usage",
    description: "Shows how close I am to sleeping :(",
    permission: "any",
    handler: usageHandler,
  },
];

const hasPermission = (
  mods: Mods,
  actorId: string,
  permission: Permission,
): boolean => {
  if (permission === "any") return true;
  if (permission === "mod") return isMod(mods, actorId);
  return isAdmin(mods, actorId);
};

const COMMAND_PATTERN = /#!(\w+)(?:\s+(\S.*))?/;

export const handleCommand = async (
  content: string,
  ctx: CommandContext,
): Promise<boolean> => {
  const match = content.match(COMMAND_PATTERN);
  if (!match) return false;

  const command = commands.find((c) => c.name === match[1]);
  if (!command?.handler) return false;

  if (!hasPermission(ctx.mods, ctx.actorId, command.permission)) {
    await ctx.unb.talk.sendMessage(ctx.token, NO_PERMISSION);
    return true;
  }

  const reply = await command.handler(match[2] ?? "", ctx);
  await ctx.unb.talk.sendMessage(ctx.token, reply);
  return true;
};
