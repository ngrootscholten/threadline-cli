import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../utils/git-diff-executor';

/**
 * Get diff for local development environment
 * 
 * For local development, we check staged changes first, then unstaged changes.
 * This allows developers to review what they've staged before committing,
 * or review unstaged changes if nothing is staged.
 * 
 * This is the ONLY implementation for local - no fallbacks, no alternatives.
 * If this doesn't work, we fail with a clear error.
 */
export async function getLocalDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

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

