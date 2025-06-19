/**
 * Unit tests for AI Gateway configuration and provider selection
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadConfig, getProviderForModel } from './config.js';

describe('AI Gateway', () => {
  beforeAll(() => {
    // Set required environment variables for testing
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    
    loadConfig('config.yaml');
  });

  describe('Provider Selection', () => {
    it('should route mapped models to correct providers', () => {
      expect(getProviderForModel('gpt-4o-mini')).toBe('openai');
      expect(getProviderForModel('claude-3-sonnet')).toBe('anthropic');
    });

    it('should use default provider for unmapped models', () => {
      const provider = getProviderForModel('unknown-model');
      expect(['openai', 'anthropic']).toContain(provider);
    });
  });
});