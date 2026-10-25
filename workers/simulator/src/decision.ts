import { setTimeout as delay } from 'node:timers/promises';
import type { PublicAgentInput } from '@ghostloop/contracts';
import { ActionValidationError, validateDecision, type ObservedControl } from './actions';
import type { Decider } from './bitdeer';

/** Only explicitly transient transport failures and malformed answers are retried. */
export class ModelResponseError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); }
}
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
  onAttempt?: (attempt: DecisionAttempt) => Promise<void>;
}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
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
      action = validateDecision(raw, options.controls, options.allowNavigation);
    } catch (error) {
      options.signal.throwIfAborted();
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
