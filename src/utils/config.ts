import chalk from 'chalk';
import { logger } from './logger';

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
 * Gets OpenAI configuration from environment variables and config file.
 * 
 * Required:
 * - OPENAI_API_KEY: Your OpenAI API key (from environment - secret)
 * - openai_model: Model name (from .threadlinerc - required)
 * - openai_service_tier: Service tier (from .threadlinerc - required)
 * 
 * Returns undefined if OPENAI_API_KEY is not set.
 * Throws an error if model or service tier are missing from .threadlinerc.
 * 
 * Note: .env.local is automatically loaded at CLI startup (see index.ts).
 * In CI/CD, environment variables are injected directly into process.env.
 * 
 * Configuration philosophy:
 * - Secrets (API keys) -> environment variables
 * - Config (model, service tier) -> .threadlinerc file (required, no fallbacks)
 */
export function getOpenAIConfig(config?: { openai_model?: string; openai_service_tier?: string }): OpenAIConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.debug('OPENAI_API_KEY: not set (direct mode unavailable)');
    return undefined;
  }
  
  logger.debug('OPENAI_API_KEY: found (value hidden for security)');
  
  // Require config values from .threadlinerc - no fallbacks
  if (!config?.openai_model) {
    throw new Error(
      'Missing required configuration: openai_model must be set in .threadlinerc file.\n' +
      'Add "openai_model": "gpt-5.2" (or your preferred model) to your .threadlinerc file.'
    );
  }
  
  if (!config?.openai_service_tier) {
    throw new Error(
      'Missing required configuration: openai_service_tier must be set in .threadlinerc file.\n' +
      'Add "openai_service_tier": "Flex" (or your preferred tier) to your .threadlinerc file.'
    );
  }
  
  logger.debug(`OPENAI_MODEL: ${config.openai_model} (from .threadlinerc)`);
  logger.debug(`OPENAI_SERVICE_TIER: ${config.openai_service_tier} (from .threadlinerc)`);
  
  return {
    apiKey,
    model: config.openai_model,
    serviceTier: config.openai_service_tier
  };
}

/**
 * Logs the OpenAI configuration being used.
 * Call this when starting direct LLM mode to inform the user.
 */
export function logOpenAIConfig(config: OpenAIConfig): void {
  logger.output(chalk.blue('OpenAI Direct Mode:'));
  logger.output(chalk.gray(`  Model: ${config.model}`));
  logger.output(chalk.gray(`  Service Tier: ${config.serviceTier}`));
  logger.output('');
}

/**
 * Bedrock configuration for direct LLM calls
 */
export interface BedrockConfig {
  accessKeyId: string;
  secretAccessKey: string;
  model: string;
  region: string;
}

/**
 * Gets Bedrock configuration from environment variables and config file.
 * 
 * Required:
 * - BEDROCK_ACCESS_KEY_ID: Your AWS access key ID (from environment - secret)
 * - BEDROCK_SECRET_ACCESS_KEY: Your AWS secret access key (from environment - secret)
 * - bedrock_model: Model name (from .threadlinerc - required)
 * - bedrock_region: AWS region (from .threadlinerc - required)
 * 
 * Returns undefined if BEDROCK_ACCESS_KEY_ID or BEDROCK_SECRET_ACCESS_KEY is not set.
 * Throws an error if model or region are missing from .threadlinerc.
 * 
 * Note: .env.local is automatically loaded at CLI startup (see index.ts).
 * In CI/CD, environment variables are injected directly into process.env.
 * 
 * Configuration philosophy:
 * - Secrets (access keys) -> environment variables
 * - Config (model, region) -> .threadlinerc file (required, no fallbacks)
 */
export function getBedrockConfig(config?: { bedrock_model?: string; bedrock_region?: string }): BedrockConfig | undefined {
  const accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
  
  if (!accessKeyId || !secretAccessKey) {
    logger.debug('BEDROCK_ACCESS_KEY_ID or BEDROCK_SECRET_ACCESS_KEY: not set (Bedrock mode unavailable)');
    return undefined;
  }
  
  logger.debug('BEDROCK_ACCESS_KEY_ID: found (value hidden for security)');
  logger.debug('BEDROCK_SECRET_ACCESS_KEY: found (value hidden for security)');
  
  // Require config values from .threadlinerc - no fallbacks
  if (!config?.bedrock_model) {
    throw new Error(
      'Missing required configuration: bedrock_model must be set in .threadlinerc file.\n' +
      'Add "bedrock_model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0" (or your preferred model) to your .threadlinerc file.'
    );
  }
  
  if (!config?.bedrock_region) {
    throw new Error(
      'Missing required configuration: bedrock_region must be set in .threadlinerc file.\n' +
      'Add "bedrock_region": "us-east-1" (or your preferred AWS region) to your .threadlinerc file.'
    );
  }
  
  logger.debug(`BEDROCK_MODEL: ${config.bedrock_model} (from .threadlinerc)`);
  logger.debug(`BEDROCK_REGION: ${config.bedrock_region} (from .threadlinerc)`);
  
  return {
    accessKeyId,
    secretAccessKey,
    model: config.bedrock_model,
    region: config.bedrock_region
  };
}

/**
 * Logs the Bedrock configuration being used.
 * Call this when starting Bedrock mode to inform the user.
 */
export function logBedrockConfig(config: BedrockConfig): void {
  logger.output(chalk.blue('Amazon Bedrock Direct Mode:'));
  logger.output(chalk.gray(`  Model: ${config.model}`));
  logger.output(chalk.gray(`  Region: ${config.region}`));
  logger.output('');
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

