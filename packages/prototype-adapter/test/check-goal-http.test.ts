import { afterEach, expect, it, vi } from 'vitest';
import { checkGoal, emptyRunState } from '../src';

afterEach(() => vi.unstubAllGlobals());

it('rejects HTTP state belonging to a different run', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(emptyRunState('run_other')));
  vi.stubGlobal('fetch', fetchMock);
  await expect(checkGoal('run_requested', { baseUrl: 'http://localhost:5173' })).rejects.toThrow('another run');
  expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
});
