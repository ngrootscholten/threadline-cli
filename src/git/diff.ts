import simpleGit, { SimpleGit } from 'simple-git';

export interface GitDiffResult {
  diff: string;
  changedFiles: string[];
}

/**
 * Get commit message for a specific commit SHA
 * Returns full commit message (subject + body) or null if commit not found
 */
export async function getCommitMessage(repoRoot: string, sha: string): Promise<string | null> {
  const git: SimpleGit = simpleGit(repoRoot);

  try {
    // Get full commit message (subject + body)
    const message = await git.show([sha, '--format=%B', '--no-patch']);
    return message.trim() || null;
  } catch {
    // Commit not found or invalid
    return null;
  }
}

/**
 * Get commit author name and email for a specific commit SHA or HEAD.
 * 
 * Uses git log to extract author information from the commit.
 * Works in all environments where git is available.
 */
export async function getCommitAuthor(
  repoRoot: string,
  sha?: string
): Promise<{ name: string; email: string } | null> {
  const git: SimpleGit = simpleGit(repoRoot);

  try {
    let logResult;
    
    if (sha) {
      // Use git log for specific commit SHA
      logResult = await git.log({ from: sha, to: sha, maxCount: 1 });
    } else {
      // Use git log for HEAD (local environment only)
      logResult = await git.log({ maxCount: 1 });
    }

    if (!logResult.latest) {
      return null;
    }

    const name = logResult.latest.author_name?.trim();
    const email = logResult.latest.author_email?.trim();

    if (!name || !email) {
      return null;
    }

    return { name, email };
  } catch {
    return null;
  }
}

/**
 * Get diff for a specific commit
 */
export async function getCommitDiff(repoRoot: string, sha: string): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get diff for the commit
  // Use git show to get the commit diff
  let diff: string;
  let changedFiles: string[];
  
  try {
    // Get diff using git show
    diff = await git.show([sha, '--format=', '--no-color', '-U200']);
    
    // Get changed files using git show --name-only
    const commitFiles = await git.show([sha, '--name-only', '--format=', '--pretty=format:']);
    changedFiles = commitFiles
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.trim());
  } catch (error: unknown) {
    // Fallback: try git diff format
    try {
      diff = await git.diff([`${sha}^..${sha}`, '-U200']);
      // Get files from diff summary
      const diffSummary = await git.diffSummary([`${sha}^..${sha}`]);
      changedFiles = diffSummary.files.map(f => f.file);
    } catch (diffError: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const diffErrorMessage = diffError instanceof Error ? diffError.message : 'Unknown error';
      throw new Error(`Commit ${sha} not found or invalid: ${errorMessage || diffErrorMessage}`);
    }
  }

  return {
    diff: diff || '',
    changedFiles
  };
}

