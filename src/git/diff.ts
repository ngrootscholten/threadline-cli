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
/**
 * Sanitize a git remote URL by removing embedded credentials.
 * 
 * CI environments often embed tokens in the remote URL for authentication:
 * - GitLab CI: https://gitlab-ci-token:TOKEN@gitlab.com/user/repo
 * - GitHub Actions: https://x-access-token:TOKEN@github.com/user/repo
 * 
 * This function strips credentials to prevent token exposure in logs/UI.
 */
function sanitizeRepoUrl(url: string): string {
  // Handle HTTPS URLs with credentials: https://user:pass@host/path
  // The regex matches: protocol://anything@host/path and removes "anything@"
  const sanitized = url.replace(/^(https?:\/\/)([^@]+@)/, '$1');
  return sanitized;
}

export async function getRepoUrl(repoRoot: string): Promise<string> {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    if (!url) {
      throw new Error('Empty URL returned');
    }
    
    // Remove embedded credentials (CI tokens) from the URL
    return sanitizeRepoUrl(url);
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
 * Uses three-dots logic (merge base) to show only the developer's changes,
 * avoiding drift from main moving forward.
 * 
 * Strategy:
 * 1. Fetch target branch: origin/${targetBranch}:refs/remotes/origin/${targetBranch}
 * 2. Find merge base (common ancestor) using git merge-base (plumbing command)
 * 3. Fetch merge base commit (always fetch, assume not available)
 * 4. Diff: ${mergeBase}..HEAD (shows only developer's changes, not changes from main)
 * 
 * Why three dots (merge base) instead of two dots (direct comparison)?
 * - Two dots: Shows all differences between target branch tip and HEAD
 *   - Includes changes that happened in main since branching (drift)
 *   - Can show files the developer didn't touch
 * - Three dots: Shows only changes from merge base to HEAD
 *   - Shows only what the developer actually changed
 *   - Industry standard for "change detection" in PR/MR reviews
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

  // Find merge base (common ancestor) using plumbing command
  // Three dots logic: compare against merge base to show only developer's changes
  // This avoids drift from main moving forward (two dots would include those changes)
  let mergeBase: string;
  try {
    mergeBase = execSync(`git merge-base origin/${targetBranch} HEAD`, {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    if (!mergeBase || mergeBase.length !== 40) {
      throw new Error(`Invalid merge base SHA: "${mergeBase}"`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to find merge base between origin/${targetBranch} and HEAD. ` +
      `This is required to show only the developer's changes (avoids drift from main). ` +
      `Error: ${errorMessage}`
    );
  }

  // Always fetch merge base (assume it's not available, fetch is fast/no-op if it is)
  // This ensures we have the merge base available for diff comparison
  logger?.debug(`Fetching merge base: ${mergeBase}`);
  try {
    await git.fetch(['origin', mergeBase, '--depth=1']);
  } catch (fetchError) {
    throw new Error(
      `Failed to fetch merge base ${mergeBase} from origin. ` +
      `This is required for PR/MR diff comparison in shallow clones. ` +
      `Ensure 'origin' remote is configured and accessible. ` +
      `Error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`
    );
  }

  // Use merge base for diff (three dots logic: shows only developer's changes)
  // git diff is plumbing command, ignores shallow boundaries
  logger?.debug(`Comparing ${mergeBase}..HEAD (merge base vs PR branch)`);
  const diff = await git.diff([`${mergeBase}..HEAD`, '-U200']);
  const diffSummary = await git.diffSummary([`${mergeBase}..HEAD`]);
  const changedFiles = diffSummary.files.map(f => f.file);

  return {
    diff: diff || '',
    changedFiles
  };
}

/**
 * Get diff for a specific commit (or HEAD if no SHA provided).
 * 
 * Uses plumbing commands consistently to work reliably in shallow clones.
 * This works regardless of CI checkout depth settings (depth=1 or depth=2).
 * 
 * Strategy:
 * 1. Get parent SHA using plumbing command (git cat-file -p) to read raw commit object
 *    - Plumbing commands ignore .git/shallow boundaries and show actual parent SHA
 *    - Porcelain commands (git show) respect shallow boundaries and hide parents in shallow clones
 *    - This is critical for CI environments that use shallow clones (depth=1)
 * 2. Parse first parent line (handles standard commits and merge commits)
 * 3. Fetch parent commit (git fetch origin <parentSHA> --depth=1)
 * 4. Use git diff <PARENT_SHA> HEAD to get diff (plumbing command, ignores shallow boundaries)
 *    - git show HEAD still respects .git/shallow even after fetching parent
 *    - git diff <PARENT_SHA> HEAD compares tree objects directly, ignoring shallow boundaries
 *    - This is the key fix: must use plumbing commands consistently, not mix with porcelain
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

  // Fetch parent commit on-demand to ensure git show can generate a proper diff
  // This works regardless of CI checkout depth settings (depth=1 or depth=2)
  // If parent is already available, fetch is fast/no-op; if not, we fetch it
  
  // Get parent SHA using plumbing command (git cat-file) instead of porcelain (git show)
  // Plumbing commands ignore .git/shallow boundaries and show the actual parent SHA
  // Porcelain commands (git show) respect shallow boundaries and hide parents in shallow clones
  // This is critical for CI environments that use shallow clones (depth=1)
  let parentSha: string;
  try {
    // Use git cat-file -p to read raw commit object (plumbing command)
    // This ignores shallow boundaries and shows the actual parent SHA
    const commitObject = execSync(`git cat-file -p ${sha}`, {
      encoding: 'utf-8',
      cwd: repoRoot
    });
    
    // Parse commit object to find first parent line
    // Standard commits have one parent; merge commits have multiple parents
    // We use the first parent (standard for diffing against previous state of branch)
    const lines = commitObject.split('\n');
    const parentLine = lines.find(line => line.startsWith('parent '));
    
    if (!parentLine) {
      throw new Error(`Commit ${sha} has no parent (it might be the root commit of the repository)`);
    }
    
    // Extract SHA from "parent <sha>" line
    // Format: "parent <40-char-sha>"
    const parts = parentLine.split(' ');
    if (parts.length < 2 || !parts[1]) {
      throw new Error(`Malformed parent line in commit object: "${parentLine}"`);
    }
    
    parentSha = parts[1].trim();
    
    if (!parentSha || parentSha.length !== 40) {
      throw new Error(`Invalid parent SHA format: "${parentSha}" (expected 40 characters)`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to get parent commit SHA for ${sha}. ` +
      `This is required to generate a proper diff. ` +
      `Error: ${errorMessage}`
    );
  }
  
  // Fetch parent commit (we've already validated parentSha is valid above)
  // If we get here, parentSha is guaranteed to be a valid 40-character SHA
  try {
    // Fetch just this one commit (depth=1 is fine, we only need the parent)
    await git.fetch(['origin', parentSha, '--depth=1']);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch parent commit ${parentSha} from origin. ` +
      `This is required to generate a proper diff in shallow clones. ` +
      `Ensure 'origin' remote is configured and accessible. ` +
      `Error: ${errorMessage}`
    );
  }
  // Get diff using plumbing command (git diff) instead of porcelain (git show)
  // git show respects .git/shallow boundaries and will still treat HEAD as root commit
  // git diff <PARENT_SHA> HEAD ignores shallow boundaries and compares tree objects directly
  // This is critical for shallow clones - we must use plumbing commands consistently
  let diff: string;
  let changedFiles: string[];
  
  try {
    // Use git diff to compare parent against HEAD (plumbing command, ignores shallow boundaries)
    diff = await git.diff([`${parentSha}..${sha}`, '-U200']);
    
    // Get changed files using git diff --name-only
    const diffSummary = await git.diffSummary([`${parentSha}..${sha}`]);
    changedFiles = diffSummary.files.map(f => f.file);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get diff for commit ${sha}: ${errorMessage}`);
  }

  return {
    diff: diff || '',
    changedFiles
  };
}

