export interface RateLimitSnapshot {
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetRequests?: string;
  resetTokens?: string;
  observedAt: number;
}

let lastSnapshot: RateLimitSnapshot | undefined;

const toNumber = (value: string | null): number | undefined =>
  value === null ? undefined : Number(value);

export const recordRateLimit = (headers: Headers): void => {
  lastSnapshot = {
    limitRequests: toNumber(headers.get("x-ratelimit-limit-requests")),
    remainingRequests: toNumber(headers.get("x-ratelimit-remaining-requests")),
    limitTokens: toNumber(headers.get("x-ratelimit-limit-tokens")),
    remainingTokens: toNumber(headers.get("x-ratelimit-remaining-tokens")),
    resetRequests: headers.get("x-ratelimit-reset-requests") ?? undefined,
    resetTokens: headers.get("x-ratelimit-reset-tokens") ?? undefined,
    observedAt: Date.now(),
  };
};

export const getLastRateLimit = (): RateLimitSnapshot | undefined =>
  lastSnapshot;

let localFallbackActive = false;

export const setLocalFallbackActive = (active: boolean): void => {
  localFallbackActive = active;
};

export const isLocalFallbackActive = (): boolean => localFallbackActive;
