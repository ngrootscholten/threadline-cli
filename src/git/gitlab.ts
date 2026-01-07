/**
 * GitLab CI Environment - Complete Isolation
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
import { GitDiffResult } from '../utils/git-diff-executor';
import { getCommitMessage } from './diff';
import { ReviewContext } from '../utils/context';

export interface GitLabContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string; // MR title
  context: ReviewContext;
}

/**
 * Gets all GitLab context in one call - completely isolated from other environments.
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
  const commitSha = getCommitSha(context);
  
  // Get commit author (fails loudly if unavailable)
  const commitAuthor = await getCommitAuthor();
  
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
    context
  };
}

/**
 * Get diff for GitLab CI environment
 * 
 * GitLab CI does a shallow clone of ONLY the current branch. The default branch
 * (e.g., origin/main) is NOT available by default. We fetch it on-demand.
 * 
 * Scenarios handled:
 * 
 * 1. MR Context (CI_MERGE_REQUEST_IID is set):
 *    - Fetch target branch, then diff target vs source
 * 
 * 2. Feature Branch Push (CI_COMMIT_REF_NAME != CI_DEFAULT_BRANCH):
 *    - Fetch default branch, then diff default vs feature
 * 
 * 3. Default Branch Push (CI_COMMIT_REF_NAME == CI_DEFAULT_BRANCH):
 *    - Use HEAD~1...HEAD (last commit only, no fetch needed)
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Get GitLab CI environment variables
  const mrIid = process.env.CI_MERGE_REQUEST_IID;
  const targetBranch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
  const sourceBranch = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
  const refName = process.env.CI_COMMIT_REF_NAME;
  const defaultBranch = process.env.CI_DEFAULT_BRANCH || 'main';

  // Scenario 1: MR Context
  if (mrIid) {
    if (!targetBranch || !sourceBranch) {
      throw new Error(
        'GitLab MR context detected but CI_MERGE_REQUEST_TARGET_BRANCH_NAME or ' +
        'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME is missing. ' +
        'This should be automatically provided by GitLab CI.'
      );
    }
    console.log(`  [GitLab] Fetching target branch: origin/${targetBranch}`);
    await git.fetch(['origin', `${targetBranch}:refs/remotes/origin/${targetBranch}`, '--depth=1']);
    const diff = await git.diff([`origin/${targetBranch}...origin/${sourceBranch}`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${targetBranch}...origin/${sourceBranch}`]);
    const changedFiles = diffSummary.files.map(f => f.file);
    return { diff: diff || '', changedFiles };
  }

  if (!refName) {
    throw new Error(
      'GitLab CI: CI_COMMIT_REF_NAME environment variable is not set. ' +
      'This should be automatically provided by GitLab CI.'
    );
  }

  // Scenario 3: Default Branch Push
  if (refName === defaultBranch) {
    console.log(`  [GitLab] Push to default branch (${defaultBranch}), using HEAD~1...HEAD`);
    const diff = await git.diff(['HEAD~1...HEAD', '-U200']);
    const diffSummary = await git.diffSummary(['HEAD~1...HEAD']);
    const changedFiles = diffSummary.files.map(f => f.file);
    return { diff: diff || '', changedFiles };
  }

  // Scenario 2: Feature Branch Push
  console.log(`  [GitLab] Feature branch push, fetching default branch: origin/${defaultBranch}`);
  await git.fetch(['origin', `${defaultBranch}:refs/remotes/origin/${defaultBranch}`, '--depth=1']);
  const diff = await git.diff([`origin/${defaultBranch}...origin/${refName}`, '-U200']);
  const diffSummary = await git.diffSummary([`origin/${defaultBranch}...origin/${refName}`]);
  const changedFiles = diffSummary.files.map(f => f.file);
  return { diff: diff || '', changedFiles };
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
 * Detects GitLab context (MR, branch, or commit)
 */
function detectContext(): ReviewContext {
  // 1. Check for MR context
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
  
  // 4. Fallback to local (shouldn't happen in GitLab CI, but TypeScript needs it)
  return { type: 'local' };
}

/**
 * Gets commit SHA from context
 */
function getCommitSha(context: ReviewContext): string | undefined {
  if (context.type === 'commit') {
    return context.commitSha;
  }
  
  if (context.type === 'branch' || context.type === 'mr') {
    return process.env.CI_COMMIT_SHA;
  }
  
  return undefined;
}

/**
 * Gets commit author for GitLab CI
 * Uses CI_COMMIT_AUTHOR environment variable (most reliable)
 */
async function getCommitAuthor(): Promise<{ name: string; email: string }> {
  const commitAuthor = process.env.CI_COMMIT_AUTHOR;
  if (!commitAuthor) {
    throw new Error(
      'GitLab CI: CI_COMMIT_AUTHOR environment variable is not set. ' +
      'This should be automatically provided by GitLab CI.'
    );
  }
  
  // Parse "name <email>" format
  const match = commitAuthor.match(/^(.+?)\s*<(.+?)>$/);
  if (!match) {
    throw new Error(
      `GitLab CI: CI_COMMIT_AUTHOR format is invalid. ` +
      `Expected format: "name <email>", got: "${commitAuthor}". ` +
      `This should be automatically provided by GitLab CI in the correct format.`
    );
  }
  
  return {
    name: match[1].trim(),
    email: match[2].trim()
  };
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

