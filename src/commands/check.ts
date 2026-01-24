import { findThreadlines } from '../validators/experts';
import { getFileContent, getFolderContent, getMultipleFilesContent } from '../git/file';
import { ReviewAPIClient, ExpertResult, ReviewResponse } from '../api/client';
import { getThreadlineApiKey, getThreadlineAccount } from '../utils/config';
import { detectEnvironment, isCIEnvironment, Environment } from '../utils/environment';
import { ReviewContextType } from '../api/client';
import { getCIContext } from '../git/ci-context';
import { getLocalContext } from '../git/local';
import { loadConfig } from '../utils/config-file';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import simpleGit from 'simple-git';


/**
 * Helper to get context for any environment.
 * CI environments use the unified getCIContext().
 * Local environment has special handling for flags.
 */
async function getContextForEnvironment(environment: Environment, repoRoot: string, commitSha?: string) {
  switch (environment) {
    case 'local':
      return getLocalContext(repoRoot, commitSha);
    case 'github':
    case 'gitlab':
    case 'bitbucket':
    case 'vercel':
      return getCIContext(repoRoot, environment);
    default:
      // TypeScript exhaustiveness check - fails at compile time if new Environment added
      throw new Error(`Unrecognized environment: ${environment satisfies never}`);
  }
}


// Get CLI version from package.json
const packageJsonPath = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const CLI_VERSION = packageJson.version;

export async function checkCommand(options: { 
  full?: boolean;
  commit?: string;
  file?: string;
  folder?: string;
  files?: string[];
}) {
  const cwd = process.cwd();
  const repoRoot = cwd; // Keep for backward compatibility with rest of function
  
  // Load configuration
  const config = await loadConfig(cwd);
  
  console.log(chalk.blue(`🔍 Threadline CLI v${CLI_VERSION}: Checking code against your threadlines...\n`));
  
  // Get git root for consistent file paths across monorepo
  const git = simpleGit(cwd);
  let gitRoot: string;
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      logger.error('Not a git repository. Threadline requires a git repository.');
      process.exit(1);
    }
    gitRoot = (await git.revparse(['--show-toplevel'])).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get git root: ${message}`);
    process.exit(1);
  }

  // Pre-flight check: Validate ALL required environment variables at once
  const apiKey = getThreadlineApiKey();
  const account = getThreadlineAccount();
  const missingVars: string[] = [];
  
  // Check for undefined, empty string, or literal unexpanded variable
  // GitLab CI keeps variables as literal "$VAR" if not defined in CI/CD settings
  if (!apiKey || apiKey === '$THREADLINE_API_KEY') missingVars.push('THREADLINE_API_KEY');
  if (!account || account === '$THREADLINE_ACCOUNT') missingVars.push('THREADLINE_ACCOUNT');
  
  if (missingVars.length > 0) {
    logger.error('Missing required environment variables:');
    for (const varName of missingVars) {
      logger.error(`   • ${varName}`);
    }
    console.log('');
    console.log(chalk.yellow('To fix this:'));
    console.log('');
    console.log(chalk.white('  Local development:'));
    console.log(chalk.gray('    1. Create a .env.local file in your project root'));
    console.log(chalk.gray('    2. Add the missing variable(s):'));
    if (missingVars.includes('THREADLINE_API_KEY')) {
      console.log(chalk.gray('       THREADLINE_API_KEY=your-api-key-here'));
    }
    if (missingVars.includes('THREADLINE_ACCOUNT')) {
      console.log(chalk.gray('       THREADLINE_ACCOUNT=your-email@example.com'));
    }
    console.log(chalk.gray('    3. Make sure .env.local is in your .gitignore'));
    console.log('');
    console.log(chalk.white('  CI/CD:'));
    console.log(chalk.gray('    GitHub Actions:     Settings → Secrets → Add variables'));
    console.log(chalk.gray('    GitLab CI:          Settings → CI/CD → Variables'));
    console.log(chalk.gray('    Bitbucket Pipelines: Repository settings → Repository variables'));
    console.log(chalk.gray('    Vercel:             Settings → Environment Variables'));
    console.log('');
    console.log(chalk.gray('Get your credentials at: https://devthreadline.com/settings'));
    process.exit(1);
  }

  // 1. Find and validate threadlines
  logger.info('Finding threadlines...');
  const threadlines = await findThreadlines(cwd, gitRoot);
  console.log(chalk.green(`✓ Found ${threadlines.length} threadline(s)\n`));

  if (threadlines.length === 0) {
    console.log(chalk.yellow('⚠️  No valid threadlines found.'));
    console.log(chalk.gray('   Run `npx threadlines init` to create your first threadline.'));
    process.exit(0);
  }

  // 2. Detect environment and context
  const environment = detectEnvironment();
    
  let gitDiff: { diff: string; changedFiles: string[] };
  let repoName: string | undefined;
  let branchName: string | undefined;
  let reviewContext: ReviewContextType;
  let metadata: {
    commitSha?: string;
    commitMessage?: string;
    commitAuthorName?: string;
    commitAuthorEmail?: string;
    prTitle?: string;
  } = {};
  
  // Check for explicit flags
  const explicitFlags = [options.commit, options.file, options.folder, options.files].filter(Boolean);
  
  // Validate mutually exclusive flags
  if (explicitFlags.length > 1) {
    logger.error('Only one review option can be specified at a time');
    console.log(chalk.gray('   Options: --commit, --file, --folder, --files'));
    process.exit(1);
  }
  
  // CI environments: auto-detect only, flags are ignored with warning
  // Local: full flag support for developer flexibility
  if (isCIEnvironment(environment)) {
    // Warn if flags are passed in CI - they're meant for local development
    if (explicitFlags.length > 0) {
      const flagName = options.commit ? '--commit' : 
                      options.file ? '--file' : 
                      options.folder ? '--folder' : '--files';
      logger.warn(`${flagName} flag ignored in CI environment. Using auto-detection.`);
    }
    
    // CI auto-detect: use environment-specific context
    const envNames: Record<string, string> = {
      vercel: 'Vercel',
      github: 'GitHub Actions',
      gitlab: 'GitLab CI',
      bitbucket: 'Bitbucket Pipelines'
    };
    logger.info(`Collecting git context for ${envNames[environment]}...`);
    
    const envContext = await getContextForEnvironment(environment, repoRoot);
    gitDiff = envContext.diff;
    repoName = envContext.repoName;
    branchName = envContext.branchName;
    reviewContext = envContext.reviewContext; // Get from CI context
    metadata = {
      commitSha: envContext.commitSha,
      commitMessage: envContext.commitMessage,
      commitAuthorName: envContext.commitAuthor.name,
      commitAuthorEmail: envContext.commitAuthor.email,
      prTitle: envContext.prTitle
    };
  } else {
    // Local environment: all flags share the same metadata
    
    // 1. Get context and metadata (pass commit SHA if provided)
    logger.info('Collecting local context...');
    const localContext = await getLocalContext(repoRoot, options.commit);
    repoName = localContext.repoName;
    branchName = localContext.branchName;
    metadata = {
      commitSha: localContext.commitSha,
      commitMessage: localContext.commitMessage,
      commitAuthorName: localContext.commitAuthor.name,
      commitAuthorEmail: localContext.commitAuthor.email
    };
    
    // 2. Get diff (override with specific content if flag provided)
    if (options.file) {
      reviewContext = 'file';
      logger.info(`Reading file: ${options.file}...`);
      gitDiff = await getFileContent(repoRoot, options.file);
    } else if (options.folder) {
      reviewContext = 'folder';
      logger.info(`Reading folder: ${options.folder}...`);
      gitDiff = await getFolderContent(repoRoot, options.folder);
    } else if (options.files && options.files.length > 0) {
      reviewContext = 'files';
      logger.info(`Reading ${options.files.length} file(s)...`);
      gitDiff = await getMultipleFilesContent(repoRoot, options.files);
    } else {
      // Default: use diff from localContext (handles commit and staged/unstaged)
      reviewContext = options.commit ? 'commit' : 'local';
      gitDiff = localContext.diff;
    }
  }
  
  if (gitDiff.changedFiles.length === 0) {
    console.error(chalk.bold('ℹ️ No changes detected.'));
    process.exit(0);
  }
  
  // Safety limit: prevent expensive API calls on large diffs
  const MAX_CHANGED_FILES = 20;
  if (gitDiff.changedFiles.length > MAX_CHANGED_FILES) {
    console.error(chalk.red(`❌ Too many changed files: ${gitDiff.changedFiles.length} (max: ${MAX_CHANGED_FILES})`));
    console.error(chalk.gray('   This limit prevents expensive API calls on large diffs.'));
    console.error(chalk.gray('   Consider reviewing smaller batches of changes.'));
    process.exit(1);
  }
  
  // Check for zero diff (files changed but no actual code changes)
  if (!gitDiff.diff || gitDiff.diff.trim() === '') {
    console.log(chalk.blue('ℹ️  No code changes detected. Diff contains zero lines added or removed.'));
    console.log(chalk.gray(`   ${gitDiff.changedFiles.length} file(s) changed but no content modifications detected.`));
    console.log('');
    console.log(chalk.bold('Results:\n'));
    console.log(chalk.gray(`${threadlines.length} threadlines checked`));
    console.log(chalk.gray(`  ${threadlines.length} not relevant`));
    console.log('');
    process.exit(0);
  }
  
  console.log(chalk.green(`✓ Found ${gitDiff.changedFiles.length} changed file(s) (context: ${reviewContext})\n`));
  
  // Log the files being sent
  for (const file of gitDiff.changedFiles) {
    logger.info(`  → ${file}`);
  }

  // 4. Read context files for each threadline
  const threadlinesWithContext = threadlines.map(threadline => {
    const contextContent: Record<string, string> = {};
    
    if (threadline.contextFiles) {
      for (const contextFile of threadline.contextFiles) {
        const fullPath = path.join(repoRoot, contextFile);
          if (fs.existsSync(fullPath)) {
            try {
              contextContent[contextFile] = fs.readFileSync(fullPath, 'utf-8');
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`Failed to read context file '${contextFile}' for threadline '${threadline.id}': ${message}`);
            }
          } else {
            throw new Error(`Context file not found for threadline '${threadline.id}': ${contextFile}`);
          }
      }
    }

    return {
      id: threadline.id,
      version: threadline.version,
      patterns: threadline.patterns,
      content: threadline.content,
      filePath: threadline.filePath,
      contextFiles: threadline.contextFiles,
      contextContent
    };
  });

  // 5. Call review API
  logger.info('Running threadline checks...');
  const client = new ReviewAPIClient(config.api_url);
  const response = await client.review({
    threadlines: threadlinesWithContext,
    diff: gitDiff.diff,
    files: gitDiff.changedFiles,
    apiKey: apiKey!,
    account: account!,
    repoName: repoName,
    branchName: branchName,
    commitSha: metadata.commitSha,
    commitMessage: metadata.commitMessage,
    commitAuthorName: metadata.commitAuthorName,
    commitAuthorEmail: metadata.commitAuthorEmail,
    prTitle: metadata.prTitle,
    environment: environment,
    cliVersion: CLI_VERSION,
    reviewContext: reviewContext
  });

  // 7. Display results (with filtering if --full not specified)
  displayResults(response, options.full || false);

  // Exit with appropriate code (attention or errors = failure)
  const hasIssues = response.results.some(r => r.status === 'attention' || r.status === 'error');
  process.exit(hasIssues ? 1 : 0);
}

function displayResults(response: ReviewResponse, showFull: boolean) {
  const { results, metadata, message } = response;

  // Filter results based on --full flag
  const filteredResults = showFull 
    ? results 
    : results.filter((r: ExpertResult) => r.status === 'attention');

  // Display informational message if present (e.g., zero diffs)
  if (message) {
    console.log('\n' + chalk.blue('ℹ️  ' + message));
  }

  const notRelevant = results.filter((r: ExpertResult) => r.status === 'not_relevant').length;
  const compliant = results.filter((r: ExpertResult) => r.status === 'compliant').length;
  const attention = results.filter((r: ExpertResult) => r.status === 'attention').length;
  const errors = results.filter((r: ExpertResult) => r.status === 'error').length;
  const attentionItems = filteredResults.filter((r: ExpertResult) => r.status === 'attention');
  // Always show errors regardless of --full flag
  const errorItems = results.filter((r: ExpertResult) => r.status === 'error');

  // Build summary parts
  const summaryParts: string[] = [];
  if (notRelevant > 0) {
    summaryParts.push(`${notRelevant} not relevant`);
  }
  if (compliant > 0) {
    summaryParts.push(`${compliant} compliant`);
  }
  if (attention > 0) {
    summaryParts.push(`${attention} attention`);
  }
  if (metadata.timedOut > 0) {
    summaryParts.push(`${metadata.timedOut} timed out`);
  }
  if (errors > 0) {
    summaryParts.push(`${errors} errors`);
  }

  // Show success message with breakdown if no issues
  if (attention === 0 && metadata.timedOut === 0 && errors === 0) {
    const summary = summaryParts.length > 0 ? ` (${summaryParts.join(', ')})` : '';
    console.log('\n' + chalk.green(`✓ Threadline check passed${summary}`));
    console.log(chalk.gray(`  ${metadata.totalThreadlines} threadline${metadata.totalThreadlines !== 1 ? 's' : ''} checked\n`));
  } else {
    // Show detailed breakdown when there are issues
    console.log('\n' + chalk.bold('Results:\n'));
    console.log(chalk.gray(`${metadata.totalThreadlines} threadlines checked`));
    
    if (showFull) {
      // Show all results when --full flag is used
      if (notRelevant > 0) {
        console.log(chalk.gray(`  ${notRelevant} not relevant`));
      }
      if (compliant > 0) {
        console.log(chalk.green(`  ${compliant} compliant`));
      }
      if (attention > 0) {
        console.log(chalk.yellow(`  ${attention} attention`));
      }
    } else {
      // Default: only show attention items
      if (attention > 0) {
        console.log(chalk.yellow(`  ${attention} attention`));
      }
    }

    if (metadata.timedOut > 0) {
      console.log(chalk.yellow(`  ${metadata.timedOut} timed out`));
    }
    if (errors > 0) {
      console.log(chalk.red(`  ${errors} errors`));
    }

    console.log('');
  }

  // Show attention items
  if (attentionItems.length > 0) {
    for (const item of attentionItems) {
      console.log(chalk.yellow(`[attention] ${item.expertId}`));
      if (item.fileReferences && item.fileReferences.length > 0) {
        // List all files as bullet points
        for (const fileRef of item.fileReferences) {
          const lineRef = item.lineReferences?.[item.fileReferences.indexOf(fileRef)];
          const lineStr = lineRef ? `:${lineRef}` : '';
          console.log(chalk.gray(`* ${fileRef}${lineStr}`));
        }
      }
      // Show reasoning once at the end (if available)
      if (item.reasoning) {
        console.log(chalk.gray(item.reasoning));
      } else if (!item.fileReferences || item.fileReferences.length === 0) {
        console.log(chalk.gray('Needs attention'));
      }
      console.log(''); // Empty line between threadlines
    }
  }

  // Show error items (always shown, regardless of --full flag)
  if (errorItems.length > 0) {
    for (const item of errorItems) {
      console.log(chalk.red(`[error] ${item.expertId}`));
      
      // Show error message
      if (item.error) {
        console.log(chalk.red(`  Error: ${item.error.message}`));
        if (item.error.type) {
          console.log(chalk.red(`  Type: ${item.error.type}`));
        }
        if (item.error.code) {
          console.log(chalk.red(`  Code: ${item.error.code}`));
        }
        // Show raw response for debugging
        if (item.error.rawResponse) {
          console.log(chalk.gray('  Raw response:'));
          console.log(chalk.gray(JSON.stringify(item.error.rawResponse, null, 2).split('\n').map(line => '    ' + line).join('\n')));
        }
      }
      
      console.log(''); // Empty line between errors
    }
  }
}

