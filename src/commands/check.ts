import { findThreadlines } from '../validators/experts';
import { getFileContent, getFolderContent, getMultipleFilesContent } from '../git/file';
import { ReviewAPIClient, ExpertResult, ReviewResponse } from '../api/client';
import { getThreadlineApiKey, getThreadlineAccount } from '../utils/config';
import { detectEnvironment } from '../utils/environment';
import { ReviewContext } from '../utils/context';
import { getGitHubContext } from '../git/github';
import { getGitLabContext } from '../git/gitlab';
import { getVercelContext } from '../git/vercel';
import { getLocalContext } from '../git/local';
import { getBranchDiff, getCommitDiff } from '../git/diff';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import simpleGit from 'simple-git';

// Get CLI version from package.json
const packageJsonPath = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const CLI_VERSION = packageJson.version;

export async function checkCommand(options: { 
  apiUrl?: string; 
  full?: boolean;
  branch?: string;
  commit?: string;
  file?: string;
  folder?: string;
  files?: string[];
}) {
  const cwd = process.cwd();
  const repoRoot = cwd; // Keep for backward compatibility with rest of function
  
  console.log(chalk.blue(`🔍 Threadline CLI v${CLI_VERSION}: Checking code against your threadlines...\n`));
  
  // Get git root for consistent file paths across monorepo
  const git = simpleGit(cwd);
  let gitRoot: string;
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      console.error(chalk.red('❌ Error: Not a git repository. Threadline requires a git repository.'));
      process.exit(1);
    }
    gitRoot = (await git.revparse(['--show-toplevel'])).trim();
  } catch {
    console.error(chalk.red('❌ Error: Failed to get git root. Make sure you are in a git repository.'));
    process.exit(1);
  }

  // Pre-flight check: Validate ALL required environment variables at once
  const apiKey = getThreadlineApiKey();
  const account = getThreadlineAccount();
  const missingVars: string[] = [];
  
  // Check for undefined, empty string, or literal unexpanded variable (GitLab keeps "$VAR" literal)
  if (!apiKey || apiKey.startsWith('$')) missingVars.push('THREADLINE_API_KEY');
  if (!account || account.startsWith('$')) missingVars.push('THREADLINE_ACCOUNT');
  
  if (missingVars.length > 0) {
    console.error(chalk.red('❌ Error: Missing required environment variables:'));
    for (const varName of missingVars) {
      console.error(chalk.red(`   • ${varName}`));
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
    console.log(chalk.gray('    GitHub Actions: Settings → Secrets → Add variables'));
    console.log(chalk.gray('    GitLab CI:      Settings → CI/CD → Variables'));
    console.log(chalk.gray('    Vercel:         Settings → Environment Variables'));
    console.log('');
    console.log(chalk.gray('Get your credentials at: https://devthreadline.com/settings'));
    process.exit(1);
  }

  try {
    // 1. Find and validate threadlines
    console.log(chalk.gray('📋 Finding threadlines...'));
    const threadlines = await findThreadlines(cwd, gitRoot);
    console.log(chalk.green(`✓ Found ${threadlines.length} threadline(s)\n`));

    if (threadlines.length === 0) {
      console.log(chalk.yellow('⚠️  No valid threadlines found.'));
      console.log(chalk.gray('   Run `npx threadlines init` to create your first threadline.'));
      process.exit(0);
    }

    // 2. Detect environment and context
    const environment = detectEnvironment();
    let context: ReviewContext;
    let gitDiff: { diff: string; changedFiles: string[] };
    let repoName: string | undefined;
    let branchName: string | undefined;
    let metadata: {
      commitSha?: string;
      commitMessage?: string;
      commitAuthorName?: string;
      commitAuthorEmail?: string;
      prTitle?: string;
    } = {};
    
    // Validate mutually exclusive flags
    const explicitFlags = [options.branch, options.commit, options.file, options.folder, options.files].filter(Boolean);
    if (explicitFlags.length > 1) {
      console.error(chalk.red('❌ Error: Only one review option can be specified at a time'));
      console.log(chalk.gray('   Options: --branch, --commit, --file, --folder, --files'));
      process.exit(1);
    }
    
    // Check for explicit flags first (override auto-detection)
    if (options.file) {
      console.log(chalk.gray(`📝 Reading file: ${options.file}...`));
      gitDiff = await getFileContent(repoRoot, options.file);
      context = { type: 'local' }; // File context doesn't need git context
      // For file/folder/files, repo/branch are not available - skip them
    } else if (options.folder) {
      console.log(chalk.gray(`📝 Reading folder: ${options.folder}...`));
      gitDiff = await getFolderContent(repoRoot, options.folder);
      context = { type: 'local' };
      // For file/folder/files, repo/branch are not available - skip them
    } else if (options.files && options.files.length > 0) {
      console.log(chalk.gray(`📝 Reading ${options.files.length} file(s)...`));
      gitDiff = await getMultipleFilesContent(repoRoot, options.files);
      context = { type: 'local' };
      // For file/folder/files, repo/branch are not available - skip them
    } else if (options.branch) {
      console.log(chalk.gray(`📝 Collecting git changes for branch: ${options.branch}...`));
      context = { type: 'branch', branchName: options.branch };
      gitDiff = await getBranchDiff(repoRoot, options.branch);
      // Get repo/branch using environment-specific approach
      if (environment === 'github') {
        const gitContext = await getGitHubContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email,
          prTitle: gitContext.prTitle
        };
      } else if (environment === 'gitlab') {
        const gitContext = await getGitLabContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email,
          prTitle: gitContext.prTitle
        };
      } else if (environment === 'vercel') {
        const gitContext = await getVercelContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email
        };
      } else {
        const gitContext = await getLocalContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email
        };
      }
    } else if (options.commit) {
      console.log(chalk.gray(`📝 Collecting git changes for commit: ${options.commit}...`));
      context = { type: 'commit', commitSha: options.commit };
      gitDiff = await getCommitDiff(repoRoot, options.commit);
      // Get repo/branch using environment-specific approach
      if (environment === 'github') {
        const gitContext = await getGitHubContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email,
          prTitle: gitContext.prTitle
        };
      } else if (environment === 'gitlab') {
        const gitContext = await getGitLabContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email,
          prTitle: gitContext.prTitle
        };
      } else if (environment === 'vercel') {
        const gitContext = await getVercelContext(repoRoot);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email
        };
      } else {
        const gitContext = await getLocalContext(repoRoot, options.commit);
        repoName = gitContext.repoName;
        branchName = gitContext.branchName;
        metadata = {
          commitSha: gitContext.commitSha,
          commitMessage: gitContext.commitMessage,
          commitAuthorName: gitContext.commitAuthor.name,
          commitAuthorEmail: gitContext.commitAuthor.email
        };
      }
    } else {
      // Auto-detect: Use environment-specific context collection (completely isolated)
      const envNames: Record<string, string> = {
        vercel: 'Vercel',
        github: 'GitHub',
        gitlab: 'GitLab',
        local: 'Local'
      };
      console.log(chalk.gray(`📝 Collecting git context for ${envNames[environment]}...`));
      
      // Get all context from environment-specific module
      let envContext;
      if (environment === 'github') {
        envContext = await getGitHubContext(repoRoot);
      } else if (environment === 'gitlab') {
        envContext = await getGitLabContext(repoRoot);
      } else if (environment === 'vercel') {
        envContext = await getVercelContext(repoRoot);
      } else {
        envContext = await getLocalContext(repoRoot);
      }
      
      gitDiff = envContext.diff;
      repoName = envContext.repoName;
      branchName = envContext.branchName;
      context = envContext.context;
      
      // Use metadata from environment context
      metadata = {
        commitSha: envContext.commitSha,
        commitMessage: envContext.commitMessage,
        commitAuthorName: envContext.commitAuthor.name,
        commitAuthorEmail: envContext.commitAuthor.email,
        prTitle: envContext.prTitle
      };
    }
    
    if (gitDiff.changedFiles.length === 0) {
      console.error(chalk.red('❌ Error: No changes detected.'));
      console.error(chalk.red('   Threadline check requires code changes to analyze.'));
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
    
    console.log(chalk.green(`✓ Found ${gitDiff.changedFiles.length} changed file(s)\n`));

    // 4. Read context files for each threadline
    const threadlinesWithContext = threadlines.map(threadline => {
      const contextContent: Record<string, string> = {};
      
      if (threadline.contextFiles) {
        for (const contextFile of threadline.contextFiles) {
          const fullPath = path.join(repoRoot, contextFile);
          if (fs.existsSync(fullPath)) {
            contextContent[contextFile] = fs.readFileSync(fullPath, 'utf-8');
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

    // 5. Get API URL
    const apiUrl = options.apiUrl || 
                   process.env.THREADLINE_API_URL || 
                   'https://devthreadline.com';

    // 6. Call review API
    console.log(chalk.gray('🤖 Running threadline checks...'));
    const client = new ReviewAPIClient(apiUrl);
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
      cliVersion: CLI_VERSION
    });

    // 7. Display results (with filtering if --full not specified)
    displayResults(response, options.full || false);

    // Exit with appropriate code
    const hasAttention = response.results.some(r => r.status === 'attention');
    process.exit(hasAttention ? 1 : 0);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(chalk.red(`\n❌ Error: ${errorMessage}`));
    process.exit(1);
  }
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
  const attentionItems = filteredResults.filter((r: ExpertResult) => r.status === 'attention');

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
  if (metadata.errors > 0) {
    summaryParts.push(`${metadata.errors} errors`);
  }

  // Display informational message if present (e.g., zero diffs)
  if (message) {
    console.log('\n' + chalk.blue('ℹ️  ' + message));
  }

  // Show success message with breakdown if no issues
  if (attention === 0 && metadata.timedOut === 0 && metadata.errors === 0) {
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
    if (metadata.errors > 0) {
      console.log(chalk.red(`  ${metadata.errors} errors`));
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
}

