import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GitHub Actions: Get repository name
 * 
 * Uses GITHUB_REPOSITORY environment variable (format: "owner/repo").
 * This is the ONLY method for GitHub - no fallbacks, no alternatives.
 */
export async function getGitHubRepoName(_repoRoot: string): Promise<string> {
  const githubRepo = process.env.GITHUB_REPOSITORY;
  if (!githubRepo) {
    throw new Error(
      'GitHub Actions: GITHUB_REPOSITORY environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  return `${serverUrl}/${githubRepo}.git`;
}

/**
 * Vercel: Get repository name
 * 
 * Uses VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG environment variables.
 * This is the ONLY method for Vercel - no fallbacks, no alternatives.
 */
export async function getVercelRepoName(_repoRoot: string): Promise<string> {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;

  if (!owner || !slug) {
    throw new Error(
      'Vercel: VERCEL_GIT_REPO_OWNER or VERCEL_GIT_REPO_SLUG environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }

  return `https://github.com/${owner}/${slug}.git`;
}

/**
 * Local: Get repository name
 * 
 * Uses git command to get origin remote URL.
 * This is the ONLY method for local - no fallbacks, no alternatives.
 * Git should always be available in local development.
 */
export async function getLocalRepoName(repoRoot: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(
      'Local: Not a git repository. Threadline requires a git repository.'
    );
  }

  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    
    if (!origin || !origin.refs?.fetch) {
      throw new Error(
        'Local: No origin remote found. ' +
        'Please configure an origin remote: git remote add origin <url>'
      );
    }

    return origin.refs.fetch;
  } catch (error: unknown) {
    // If it's already our error, re-throw it
    if (error instanceof Error && error.message.includes('Local:')) {
      throw error;
    }
    // Otherwise, wrap it
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Local: Failed to get repository name from git: ${errorMessage}`
    );
  }
}

/**
 * GitHub Actions: Get branch name
 * 
 * Uses GITHUB_REF_NAME environment variable.
 * This is the ONLY method for GitHub - no fallbacks, no alternatives.
 */
export async function getGitHubBranchName(_repoRoot: string): Promise<string> {
  const refName = process.env.GITHUB_REF_NAME;
  if (!refName) {
    throw new Error(
      'GitHub Actions: GITHUB_REF_NAME environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions.'
    );
  }

  return refName;
}

/**
 * Vercel: Get branch name
 * 
 * Uses VERCEL_GIT_COMMIT_REF environment variable.
 * This is the ONLY method for Vercel - no fallbacks, no alternatives.
 */
export async function getVercelBranchName(_repoRoot: string): Promise<string> {
  const branchName = process.env.VERCEL_GIT_COMMIT_REF;
  if (!branchName) {
    throw new Error(
      'Vercel: VERCEL_GIT_COMMIT_REF environment variable is not set. ' +
      'This should be automatically provided by Vercel CI.'
    );
  }

  return branchName;
}

/**
 * Local: Get branch name
 * 
 * Uses git command to get current branch name.
 * This is the ONLY method for local - no fallbacks, no alternatives.
 * Git should always be available in local development.
 */
export async function getLocalBranchName(repoRoot: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoRoot);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(
      'Local: Not a git repository. Threadline requires a git repository.'
    );
  }

  try {
    const branchName = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    if (!branchName || branchName.trim() === '') {
      throw new Error(
        'Local: Could not determine branch name. ' +
        'This might be a brand new repository with no commits. ' +
        'Make at least one commit before running threadlines check.'
      );
    }

    // Handle detached HEAD state
    if (branchName === 'HEAD') {
      throw new Error(
        'Local: Currently in detached HEAD state. ' +
        'Please checkout a branch before running threadlines check.'
      );
    }

    return branchName.trim();
  } catch (error: unknown) {
    // If it's already our error, re-throw it
    if (error instanceof Error && error.message.includes('Local:')) {
      throw error;
    }
    // Otherwise, wrap it
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Local: Failed to get branch name from git: ${errorMessage}`
    );
  }
}

/**
 * GitLab CI: Get repository name
 * 
 * Uses CI_PROJECT_URL environment variable.
 * This is the ONLY method for GitLab - no fallbacks, no alternatives.
 */
export async function getGitLabRepoName(_repoRoot: string): Promise<string> {
  const projectUrl = process.env.CI_PROJECT_URL;
  if (!projectUrl) {
    throw new Error(
      'GitLab CI: CI_PROJECT_URL environment variable is not set. ' +
      'This should be automatically provided by GitLab CI.'
    );
  }

  // CI_PROJECT_URL is like "https://gitlab.com/owner/repo"
  // Add .git suffix for consistency with other environments
  return `${projectUrl}.git`;
}

/**
 * GitLab CI: Get branch name
 * 
 * Uses CI_COMMIT_REF_NAME environment variable.
 * This is the ONLY method for GitLab - no fallbacks, no alternatives.
 */
export async function getGitLabBranchName(_repoRoot: string): Promise<string> {
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
 * Detects the default branch name of the repository for GitHub Actions.
 * 
 * Uses GITHUB_EVENT_PATH JSON (repository.default_branch) - the most authoritative source
 * provided directly by GitHub Actions.
 * 
 * This function is ONLY called from GitHub Actions context (getGitHubDiff),
 * so GITHUB_EVENT_PATH should always be available. If it's not, we fail with a clear error.
 * 
 * Returns the branch name (e.g., "main", "master") without the "origin/" prefix.
 * Throws an error if the default branch cannot be detected.
 */
export async function getDefaultBranchName(_repoRoot: string): Promise<string> {
  // GitHub Actions provides GITHUB_EVENT_PATH which contains repository.default_branch
  const githubEventPath = process.env.GITHUB_EVENT_PATH;
  
  if (!githubEventPath) {
    throw new Error(
      'GITHUB_EVENT_PATH environment variable is not set. ' +
      'This should be automatically provided by GitHub Actions. ' +
      'This function should only be called in GitHub Actions context.'
    );
  }

  try {
    const eventPath = path.resolve(githubEventPath);
    
    if (!fs.existsSync(eventPath)) {
      throw new Error(`GITHUB_EVENT_PATH file does not exist: ${eventPath}`);
    }
    
    const eventJson = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const defaultBranch = eventJson.repository?.default_branch;
    
    if (!defaultBranch || typeof defaultBranch !== 'string') {
      throw new Error(
        'Could not find repository.default_branch in GITHUB_EVENT_PATH JSON. ' +
        'This should be automatically provided by GitHub Actions.'
      );
    }
    
    return defaultBranch;
  } catch (error: unknown) {
    // If it's already our error, re-throw it
    if (error instanceof Error && (error.message.includes('GITHUB_EVENT_PATH') || error.message.includes('default_branch'))) {
      throw error;
    }
    // Otherwise, wrap it
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Failed to read or parse GITHUB_EVENT_PATH: ${errorMessage}. ` +
      'This should be automatically provided by GitHub Actions.'
    );
  }
}

