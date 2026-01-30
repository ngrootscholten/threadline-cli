---
id: use-logger-utility
version: 1.0.0
patterns:
  - "**/*.ts"
  - "**/*.tsx"
context_files:
  - "src/utils/logger.ts"
---

# Use Logger Utility for All Output

Use the centralized logger utility (`src/utils/logger.ts`) for all output. It provides consistent formatting and clear separation between debug and always-visible information.

## Guidelines

1. **Use logger utility for all output** - Don't use `console.log()`, `console.error()`, `console.warn()`, or `console.info()` directly.

2. **Exception: Logger implementation** - The logger utility itself (`src/utils/logger.ts`) can use `console` directly since it's the implementation.

3. **Log levels**:
   - `logger.debug()` - Technical details, internal state (only with `--debug` flag)
   - `logger.info()` - Important status messages, progress updates (always shown)
   - `logger.output()` - Formatted output, structured display (always shown, no prefix)
   - `logger.warn()` - Non-fatal issues, recommendations (always shown)
   - `logger.error()` - Failures, problems (always shown)

## Examples

```typescript
// ❌ Bad - Direct console calls
function loadConfig(configPath: string): Config {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    console.warn(`Warning: Failed to parse config: ${error.message}`);
    return DEFAULT_CONFIG;
  }
}

// ✅ Good - Use logger utility
function loadConfig(configPath: string): Config {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    logger.warn(`Failed to parse config: ${error.message}`);
    return DEFAULT_CONFIG;
  }
}

// ✅ Good - logger.info() for important status (always visible)
logger.info('Finding threadlines...');
logger.info(`✓ Found ${threadlines.length} threadline(s)`);

// ✅ Good - logger.output() for formatted display (always visible, no prefix)
function displayResults(results: ExpertResult[]) {
  logger.output(chalk.green(`✓ Found ${results.length} result(s)`));
  for (const result of results) {
    logger.output(chalk.yellow(`[attention] ${result.expertId}`));
  }
}

// ✅ Good - logger.output() for error help messages (always visible)
if (!openAIConfig) {
  logger.error('Missing required environment variable: OPENAI_API_KEY');
  logger.output('');
  logger.output(chalk.yellow('To fix this:'));
  logger.output(chalk.gray('  1. Create a .env.local file'));
  logger.output(chalk.gray('  2. Add: OPENAI_API_KEY=your-key'));
  process.exit(1);
}

// ✅ Good - logger.debug() for technical details (only with --debug)
logger.debug(`Processing threadline ${threadline.id} with ${files.length} files`);
```
