import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

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

  try {
    // Create threadlines directory if it doesn't exist
    if (!fs.existsSync(threadlinesDir)) {
      fs.mkdirSync(threadlinesDir, { recursive: true });
      console.log(chalk.green(`✓ Created /threadlines directory`));
    }

    // Check if example file already exists
    if (fs.existsSync(exampleFile)) {
      console.log(chalk.yellow(`⚠️  ${exampleFile} already exists`));
      console.log(chalk.gray('   Edit it to create your threadline, or delete it and run init again.'));
      return;
    }

    // Write template file
    fs.writeFileSync(exampleFile, TEMPLATE, 'utf-8');
    
    console.log(chalk.green(`✓ Created ${exampleFile}`));
    console.log('');
    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray('  1. Edit threadlines/example.md with your coding standards'));
    console.log(chalk.gray('  2. Rename it to something descriptive (e.g., error-handling.md)'));
    console.log('');
    console.log(chalk.yellow('⚠️  IMPORTANT: Configuration Required'));
    console.log(chalk.white('   To use threadlines check, you need:'));
    console.log('');
    console.log(chalk.white('   Create a .env.local file in your project root with:'));
    console.log(chalk.gray('     THREADLINE_API_KEY=your-api-key-here'));
    console.log(chalk.gray('     THREADLINE_ACCOUNT=your-email@example.com'));
    console.log('');
    console.log(chalk.white('   Make sure .env.local is in your .gitignore file!'));
    console.log('');
    console.log(chalk.gray('  3. Run: npx threadlines check'));
    console.log(chalk.gray('     (Use npx --yes threadlines check in non-interactive environments)'));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(chalk.red(`\n❌ Error: ${errorMessage}`));
    process.exit(1);
  }
}

