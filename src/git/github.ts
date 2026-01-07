/**
 * GitHub Actions Environment - Complete Isolation
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
import * as fs from 'fs';
import { GitDiffResult } from '../utils/git-diff-executor';
import { getDefaultBranchName } from './repo';
import { getCommitMessage } from './diff';
import { ReviewContext } from '../utils/context';

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
 * Gets all GitHub context in one call - completely isolated from other environments.
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
  
  // Get commit author (fails loudly if unavailable)
  // Note: commitSha parameter not needed - GitHub reads from GITHUB_EVENT_PATH JSON
  const commitAuthor = await getCommitAuthor();
  
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
    context
  };
}

/**
 * Gets diff for GitHub Actions CI environment
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);
  const defaultBranch = await getDefaultBranchName(repoRoot);

  // Determine context from GitHub environment variables
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;
  const headRef = process.env.GITHUB_HEAD_REF;
  const refName = process.env.GITHUB_REF_NAME;
  const commitSha = process.env.GITHUB_SHA;

  // Scenario 1: PR Context
  if (eventName === 'pull_request') {
    if (!baseRef || !headRef) {
      throw new Error(
        'GitHub PR context detected but GITHUB_BASE_REF or GITHUB_HEAD_REF is missing. ' +
        'This should be automatically provided by GitHub Actions.'
      );
    }

    const diff = await git.diff([`origin/${baseRef}...origin/${headRef}`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${baseRef}...origin/${headRef}`]);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  // Scenario 2 & 4: Default Branch Push
  if (refName === defaultBranch && commitSha) {
    try {
      const diff = await git.diff([`origin/${defaultBranch}~1...origin/${defaultBranch}`, '-U200']);
      const diffSummary = await git.diffSummary([`origin/${defaultBranch}~1...origin/${defaultBranch}`]);
      const changedFiles = diffSummary.files.map(f => f.file);

      return {
        diff: diff || '',
        changedFiles
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Could not get diff for default branch '${defaultBranch}'. ` +
        `This might be the first commit on the branch. Error: ${errorMessage}`
      );
    }
  }

  // Scenario 3: Feature Branch Push
  if (refName) {
    const diff = await git.diff([`origin/${defaultBranch}...origin/${refName}`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${defaultBranch}...origin/${refName}`]);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  throw new Error(
    'GitHub Actions environment detected but no valid context found. ' +
    'Expected GITHUB_EVENT_NAME="pull_request" (with GITHUB_BASE_REF/GITHUB_HEAD_REF) ' +
    'or GITHUB_REF_NAME for branch context.'
  );
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
 * Detects GitHub context (PR, branch, or commit)
 */
function detectContext(): ReviewContext {
  // 1. Check for PR context
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
  
  // 2. Check for branch context
  if (process.env.GITHUB_REF_NAME) {
    return {
      type: 'branch',
      branchName: process.env.GITHUB_REF_NAME
    };
  }
  
  // 3. Check for commit context
  if (process.env.GITHUB_SHA) {
    return {
      type: 'commit',
      commitSha: process.env.GITHUB_SHA
    };
  }
  
  // 4. Fallback to local (shouldn't happen in GitHub Actions, but TypeScript needs it)
  return { type: 'local' };
}

/**
 * Gets commit SHA from context
 */
function getCommitSha(context: ReviewContext): string | undefined {
  if (context.type === 'commit') {
    return context.commitSha;
  }
  
  if (context.type === 'branch' || context.type === 'pr') {
    return process.env.GITHUB_SHA;
  }
  
  return undefined;
}

/**
 * Gets commit author for GitHub Actions
 * Reads from GITHUB_EVENT_PATH JSON file (most reliable)
 * Note: commitSha parameter not used - GitHub provides author info in event JSON
 */
async function getCommitAuthor(): Promise<{ name: string; email: string }> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error(
      'GitHub Actions: GITHUB_EVENT_PATH environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }
  
  if (!fs.existsSync(eventPath)) {
    throw new Error(
      `GitHub Actions: GITHUB_EVENT_PATH file does not exist: ${eventPath}. ` +
      'This should be automatically provided by GitHub Actions.'
    );
  }
  
  try {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    
    // For push events, use head_commit.author
    if (eventData.head_commit?.author) {
      return {
        name: eventData.head_commit.author.name,
        email: eventData.head_commit.author.email
      };
    }
    
    // For PR events, use commits[0].author (first commit in the PR)
    if (eventData.commits && eventData.commits.length > 0 && eventData.commits[0].author) {
      return {
        name: eventData.commits[0].author.name,
        email: eventData.commits[0].author.email
      };
    }
    
    // Fallback to pull_request.head.commit.author for PR events
    if (eventData.pull_request?.head?.commit?.author) {
      return {
        name: eventData.pull_request.head.commit.author.name,
        email: eventData.pull_request.head.commit.author.email
      };
    }
    
    // If we get here, the event JSON doesn't contain author info
    throw new Error(
      `GitHub Actions: GITHUB_EVENT_PATH JSON does not contain commit author information. ` +
      `Event type: ${eventData.action || 'unknown'}. ` +
      `This should be automatically provided by GitHub Actions.`
    );
  } catch (error: unknown) {
    // If JSON parsing fails, fail loudly
    if (error instanceof Error && error.message.includes('GitHub Actions:')) {
      throw error; // Re-throw our own errors
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `GitHub Actions: Failed to read or parse GITHUB_EVENT_PATH JSON: ${errorMessage}. ` +
      'This should be automatically provided by GitHub Actions.'
    );
  }
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

