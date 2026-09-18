import { readJson, writeJson } from "./env.ts";

export interface Settings {
  maxMemory: number;
  maxImageMemory: number;
  maxMessageLength: number;
  model: string;
  local: boolean;
  localFallbackModel: string;
  birthdaysEnabled: boolean;
}

const settingParsers: { [K in keyof Settings]: (str: string) => Settings[K] } =
  {
    maxMemory: (str) => parseInt(str),
    maxImageMemory: (str) => parseInt(str),
    maxMessageLength: (str) => parseInt(str),
    model: (str) => str,
    local: (str) => str === "true",
    localFallbackModel: (str) => str,
    birthdaysEnabled: (str) => str === "true",
  };

export const defaultSettings: Settings = {
  maxMemory: 16,
  maxImageMemory: 3,
  maxMessageLength: 200,
  model: "qwen/qwen3.8-27b",
  local: false,
  localFallbackModel: "",
  birthdaysEnabled: false,
};

const SETTINGS_PATH = `${Deno.cwd()}/settings.json`;

export const loadSettings = (): Promise<Settings> =>
  readJson(SETTINGS_PATH, defaultSettings);

export const saveSettings = (settings: Settings): Promise<void> =>
  writeJson(SETTINGS_PATH, settings);

export const updateSetting = async <K extends keyof Settings>(
  settings: Settings,
  key: K,
  value: string,
): Promise<void> => {
  settings[key] = settingParsers[key](value);
  await saveSettings(settings);
};
