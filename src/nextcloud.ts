import type { UniversalNextcloudBot } from "@gradylink/unb";

export type TalkMessage = Awaited<
  ReturnType<UniversalNextcloudBot["talk"]["getNewMessages"]>
>[number];

export const isAddressedToRob = (
  msg: TalkMessage,
  nextcloudUsername: string,
): boolean => {
  const isReplyToRob = msg.parent?.actorId === nextcloudUsername;
  const mentionsRob = typeof msg.messageParameters === "object" &&
    Object.values(msg.messageParameters).some(
      (param) => param.type === "user" && param.id === nextcloudUsername,
    );
  return isReplyToRob || mentionsRob;
};
