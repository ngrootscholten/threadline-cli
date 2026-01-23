/**
 * GitLab CI Environment
 * 
 * All GitLab-specific logic is contained in this file.
 * No dependencies on other environment implementations.
 * 
 * Exports a single function: getGitLabContext() that returns:
 * - diff: GitDiffResult
 * - repoName: string
 * - branchName: string
 * - commitAuthor: { name: string; email: string }
 * - prTitle?: string (MR title)
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../types/git';
import { getCommitMessage, getPRDiff, getCommitAuthor, getCommitDiff } from './diff';
import { ReviewContext } from '../utils/context';
import { ReviewContextType } from '../api/client';
import { logger } from '../utils/logger';

export interface GitLabContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string; // MR title
  context: ReviewContext;
  reviewContext: ReviewContextType;
}

/**
 * Gets all GitLab context
 */
export async function getGitLabContext(repoRoot: string): Promise<GitLabContext> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get all GitLab context
  const diff = await getDiff(repoRoot);
  const repoName = await getRepoName();
  const branchName = await getBranchName();
  const context = detectContext();
  const reviewContext = detectReviewContext();
  const commitSha = getCommitSha(context);
  
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
  
  // Get MR title if in MR context
  const prTitle = getMRTitle(context);

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
 * Get diff for GitLab CI environment
 * 
 * Strategy:
 * - MR context: Uses shared getPRDiff() - fetches target branch, compares against HEAD
 * - Any push (main or feature branch): Compare last commit only (HEAD~1...HEAD)
 * 
 * Note: GitLab CI does a shallow clone, so we fetch the target branch for MR context.
 * For regular pushes, HEAD~1...HEAD works without additional fetching.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const mrIid = process.env.CI_MERGE_REQUEST_IID;
  const targetBranch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;

  // MR Context: Use shared getPRDiff() implementation
  if (mrIid) {
    if (!targetBranch) {
      throw new Error(
        'GitLab MR context detected but CI_MERGE_REQUEST_TARGET_BRANCH_NAME is missing. ' +
        'This should be automatically provided by GitLab CI.'
      );
    }
    return getPRDiff(repoRoot, targetBranch, logger);
  }

  // Any push (main or feature branch): Review last commit only
  // Use shared getCommitDiff (defaults to HEAD)
  return getCommitDiff(repoRoot);
}

/**
 * Gets repository name for GitLab CI
 */
async function getRepoName(): Promise<string> {
  const projectUrl = process.env.CI_PROJECT_URL;
  if (!projectUrl) {
    throw new Error(
      'GitLab CI: CI_PROJECT_URL environment variable is not set. ' +
      'This should be automatically provided by GitLab CI.'
    );
  }
  return `${projectUrl}.git`;
}

/**
 * Gets branch name for GitLab CI
 */
async function getBranchName(): Promise<string> {
  const refName = process.env.CI_COMMIT_REF_NAME;
  if (!refName) {
    throw new Error(
      'GitLab CI: CI_COMMIT_REF_NAME environment variable is not set. ' +
      'This should be automatically provided by GitLab CI.'
    );
  }
  return refName;
}

/**
 * Detects GitLab context (MR or commit)
 * 
 * - MR context: When CI_MERGE_REQUEST_IID is set
 * - Commit context: Any push (main or feature branch) - reviews single commit
 */
function detectContext(): ReviewContext {
  // MR context
  const mrIid = process.env.CI_MERGE_REQUEST_IID;
  if (mrIid) {
    const targetBranch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
    const sourceBranch = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
    
    if (targetBranch && sourceBranch) {
      return {
        type: 'mr',
        mrNumber: mrIid,
        sourceBranch,
        targetBranch
      };
    }
  }
  
  // Any push (main or feature branch) → commit context
  if (process.env.CI_COMMIT_SHA) {
    return {
      type: 'commit',
      commitSha: process.env.CI_COMMIT_SHA
    };
  }
  
  throw new Error(
    'GitLab CI: Could not detect context. ' +
    'Expected CI_MERGE_REQUEST_IID or CI_COMMIT_SHA to be set. ' +
    'This should be automatically provided by GitLab CI.'
  );
}

/**
 * Detects review context type for API (simple string type)
 */
function detectReviewContext(): ReviewContextType {
  // MR context
  if (process.env.CI_MERGE_REQUEST_IID) {
    return 'pr';
  }
  
  // Commit context (any push)
  return 'commit';
}

/**
 * Gets commit SHA from context
 */
function getCommitSha(context: ReviewContext): string | undefined {
  if (context.type === 'commit') {
    return context.commitSha;
  }
  
  if (context.type === 'mr') {
    return process.env.CI_COMMIT_SHA;
  }
  
  return undefined;
}


/**
 * Gets MR title for GitLab CI
 */
function getMRTitle(context: ReviewContext): string | undefined {
  if (context.type !== 'mr') {
    return undefined;
  }
  
  // GitLab CI provides MR title as env var
  return process.env.CI_MERGE_REQUEST_TITLE;
}

