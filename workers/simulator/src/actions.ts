import { z } from 'zod';
import type { Control } from '@ghostloop/contracts';

export type ObservedControl = Control & {
  allowedActions: ('click' | 'type' | 'select')[];
  options?: string[];
  bounds: { x: number; y: number; width: number; height: number };
};
const reason = z.string().max(500).optional();
export const Decision = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), elementId: z.string(), reason }).strict(),
  z.object({ type: z.literal('type'), elementId: z.string(), value: z.string().max(2000), reason }).strict(),
  z.object({ type: z.literal('select'), elementId: z.string(), value: z.string(), reason }).strict(),
  z.object({ type: z.literal('stop'), reason }).strict(),
]);
export type Decision = z.infer<typeof Decision>;
export function validateDecision(raw: unknown, controls: ObservedControl[]): Decision {
  const action = Decision.parse(raw);
  if (action.type === 'stop') return action;
  const control = controls.find(c => c.elementId === action.elementId);
  if (!control?.enabled || !control.allowedActions.includes(action.type)) throw new Error('Unknown, disabled, or incompatible target');
  if (action.type === 'select' && !control.options?.includes(action.value)) throw new Error('Unknown select option');
  return action;
}
