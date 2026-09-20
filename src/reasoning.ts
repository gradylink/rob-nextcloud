export const getReasoningEffort = (
  model: string,
): "none" | "low" | undefined => {
  if (model.startsWith("qwen/")) return "none";
  if (model.startsWith("openai/gpt-oss")) return "low";
  return undefined;
};
