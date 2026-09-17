import { readJson, writeJson } from "./env.ts";

export interface ModInfo {
  type: "mod" | "admin";
  id: string;
}

export type Mods = Record<string, ModInfo>;

const MODS_PATH = `${Deno.cwd()}/mods.json`;

export const loadMods = (): Promise<Mods> => readJson(MODS_PATH, {});

export const saveMods = (mods: Mods): Promise<void> =>
  writeJson(MODS_PATH, mods);

export const isMod = (mods: Mods, userId: string): boolean => userId in mods;

export const isAdmin = (mods: Mods, userId: string): boolean =>
  mods[userId]?.type === "admin";
