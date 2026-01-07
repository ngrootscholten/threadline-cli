/**
 * Vercel Environment - Complete Isolation
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
import { execSync } from 'child_process';
import { GitDiffResult } from '../utils/git-diff-executor';
import { getCommitMessage } from './diff';
import { ReviewContext } from '../utils/context';

export interface VercelContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string; // Not applicable for Vercel, but included for consistency
  context: ReviewContext;
}

/**
 * Gets all Vercel context in one call - completely isolated from other environments.
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
  
  // Get commit author (fails loudly if unavailable)
  const commitAuthor = await getCommitAuthorForVercel(repoRoot, commitSha);
  
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
    context
  };
}

/**
 * Get diff for Vercel CI environment
 * 
 * Vercel provides VERCEL_GIT_COMMIT_SHA which contains the commit being deployed.
 * This function gets the diff for that specific commit using git show.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Get commit SHA from Vercel environment variable
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!commitSha) {
    throw new Error(
      'VERCEL_GIT_COMMIT_SHA environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }

  // Get diff using git show - this is the ONLY way we get diff in Vercel
  const diff = await git.show([commitSha, '--format=', '--no-color', '-U200']);
  
  // Get changed files using git show --name-only
  const commitFiles = await git.show([commitSha, '--name-only', '--format=', '--pretty=format:']);
  const changedFiles = commitFiles
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.trim());

  return {
    diff: diff || '',  // Empty diff is legitimate (e.g., metadata-only commits, merge commits)
    changedFiles
  };
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

/**
 * Gets commit author for Vercel
 * Uses VERCEL_GIT_COMMIT_AUTHOR_NAME for name, raw git log command for email
 * 
 * Uses raw `git log` command (same as test script) instead of simple-git library
 * because simple-git's log method may not work correctly in Vercel's shallow clone.
 */
async function getCommitAuthorForVercel(
  repoRoot: string,
  commitSha: string
): Promise<{ name: string; email: string }> {
  const authorName = process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME;
  if (!authorName) {
    throw new Error(
      'Vercel: VERCEL_GIT_COMMIT_AUTHOR_NAME environment variable is not set. ' +
      'This should be automatically provided by Vercel.'
    );
  }
  
  // Use raw git log command (same approach as test script) - more reliable than simple-git
  try {
    const email = execSync(
      `git log ${commitSha} -1 --format=%ae`,
      { encoding: 'utf-8', cwd: repoRoot }
    ).trim();
    
    if (!email) {
      throw new Error('Email is empty');
    }
    
    return {
      name: authorName.trim(),
      email: email.trim()
    };
  } catch (error) {
    throw new Error(
      `Vercel: Failed to get commit author email from git log for commit ${commitSha}. ` +
      `This should be available in Vercel's build environment. ` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

