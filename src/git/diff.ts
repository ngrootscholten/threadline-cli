import simpleGit, { SimpleGit } from 'simple-git';
import { execSync } from 'child_process';

export interface GitDiffResult {
  diff: string;
  changedFiles: string[];
}

// =============================================================================
// CORE GIT OPERATIONS
// These functions use raw git commands and work reliably across all CI environments.
// They are the single source of truth for git information.
// =============================================================================

/**
 * Get the repository URL from git remote origin.
 * 
 * Uses `git remote get-url origin` which works in all environments,
 * including shallow clones. This is more reliable than CI-specific
 * environment variables as it reads directly from git config.
 * 
 * @param repoRoot - Path to the repository root
 * @returns Repository URL (e.g., "https://github.com/user/repo.git")
 */
export async function getRepoUrl(repoRoot: string): Promise<string> {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    if (!url) {
      throw new Error('Empty URL returned');
    }
    
    return url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to get repository URL from git remote. ` +
      `Ensure 'origin' remote is configured. Error: ${message}`
    );
  }
}

/**
 * Get the current HEAD commit SHA.
 * 
 * Uses `git rev-parse HEAD` which works reliably in all environments,
 * including shallow clones. This is the single source of truth for
 * the current commit SHA.
 * 
 * @param repoRoot - Path to the repository root
 * @returns Full commit SHA (40 characters)
 */
export async function getHeadCommitSha(repoRoot: string): Promise<string> {
  try {
    const sha = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    if (!sha || sha.length !== 40) {
      throw new Error(`Invalid SHA returned: "${sha}"`);
    }
    
    return sha;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get HEAD commit SHA: ${message}`);
  }
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
 * Uses raw git log command to extract author information.
 * Works in all environments where git is available.
 * 
 * Throws on error - git commits always have authors, so failure indicates
 * an invalid SHA or repository issue that should surface immediately.
 * 
 * Used by: GitHub, GitLab, Bitbucket, Vercel, Local (all CI environments)
 */
export async function getCommitAuthor(
  repoRoot: string,
  sha?: string
): Promise<{ name: string; email: string }> {
  const commitRef = sha || 'HEAD';
  
  let output: string;
  try {
    // Use raw git command (same as test scripts) - more reliable than simple-git API
    const command = `git log -1 --format="%an <%ae>" ${commitRef}`;
    output = execSync(command, { 
      encoding: 'utf-8', 
      cwd: repoRoot 
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get commit author for ${commitRef}: ${message}`);
  }

  // Parse output: "Name <email>"
  const match = output.match(/^(.+?)\s*<(.+?)>$/);
  if (!match) {
    throw new Error(
      `Failed to parse commit author for ${commitRef}. ` +
      `Expected format "Name <email>", got: "${output}"`
    );
  }

  const name = match[1].trim();
  const email = match[2].trim();

  if (!name || !email) {
    throw new Error(
      `Commit author for ${commitRef} has empty name or email. ` +
      `Got name="${name}", email="${email}"`
    );
  }

  return { name, email };
}

/**
 * Get diff for a PR/MR context in CI environments.
 * 
 * This is a shared implementation for CI environments that do shallow clones.
 * It fetches the target branch on-demand and compares it against HEAD.
 * 
 * Strategy:
 * 1. Fetch target branch: origin/${targetBranch}:refs/remotes/origin/${targetBranch}
 * 2. Diff: origin/${targetBranch}..HEAD (two dots = direct comparison)
 * 
 * Why HEAD instead of origin/${sourceBranch}?
 * - CI shallow clones only have HEAD available by default
 * - origin/${sourceBranch} doesn't exist until explicitly fetched
 * - HEAD IS the source branch in PR/MR pipelines
 * 
 * Used by: GitHub, GitLab, Bitbucket (all PR/MR contexts)
 * Future: Azure DevOps will use this when added
 * 
 * @param repoRoot - Path to the repository root
 * @param targetBranch - The branch being merged INTO (e.g., "main", "develop")
 * @param logger - Optional logger for debug output
 */
export async function getPRDiff(
  repoRoot: string,
  targetBranch: string,
  logger?: { debug: (msg: string) => void }
): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Fetch target branch on-demand (works with shallow clones)
  logger?.debug(`Fetching target branch: origin/${targetBranch}`);
  try {
    await git.fetch(['origin', `${targetBranch}:refs/remotes/origin/${targetBranch}`, '--depth=1']);
  } catch (fetchError) {
    throw new Error(
      `Failed to fetch target branch origin/${targetBranch}. ` +
      `This is required for PR/MR diff comparison. ` +
      `Error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`
    );
  }

  // Use two dots (..) for direct comparison (same as GitHub)
  // Two dots: shows all changes in HEAD that aren't in origin/${targetBranch}
  // Three dots: requires finding merge base which can fail with shallow clones
  logger?.debug(`Comparing origin/${targetBranch}..HEAD`);
  const diff = await git.diff([`origin/${targetBranch}..HEAD`, '-U200']);
  const diffSummary = await git.diffSummary([`origin/${targetBranch}..HEAD`]);
  const changedFiles = diffSummary.files.map(f => f.file);

  return {
    diff: diff || '',
    changedFiles
  };
}

/**
 * Get diff for a specific commit (or HEAD if no SHA provided).
 * 
 * Uses `git show` which works reliably with shallow clones (depth=1).
 * This is safer than `HEAD~1...HEAD` which requires depth >= 2.
 * 
 * Used by:
 * - All CI environments for push/commit context (GitHub, GitLab, Bitbucket, Vercel)
 * - Local environment for --commit flag
 * 
 * @param repoRoot - Path to the repository root
 * @param sha - Commit SHA to get diff for (defaults to HEAD)
 */
export async function getCommitDiff(repoRoot: string, sha: string = 'HEAD'): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Get diff using git show
  let diff: string;
  let changedFiles: string[];
  
  try {
    diff = await git.show([sha, '--format=', '--no-color', '-U200']);
    
    // Get changed files using git show --name-only
    const commitFiles = await git.show([sha, '--name-only', '--format=', '--pretty=format:']);
    changedFiles = commitFiles
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.trim());
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get diff for commit ${sha}: ${errorMessage}`);
  }

  return {
    diff: diff || '',
    changedFiles
  };
}

