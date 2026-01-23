/**
 * GitHub Actions Environment
 * 
 * All GitHub-specific logic is contained in this file.
 * No dependencies on other environment implementations.
 * 
 * Exports a single function: getGitHubContext() that returns:
 * - diff: GitDiffResult
 * - repoName: string
 * - branchName: string
 * - commitAuthor: { name: string; email: string }
 * - prTitle?: string
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../types/git';
import { getCommitMessage, getCommitAuthor, getPRDiff, getCommitDiff } from './diff';
import { ReviewContext } from '../utils/context';
import { ReviewContextType } from '../api/client';
import { logger } from '../utils/logger';

export interface GitHubContext {
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
 * Gets all GitHub context 
 */
export async function getGitHubContext(repoRoot: string): Promise<GitHubContext> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get all GitHub context
  const diff = await getDiff(repoRoot);
  const repoName = await getRepoName();
  const branchName = await getBranchName();
  const context = detectContext();
  const reviewContext = detectReviewContext();
  const commitSha = getCommitSha(context);
  
  // Validate commit SHA is available (should always be set in GitHub Actions)
  if (!commitSha) {
    throw new Error(
      'GitHub Actions: GITHUB_SHA environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }
  
  // Get commit author using git commands (same approach as Bitbucket/Local)
  // getCommitAuthor throws on failure with descriptive error
  const commitAuthor = await getCommitAuthor(repoRoot, commitSha);
  
  // Get commit message if we have a SHA
  let commitMessage: string | undefined;
  if (commitSha) {
    const message = await getCommitMessage(repoRoot, commitSha);
    if (message) {
      commitMessage = message;
    }
  }
  
  // Get PR title if in PR context
  const prTitle = getPRTitle(context);

  return {
    diff,
    repoName,
    branchName,
    commitSha,
    commitMessage,
    commitAuthor,
    prTitle,
    context,
    reviewContext
  };
}

/**
 * Gets diff for GitHub Actions CI environment
 * 
 * Strategy:
 * - PR context: Uses shared getPRDiff() - fetches base branch, compares against HEAD
 * - Any push (main or feature branch): Compare last commit only using git show HEAD
 * 
 * Note: GitHub Actions does shallow clones by default (fetch-depth: 1), so we fetch
 * the base branch on-demand. HEAD points to the merge commit which contains all PR changes.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;

  // PR Context: Use shared getPRDiff() implementation
  if (eventName === 'pull_request') {
    if (!baseRef) {
      throw new Error(
        'GitHub PR context detected but GITHUB_BASE_REF is missing. ' +
        'This should be automatically provided by GitHub Actions.'
      );
    }
    return getPRDiff(repoRoot, baseRef, logger);
  }

  // Any push (main or feature branch): Review last commit only
  // Use shared getCommitDiff (defaults to HEAD)
  return getCommitDiff(repoRoot);
}

/**
 * Gets repository name for GitHub Actions
 */
async function getRepoName(): Promise<string> {
  const githubRepo = process.env.GITHUB_REPOSITORY;
  if (!githubRepo) {
    throw new Error(
      'GitHub Actions: GITHUB_REPOSITORY environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  return `${serverUrl}/${githubRepo}.git`;
}

/**
 * Gets branch name for GitHub Actions
 */
async function getBranchName(): Promise<string> {
  const refName = process.env.GITHUB_REF_NAME;
  if (!refName) {
    throw new Error(
      'GitHub Actions: GITHUB_REF_NAME environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }

  return refName;
}

/**
 * Detects GitHub context (PR or commit)
 * 
 * - PR context: When GITHUB_EVENT_NAME is 'pull_request'
 * - Commit context: Any push (main or feature branch) - reviews single commit
 */
function detectContext(): ReviewContext {
  // PR context
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const targetBranch = process.env.GITHUB_BASE_REF;
    const sourceBranch = process.env.GITHUB_HEAD_REF;
    const prNumber = process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER || process.env.GITHUB_EVENT_NUMBER;
    
    if (targetBranch && sourceBranch && prNumber) {
      return {
        type: 'pr',
        prNumber,
        sourceBranch,
        targetBranch
      };
    }
  }
  
  // Any push (main or feature branch) → commit context
  if (process.env.GITHUB_SHA) {
    return {
      type: 'commit',
      commitSha: process.env.GITHUB_SHA
    };
  }
  
  throw new Error(
    'GitHub Actions: Could not detect context. ' +
    'Expected GITHUB_EVENT_NAME="pull_request" or GITHUB_SHA to be set. ' +
    'This should be automatically provided by GitHub Actions.'
  );
}

/**
 * Gets commit SHA from context
 */
function getCommitSha(context: ReviewContext): string | undefined {
  if (context.type === 'commit') {
    return context.commitSha;
  }
  
  if (context.type === 'pr') {
    return process.env.GITHUB_SHA;
  }
  
  return undefined;
}


/**
 * Detects review context type for API (simple string type)
 */
function detectReviewContext(): ReviewContextType {
  // PR context
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    return 'pr';
  }
  
  // Commit context (any push)
  return 'commit';
}

/**
 * Gets PR title for GitHub Actions
 * Note: GitHub Actions doesn't provide PR title as an env var by default.
 * It would need to be passed from the workflow YAML or fetched via API.
 */
function getPRTitle(context: ReviewContext): string | undefined {
  if (context.type !== 'pr') {
    return undefined;
  }
  
  // Only if passed from workflow: PR_TITLE: ${{ github.event.pull_request.title }}
  return process.env.PR_TITLE;
}

