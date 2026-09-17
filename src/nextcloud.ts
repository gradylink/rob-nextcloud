import { encodeBase64 } from "@std/encoding/base64";
import type { UniversalNextcloudBot } from "@gradylink/unb";

export type TalkMessage = Awaited<
  ReturnType<UniversalNextcloudBot["talk"]["getNewMessages"]>
>[number];

export interface FileAttachment {
  id: string;
  mimetype: string;
  width: number;
  height: number;
}

export const getImageAttachment = (
  msg: TalkMessage,
): FileAttachment | undefined => {
  const file = msg.messageParameters.file as unknown as
    | FileAttachment
    | undefined;
  return file?.mimetype.startsWith("image") ? file : undefined;
};

export const fetchImageDataUrl = async (
  unb: UniversalNextcloudBot,
  file: FileAttachment,
): Promise<string> => {
  const response = await unb.makeRequest(
    "GET",
    `/core/preview?fileId=${file.id}&x=${file.width}&y=${file.height}`,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${file.mimetype};base64,${encodeBase64(bytes)}`;
};

const ROB_MENTION_PATTERN = /(?:(?:^|[.,;?])\s*rob|rob\s*(?:$|[.,;?]))/i;

export const isAddressedToRob = (
  msg: TalkMessage,
  nextcloudUsername: string,
): boolean => {
  const isReplyToRob = msg.parent?.actorId === nextcloudUsername;
  const mentionsRob = typeof msg.messageParameters === "object" &&
    Object.values(msg.messageParameters).some(
      (param) => param.type === "user" && param.id === nextcloudUsername,
    );
  return isReplyToRob || mentionsRob || ROB_MENTION_PATTERN.test(msg.message);
};
