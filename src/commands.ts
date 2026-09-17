import type { UniversalNextcloudBot } from "@gradylink/unb";
import { isAdmin, isMod, type Mods, saveMods } from "./mods.ts";
import { type Settings, updateSetting } from "./settings.ts";

const HELP_TEXT =
  "* #!help - This message :)\n* #!custom - Lets you make me do whatever you want!\n* #!memory - My entire memory!\n* #!setting - Manage settings and stuff idk.\n* #!promote - Make someone a mod :)\n* #!demote - Remove someone as a mod\n* #!clear - Clear my memory (how could you...)";

export interface CommandContext {
  settings: Settings;
  mods: Mods;
  unb: UniversalNextcloudBot;
  token: string;
  actorId: string;
  clearMemory: () => void;
}

/** Returns true if `content` was a recognized command. */
export const handleCommand = async (
  content: string,
  ctx: CommandContext,
): Promise<boolean> => {
  const reply = (text: string) => ctx.unb.talk.sendMessage(ctx.token, text);

  if (content.includes("#!clear")) {
    ctx.clearMemory();
    await reply("Memory cleared :P");
    return true;
  }

  if (content.includes("#!help")) {
    await reply(HELP_TEXT);
    return true;
  }

  if (content.includes("#!promote") || content.includes("#!demote")) {
    const promoting = content.includes("#!promote");
    if (!isAdmin(ctx.mods, ctx.actorId)) {
      await reply("You don't have permission for that :(");
      return true;
    }

    const username = content.match(
      promoting ? /#!promote\s+([\w.]+)/ : /#!demote\s+([\w.]+)/,
    )?.[1];
    if (!username) {
      await reply("You used the command wrong >:(");
      return true;
    }

    if (promoting) {
      if (username in ctx.mods) {
        ctx.mods[username]!.type = "admin";
      } else {
        ctx.mods[username] = { type: "mod", id: username };
      }
    } else {
      if (ctx.mods[username]?.type === "admin") {
        ctx.mods[username].type = "mod";
      } else {
        delete ctx.mods[username];
      }
    }
    await saveMods(ctx.mods);
    await reply("Done!");
    return true;
  }

  if (content.includes("#!setting")) {
    const match = content.match(/#!setting(\s+\w+)?(\s+[\w-.\/]+)?/);
    if (!match) return true;
    const key = match[1]?.trim();
    const value = match[2]?.trim();

    if (key === undefined && value === undefined) {
      await reply(
        `Available Settings Are:\n\n${
          Object.keys(ctx.settings).map((s) => `* ${s}`).join("\n")
        }`,
      );
      return true;
    }

    if (key !== undefined && value !== undefined) {
      if (!isMod(ctx.mods, ctx.actorId)) {
        await reply("You don't have permission for that :(");
        return true;
      }
      if (!(key in ctx.settings)) {
        await reply("Invalid Setting");
        return true;
      }
      await updateSetting(ctx.settings, key as keyof Settings, value);
      await reply("Done!");
      return true;
    }

    await reply(`\`${ctx.settings[key as keyof Settings]}\``);
    return true;
  }

  return false;
};
