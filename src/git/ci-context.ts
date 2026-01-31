/**
 * Unified CI Context
 * 
 * Single function to get context for ANY CI environment.
 * Uses:
 * - Shared git commands for: repo URL, commit SHA, author, message, diff
 * - CI-specific env vars (via ci-config.ts) for: PR detection, branch name, PR title
 * 
 * This replaces the individual github.ts, gitlab.ts, bitbucket.ts, vercel.ts files.
 */

import { execSync } from 'child_process';
import { GitDiffResult } from '../types/git';
import { ReviewContextType } from '../api/client';
import { logger } from '../utils/logger';
import { CIEnvironment, CI_CONFIGS } from './ci-config';
import {
  getRepoUrl,
  getHeadCommitSha,
  getCommitAuthor,
  getCommitMessage,
  getPRDiff,
  getCommitDiff,
} from './diff';

export interface CIContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string;
  reviewContext: ReviewContextType;
}

/**
 * Get context for any CI environment.
 * 
 * This is the SINGLE entry point for all CI environments.
 * It uses shared git commands for most data, and only reads
 * CI-specific env vars for things git can't provide reliably.
 * 
 * @param repoRoot - Path to the repository root
 * @param environment - The CI environment (github, gitlab, bitbucket, vercel)
 */
export async function getCIContext(
  repoRoot: string,
  environment: CIEnvironment
): Promise<CIContext> {
  const config = CI_CONFIGS[environment];

  // Check if we're in a git repo
  try {
    execSync('git rev-parse --git-dir', { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // === SHARED GIT COMMANDS (reliable across all CI environments) ===
  const repoName = await getRepoUrl(repoRoot);
  const commitSha = await getHeadCommitSha(repoRoot);
  const commitAuthor = await getCommitAuthor(repoRoot);
  const commitMessage = await getCommitMessage(repoRoot, commitSha);

  // === CI-SPECIFIC ENV VARS (only for things git can't provide) ===
  const branchName = config.getBranchName();
  const isPR = config.isPullRequest();
  const reviewContext: ReviewContextType = isPR ? 'pr' : 'commit';
  const prTitle = isPR ? config.getPRTitle() : undefined;

  // Get diff using appropriate strategy
  let diff: GitDiffResult;
  if (isPR) {
    const targetBranch = config.getTargetBranch();
    if (!targetBranch) {
      throw new Error(
        `${environment} PR context detected but target branch is missing. ` +
        'This should be automatically provided by the CI environment.'
      );
    }
    diff = await getPRDiff(repoRoot, targetBranch, logger);
  } else {
    diff = await getCommitDiff(repoRoot);
  }

  return {
    diff,
    repoName,
    branchName,
    commitSha,
    commitMessage,
    commitAuthor,
    prTitle,
    reviewContext,
  };
}
