/**
 * Review Context Detection
 * 
 * Determines what type of code review context we're in:
 * - PR/MR: Multiple commits comparing two branches
 * - Branch: All commits on a branch vs base branch
 * - Commit: Single commit changes
 * - Local: Staged/unstaged changes in working directory
 * 
 * Context detection is environment-specific - each CI platform
 * provides different environment variables.
 */

import { Environment } from './environment';

export type ContextType = 'pr' | 'mr' | 'branch' | 'commit' | 'local';

export interface PRContext {
  type: 'pr';
  prNumber: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface MRContext {
  type: 'mr';
  mrNumber: string;
  sourceBranch: string;
  targetBranch: string;
  prTitle?: string; // Available in GitLab CI
}

export interface BranchContext {
  type: 'branch';
  branchName: string;
}

export interface CommitContext {
  type: 'commit';
  commitSha: string;
}

export interface LocalContext {
  type: 'local';
}

export type ReviewContext = PRContext | MRContext | BranchContext | CommitContext | LocalContext;

/**
 * Detects the review context based on the environment.
 * 
 * Each environment has different environment variables available,
 * so detection logic is environment-specific.
 */
export function detectContext(environment: Environment): ReviewContext {
  switch (environment) {
    case 'github':
      return detectGitHubContext();
    case 'gitlab':
      return detectGitLabContext();
    case 'vercel':
      return detectVercelContext();
    case 'local':
      return { type: 'local' };
    default:
      return { type: 'local' };
  }
}

/**
 * GitHub Actions context detection
 * 
 * Environment Variables:
 * - PR: GITHUB_EVENT_NAME='pull_request', GITHUB_BASE_REF, GITHUB_HEAD_REF, GITHUB_EVENT_NUMBER
 * - Branch: GITHUB_REF_NAME
 * - Commit: GITHUB_SHA
 */
function detectGitHubContext(): ReviewContext {
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
  
  // 4. Fallback to local
  return { type: 'local' };
}

/**
 * GitLab CI context detection
 * 
 * Environment Variables:
 * - MR: CI_MERGE_REQUEST_IID, CI_MERGE_REQUEST_TARGET_BRANCH_NAME, CI_MERGE_REQUEST_SOURCE_BRANCH_NAME, CI_MERGE_REQUEST_TITLE
 * - Branch: CI_COMMIT_REF_NAME
 * - Commit: CI_COMMIT_SHA
 */
function detectGitLabContext(): ReviewContext {
  // 1. Check for MR context
  if (process.env.CI_MERGE_REQUEST_IID) {
    const targetBranch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
    const sourceBranch = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
    const mrNumber = process.env.CI_MERGE_REQUEST_IID;
    const mrTitle = process.env.CI_MERGE_REQUEST_TITLE;
    
    if (targetBranch && sourceBranch && mrNumber) {
      return {
        type: 'mr',
        mrNumber,
        sourceBranch,
        targetBranch,
        prTitle: mrTitle || undefined
      };
    }
  }
  
  // 2. Check for branch context
  if (process.env.CI_COMMIT_REF_NAME) {
    return {
      type: 'branch',
      branchName: process.env.CI_COMMIT_REF_NAME
    };
  }
  
  // 3. Check for commit context
  if (process.env.CI_COMMIT_SHA) {
    return {
      type: 'commit',
      commitSha: process.env.CI_COMMIT_SHA
    };
  }
  
  // 4. Fallback to local
  return { type: 'local' };
}

/**
 * Vercel context detection
 * 
 * Environment Variables:
 * - Branch: VERCEL_GIT_COMMIT_REF
 * - Commit: VERCEL_GIT_COMMIT_SHA
 * 
 * Vercel Limitation:
 * Vercel performs shallow clones of the repository, typically fetching only the
 * specific commit being deployed. The git repository in Vercel's build environment
 * does not contain the full git history or remote branch references (e.g., origin/main).
 * This means branch-based diff operations (comparing feature branch against base branch)
 * are not possible because the base branch refs are not available in the repository.
 * 
 * Solution:
 * We hardcode commit context for Vercel, using VERCEL_GIT_COMMIT_SHA to get a
 * commit-based diff (comparing the commit against its parent). This works within
 * Vercel's constraints since we only need the commit SHA, not branch references.
 */
function detectVercelContext(): ReviewContext {
  // Hardcode commit context for Vercel due to shallow clone limitations
  // Vercel's git repository doesn't have base branch refs available
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return {
      type: 'commit',
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA
    };
  }
  
  // Fallback to local
  return { type: 'local' };
}

