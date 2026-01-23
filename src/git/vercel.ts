/**
 * Vercel Environment
 * 
 * All Vercel-specific logic is contained in this file.
 * No dependencies on other environment implementations.
 * 
 * Exports a single function: getVercelContext() that returns:
 * - diff: GitDiffResult
 * - repoName: string
 * - branchName: string
 * - commitAuthor: { name: string; email: string }
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../types/git';
import { getCommitMessage, getCommitAuthor, getCommitDiff } from './diff';
import { ReviewContext } from '../utils/context';
import { ReviewContextType } from '../api/client';

export interface VercelContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string; // Not applicable for Vercel, but included for consistency
  context: ReviewContext;
  reviewContext: ReviewContextType;
}

/**
 * Gets all Vercel context
 */
export async function getVercelContext(repoRoot: string): Promise<VercelContext> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get all Vercel context
  const diff = await getDiff(repoRoot);
  const repoName = await getRepoName();
  const branchName = await getBranchName();
  const commitSha = getCommitSha();
  const context: ReviewContext = { type: 'commit', commitSha };
  const reviewContext: ReviewContextType = 'commit';
  
  // Get commit author using shared function (git log)
  // getCommitAuthor throws on failure with descriptive error
  const commitAuthor = await getCommitAuthor(repoRoot, commitSha);
  
  // Get commit message
  let commitMessage: string | undefined;
  const message = await getCommitMessage(repoRoot, commitSha);
  if (message) {
    commitMessage = message;
  }

  return {
    diff,
    repoName,
    branchName,
    commitSha,
    commitMessage,
    commitAuthor,
    context,
    reviewContext
  };
}

/**
 * Get diff for Vercel CI environment
 * 
 * Vercel only supports commit context (no PRs).
 * Uses shared getCommitDiff with HEAD (which equals VERCEL_GIT_COMMIT_SHA).
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  // Use shared getCommitDiff (defaults to HEAD)
  // In Vercel, HEAD is the commit being deployed
  return getCommitDiff(repoRoot);
}

/**
 * Gets repository name for Vercel
 */
async function getRepoName(): Promise<string> {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;

  if (!owner || !slug) {
    throw new Error(
      'Vercel: VERCEL_GIT_REPO_OWNER or VERCEL_GIT_REPO_SLUG environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }

  return `https://github.com/${owner}/${slug}.git`;
}

/**
 * Gets branch name for Vercel
 */
async function getBranchName(): Promise<string> {
  const branchName = process.env.VERCEL_GIT_COMMIT_REF;
  if (!branchName) {
    throw new Error(
      'Vercel: VERCEL_GIT_COMMIT_REF environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }

  return branchName;
}

/**
 * Gets commit SHA for Vercel
 */
function getCommitSha(): string {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!commitSha) {
    throw new Error(
      'Vercel: VERCEL_GIT_COMMIT_SHA environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }
  return commitSha;
}


