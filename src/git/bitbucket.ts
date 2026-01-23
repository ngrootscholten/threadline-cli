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
import { GitDiffResult } from '../types/git';
import { getCommitMessage, getCommitAuthor, getPRDiff, getCommitDiff } from './diff';
import { ReviewContext } from '../utils/context';
import { ReviewContextType } from '../api/client';
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
  reviewContext: ReviewContextType;
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
  const reviewContext = detectReviewContext();
  const commitSha = getCommitSha();
  
  // Get commit author using shared function (git log)
  // getCommitAuthor throws on failure with descriptive error
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
    context,
    reviewContext
  };
}

/**
 * Get diff for Bitbucket Pipelines environment
 * 
 * Strategy:
 * - PR context: Uses shared getPRDiff() - fetches destination branch, compares against HEAD
 * - Any push (main or feature branch): Compare last commit only (HEAD~1...HEAD)
 * 
 * Note: We fetch the destination branch on-demand so this works with shallow clones.
 * Users don't need `depth: full` in their bitbucket-pipelines.yml.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const prId = process.env.BITBUCKET_PR_ID;
  const prDestinationBranch = process.env.BITBUCKET_PR_DESTINATION_BRANCH;

  // PR Context: Use shared getPRDiff() implementation
  if (prId) {
    if (!prDestinationBranch) {
      throw new Error(
        'Bitbucket PR context detected but BITBUCKET_PR_DESTINATION_BRANCH is not set. ' +
        'This should be automatically provided by Bitbucket Pipelines.'
      );
    }
    return getPRDiff(repoRoot, prDestinationBranch, logger);
  }

  // Any push (main or feature branch): Review last commit only
  // Use shared getCommitDiff (defaults to HEAD)
  return getCommitDiff(repoRoot);
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
 * Detects review context type for API (simple string type)
 */
function detectReviewContext(): ReviewContextType {
  // PR context
  if (process.env.BITBUCKET_PR_ID) {
    return 'pr';
  }
  
  // Commit context (any push)
  return 'commit';
}

/**
 * Gets commit SHA from Bitbucket environment
 */
function getCommitSha(): string | undefined {
  return process.env.BITBUCKET_COMMIT;
}

