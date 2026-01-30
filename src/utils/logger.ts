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
 * - debug: Only shown when --debug flag is set (technical details)
 * - info: Always shown (important status messages)
 * - output: Always shown (formatted output, no prefix)
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
   * Info-level log (important status messages, progress updates)
   * Always shown (important information users need to see)
   */
  info: (message: string): void => {
    console.log(chalk.blue(`[INFO] ${message}`));
  },

  /**
   * Output formatted text (for structured output like results display)
   * Always shown, no prefix (for custom formatting)
   */
  output: (message: string): void => {
    console.log(message);
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
