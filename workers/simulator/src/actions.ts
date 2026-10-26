import { z } from 'zod';
import type { Control } from '@ghostloop/contracts';

export type ObservedControl = Control & {
  allowedActions: ('click' | 'type' | 'select')[];
  tagName?: string;
  inputType?: string;
  value?: string;
  checked?: boolean;
  options?: string[];
  maxLength?: number;
  navigationUrl?: string;
  opensNewContext?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
};
export class ActionValidationError extends Error {}
const elementId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.-]+$/);
const reason = z.string().max(500).optional();
export const Decision = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), elementId, reason }).strict(),
  z.object({ type: z.literal('type'), elementId, value: z.string().max(2000), reason }).strict(),
  z.object({ type: z.literal('select'), elementId, value: z.string().max(2000), reason }).strict(),
  z.object({ type: z.literal('scroll'), value: z.enum(['up', 'down']), reason }).strict(),
  z.object({ type: z.literal('stop'), reason }).strict(),
]);
export type Decision = z.infer<typeof Decision>;
export function validateDecision(raw: unknown, controls: ObservedControl[], allowNavigation?: (url: string) => boolean): Decision {
  const parsed = Decision.safeParse(raw);
  if (!parsed.success) throw new ActionValidationError('Invalid action shape: use only click, type, select, scroll (value "up" or "down"), or stop with the required fields');
  const action = parsed.data;
  if (action.type === 'stop' || action.type === 'scroll') return action;
  const matches = controls.filter(c => c.elementId === action.elementId);
  if (matches.length !== 1) throw new ActionValidationError('Target must identify exactly one observed control');
  const control = matches[0];
  if (!control?.enabled || !control.allowedActions.includes(action.type)) throw new ActionValidationError('Unknown, disabled, or incompatible target');
  if (action.type === 'select' && !control.options?.includes(action.value)) throw new ActionValidationError('Unknown select option');
  if (action.type === 'type') {
    if (control.maxLength !== undefined && action.value.length > control.maxLength)
      throw new ActionValidationError('Value exceeds observed maximum length');
    if (control.inputType === 'number' && action.value !== '' &&
        (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(action.value) || !Number.isFinite(Number(action.value))))
      throw new ActionValidationError('Number input requires a finite numeric value or empty text');
  }
  if (action.type === 'click') {
    if (control.opensNewContext) throw new ActionValidationError('New windows and downloads are unsupported');
    if (control.navigationUrl && (!/^https?:/.test(control.navigationUrl) || !allowNavigation?.(control.navigationUrl)))
      throw new ActionValidationError('Navigation outside the configured prototype is forbidden');
  }
  return action;
}
