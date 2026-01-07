import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

/**
 * Loads environment variables from .env.local file in the project root
 * (where the user runs the command, not the CLI package directory)
 */
function loadEnvLocal(): void {
  const projectRoot = process.cwd();
  const envLocalPath = path.join(projectRoot, '.env.local');
  
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  }
}

/**
 * Gets THREADLINE_API_KEY from environment.
 * Priority: process.env.THREADLINE_API_KEY → .env.local file
 */
export function getThreadlineApiKey(): string | undefined {
  // Load .env.local if it exists (doesn't override existing env vars)
  loadEnvLocal();
  
  // Check environment variable (from shell or CI/CD)
  return process.env.THREADLINE_API_KEY;
}

/**
 * Gets THREADLINE_ACCOUNT from environment.
 * Priority: process.env.THREADLINE_ACCOUNT → .env.local file
 */
export function getThreadlineAccount(): string | undefined {
  // Load .env.local if it exists (doesn't override existing env vars)
  loadEnvLocal();
  
  // Check environment variable (from shell or CI/CD)
  return process.env.THREADLINE_ACCOUNT;
}

