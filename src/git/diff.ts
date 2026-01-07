import simpleGit, { SimpleGit } from 'simple-git';

export interface GitDiffResult {
  diff: string;
  changedFiles: string[];
}


/**
 * Get diff for a specific branch (all commits vs base branch)
 * Uses git merge-base to find common ancestor, then diffs from there
 */
export async function getBranchDiff(
  repoRoot: string,
  branchName: string,
  baseBranch?: string
): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Determine base branch
  let base: string;
  
  if (baseBranch) {
    // Use provided base branch
    base = baseBranch;
  } else {
    // Check if the branch itself is a base branch (main/master)
    const baseBranchNames = ['main', 'master'];
    const isBaseBranch = baseBranchNames.includes(branchName.toLowerCase());
    
    if (isBaseBranch) {
      // For main/master branch, compare against previous commit (HEAD~1)
      // This checks what changed in the most recent commit
      try {
        const previousCommit = await git.revparse(['HEAD~1']);
        // Use commit-based diff instead
        const diff = await git.diff([`${previousCommit}..HEAD`, '-U200']);
        const diffSummary = await git.diffSummary([`${previousCommit}..HEAD`]);
        const changedFiles = diffSummary.files.map(f => f.file);
        
        return {
          diff: diff || '',
          changedFiles
        };
      } catch (error: unknown) {
        // If no previous commit, return empty (first commit)
        const errorMessage = error instanceof Error ? error.message : 'HEAD~1 does not exist';
        console.log(`[DEBUG] No previous commit found (first commit or error): ${errorMessage}`);
        return {
          diff: '',
          changedFiles: []
        };
      }
    }
    
    // Try to detect base branch: upstream, default branch, or common names
    base = await detectBaseBranch(git, branchName);
  }
  
  // Helper function to detect base branch
  // Returns the branch name to use in git commands (may be local or remote)
  // In CI environments, prioritizes remote refs since local branches often don't exist
  // Note: Vercel is excluded here because it uses commit context, not branch context
  async function detectBaseBranch(git: SimpleGit, branchName: string): Promise<string> {
    const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
    
    // Strategy 1: Try upstream tracking branch (most reliable if set)
    try {
      const upstream = await git.revparse(['--abbrev-ref', '--symbolic-full-name', `${branchName}@{u}`]);
      const upstreamBranch = upstream.replace(/^origin\//, '');
      // Don't use the branch itself as its base
      if (upstreamBranch !== branchName) {
        // In CI, prefer remote refs since local branches often don't exist
        if (isCI) {
          console.log(`[DEBUG] CI environment detected, using upstream tracking branch (remote): ${upstream}`);
          return upstream;
        }
        // In local dev, check if local branch exists
        try {
          await git.revparse([upstreamBranch]);
          console.log(`[DEBUG] Using upstream tracking branch (local): ${upstreamBranch}`);
          return upstreamBranch;
        } catch {
          console.log(`[DEBUG] Upstream tracking branch exists but local branch '${upstreamBranch}' not found, using remote: ${upstream}`);
          return upstream;
        }
      } else {
        console.log(`[DEBUG] Upstream tracking branch '${upstreamBranch}' is the same as current branch, skipping`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'no upstream configured';
      console.log(`[DEBUG] Upstream tracking branch not set for '${branchName}': ${errorMessage}`);
    }
    
    // Strategy 2: Try default branch from origin/HEAD (reliable if configured)
    try {
      const defaultBranch = await git.revparse(['--abbrev-ref', 'refs/remotes/origin/HEAD']);
      const defaultBranchName = defaultBranch.replace(/^origin\//, '');
      // Don't use the branch itself as its base
      if (defaultBranchName !== branchName) {
        // In CI, prefer remote refs
        if (isCI) {
          console.log(`[DEBUG] CI environment detected, using default branch (remote): ${defaultBranch}`);
          return defaultBranch;
        }
        // In local dev, check if local branch exists
        try {
          await git.revparse([defaultBranchName]);
          console.log(`[DEBUG] Using default branch (local): ${defaultBranchName}`);
          return defaultBranchName;
        } catch {
          console.log(`[DEBUG] Default branch exists but local branch '${defaultBranchName}' not found, using remote: ${defaultBranch}`);
          return defaultBranch;
        }
      } else {
        console.log(`[DEBUG] Default branch '${defaultBranchName}' is the same as current branch, skipping`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'not found';
      console.log(`[DEBUG] Default branch (refs/remotes/origin/HEAD) not configured: ${errorMessage}`);
    }
    
    // Strategy 3: Try common branch names by checking remote refs first, then local branches
    // This works reliably in CI with fetch-depth: 0, and also works locally
    const commonBases = ['main', 'master', 'develop'];
    for (const candidate of commonBases) {
      if (candidate.toLowerCase() === branchName.toLowerCase()) {
        continue; // Skip if it's the same branch
      }
      
      // Try remote ref first
      try {
        await git.revparse([`origin/${candidate}`]);
        // In CI, prefer remote refs since local branches often don't exist
        if (isCI) {
          console.log(`[DEBUG] CI environment detected, using common branch name (remote): origin/${candidate}`);
          return `origin/${candidate}`;
        }
        // In local dev, check if local branch exists
        try {
          await git.revparse([candidate]);
          console.log(`[DEBUG] Using common branch name (local): ${candidate}`);
          return candidate;
        } catch {
          console.log(`[DEBUG] Common branch '${candidate}' exists remotely but not locally, using remote: origin/${candidate}`);
          return `origin/${candidate}`;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'does not exist';
        console.log(`[DEBUG] Remote branch 'origin/${candidate}' not found: ${errorMessage}`);
        
        // If remote doesn't exist, also try local branch (especially for CI like Vercel)
        try {
          await git.revparse([candidate]);
          console.log(`[DEBUG] Remote 'origin/${candidate}' not available, but local branch '${candidate}' found - using local`);
          return candidate;
        } catch (localError: unknown) {
          const localErrorMessage = localError instanceof Error ? localError.message : 'does not exist';
          console.log(`[DEBUG] Local branch '${candidate}' also not found: ${localErrorMessage}`);
          // Continue to next candidate
        }
      }
    }
    
    // All strategies failed - provide clear error with context
    throw new Error(
      `Could not determine base branch for '${branchName}'. ` +
      `Tried: upstream tracking, default branch (origin/HEAD), and common names (main, master, develop). ` +
      `Please specify base branch with --base flag or configure upstream tracking with: ` +
      `git branch --set-upstream-to=origin/main ${branchName}`
    );
  }

  // Get diff between base and branch (cumulative diff of all commits)
  // Format: git diff base...branch (three-dot notation finds common ancestor)
  const diff = await git.diff([`${base}...${branchName}`, '-U200']);
  
  // Get list of changed files
  const diffSummary = await git.diffSummary([`${base}...${branchName}`]);
  const changedFiles = diffSummary.files.map(f => f.file);

  return {
    diff: diff || '',
    changedFiles
  };
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

/**
 * Get diff for PR/MR (source branch vs target branch)
 */
export async function getPRMRDiff(
  repoRoot: string,
  sourceBranch: string,
  targetBranch: string
): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get diff between target and source (cumulative diff)
  // Format: git diff target...source (three-dot notation finds common ancestor)
  const diff = await git.diff([`${targetBranch}...${sourceBranch}`, '-U200']);
  
  // Get list of changed files
  const diffSummary = await git.diffSummary([`${targetBranch}...${sourceBranch}`]);
  const changedFiles = diffSummary.files.map(f => f.file);

  return {
    diff: diff || '',
    changedFiles
  };
}

