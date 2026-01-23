/**
 * Local Environment
 * 
 * All Local-specific logic is contained in this file.
 * No dependencies on other environment implementations.
 * 
 * Exports a single function: getLocalContext() that returns:
 * - diff: GitDiffResult
 * - repoName: string
 * - branchName: string
 * - commitAuthor: { name: string; email: string }
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../types/git';
import { getCommitMessage, getCommitAuthor, getCommitDiff, getRepoUrl } from './diff';
import { ReviewContextType } from '../api/client';

export interface LocalContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string; // Not applicable for local, but included for consistency
  reviewContext: ReviewContextType;
}

/**
 * Gets all Local context 
 */
export async function getLocalContext(
  repoRoot: string,
  commitSha?: string
): Promise<LocalContext> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get all Local context
  const diff = commitSha ? await getCommitDiff(repoRoot, commitSha) : await getDiff(repoRoot);
  const repoName = await getRepoUrl(repoRoot);  // Shared git command
  const branchName = await getBranchName(repoRoot);
  const reviewContext: ReviewContextType = commitSha ? 'commit' : 'local';
  
  // Get commit author (fails loudly if unavailable)
  const commitAuthor = commitSha
    ? await getCommitAuthorFromGit(repoRoot, commitSha)
    : await getCommitAuthorFromConfig(repoRoot);
  
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
    prTitle: undefined, // Not applicable for local
    reviewContext
  };
}

/**
 * Get diff for local development environment
 * 
 * For local development, we check staged changes first, then unstaged changes.
 * This allows developers to review what they've staged before committing,
 * or review unstaged changes if nothing is staged.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Get git status to determine what changes exist
  const status = await git.status();
  
  let diff: string;
  let changedFiles: string[];

  // Priority 1: Use staged changes if available
  if (status.staged.length > 0) {
    diff = await git.diff(['--cached', '-U200']);
    // status.staged is an array of strings (file paths)
    changedFiles = status.staged;
  }
  // Priority 2: Use unstaged changes if no staged changes
  else if (status.files.length > 0) {
    diff = await git.diff(['-U200']);
    changedFiles = status.files
      .filter(f => f.working_dir !== ' ' || f.index !== ' ')
      .map(f => f.path);
  }
  // No changes at all
  else {
    return {
      diff: '',
      changedFiles: []
    };
  }

  return {
    diff: diff || '',
    changedFiles
  };
}


/**
 * Gets branch name for local environment
 * (Uses git command directly - works in local because not in detached HEAD state)
 */
async function getBranchName(repoRoot: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoRoot);

  try {
    const branchSummary = await git.branchLocal();
    const currentBranch = branchSummary.current;
    
    if (!currentBranch) {
      throw new Error('Could not determine current branch. Are you in a git repository?');
    }

    return currentBranch;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get branch name: ${errorMessage}`);
  }
}

/**
 * Gets commit author from git config (for uncommitted changes)
 * This represents who is currently working on the changes and will commit them.
 * 
 * No fallbacks - if git config is not set or fails, throws an error.
 */
async function getCommitAuthorFromConfig(repoRoot: string): Promise<{ name: string; email: string }> {
  const git: SimpleGit = simpleGit(repoRoot);
  
  try {
    const name = await git.getConfig('user.name');
    const email = await git.getConfig('user.email');
    
    if (!name.value || !email.value) {
      throw new Error(
        'Git config user.name or user.email is not set. ' +
        'Run: git config user.name "Your Name" && git config user.email "your.email@example.com"'
      );
    }
    
    return {
      name: name.value.trim(),
      email: email.value.trim()
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get git config user: ${errorMessage}`);
  }
}

/**
 * Gets commit author from git log (for specific commits)
 * getCommitAuthor throws on failure with descriptive error
 */
async function getCommitAuthorFromGit(
  repoRoot: string,
  commitSha: string
): Promise<{ name: string; email: string }> {
  return getCommitAuthor(repoRoot, commitSha);
}

