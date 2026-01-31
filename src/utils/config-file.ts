import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ThreadlineConfig {
  /**
   * Mode controls whether results are synced to the web app.
   * - "online": Sync results to web app for analytics and collaboration (requires THREADLINE_API_KEY and THREADLINE_ACCOUNT)
   * - "offline": Local-only processing, no sync to web app
   */
  mode: 'online' | 'offline';
  api_url: string;
  openai_model: string;
  openai_service_tier: string;
  diff_context_lines: number;
}

export const DEFAULT_CONFIG: ThreadlineConfig = {
  mode: 'online', // Default: sync enabled. Set to "offline" for local-only processing.
  api_url: 'https://devthreadline.com',
  openai_model: 'gpt-5.2',
  openai_service_tier: 'Flex',
  diff_context_lines: 10,
};

/**
 * Finds the git root directory by walking up from startDir.
 * Fails loudly if not in a git repository (this tool requires a git repo).
 */
async function findGitRoot(startDir: string): Promise<string> {
  try {
    // Check if we're in a git repo
    execSync('git rev-parse --git-dir', { cwd: startDir, stdio: 'ignore' });
    // Get git root
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      cwd: startDir
    }).trim();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Not a git repository. Threadline requires a git repository.\n` +
      `Current directory: ${startDir}\n` +
      `Error: ${errorMessage}`
    );
  }
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
    let configContent = fs.readFileSync(configPath, 'utf-8');
    
    // Strip single-line comments (// ...) before parsing JSON
    // This allows comments in .threadlinerc for documentation
    // Only match comments at the start of a line (after whitespace) to avoid matching // inside strings
    // Also remove empty lines left after comment removal
    configContent = configContent
      .replace(/^\s*\/\/.*$/gm, '') // Remove comments (only at start of line after whitespace)
      .replace(/^\s*[\r\n]/gm, ''); // Remove empty lines
    
    try {
      const fileConfig = JSON.parse(configContent);
      
      // Merge file config into defaults (file overrides defaults)
      Object.assign(config, fileConfig);
    } catch (error) {
      // If file exists but can't be parsed, fail loudly - this is a user error that needs fixing
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to parse .threadlinerc at ${configPath}: ${errorMessage}\n` +
        `Please fix the syntax error in your .threadlinerc file.`
      );
    }
  }

  return config;
}
