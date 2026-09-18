import type { UniversalNextcloudBot } from "@gradylink/unb";
import { readJson, writeJson } from "./env.ts";

interface BirthdayCacheEntry {
  /** "MM-DD", or null if the account has no birthdate set. */
  monthDay: string | null;
  lastAnnouncedYear?: number;
}

type BirthdayCache = Record<string, BirthdayCacheEntry>;

const CACHE_PATH = `${Deno.cwd()}/birthdays.json`;

const loadCache = (): Promise<BirthdayCache> => readJson(CACHE_PATH, {});
const saveCache = (cache: BirthdayCache): Promise<void> =>
  writeJson(CACHE_PATH, cache);

const pad = (n: number): string => String(n).padStart(2, "0");

const toMonthDay = (date: Date): string =>
  `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseBirthdate = (birthdate: string): string | null => {
  const date = new Date(birthdate);
  return Number.isNaN(date.getTime()) ? null : toMonthDay(date);
};

const getRoster = async (
  unb: UniversalNextcloudBot,
  tokens: string[],
  botUsername: string,
): Promise<Set<string>> => {
  const roster = new Set<string>();
  for (const token of tokens) {
    try {
      const participants = await unb.talk.getParticipants(token);
      for (const p of participants) {
        if (p.actorType === "users" && p.actorId !== botUsername) {
          roster.add(p.actorId);
        }
      }
    } catch (e) {
      console.warn(`Couldn't fetch participants for room ${token}: ${e}`);
    }
  }
  return roster;
};

export const findTodaysBirthdays = async (
  unb: UniversalNextcloudBot,
  tokens: string[],
  botUsername: string,
): Promise<string[]> => {
  const cache = await loadCache();
  const roster = await getRoster(unb, tokens, botUsername);

  let dirty = false;
  for (const userId of roster) {
    if (userId in cache) continue;
    try {
      const account = await unb.profile.getAccount(userId);
      cache[userId] = {
        monthDay: account.birthdate ? parseBirthdate(account.birthdate) : null,
      };
      dirty = true;
    } catch (e) {
      console.warn(`Couldn't fetch account details for ${userId}: ${e}`);
    }
  }
  if (dirty) await saveCache(cache);

  const todayMonthDay = toMonthDay(new Date());
  const currentYear = new Date().getFullYear();

  return Object.entries(cache)
    .filter(([, entry]) =>
      entry.monthDay === todayMonthDay &&
      entry.lastAnnouncedYear !== currentYear
    )
    .map(([userId]) => userId);
};

export const markBirthdayAnnounced = async (userId: string): Promise<void> => {
  const cache = await loadCache();
  const entry = cache[userId];
  if (!entry) return;
  entry.lastAnnouncedYear = new Date().getFullYear();
  await saveCache(cache);
};
