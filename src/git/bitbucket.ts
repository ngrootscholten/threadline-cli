/**
 * Bitbucket Pipelines Environment
 * 
 * All Bitbucket-specific logic is contained in this file.
 * No dependencies on other environment implementations.
 * 
 * Exports a single function: getBitbucketContext() that returns:
 * - diff: GitDiffResult
 * - repoName: string
 * - branchName: string
 * - commitAuthor: { name: string; email: string }
 * - prTitle?: string (PR title - not available in Bitbucket env vars)
 * 
 * Implementation Status (all tested 2026-01-18):
 * - ✅ Direct commit to main
 * - ✅ Feature branch push
 * - ✅ PR context
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { execSync } from 'child_process';
import { GitDiffResult } from '../types/git';
import { getCommitMessage } from './diff';
import { ReviewContext } from '../utils/context';
import { logger } from '../utils/logger';

export interface BitbucketContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string;
  context: ReviewContext;
}

/**
 * Gets all Bitbucket context in one call 
 */
export async function getBitbucketContext(repoRoot: string): Promise<BitbucketContext> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get all Bitbucket context
  const diff = await getDiff(repoRoot);
  const repoName = getRepoName();
  const branchName = getBranchName();
  const context = detectContext();
  const commitSha = getCommitSha();
  
  // Get commit author (from git log - Bitbucket doesn't provide this as env var)
  const commitAuthor = await getCommitAuthor(repoRoot);
  
  // Get commit message if we have a SHA
  let commitMessage: string | undefined;
  if (commitSha) {
    const message = await getCommitMessage(repoRoot, commitSha);
    if (message) {
      commitMessage = message;
    }
  }

  return {
    diff,
    repoName,
    branchName,
    commitSha,
    commitMessage,
    commitAuthor,
    prTitle: undefined, // Bitbucket doesn't expose PR title as env var
    context
  };
}

/**
 * Get diff for Bitbucket Pipelines environment
 * 
 * Strategy:
 * - PR context: Fetch destination branch on-demand, compare source vs target (full PR diff)
 * - Any push (main or feature branch): Compare last commit only (HEAD~1...HEAD)
 * 
 * Note: We fetch the destination branch on-demand so this works with shallow clones.
 * Users don't need `depth: full` in their bitbucket-pipelines.yml.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  const prId = process.env.BITBUCKET_PR_ID;
  const prDestinationBranch = process.env.BITBUCKET_PR_DESTINATION_BRANCH;

  // PR Context: Fetch destination branch and compare
  if (prId) {
    if (!prDestinationBranch) {
      throw new Error(
        'Bitbucket PR context detected but BITBUCKET_PR_DESTINATION_BRANCH is not set. ' +
        'This should be automatically provided by Bitbucket Pipelines.'
      );
    }
    
    // Fetch destination branch on-demand (works with shallow clones)
    logger.debug(`Fetching destination branch: origin/${prDestinationBranch}`);
    await git.fetch(['origin', `${prDestinationBranch}:refs/remotes/origin/${prDestinationBranch}`, '--depth=1']);
    
    logger.debug(`PR #${prId}, using origin/${prDestinationBranch}...HEAD`);
    const diff = await git.diff([`origin/${prDestinationBranch}...HEAD`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${prDestinationBranch}...HEAD`]);
    const changedFiles = diffSummary.files.map(f => f.file);
    return { diff: diff || '', changedFiles };
  }

  // Any push (main or feature branch): Review last commit only
  const diff = await git.diff(['HEAD~1...HEAD', '-U200']);
  const diffSummary = await git.diffSummary(['HEAD~1...HEAD']);
  const changedFiles = diffSummary.files.map(f => f.file);
  return { diff: diff || '', changedFiles };
}

/**
 * Gets repository name for Bitbucket Pipelines
 * 
 * Uses BITBUCKET_REPO_FULL_NAME to construct the repo URL.
 * Example: ngrootscholten/threadline -> https://bitbucket.org/ngrootscholten/threadline.git
 */
function getRepoName(): string {
  const repoFullName = process.env.BITBUCKET_REPO_FULL_NAME;
  if (!repoFullName) {
    throw new Error(
      'Bitbucket Pipelines: BITBUCKET_REPO_FULL_NAME environment variable is not set. ' +
      'This should be automatically provided by Bitbucket Pipelines.'
    );
  }
  return `https://bitbucket.org/${repoFullName}.git`;
}

/**
 * Gets branch name for Bitbucket Pipelines
 */
function getBranchName(): string {
  const branchName = process.env.BITBUCKET_BRANCH;
  if (!branchName) {
    throw new Error(
      'Bitbucket Pipelines: BITBUCKET_BRANCH environment variable is not set. ' +
      'This should be automatically provided by Bitbucket Pipelines.'
    );
  }
  return branchName;
}

/**
 * Detects Bitbucket context (PR or commit)
 * 
 * - PR context: When BITBUCKET_PR_ID is set
 * - Commit context: Any push (main or feature branch) - reviews single commit
 */
function detectContext(): ReviewContext {
  // PR context
  const prId = process.env.BITBUCKET_PR_ID;
  const prDestinationBranch = process.env.BITBUCKET_PR_DESTINATION_BRANCH;
  const sourceBranch = process.env.BITBUCKET_BRANCH;
  
  if (prId && prDestinationBranch && sourceBranch) {
    return {
      type: 'pr',
      prNumber: prId,
      sourceBranch,
      targetBranch: prDestinationBranch
    };
  }
  
  // Any push (main or feature branch) → commit context
  if (process.env.BITBUCKET_COMMIT) {
    return {
      type: 'commit',
      commitSha: process.env.BITBUCKET_COMMIT
    };
  }
  
  throw new Error(
    'Bitbucket Pipelines: Could not detect context. ' +
    'Expected BITBUCKET_PR_ID or BITBUCKET_COMMIT to be set. ' +
    'This should be automatically provided by Bitbucket Pipelines.'
  );
}

/**
 * Gets commit SHA from Bitbucket environment
 */
function getCommitSha(): string | undefined {
  return process.env.BITBUCKET_COMMIT;
}

/**
 * Gets commit author for Bitbucket Pipelines
 * 
 * Bitbucket doesn't provide commit author as an environment variable,
 * so we use git log to get it.
 * 
 * This approach is verified by our test script (test-bitbucket-context.ts)
 * which successfully retrieves commit author in all scenarios:
 * - Direct commit to main
 * - Feature branch push
 * - PR pipeline
 * - Merge commit
 */
async function getCommitAuthor(repoRoot: string): Promise<{ name: string; email: string }> {
  // Use raw git commands - this is exactly what the test script uses and we know it works
  try {
    const name = execSync('git log -1 --format=%an', { encoding: 'utf-8', cwd: repoRoot }).trim();
    const email = execSync('git log -1 --format=%ae', { encoding: 'utf-8', cwd: repoRoot }).trim();
    
    if (!name || !email) {
      throw new Error('git log returned empty name or email');
    }
    
    return { name, email };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Bitbucket Pipelines: Failed to get commit author from git log. ` +
      `Error: ${errorMessage}`
    );
  }
}
