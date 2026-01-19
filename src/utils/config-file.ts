import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';

export interface ThreadlineConfig {
  mode: 'online' | 'offline';
  api_url: string;
  openai_model: string;
  openai_service_tier: string;
  diff_context_lines: number;
}

export const DEFAULT_CONFIG: ThreadlineConfig = {
  mode: 'online',
  api_url: 'https://devthreadline.com',
  openai_model: 'gpt-5.2',
  openai_service_tier: 'flex',
  diff_context_lines: 10,
};

/**
 * Finds the git root directory by walking up from startDir.
 * Returns startDir if not in a git repository.
 */
async function findGitRoot(startDir: string): Promise<string> {
  try {
    const git = simpleGit(startDir);
    const isRepo = await git.checkIsRepo();
    if (isRepo) {
      return (await git.revparse(['--show-toplevel'])).trim();
    }
  } catch {
    // Not a git repo or error - return startDir
  }
  return startDir;
}

/**
 * Loads configuration from .threadlinerc file.
 * 
 * Priority:
 * 1. Built-in defaults
 * 2. .threadlinerc file (if exists) - merged with defaults
 * 
 * Searches for .threadlinerc starting from startDir, walking up to git root.
 * If no file found, returns defaults.
 */
export async function loadConfig(startDir: string): Promise<ThreadlineConfig> {
  // Start with defaults
  const config: ThreadlineConfig = { ...DEFAULT_CONFIG };

  // Find git root to limit search scope
  const gitRoot = await findGitRoot(startDir);
  
  // Look for .threadlinerc starting from startDir, up to git root
  let currentDir = startDir;
  let configPath: string | null = null;

  while (true) {
    const candidatePath = path.join(currentDir, '.threadlinerc');
    if (fs.existsSync(candidatePath)) {
      configPath = candidatePath;
      break;
    }

    // Stop at git root
    if (path.resolve(currentDir) === path.resolve(gitRoot)) {
      break;
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  // If config file found, parse and merge
  if (configPath) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(configContent);
      
      // Merge file config into defaults (file overrides defaults)
      Object.assign(config, fileConfig);
    } catch (error) {
      // If file exists but can't be parsed, log warning but continue with defaults
      console.warn(`Warning: Failed to parse .threadlinerc at ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return config;
}

/**
 * Synchronous version of loadConfig for cases where async isn't available.
 * Uses a simpler search strategy (current dir only).
 */
export function loadConfigSync(startDir: string): ThreadlineConfig {
  const config: ThreadlineConfig = { ...DEFAULT_CONFIG };

  const configPath = path.join(startDir, '.threadlinerc');
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(configContent);
      Object.assign(config, fileConfig);
    } catch (error) {
      // Silently fail - use defaults
    }
  }

  return config;
}
