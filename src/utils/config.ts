import chalk from 'chalk';
import { logger } from './logger';

// Default values for OpenAI configuration
const OPENAI_MODEL_DEFAULT = 'gpt-5.2';
const OPENAI_SERVICE_TIER_DEFAULT = 'Flex';

/**
 * Gets THREADLINE_API_KEY from environment.
 * 
 * Note: .env.local is automatically loaded at CLI startup (see index.ts).
 * In CI/CD, environment variables are injected directly into process.env.
 */
export function getThreadlineApiKey(): string | undefined {
  const apiKey = process.env.THREADLINE_API_KEY;
  
  if (apiKey) {
    logger.debug('THREADLINE_API_KEY: found (value hidden for security)');
  } else {
    logger.debug('THREADLINE_API_KEY: not set');
  }
  
  return apiKey;
}

/**
 * Gets THREADLINE_ACCOUNT from environment.
 * 
 * Note: .env.local is automatically loaded at CLI startup (see index.ts).
 * In CI/CD, environment variables are injected directly into process.env.
 */
export function getThreadlineAccount(): string | undefined {
  const account = process.env.THREADLINE_ACCOUNT;
  
  if (account) {
    logger.debug(`THREADLINE_ACCOUNT: ${account}`);
  } else {
    logger.debug('THREADLINE_ACCOUNT: not set');
  }
  
  return account;
}

/**
 * OpenAI configuration for direct LLM calls
 */
export interface OpenAIConfig {
  apiKey: string;
  model: string;
  serviceTier: string;
}

/**
 * Gets OpenAI configuration from environment variables.
 * 
 * Required:
 * - OPENAI_API_KEY: Your OpenAI API key
 * 
 * Optional (with defaults):
 * - OPENAI_MODEL: Model to use (default: gpt-5.2)
 * - OPENAI_SERVICE_TIER: Service tier (default: Flex)
 * 
 * Returns undefined if OPENAI_API_KEY is not set.
 * 
 * Note: .env.local is automatically loaded at CLI startup (see index.ts).
 * In CI/CD, environment variables are injected directly into process.env.
 */
export function getOpenAIConfig(): OpenAIConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.debug('OPENAI_API_KEY: not set (direct mode unavailable)');
    return undefined;
  }
  
  logger.debug('OPENAI_API_KEY: found (value hidden for security)');
  
  const model = process.env.OPENAI_MODEL || OPENAI_MODEL_DEFAULT;
  const serviceTier = process.env.OPENAI_SERVICE_TIER || OPENAI_SERVICE_TIER_DEFAULT;
  
  if (process.env.OPENAI_MODEL) {
    logger.debug(`OPENAI_MODEL: ${model} (from environment)`);
  } else {
    logger.debug(`OPENAI_MODEL: ${model} (using default)`);
  }
  
  if (process.env.OPENAI_SERVICE_TIER) {
    logger.debug(`OPENAI_SERVICE_TIER: ${serviceTier} (from environment)`);
  } else {
    logger.debug(`OPENAI_SERVICE_TIER: ${serviceTier} (using default)`);
  }
  
  return {
    apiKey,
    model,
    serviceTier
  };
}

/**
 * Logs the OpenAI configuration being used.
 * Call this when starting direct LLM mode to inform the user.
 */
export function logOpenAIConfig(config: OpenAIConfig): void {
  console.log(chalk.blue('OpenAI Direct Mode:'));
  console.log(chalk.gray(`  Model: ${config.model}${config.model === OPENAI_MODEL_DEFAULT ? ' (default)' : ''}`));
  console.log(chalk.gray(`  Service Tier: ${config.serviceTier}${config.serviceTier === OPENAI_SERVICE_TIER_DEFAULT ? ' (default)' : ''}`));
  console.log('');
}

/**
 * Checks if direct OpenAI mode is available (OPENAI_API_KEY is set).
 * 
 * Note: .env.local is automatically loaded at CLI startup (see index.ts).
 * In CI/CD, environment variables are injected directly into process.env.
 */
export function isDirectModeAvailable(): boolean {
  const available = !!process.env.OPENAI_API_KEY;
  
  if (available) {
    logger.debug('Direct OpenAI mode: available (OPENAI_API_KEY found)');
  } else {
    logger.debug('Direct OpenAI mode: unavailable (OPENAI_API_KEY not set)');
  }
  
  return available;
}

