import { setTimeout as delay } from 'node:timers/promises';
import type { PublicAgentInput } from '@ghostloop/contracts';
import { ActionValidationError, validateDecision, type ObservedControl } from './actions';
import type { Decider } from './bitdeer';

/** Only explicitly transient transport failures and malformed answers are retried. */
export class ModelResponseError extends Error {
  constructor(message: string, public readonly retryable: boolean,
    public readonly rate?: { limited: true; retryAfterMs?: number }) { super(message); }
}
/** Longest single wait for a rate-limited provider, whatever Retry-After asks for. */
export const MAX_RATE_LIMIT_WAIT_MS = 30_000;
export interface DecisionAttempt {
  attempt: number;
  status: 'accepted' | 'rejected';
  feedback?: string;
  retry: boolean;
}
export async function requestDecision(options: {
  decide: Decider; input: PublicAgentInput; controls: ObservedControl[]; signal: AbortSignal;
  allowNavigation?: (url: string) => boolean;
  maxAttempts?: number; retryDelayMs?: number;
  /** Rate-limit (HTTP 429) waits allowed per decision; they do not use up attempts. */
  maxRateLimitWaits?: number; rateLimitDelayMs?: number;
  /** Judged trials need a reason on every action, so the judge can weigh what the user meant to do. */
  requireReason?: boolean;
  onAttempt?: (attempt: DecisionAttempt) => Promise<void>;
}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const maxRateLimitWaits = options.maxRateLimitWaits ?? 4;
  const rateLimitDelayMs = options.rateLimitDelayMs ?? 2000;
  if (!Number.isInteger(maxRateLimitWaits) || maxRateLimitWaits < 0 || maxRateLimitWaits > 8 ||
      !Number.isInteger(rateLimitDelayMs) || rateLimitDelayMs < 0 || rateLimitDelayMs > MAX_RATE_LIMIT_WAIT_MS)
    throw new Error('Rate-limit waits must be 0–8 and the delay 0–30000ms');
  let rateLimitWaits = 0;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1000)
    throw new Error('Decision retry limits must be 1–3 attempts and 0–1000ms initial delay');
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.signal.throwIfAborted();
    let action;
    try {
      const raw = await options.decide(options.input, options.controls, options.signal, feedback);
      options.signal.throwIfAborted();
      action = validateDecision(raw, options.controls, options.allowNavigation, { requireReason: options.requireReason });
    } catch (error) {
      options.signal.throwIfAborted();
      // A rate limit is the provider asking us to slow down, not a bad answer: wait (honoring Retry-After) and ask
      // again without spending one of the decision's attempts.
      if (error instanceof ModelResponseError && error.rate && rateLimitWaits < maxRateLimitWaits) {
        const wait = Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(error.rate.retryAfterMs ?? 0, rateLimitDelayMs * 2 ** rateLimitWaits));
        rateLimitWaits++;
        await options.onAttempt?.({ attempt, status: 'rejected', feedback: `${error.message}; waiting ${wait}ms`, retry: true });
        await delay(wait, undefined, { signal: options.signal });
        attempt--;
        continue;
      }
      const retryable = error instanceof ActionValidationError || error instanceof ModelResponseError && error.retryable;
      feedback = error instanceof ActionValidationError || error instanceof ModelResponseError ? error.message : 'Model request failed';
      const retry = retryable && attempt < maxAttempts;
      await options.onAttempt?.({ attempt, status: 'rejected', feedback, retry });
      if (!retry) throw error;
      await delay(retryDelayMs * 2 ** (attempt - 1), undefined, { signal: options.signal });
      continue;
    }
    await options.onAttempt?.({ attempt, status: 'accepted', retry: false });
    return action;
  }
  throw new Error('Decision attempts exhausted');
}
