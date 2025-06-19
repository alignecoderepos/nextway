/**
 * Configuration loader and validator for AI Gateway
 * Loads YAML config and validates with Zod schemas
 */

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';

// Zod schemas for configuration validation
const ProviderConfigSchema = z.object({
  api_key_env: z.string(),
  endpoint: z.string().url(),
});

const ConfigSchema = z.object({
  default_provider: z.enum(['openai', 'anthropic']),
  timeout_ms: z.number().positive().default(30000),
  providers: z.object({
    openai: ProviderConfigSchema,
    anthropic: ProviderConfigSchema,
  }),
  model_mappings: z.record(z.string(), z.enum(['openai', 'anthropic'])),
  rate_limits: z.object({
    per_minute: z.number().positive().default(60),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderName = 'openai' | 'anthropic';

let config: Config;

export function loadConfig(configPath = 'config.yaml'): Config {
  try {
    const configFile = readFileSync(configPath, 'utf8');
    const rawConfig = parse(configFile);
    
    config = ConfigSchema.parse(rawConfig);
    
    // Validate API keys are present in environment
    for (const [providerName, providerConfig] of Object.entries(config.providers)) {
      const apiKey = process.env[providerConfig.api_key_env];
      if (!apiKey) {
        console.error(`Missing API key: ${providerConfig.api_key_env} for provider ${providerName}`);
        process.exit(1);
      }
    }
    
    console.log(`Configuration loaded successfully from ${configPath}`);
    return config;
  } catch (error) {
    console.error('Failed to load configuration:', error);
    process.exit(1);
  }
}

export function getConfig(): Config {
  if (!config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return config;
}

export function getProviderForModel(model: string): ProviderName {
  const config = getConfig();
  return config.model_mappings[model] || config.default_provider;
}