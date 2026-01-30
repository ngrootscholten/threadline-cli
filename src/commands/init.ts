import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger';

const TEMPLATE = `---
id: example-threadline
version: 1.0.0
patterns:
  - "**/*.ts"
  - "**/*.tsx"
context_files: []
---

# Example Threadline

Describe your coding standard or convention here.

This threadline will check all TypeScript files (\`**/*.ts\` and \`**/*.tsx\`) against the guidelines you define below.

## Guidelines

- Add your first guideline here
- Add your second guideline here
- Add examples or patterns to follow

## Examples

\`\`\`typescript
// Good example
\`\`\`

\`\`\`typescript
// Bad example - avoid this
\`\`\`
`;

export async function initCommand() {
  const repoRoot = process.cwd();
  const threadlinesDir = path.join(repoRoot, 'threadlines');
  const exampleFile = path.join(threadlinesDir, 'example.md');
  const configFile = path.join(repoRoot, '.threadlinerc');

  try {
    // Create threadlines directory if it doesn't exist
    if (!fs.existsSync(threadlinesDir)) {
      fs.mkdirSync(threadlinesDir, { recursive: true });
      logger.output(chalk.green(`✓ Created /threadlines directory`));
    }

    // Create .threadlinerc if it doesn't exist
    if (!fs.existsSync(configFile)) {
      // Generate config with comment explaining mode
      const configContent = `{
  // mode: "online" syncs results to web app (requires THREADLINE_API_KEY and THREADLINE_ACCOUNT)
  // mode: "offline" processes locally only, no sync
  "mode": "online",
  "api_url": "https://devthreadline.com",
  "openai_model": "gpt-5.2",
  "openai_service_tier": "Flex",
  "diff_context_lines": 10
}`;
      fs.writeFileSync(configFile, configContent, 'utf-8');
      logger.output(chalk.green(`✓ Created .threadlinerc`));
    }

    // Check if example file already exists
    if (fs.existsSync(exampleFile)) {
      logger.warn(`${exampleFile} already exists`);
      logger.output(chalk.gray('   Edit it to create your threadline, or delete it and run init again.'));
      return;
    }

    // Write template file
    fs.writeFileSync(exampleFile, TEMPLATE, 'utf-8');
    
    logger.output(chalk.green(`✓ Created ${exampleFile}`));
    logger.output('');
    logger.output(chalk.blue('Next steps:'));
    logger.output(chalk.gray('  1. Edit threadlines/example.md with your coding standards'));
    logger.output(chalk.gray('  2. Rename it to something descriptive (e.g., error-handling.md)'));
    logger.output('');
    logger.output(chalk.yellow('⚠️  IMPORTANT: Configuration Required'));
    logger.output(chalk.white('   To use threadlines check, you need:'));
    logger.output('');
    logger.output(chalk.white('   Create a .env.local file in your project root with:'));
    logger.output(chalk.gray('     OPENAI_API_KEY=your-openai-api-key'));
    logger.output(chalk.gray('     THREADLINE_API_KEY=your-api-key-here'));
    logger.output(chalk.gray('     THREADLINE_ACCOUNT=your-email@example.com'));
    logger.output('');
    logger.output(chalk.white('   Make sure .env.local is in your .gitignore file!'));
    logger.output('');
    logger.output(chalk.gray('  3. Run: npx threadlines check'));
    logger.output(chalk.gray('     (Use npx --yes threadlines check in non-interactive environments)'));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(errorMessage);
    process.exit(1);
  }
}

