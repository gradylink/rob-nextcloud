export const requiredEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return fallback;
  }
};

export const writeJson = (path: string, value: unknown): Promise<void> =>
  Deno.writeTextFile(path, JSON.stringify(value));
