/**
 * Bitbucket Pipelines Environment - Complete Isolation
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
import { GitDiffResult } from '../utils/git-diff-executor';
import { getCommitMessage } from './diff';
import { ReviewContext } from '../utils/context';

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
 * Bitbucket Pipelines with depth: full has full git history available,
 * including origin/main. Unlike GitLab, no fetch is needed.
 * 
 * Diff Strategy:
 * 
 * | Scenario                  | Target Branch Known?                        | Diff Command                              |
 * |---------------------------|---------------------------------------------|-------------------------------------------|
 * | PR                        | ✅ Yes - BITBUCKET_PR_DESTINATION_BRANCH    | origin/${destination}...HEAD              |
 * | Feature branch (no PR)    | ❌ No - detect main/master                  | origin/main...HEAD or origin/master...HEAD|
 * | Push to default branch    | N/A                                         | HEAD~1...HEAD                             |
 * 
 * Key point: For PRs, Bitbucket provides BITBUCKET_PR_DESTINATION_BRANCH - this is the
 * most relevant comparison point because it's where the code will be merged.
 * 
 * For non-PR feature branches, Bitbucket does NOT provide a default branch env var
 * (unlike GitLab's CI_DEFAULT_BRANCH), so we detect by checking if origin/main or
 * origin/master exists.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  const branchName = process.env.BITBUCKET_BRANCH;
  const prId = process.env.BITBUCKET_PR_ID;
  const prDestinationBranch = process.env.BITBUCKET_PR_DESTINATION_BRANCH;

  // Scenario 1: PR context - use the target branch from env var
  if (prId) {
    if (!prDestinationBranch) {
      throw new Error(
        'Bitbucket PR context detected but BITBUCKET_PR_DESTINATION_BRANCH is not set. ' +
        'This should be automatically provided by Bitbucket Pipelines.'
      );
    }
    
    console.log(`  [Bitbucket] PR #${prId}, using origin/${prDestinationBranch}...HEAD`);
    const diff = await git.diff([`origin/${prDestinationBranch}...HEAD`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${prDestinationBranch}...HEAD`]);
    const changedFiles = diffSummary.files.map(f => f.file);
    return { diff: diff || '', changedFiles };
  }

  // Scenario 2: Non-PR push
  if (!branchName) {
    throw new Error(
      'Bitbucket Pipelines: BITBUCKET_BRANCH environment variable is not set. ' +
      'This should be automatically provided by Bitbucket Pipelines.'
    );
  }

  // Detect the default branch (Bitbucket doesn't provide this as an env var)
  const defaultBranch = await detectDefaultBranch(git);

  // If we're on the default branch, just show the last commit
  if (branchName === defaultBranch) {
    console.log(`  [Bitbucket] Push to ${defaultBranch}, using HEAD~1...HEAD`);
    const diff = await git.diff(['HEAD~1...HEAD', '-U200']);
    const diffSummary = await git.diffSummary(['HEAD~1...HEAD']);
    const changedFiles = diffSummary.files.map(f => f.file);
    return { diff: diff || '', changedFiles };
  }

  // Feature branch: compare against default branch
  // This shows all changes the branch introduces, correctly excluding
  // any commits merged in from the default branch
  console.log(`  [Bitbucket] Feature branch "${branchName}", using origin/${defaultBranch}...HEAD`);
  const diff = await git.diff([`origin/${defaultBranch}...HEAD`, '-U200']);
  const diffSummary = await git.diffSummary([`origin/${defaultBranch}...HEAD`]);
  const changedFiles = diffSummary.files.map(f => f.file);
  return { diff: diff || '', changedFiles };
}

/**
 * Detect the default branch for Bitbucket Pipelines.
 * 
 * Bitbucket does NOT provide a default branch env var (unlike GitLab's CI_DEFAULT_BRANCH
 * or GitHub's repository.default_branch in the event JSON).
 * 
 * We try 'main' first (most common), then 'master' as fallback.
 * This covers the vast majority of repositories.
 *  
 * ---
 * Design Decision: We compare against main instead of just checking the last commit
 * 
 * Threadlines assumes that feature branches are intended to eventually merge to the
 * default branch. Comparing against main shows ALL changes the branch introduces,
 * which is what you want to review before merging.
 * 
 * Per-commit checking happens during local development.
 * ---
 */
async function detectDefaultBranch(git: SimpleGit): Promise<string> {
  // Try 'main' first (modern default)
  try {
    await git.revparse(['--verify', 'origin/main']);
    return 'main';
  } catch {
    // origin/main doesn't exist, try master
  }
  
  // Try 'master' (legacy default)
  try {
    await git.revparse(['--verify', 'origin/master']);
    return 'master';
  } catch {
    // origin/master doesn't exist either
  }
  
  throw new Error(
    'Bitbucket Pipelines: Cannot determine default branch. ' +
    'Neither origin/main nor origin/master found. ' +
    'For repositories with a different default branch, create a PR to trigger branch comparison.'
  );
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
 * Detects Bitbucket context (PR, branch, or commit)
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
  
  // Branch context
  if (process.env.BITBUCKET_BRANCH) {
    return {
      type: 'branch',
      branchName: process.env.BITBUCKET_BRANCH
    };
  }
  
  // Commit context
  if (process.env.BITBUCKET_COMMIT) {
    return {
      type: 'commit',
      commitSha: process.env.BITBUCKET_COMMIT
    };
  }
  
  // Fallback to local (shouldn't happen in Bitbucket Pipelines)
  return { type: 'local' };
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
