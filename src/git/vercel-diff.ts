import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../utils/git-diff-executor';

/**
 * Get diff for Vercel CI environment
 * 
 * Vercel provides VERCEL_GIT_COMMIT_SHA which contains the commit being deployed.
 * This function gets the diff for that specific commit using git show.
 * 
 * This is the ONLY implementation for Vercel - no fallbacks, no alternatives.
 * If this doesn't work, we fail with a clear error.
 */
export async function getVercelDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get commit SHA from Vercel environment variable
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!commitSha) {
    throw new Error(
      'VERCEL_GIT_COMMIT_SHA environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }

  // Get diff using git show - this is the ONLY way we get diff in Vercel
  const diff = await git.show([commitSha, '--format=', '--no-color', '-U200']);
  
  // Get changed files using git show --name-only
  const commitFiles = await git.show([commitSha, '--name-only', '--format=', '--pretty=format:']);
  const changedFiles = commitFiles
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.trim());

  return {
    diff: diff || '',
    changedFiles
  };
}

