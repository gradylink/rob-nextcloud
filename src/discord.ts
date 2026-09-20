import type { Message, TextBasedChannel } from "discord.js";

const MENTION_PATTERN = /<@!?(\d+)>/g;

/** Rewrites native Discord `<@id>` mentions into Rob's internal `{id|displayName}` format. */
export const formatMentions = (msg: Message): string =>
  msg.content.replace(MENTION_PATTERN, (_full, id) => {
    const name = msg.mentions.members?.get(id)?.displayName ??
      msg.mentions.users.get(id)?.username ??
      id;
    return `{${id}|${name}}`;
  });

export const getDisplayName = (msg: Message): string =>
  msg.member?.displayName ?? msg.author.username;

export const isAddressedToRob = async (
  msg: Message,
  botUserId: string,
): Promise<boolean> => {
  if (msg.mentions.has(botUserId)) return true;

  const repliedToId = msg.reference?.messageId;
  if (!repliedToId) return false;

  try {
    const replied = msg.channel.messages.cache.get(repliedToId) ??
      (await msg.channel.messages.fetch(repliedToId));
    return replied.author.id === botUserId;
  } catch {
    return false;
  }
};

const DISCORD_MESSAGE_LIMIT = 2000;

/** Sends `content` to `channel`, splitting on newlines to respect Discord's message length limit. */
export const sendChunked = async (
  channel: TextBasedChannel,
  content: string,
): Promise<void> => {
  if (!("send" in channel)) return;

  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MESSAGE_LIMIT) {
      await channel.send(remaining);
      return;
    }
    let splitAt = remaining.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT);
    if (splitAt <= 0) splitAt = DISCORD_MESSAGE_LIMIT;
    await channel.send(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
};
