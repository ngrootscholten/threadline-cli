import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../utils/git-diff-executor';
import { getDefaultBranchName } from './repo';

/**
 * Get diff for GitHub Actions CI environment
 * 
 * Handles four scenarios:
 * 
 * 1. PR Context (pull_request event):
 *    Uses GITHUB_BASE_REF vs GITHUB_HEAD_REF
 *    Shows: All changes in the PR
 * 
 * 2. Merge Commit to Default Branch (push event, default branch):
 *    Compare: origin/default~1 vs origin/default
 *    Shows: All changes that were merged in
 * 
 * 3. Feature Branch Push (push event, feature branch):
 *    Compare: origin/default vs origin/feature-branch
 *    Shows: Cumulative changes in feature branch vs default
 * 
 * 4. Direct Commit to Default Branch (push event, default branch, non-merge):
 *    Compare: origin/default~1 vs origin/default
 *    Shows: Changes in the direct commit
 * 
 * Known Limitation - Rebase and Merge:
 *    When using "Rebase and merge" strategy in GitHub, multiple commits are
 *    added to the default branch. Our approach (default~1 vs default) only
 *    captures the LAST commit, not all rebased commits. This is a naive
 *    implementation. To fully support rebase merges, we'd need to use the
 *    `before` SHA from GITHUB_EVENT_PATH to compare before...after.
 */
export async function getGitHubDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Detect the default branch name (e.g., "main", "master")
  // This is used for scenarios 2, 3, and 4
  const defaultBranch = await getDefaultBranchName(repoRoot);

  // Determine context from GitHub environment variables
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;
  const headRef = process.env.GITHUB_HEAD_REF;
  const refName = process.env.GITHUB_REF_NAME;
  const commitSha = process.env.GITHUB_SHA;

  // Scenario 1: PR Context
  // When a PR is created or updated, GitHub provides both base and head branches
  // This is the simplest case - we use what GitHub gives us directly
  if (eventName === 'pull_request') {
    if (!baseRef || !headRef) {
      throw new Error(
        'GitHub PR context detected but GITHUB_BASE_REF or GITHUB_HEAD_REF is missing. ' +
        'This should be automatically provided by GitHub Actions.'
      );
    }

    // Compare target branch (base) vs source branch (head)
    // This shows all changes in the PR
    const diff = await git.diff([`origin/${baseRef}...origin/${headRef}`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${baseRef}...origin/${headRef}`]);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  // Scenario 2 & 4: Default Branch Push (merge commit or direct commit)
  // When code is pushed to the default branch, we compare default~1 vs default
  // This works for both merge commits and direct commits:
  // - Merge commits: Shows all changes that were merged in
  // - Direct commits: Shows the changes in the direct commit
  if (refName === defaultBranch && commitSha) {
    // Compare default branch before the push (default~1) vs default branch after the push (default)
    // This shows all changes introduced by the push, whether merged or direct
    try {
      const diff = await git.diff([`origin/${defaultBranch}~1...origin/${defaultBranch}`, '-U200']);
      const diffSummary = await git.diffSummary([`origin/${defaultBranch}~1...origin/${defaultBranch}`]);
      const changedFiles = diffSummary.files.map(f => f.file);

      return {
        diff: diff || '',
        changedFiles
      };
    } catch (error: unknown) {
      // If we can't get the diff (e.g., first commit on branch), throw a clear error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Could not get diff for default branch '${defaultBranch}'. ` +
        `This might be the first commit on the branch. Error: ${errorMessage}`
      );
    }
  }

  // Scenario 3: Feature Branch Push
  // When code is pushed to a feature branch, we want to see all changes vs the default branch
  // Compare: origin/default vs origin/feature-branch
  // This shows cumulative changes in the feature branch (all commits vs default branch)
  // Note: We don't use HEAD~1 vs HEAD because that only shows the last commit,
  //       not the cumulative changes in the branch
  if (refName) {
    // For branch pushes, compare against origin/default (detected default branch)
    // GitHub Actions with fetch-depth: 0 should have origin/default available
    const diff = await git.diff([`origin/${defaultBranch}...origin/${refName}`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${defaultBranch}...origin/${refName}`]);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  // Neither PR nor branch context available
  throw new Error(
    'GitHub Actions environment detected but no valid context found. ' +
    'Expected GITHUB_EVENT_NAME="pull_request" (with GITHUB_BASE_REF/GITHUB_HEAD_REF) ' +
    'or GITHUB_REF_NAME for branch context.'
  );
}

