import { ControlRegistry, GoalCheckResult, type PrototypeGoalAdapter } from '@ghostloop/contracts';
import type { RunOptions } from './run';

export function prototypeUrl(baseUrl: string, versionId: string, runId: string) {
  const url = new URL(`/v/${encodeURIComponent(versionId)}/signup`, baseUrl);
  url.searchParams.set('run', runId);
  return url.href;
}
export async function loadRegistry(baseUrl: string, versionId: string, signal: AbortSignal) {
  const response = await fetch(new URL(`/designs/versions/${encodeURIComponent(versionId)}.json`, baseUrl),
    { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
  if (!response.ok) throw new Error(`Control registry HTTP ${response.status}`);
  const raw = await response.json() as { versionId?: unknown; elements?: unknown[] };
  // C's wire format may call its ID `id`; the shared public format uses elementId.
  const elements = raw.elements?.map(entry => {
    const e = entry as Record<string, unknown>;
    return { elementId: e.elementId ?? e.id, screen: e.screen, role: e.role, label: e.label ?? '' };
  });
  const registry = ControlRegistry.parse({ versionId: raw.versionId, elements });
  if (registry.versionId !== versionId) throw new Error('Registry version mismatch');
  if (new Set(registry.elements.map(e => e.elementId)).size !== registry.elements.length) throw new Error('Duplicate registry IDs');
  return registry;
}
export function prototypeIntegration(baseUrl: string, versionId: string, adapter: PrototypeGoalAdapter): NonNullable<RunOptions['prototype']> {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Prototype URL must use HTTP(S)');
  async function call(runId: string, suffix: string, method: string, signal?: AbortSignal) {
    const response = await fetch(new URL(`/api/runs/${encodeURIComponent(runId)}${suffix}`, base), {
      method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Run ${method} HTTP ${response.status}`);
    return response;
  }
  return {
    versionId,
    url: runId => prototypeUrl(baseUrl, versionId, runId),
    initialize: async (runId, signal) => {
      await call(runId, '/init', 'POST', signal);
      return (await loadRegistry(baseUrl, versionId, signal)).elements;
    },
    checkGoal: async runId => {
      const result = GoalCheckResult.parse(await adapter.checkGoal(runId));
      if (result.runId !== runId) throw new Error('Goal checker returned another run ID');
      return result;
    },
    cleanup: async runId => { await call(runId, '', 'DELETE'); },
    allowRequest: (requestUrl, navigation, runId) => {
      const u = new URL(requestUrl);
      if (u.origin !== base.origin) return false;
      if (navigation) return u.pathname.startsWith(`/v/${versionId}/`) && ['signup', 'workspace', 'plan', 'invite', 'confirm'].includes(u.pathname.split('/').at(-1) ?? '') && u.searchParams.get('run') === runId;
      if (u.pathname.startsWith('/api/runs/')) return u.pathname === `/api/runs/${runId}` || u.pathname.startsWith(`/api/runs/${runId}/`);
      // Local JS/CSS/assets and versioned manifests are needed by the Vite app.
      return !u.pathname.startsWith('/api/');
    },
  };
}
