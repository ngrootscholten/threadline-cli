import { findThreadlines } from '../validators/experts';
import { getFileContent, getFolderContent, getMultipleFilesContent } from '../git/file';
import { ExpertResult, ReviewResponse, ReviewAPIClient } from '../api/client';
import { getOpenAIConfig, logOpenAIConfig, getBedrockConfig, logBedrockConfig, getThreadlineApiKey, getThreadlineAccount } from '../utils/config';
import { detectEnvironment, isCIEnvironment, Environment } from '../utils/environment';
import { ReviewContextType } from '../api/client';
import { getCIContext } from '../git/ci-context';
import { getLocalContext } from '../git/local';
import { loadConfig } from '../utils/config-file';
import { logger } from '../utils/logger';
import { processThreadlines } from '../processors/expert';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';


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
  
  logger.info(`🔍 Threadline CLI v${CLI_VERSION}: Checking code against your threadlines...`);
  
  // Get git root for consistent file paths across monorepo
  let gitRoot: string;
  try {
    // Check if we're in a git repo
    execSync('git rev-parse --git-dir', { cwd: cwd, stdio: 'ignore' });
    // Get git root
    gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      cwd: cwd
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get git root: ${message}`);
    logger.error('Not a git repository. Threadline requires a git repository.');
    process.exit(1);
  }

  // Determine which LLM provider to use based on configuration
  // Explicit provider selection (not a fallback pattern)
  const bedrockConfig = getBedrockConfig(config);
  const openAIConfig = getOpenAIConfig(config);
  
  let provider: 'bedrock' | 'openai';
  let bedrockConfigToUse: typeof bedrockConfig;
  let openAIConfigToUse: typeof openAIConfig;
  
  // Explicit provider selection: handle all cases clearly
  if (bedrockConfig && openAIConfig) {
    // Both configured: use Bedrock (explicit priority)
    logger.warn('Both Bedrock and OpenAI are configured. Using Bedrock (priority provider).');
    provider = 'bedrock';
    bedrockConfigToUse = bedrockConfig;
    openAIConfigToUse = undefined;
    logBedrockConfig(bedrockConfig);
  } else if (bedrockConfig) {
    // Only Bedrock configured: use Bedrock
    provider = 'bedrock';
    bedrockConfigToUse = bedrockConfig;
    openAIConfigToUse = undefined;
    logBedrockConfig(bedrockConfig);
  } else if (openAIConfig) {
    // Only OpenAI configured: use OpenAI
    provider = 'openai';
    bedrockConfigToUse = undefined;
    openAIConfigToUse = openAIConfig;
    logOpenAIConfig(openAIConfig);
  } else {
    // Neither configured: fail loudly
    logger.error('Missing required LLM provider configuration');
    logger.output('');
    logger.output(chalk.yellow('You need to configure either Bedrock or OpenAI:'));
    logger.output('');
    logger.output(chalk.white('  Option 1: Amazon Bedrock'));
    logger.output(chalk.gray('    Local development:'));
    logger.output(chalk.gray('      1. Create a .env.local file in your project root'));
    logger.output(chalk.gray('      2. Add: BEDROCK_ACCESS_KEY_ID=your-access-key-id'));
    logger.output(chalk.gray('      3. Add: BEDROCK_SECRET_ACCESS_KEY=your-secret-access-key'));
    logger.output(chalk.gray('      4. Ensure .threadlinerc contains: bedrock_model and bedrock_region'));
    logger.output(chalk.gray('    CI/CD: Add BEDROCK_ACCESS_KEY_ID and BEDROCK_SECRET_ACCESS_KEY as secrets'));
    logger.output(chalk.gray('           Ensure .threadlinerc contains: bedrock_model and bedrock_region'));
    logger.output('');
    logger.output(chalk.white('  Option 2: OpenAI'));
    logger.output(chalk.gray('    Local development:'));
    logger.output(chalk.gray('      1. Create a .env.local file in your project root'));
    logger.output(chalk.gray('      2. Add: OPENAI_API_KEY=your-openai-api-key'));
    logger.output(chalk.gray('      3. Ensure .threadlinerc contains: openai_model and openai_service_tier'));
    logger.output(chalk.gray('    CI/CD:'));
    logger.output(chalk.gray('      GitHub Actions:     Settings → Secrets → Add OPENAI_API_KEY'));
    logger.output(chalk.gray('      GitLab CI:          Settings → CI/CD → Variables → Add OPENAI_API_KEY'));
    logger.output(chalk.gray('      Bitbucket Pipelines: Repository settings → Repository variables → Add OPENAI_API_KEY'));
    logger.output(chalk.gray('      Vercel:             Settings → Environment Variables → Add OPENAI_API_KEY'));
    logger.output(chalk.gray('      Ensure .threadlinerc contains: openai_model and openai_service_tier'));
    logger.output('');
    logger.output(chalk.gray('Get your OpenAI API key at: https://platform.openai.com/api-keys'));
    process.exit(1);
  }

  // 1. Find and validate threadlines
  logger.info('Finding threadlines...');
  const threadlines = await findThreadlines(cwd, gitRoot);
  logger.info(`✓ Found ${threadlines.length} threadline(s)\n`);

  if (threadlines.length === 0) {
    logger.warn('No valid threadlines found.');
    logger.output(chalk.gray('   Run `npx threadlines init` to create your first threadline.'));
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
    logger.output(chalk.gray('   Options: --commit, --file, --folder, --files'));
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
    logger.info('ℹ️ No changes detected.');
    process.exit(0);
  }
  
  // Safety limit: prevent expensive API calls on large diffs
  const MAX_CHANGED_FILES = 20;
  if (gitDiff.changedFiles.length > MAX_CHANGED_FILES) {
    logger.error(`Too many changed files: ${gitDiff.changedFiles.length} (max: ${MAX_CHANGED_FILES})`);
    logger.output(chalk.gray('   This limit prevents expensive API calls on large diffs.'));
    logger.output(chalk.gray('   Consider reviewing smaller batches of changes.'));
    process.exit(1);
  }
  
  // Check for zero diff (files changed but no actual code changes)
  if (!gitDiff.diff || gitDiff.diff.trim() === '') {
    logger.info('ℹ️  No code changes detected. Diff contains zero lines added or removed.');
    logger.output(chalk.gray(`   ${gitDiff.changedFiles.length} file(s) changed but no content modifications detected.`));
    logger.output('');
    logger.output(chalk.bold('Results:\n'));
    logger.output(chalk.gray(`${threadlines.length} threadlines checked`));
    logger.output(chalk.gray(`  ${threadlines.length} not relevant`));
    logger.output('');
    process.exit(0);
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

  // 5. Process threadlines locally using configured LLM provider
  logger.info('Running threadline checks...');
  const processResponse = await processThreadlines({
    threadlines: threadlinesWithContext.map(t => ({
      id: t.id,
      version: t.version,
      patterns: t.patterns,
      content: t.content,
      contextFiles: t.contextFiles,
      contextContent: t.contextContent
    })),
    diff: gitDiff.diff,
    files: gitDiff.changedFiles,
    provider,
    bedrockConfig: bedrockConfigToUse ? {
      accessKeyId: bedrockConfigToUse.accessKeyId,
      secretAccessKey: bedrockConfigToUse.secretAccessKey,
      model: bedrockConfigToUse.model,
      region: bedrockConfigToUse.region
    } : undefined,
    openaiConfig: openAIConfigToUse ? {
      apiKey: openAIConfigToUse.apiKey,
      model: openAIConfigToUse.model,
      serviceTier: openAIConfigToUse.serviceTier
    } : undefined,
    contextLinesForLLM: config.diff_context_lines
  });
  
  // Convert ProcessThreadlinesResponse to ReviewResponse format for displayResults
  const response: ReviewResponse = {
    results: processResponse.results,
    metadata: {
      totalThreadlines: processResponse.metadata.totalThreadlines,
      completed: processResponse.metadata.completed,
      timedOut: processResponse.metadata.timedOut,
      errors: processResponse.metadata.errors
    }
  };

  // 6. Sync results to web app (if mode is "online")
  if (config.mode === 'online') {
    const apiKey = getThreadlineApiKey();
    const account = getThreadlineAccount();
    
    if (!apiKey || !account) {
      // Configuration error: mode is "online" but credentials are missing
      // Fail loudly - this is a user configuration error that needs to be fixed
      logger.error('Sync mode is "online" but required credentials are missing.');
      logger.error('Set THREADLINE_API_KEY and THREADLINE_ACCOUNT environment variables to enable syncing.');
      logger.error('Alternatively, set mode to "offline" in .threadlinerc to disable syncing.');
      throw new Error(
        'Sync configuration error: mode is "online" but THREADLINE_API_KEY or THREADLINE_ACCOUNT is not set. ' +
        'Either set these environment variables or change mode to "offline" in .threadlinerc.'
      );
    }
    
    // Attempt sync - if it fails, show error but don't fail the check (local processing succeeded)
    try {
      logger.info('Syncing results to web app...');
      const client = new ReviewAPIClient(config.api_url);
      await client.syncResults({
        threadlines: threadlinesWithContext,
        diff: gitDiff.diff,
        files: gitDiff.changedFiles,
        results: processResponse.results,
        metadata: {
          totalThreadlines: processResponse.metadata.totalThreadlines,
          completed: processResponse.metadata.completed,
          timedOut: processResponse.metadata.timedOut,
          errors: processResponse.metadata.errors,
          llmModel: processResponse.metadata.llmModel
        },
        apiKey,
        account,
        repoName,
        branchName,
        commitSha: metadata.commitSha,
        commitMessage: metadata.commitMessage,
        commitAuthorName: metadata.commitAuthorName,
        commitAuthorEmail: metadata.commitAuthorEmail,
        prTitle: metadata.prTitle,
        environment: environment,
        cliVersion: CLI_VERSION,
        reviewContext: reviewContext
      });
      logger.info('✓ Results synced successfully');
    } catch (error) {
      // Sync API call failed - show error prominently but don't fail the check (local processing succeeded)
      // This is not a silent fallback: we explicitly show the error and explain why we continue
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to sync results to web app: ${errorMessage}`);
      logger.warn('Check results are still valid - sync failure does not affect local processing.');
    }
  }

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
    logger.output('\n' + chalk.blue('ℹ️  ' + message));
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
    logger.output('\n' + chalk.green(`✓ Threadline check passed${summary}`));
    logger.output(chalk.gray(`  ${metadata.totalThreadlines} threadline${metadata.totalThreadlines !== 1 ? 's' : ''} checked\n`));
  } else {
    // Show detailed breakdown when there are issues
    logger.output('\n' + chalk.bold('Results:\n'));
    logger.output(chalk.gray(`${metadata.totalThreadlines} threadlines checked`));
    
    if (showFull) {
      // Show all results when --full flag is used
      if (notRelevant > 0) {
        logger.output(chalk.gray(`  ${notRelevant} not relevant`));
      }
      if (compliant > 0) {
        logger.output(chalk.green(`  ${compliant} compliant`));
      }
      if (attention > 0) {
        logger.output(chalk.yellow(`  ${attention} attention`));
      }
    } else {
      // Default: only show attention items
      if (attention > 0) {
        logger.output(chalk.yellow(`  ${attention} attention`));
      }
    }

    
    if (metadata.timedOut > 0) {
      logger.output(chalk.yellow(`  ${metadata.timedOut} timed out`));
    }
    if (errors > 0) {
      logger.output(chalk.red(`  ${errors} errors`));
    }

    logger.output('');
  }

  // Show attention items
  if (attentionItems.length > 0) {
    for (const item of attentionItems) {
      logger.output(chalk.yellow(`[attention] ${item.expertId}`));
      if (item.fileReferences && item.fileReferences.length > 0) {
        // List all files as bullet points
        for (const fileRef of item.fileReferences) {
          const lineRef = item.lineReferences?.[item.fileReferences.indexOf(fileRef)];
          const lineStr = lineRef ? `:${lineRef}` : '';
          logger.output(chalk.gray(`* ${fileRef}${lineStr}`));
        }
      }
      // Show reasoning once at the end (if available)
      if (item.reasoning) {
        logger.output(chalk.gray(item.reasoning));
      } else if (!item.fileReferences || item.fileReferences.length === 0) {
        logger.output(chalk.gray('Needs attention'));
      }
      logger.output(''); // Empty line between threadlines
    }
  }

  // Show error items (always shown, regardless of --full flag)
  if (errorItems.length > 0) {
    for (const item of errorItems) {
      logger.output(chalk.red(`[error] ${item.expertId}`));
      
      // Show error message
      if (item.error) {
        logger.output(chalk.red(`  Error: ${item.error.message}`));
        if (item.error.type) {
          logger.output(chalk.red(`  Type: ${item.error.type}`));
        }
        if (item.error.code) {
          logger.output(chalk.red(`  Code: ${item.error.code}`));
        }
        // Show raw response for debugging
        if (item.error.rawResponse) {
          logger.output(chalk.gray('  Raw response:'));
          logger.output(chalk.gray(JSON.stringify(item.error.rawResponse, null, 2).split('\n').map(line => '    ' + line).join('\n')));
        }
      }
      
      logger.output(''); // Empty line between errors
    }
  }
}

