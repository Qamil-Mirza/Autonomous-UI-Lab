import { describe, expect, it } from 'vitest';
import { bitdeerConfig } from '../src/bitdeer';
describe('Bitdeer worker configuration', () => {
  it('reads model, endpoint, timeout and key from the environment', () => {
    expect(bitdeerConfig({ BITDEER_API_KEY: 'test-key', BITDEER_MODEL: 'vision-model', BITDEER_BASE_URL: 'http://localhost:9000/v1/', BITDEER_TIMEOUT_MS: '12000' }))
      .toEqual({ apiKey: 'test-key', model: 'vision-model', baseUrl: 'http://localhost:9000/v1', timeoutMs: 12000 });
  });
  it('fails early for missing keys and invalid timeouts or endpoint credentials', () => {
    expect(() => bitdeerConfig({})).toThrow('BITDEER_API_KEY');
    for (const timeout of ['0', '-1', 'NaN', '1.5', '240001', ''])
      expect(() => bitdeerConfig({ BITDEER_API_KEY: 'test', BITDEER_TIMEOUT_MS: timeout })).toThrow('BITDEER_TIMEOUT_MS');
    expect(() => bitdeerConfig({ BITDEER_API_KEY: 'test', BITDEER_BASE_URL: 'https://user:password@example.com/v1' })).toThrow('BITDEER_BASE_URL');
  });
});
