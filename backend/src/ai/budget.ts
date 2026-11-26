import type { Redis } from 'ioredis';

/**
 * Free-tier budget for Gemini, counted in requests and shared by every API instance (Redis).
 * Three limits: per day for the whole app, per day per user, and per minute. Days follow
 * Pacific time because that is when Google resets the free-tier daily quota.
 */
export interface BudgetLimits {
  daily: number;
  userDaily: number;
  perMinute: number;
}

export interface Usage {
  used_today: number;
  limit_today: number;
  user_used_today: number;
  user_limit_today: number;
}

export class BudgetError extends Error {
  constructor(
    readonly kind: 'daily' | 'user' | 'minute',
    /** Seconds until a request may succeed. */
    readonly retryAfter: number,
    message: string,
  ) {
    super(message);
  }
}

/** YYYY-MM-DD in Pacific time. */
export const pacificDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Seconds until the next Pacific midnight (approximate across DST changes, never below 60). */
function secondsToPacificMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.max(60, 86_400 - (get('hour') * 3600 + get('minute') * 60 + get('second')));
}

export class AiBudget {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly limits: BudgetLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private keys(userId: string) {
    const now = this.now();
    const day = pacificDay(now);
    return {
      day: `${this.prefix}:ai:day:${day}`,
      user: `${this.prefix}:ai:day:${day}:u:${userId}`,
      minute: `${this.prefix}:ai:min:${Math.floor(now.getTime() / 60_000)}`,
    };
  }

  async usage(userId: string): Promise<Usage> {
    const k = this.keys(userId);
    const [day, user] = await this.redis.mget(k.day, k.user);
    return {
      used_today: Number(day ?? 0),
      limit_today: this.limits.daily,
      user_used_today: Number(user ?? 0),
      user_limit_today: this.limits.userDaily,
    };
  }

  /** Reserves one request, or throws BudgetError (nothing is reserved then). */
  async take(userId: string): Promise<void> {
    const k = this.keys(userId);
    const res = await this.redis
      .multi()
      .incr(k.day)
      .expire(k.day, 2 * 86_400)
      .incr(k.user)
      .expire(k.user, 2 * 86_400)
      .incr(k.minute)
      .expire(k.minute, 120)
      .exec();
    const count = (i: number) => Number(res?.[i]?.[1] ?? 0);
    const [day, user, minute] = [count(0), count(2), count(4)];
    let err: BudgetError | null = null;
    if (day > this.limits.daily) {
      err = new BudgetError('daily', secondsToPacificMidnight(this.now()), 'The AI has used its daily free quota. It resets at midnight Pacific time.');
    } else if (user > this.limits.userDaily) {
      err = new BudgetError('user', secondsToPacificMidnight(this.now()), `You have used your ${this.limits.userDaily} AI requests for today.`);
    } else if (minute > this.limits.perMinute) {
      err = new BudgetError('minute', 60 - this.now().getUTCSeconds(), 'The AI is busy. Try again in a minute.');
    }
    if (err) {
      await this.redis.multi().decr(k.day).decr(k.user).decr(k.minute).exec();
      throw err;
    }
  }
}
