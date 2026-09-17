import {
  type ChatHistoryItem,
  getLlama,
  type Llama,
  LlamaChatSession,
  type LlamaModel,
} from "node-llama-cpp";

let llamaPromise: Promise<Llama> | undefined;
const getLlamaInstance = (): Promise<Llama> => llamaPromise ??= getLlama();

const modelCache = new Map<string, Promise<LlamaModel>>();

const loadLocalModel = (fileName: string): Promise<LlamaModel> => {
  let model = modelCache.get(fileName);
  if (!model) {
    model = getLlamaInstance().then((llama) =>
      llama.loadModel({ modelPath: `${Deno.cwd()}/models/${fileName}.gguf` })
    );
    modelCache.set(fileName, model);
  }
  return model;
};

export const preloadLocalModel = (fileName: string): Promise<LlamaModel> =>
  loadLocalModel(fileName);

export const runLocalChat = async (
  fileName: string,
  systemPrompt: string,
  history: ChatHistoryItem[],
  prompt: string,
): Promise<string> => {
  const model = await loadLocalModel(fileName);
  const context = await model.createContext();
  try {
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt,
    });
    session.setChatHistory(history);
    return await session.prompt(prompt, {});
  } finally {
    await context.dispose();
  }
};
