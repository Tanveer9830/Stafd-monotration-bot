export class RateLimiterService {
  private readonly windows = new Map<string, number[]>();

  public checkAndConsume(actorKey: string, maxActionsPerMinute = 30, nowMs = Date.now()): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const windowStart = nowMs - 60_000;
    const timestamps = (this.windows.get(actorKey) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= maxActionsPerMinute) {
      this.windows.set(actorKey, timestamps);
      const oldest = timestamps[0] ?? nowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60_000 - nowMs) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    timestamps.push(nowMs);
    this.windows.set(actorKey, timestamps);
    return {
      allowed: true,
      remaining: Math.max(0, maxActionsPerMinute - timestamps.length),
      retryAfterSeconds: 0,
    };
  }
}
