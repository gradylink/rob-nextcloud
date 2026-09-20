import {
  type ChatHistoryItem,
  getLlama,
  type Llama,
  LlamaChatSession,
  type LlamaModel,
} from "node-llama-cpp";

let llamaPromise: Promise<Llama> | undefined;
const getLlamaInstance = (): Promise<Llama> => llamaPromise ??= getLlama();
console.log("Local GPU Backend: " + (await getLlamaInstance()).gpu);

const LOCAL_CONTEXT_SIZE = 8192;

const modelCache = new Map<string, Promise<LlamaModel>>();

const loadLocalModel = (fileName: string): Promise<LlamaModel> => {
  let model = modelCache.get(fileName);
  if (!model) {
    model = getLlamaInstance().then((llama) =>
      llama.loadModel({
        modelPath: `${Deno.cwd()}/models/${fileName}.gguf`,
        gpuLayers: { fitContext: { contextSize: LOCAL_CONTEXT_SIZE } },
      })
    );
    modelCache.set(fileName, model);
  }
  return model;
};

const sessionCache = new Map<string, Promise<LlamaChatSession>>();

const loadLocalSession = (fileName: string): Promise<LlamaChatSession> => {
  let session = sessionCache.get(fileName);
  if (!session) {
    session = loadLocalModel(fileName)
      .then((model) => model.createContext({ contextSize: LOCAL_CONTEXT_SIZE }))
      .then((context) =>
        new LlamaChatSession({ contextSequence: context.getSequence() })
      );
    sessionCache.set(fileName, session);
  }
  return session;
};

export const preloadLocalModel = (
  fileName: string,
): Promise<LlamaChatSession> => loadLocalSession(fileName);

export const runLocalChat = async (
  fileName: string,
  systemPrompt: string,
  history: ChatHistoryItem[],
  prompt: string,
): Promise<string> => {
  const session = await loadLocalSession(fileName);
  session.setChatHistory([{ type: "system", text: systemPrompt }, ...history]);
  return await session.prompt(prompt, {});
};
