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
import { getCommitMessage, getCommitAuthor } from './diff';
import { ReviewContext } from '../utils/context';
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
  const commitSha = getCommitSha(context);
  
  // Validate commit SHA is available (should always be set in GitHub Actions)
  if (!commitSha) {
    throw new Error(
      'GitHub Actions: GITHUB_SHA environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }
  
  // Get commit author using git commands (same approach as Bitbucket/Local)
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

  // Validate commit author was found
  if (!commitAuthor) {
    throw new Error(
      `GitHub Actions: Failed to get commit author from git log for commit ${commitSha || 'HEAD'}. ` +
      'This should be automatically available in the git repository.'
    );
  }

  return {
    diff,
    repoName,
    branchName,
    commitSha,
    commitMessage,
    commitAuthor,
    prTitle,
    context
  };
}

/**
 * Gets diff for GitHub Actions CI environment
 * 
 * Strategy:
 * - PR context: Fetch base branch on-demand, compare base vs HEAD (full PR diff)
 * - Any push (main or feature branch): Compare last commit only (HEAD~1...HEAD)
 * 
 * Note: GitHub Actions does shallow clones by default (fetch-depth: 1), so we fetch
 * the base branch on-demand. HEAD points to the merge commit which contains all PR changes.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;

  // PR Context: Fetch base branch and compare with HEAD (merge commit)
  if (eventName === 'pull_request') {
    if (!baseRef) {
      throw new Error(
        'GitHub PR context detected but GITHUB_BASE_REF is missing. ' +
        'This should be automatically provided by GitHub Actions.'
      );
    }

    // Fetch base branch on-demand (works with shallow clones)
    logger.debug(`Fetching base branch: origin/${baseRef}`);
    await git.fetch(['origin', `${baseRef}:refs/remotes/origin/${baseRef}`, '--depth=1']);
    
    logger.debug(`PR context, using origin/${baseRef}...HEAD`);
    const diff = await git.diff([`origin/${baseRef}...HEAD`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${baseRef}...HEAD`]);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  // Any push (main or feature branch): Review last commit only
  const diff = await git.diff(['HEAD~1...HEAD', '-U200']);
  const diffSummary = await git.diffSummary(['HEAD~1...HEAD']);
  const changedFiles = diffSummary.files.map(f => f.file);

  return {
    diff: diff || '',
    changedFiles
  };
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

