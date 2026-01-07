import simpleGit, { SimpleGit } from 'simple-git';
import { GitDiffResult } from '../utils/git-diff-executor';

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
 * 
 * This is the ONLY implementation for GitLab - no fallbacks, no alternatives.
 */
export async function getGitLabDiff(repoRoot: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

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

    // Fetch target branch (GitLab doesn't have it by default)
    console.log(`  [GitLab] Fetching target branch: origin/${targetBranch}`);
    await git.fetch(['origin', `${targetBranch}:refs/remotes/origin/${targetBranch}`, '--depth=1']);

    // Diff target vs source
    const diff = await git.diff([`origin/${targetBranch}...origin/${sourceBranch}`, '-U200']);
    const diffSummary = await git.diffSummary([`origin/${targetBranch}...origin/${sourceBranch}`]);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  // Scenario 2 & 3: Branch Push
  if (!refName) {
    throw new Error(
      'GitLab CI environment detected but CI_COMMIT_REF_NAME is not set. ' +
      'This should be automatically provided by GitLab CI.'
    );
  }

  // Scenario 3: Default Branch Push (e.g., direct commit to main)
  if (refName === defaultBranch) {
    console.log(`  [GitLab] Push to default branch (${defaultBranch}), using HEAD~1...HEAD`);
    
    const diff = await git.diff(['HEAD~1...HEAD', '-U200']);
    const diffSummary = await git.diffSummary(['HEAD~1...HEAD']);
    const changedFiles = diffSummary.files.map(f => f.file);

    return {
      diff: diff || '',
      changedFiles
    };
  }

  // Scenario 2: Feature Branch Push
  console.log(`  [GitLab] Feature branch push, fetching default branch: origin/${defaultBranch}`);
  await git.fetch(['origin', `${defaultBranch}:refs/remotes/origin/${defaultBranch}`, '--depth=1']);

  // Diff default vs feature
  const diff = await git.diff([`origin/${defaultBranch}...origin/${refName}`, '-U200']);
  const diffSummary = await git.diffSummary([`origin/${defaultBranch}...origin/${refName}`]);
  const changedFiles = diffSummary.files.map(f => f.file);

  return {
    diff: diff || '',
    changedFiles
  };
}
