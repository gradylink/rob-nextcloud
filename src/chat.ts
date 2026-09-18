import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat.mjs";
import type { ChatHistoryItem } from "node-llama-cpp";
import type { UniversalNextcloudBot } from "@gradylink/unb";
import type { Settings } from "./settings.ts";
import type { Mods } from "./mods.ts";
import type { MessageInfo } from "./memory.ts";
import { runTool, tools } from "./tools.ts";
import { runLocalChat } from "./local-model.ts";
import { recordRateLimit, setLocalFallbackActive } from "./usage.ts";

export interface GenerateContext {
  settings: Settings;
  mods: Mods;
  unb: UniversalNextcloudBot;
  token: string;
  actorId: string;
  systemPrompt: string;
  /** Conversation memory, latest message last. */
  history: MessageInfo[];
  nextcloudUsername: string;
  groq?: Groq;
}

const toLocalHistory = (
  history: MessageInfo[],
  nextcloudUsername: string,
): ChatHistoryItem[] =>
  history.slice(0, -1).map((msg): ChatHistoryItem =>
    msg.user === nextcloudUsername
      ? { type: "model", response: [msg.message] }
      : { type: "user", text: msg.message }
  );

const toGroqMessages = (
  systemPrompt: string,
  history: MessageInfo[],
  nextcloudUsername: string,
): ChatCompletionMessageParam[] => [
  { role: "system", content: systemPrompt },
  ...history.map((message) => ({
    role: message.user === nextcloudUsername ? "assistant" : "user",
    name: message.user,
    content: message.imageUrl
      ? [
        { type: "text", text: message.message },
        { type: "image_url", image_url: { url: message.imageUrl } },
      ]
      : message.message,
  })) as ChatCompletionMessageParam[],
];

const extractDumbToolCall = (
  content: string,
): { name: string; arguments: string } | undefined => {
  const match = content.match(
    /[<{]function=(\w+)[>:]\s*([\s\S]*?)\s*(?:<\/function>|})/,
  );
  return match ? { name: match[1]!, arguments: match[2] || "{}" } : undefined;
};

const runGroqChat = async (ctx: GenerateContext): Promise<string> => {
  const messages = toGroqMessages(
    ctx.systemPrompt,
    ctx.history,
    ctx.nextcloudUsername,
  );

  for (let i = 0; i < 10; i++) {
    const { data: completion, response } = await ctx.groq!.chat.completions
      .create({
        model: ctx.settings.model,
        tools,
        tool_choice: "auto",
        messages,
        reasoning_effort: "none",
      })
      .withResponse();
    recordRateLimit(response.headers);

    const choice = completion.choices[0];
    if (!choice) return "";

    const dumbToolCall = !choice.message.tool_calls &&
      extractDumbToolCall(choice.message.content || "");
    if (dumbToolCall) {
      choice.message.tool_calls = [{
        id: `call_dumb_${Date.now()}`,
        type: "function",
        function: dumbToolCall,
      }];
    }

    messages.push(choice.message as ChatCompletionMessageParam);

    if (!choice.message.tool_calls?.length) {
      return choice.message.content || "";
    }

    for (const toolCall of choice.message.tool_calls) {
      const toolResultContent = await runTool(
        toolCall.function.name,
        toolCall.function.arguments,
        {
          settings: ctx.settings,
          mods: ctx.mods,
          unb: ctx.unb,
          token: ctx.token,
          actorId: ctx.actorId,
        },
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResultContent,
      });
    }
  }

  return "";
};

const isRateLimitError = (e: unknown): boolean =>
  e instanceof Groq.APIError && e.status === 429;

export const generateResponse = async (
  ctx: GenerateContext,
): Promise<string> => {
  const latestPrompt = ctx.history.at(-1)?.message ?? "";

  if (ctx.settings.local) {
    return await runLocalChat(
      ctx.settings.localFallbackModel || ctx.settings.model,
      ctx.systemPrompt,
      toLocalHistory(ctx.history, ctx.nextcloudUsername),
      latestPrompt,
    );
  }

  try {
    const result = await runGroqChat(ctx);
    setLocalFallbackActive(false);
    return result;
  } catch (e) {
    if (isRateLimitError(e) && ctx.settings.localFallbackModel) {
      console.warn(
        `Groq rate limit hit, falling back to local model "${ctx.settings.localFallbackModel}"`,
      );
      setLocalFallbackActive(true);
      return await runLocalChat(
        ctx.settings.localFallbackModel,
        ctx.systemPrompt,
        toLocalHistory(ctx.history, ctx.nextcloudUsername),
        latestPrompt,
      );
    }
    throw e;
  }
};
