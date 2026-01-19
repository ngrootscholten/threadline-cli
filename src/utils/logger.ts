import chalk from 'chalk';

/**
 * Global debug flag - set when --debug is passed to CLI
 */
let debugEnabled = false;

/**
 * Enable debug logging (called when --debug flag is set)
 */
export function enableDebug(): void {
  debugEnabled = true;
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Logger utility for CLI output
 * 
 * - debug/info: Only shown when --debug flag is set
 * - warn/error: Always shown (critical information)
 */
export const logger = {
  /**
   * Debug-level log (technical details, internal state)
   * Only shown with --debug flag
   */
  debug: (message: string): void => {
    if (debugEnabled) {
      console.log(chalk.gray(`[DEBUG] ${message}`));
    }
  },

  /**
   * Info-level log (what's happening, progress updates)
   * Only shown with --debug flag
   */
  info: (message: string): void => {
    if (debugEnabled) {
      console.log(chalk.blue(`[INFO] ${message}`));
    }
  },

  /**
   * Warning (non-fatal issues, recommendations)
   * Always shown
   */
  warn: (message: string): void => {
    console.log(chalk.yellow(`⚠️  ${message}`));
  },

  /**
   * Error (failures, problems)
   * Always shown
   */
  error: (message: string): void => {
    console.error(chalk.red(`❌ ${message}`));
  }
};
