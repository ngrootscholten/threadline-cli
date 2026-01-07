/**
 * Metadata Collection
 * 
 * Collects environment-specific metadata for review context:
 * - Commit SHA (from env vars or git)
 * - Commit message (from git)
 * - PR/MR title (from env vars or API)
 * 
 * Metadata collection is environment-specific because each CI platform
 * provides different environment variables.
 */

import { Environment } from './environment';
import { ReviewContext } from './context';
import { getCommitMessage, getCommitAuthor } from '../git/diff';
import * as fs from 'fs';
import simpleGit from 'simple-git';

export interface ReviewMetadata {
  commitSha?: string;
  commitMessage?: string;
  commitAuthorName?: string;
  commitAuthorEmail?: string;
  prTitle?: string;
}

/**
 * Collects metadata for the given context and environment.
 * 
 * This function knows how to extract metadata from each environment's
 * specific environment variables and git commands.
 */
export async function collectMetadata(
  context: ReviewContext,
  environment: Environment,
  repoRoot: string
): Promise<ReviewMetadata> {
  const metadata: ReviewMetadata = {};

  // Collect commit SHA (environment-specific)
  metadata.commitSha = getCommitSha(context, environment);

  // Collect commit message and author (environment-specific)
  if (metadata.commitSha) {
    const message = await getCommitMessage(repoRoot, metadata.commitSha);
    if (message) {
      metadata.commitMessage = message;
    }
    
    // Get commit author - environment-specific approach (fails loudly if unavailable)
    const author = await getCommitAuthorForEnvironment(environment, repoRoot, metadata.commitSha);
    metadata.commitAuthorName = author.name;
    metadata.commitAuthorEmail = author.email;
  } else {
    // For local environment without explicit commit SHA:
    // Use git config (who will commit staged/unstaged changes)
    // No fallbacks - if git config fails, the error propagates and fails the check
    const author = await getGitConfigUser(repoRoot);
    metadata.commitAuthorName = author.name;
    metadata.commitAuthorEmail = author.email;
  }

  // Collect PR/MR title (environment-specific)
  metadata.prTitle = getPRTitle(context, environment);

  return metadata;
}

/**
 * Extracts commit SHA from context and environment.
 */
function getCommitSha(context: ReviewContext, environment: Environment): string | undefined {
  // If context already has commit SHA, use it
  if (context.type === 'commit') {
    return context.commitSha;
  }

  // For branch contexts, try to get commit SHA from environment variables
  if (context.type === 'branch') {
    switch (environment) {
      case 'github':
        return process.env.GITHUB_SHA;
      case 'gitlab':
        return process.env.CI_COMMIT_SHA;
      case 'vercel':
        return process.env.VERCEL_GIT_COMMIT_SHA;
      default:
        return undefined;
    }
  }

  // For PR/MR contexts, commit SHA might be available in env vars
  if (context.type === 'pr' || context.type === 'mr') {
    switch (environment) {
      case 'github':
        // For PRs, GITHUB_SHA is a merge commit, might want GITHUB_HEAD_SHA instead
        return process.env.GITHUB_HEAD_SHA || process.env.GITHUB_SHA;
      case 'gitlab':
        return process.env.CI_COMMIT_SHA;
      default:
        return undefined;
    }
  }

  return undefined;
}

/**
 * Gets commit author information using environment-specific methods.
 * 
 * Each environment has a single, isolated strategy:
 * - GitHub: Reads from GITHUB_EVENT_PATH JSON file (fails loudly if unavailable)
 * - GitLab: Uses CI_COMMIT_AUTHOR environment variable (fails loudly if unavailable)
 * - Vercel: Uses VERCEL_GIT_COMMIT_AUTHOR_NAME + git log (fails loudly if unavailable)
 * - Local: Uses git config (handled separately in collectMetadata, fails loudly if unavailable)
 * 
 * No fallbacks - each environment is completely isolated.
 */
async function getCommitAuthorForEnvironment(
  environment: Environment,
  repoRoot: string,
  commitSha: string
): Promise<{ name: string; email: string }> {
  if (environment === 'github') {
    // GitHub: Read from GITHUB_EVENT_PATH JSON file
    // This is more reliable than git commands, especially in shallow clones
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error(
        'GitHub Actions: GITHUB_EVENT_PATH environment variable is not set. ' +
        'This should be automatically provided by GitHub Actions.'
      );
    }
    
    if (!fs.existsSync(eventPath)) {
      throw new Error(
        `GitHub Actions: GITHUB_EVENT_PATH file does not exist: ${eventPath}. ` +
        'This should be automatically provided by GitHub Actions.'
      );
    }
    
    try {
      const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
      
      // For push  events, use head_commit.author 
      if (eventData.head_commit?.author) {
        return {
          name: eventData.head_commit.author.name,
          email: eventData.head_commit.author.email
        };
      }
      
      // For PR events, use commits[0].author (first commit in the PR)
      if (eventData.commits && eventData.commits.length > 0 && eventData.commits[0].author) {
        return {
          name: eventData.commits[0].author.name,
          email: eventData.commits[0].author.email
        };
      }
      
      // Fallback to pull_request.head.commit.author for PR events
      if (eventData.pull_request?.head?.commit?.author) {
        return {
          name: eventData.pull_request.head.commit.author.name,
          email: eventData.pull_request.head.commit.author.email
        };
      }
      
      // If we get here, the event JSON doesn't contain author info
      throw new Error(
        `GitHub Actions: GITHUB_EVENT_PATH JSON does not contain commit author information. ` +
        `Event type: ${eventData.action || 'unknown'}. ` +
        `This should be automatically provided by GitHub Actions.`
      );
    } catch (error: unknown) {
      // If JSON parsing fails, fail loudly
      if (error instanceof Error && error.message.includes('GitHub Actions:')) {
        throw error; // Re-throw our own errors
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `GitHub Actions: Failed to read or parse GITHUB_EVENT_PATH JSON: ${errorMessage}. ` +
        'This should be automatically provided by GitHub Actions.'
      );
    }
  }
  
  if (environment === 'gitlab') {
    // GitLab: Use CI_COMMIT_AUTHOR environment variable
    // Format: "name <email>" (e.g., "ngrootscholten <niels.grootscholten@gmail.com>")
    // This is more reliable than git commands, especially in shallow clones
    const commitAuthor = process.env.CI_COMMIT_AUTHOR;
    if (!commitAuthor) {
      throw new Error(
        'GitLab CI: CI_COMMIT_AUTHOR environment variable is not set. ' +
        'This should be automatically provided by GitLab CI.'
      );
    }
    
    // Parse "name <email>" format
    const match = commitAuthor.match(/^(.+?)\s*<(.+?)>$/);
    if (!match) {
      throw new Error(
        `GitLab CI: CI_COMMIT_AUTHOR format is invalid. ` +
        `Expected format: "name <email>", got: "${commitAuthor}". ` +
        `This should be automatically provided by GitLab CI in the correct format.`
      );
    }
    
    return {
      name: match[1].trim(),
      email: match[2].trim()
    };
  }
  
  if (environment === 'vercel') {
    // Vercel: Use VERCEL_GIT_COMMIT_AUTHOR_NAME for name, git log for email
    // Vercel provides author name but not email in environment variables
    // git log works reliably in Vercel's build environment
    const authorName = process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME;
    if (!authorName) {
      throw new Error(
        'Vercel: VERCEL_GIT_COMMIT_AUTHOR_NAME environment variable is not set. ' +
        'This should be automatically provided by Vercel.'
      );
    }
    
    // Get email from git log - fail loudly if this doesn't work
    const gitAuthor = await getCommitAuthor(repoRoot, commitSha);
    if (!gitAuthor || !gitAuthor.email) {
      throw new Error(
        `Vercel: Failed to get commit author email from git log for commit ${commitSha}. ` +
        `This should be available in Vercel's build environment.`
      );
    }
    
    return {
      name: authorName.trim(),
      email: gitAuthor.email.trim()
    };
  }
  
  // Local environment should not reach here - it's handled separately in collectMetadata
  // when commitSha is undefined. If we get here with 'local', it means commitSha was set
  // (e.g., --commit flag), so we can use git log.
  if (environment === 'local') {
    const gitAuthor = await getCommitAuthor(repoRoot, commitSha);
    if (!gitAuthor || !gitAuthor.email) {
      throw new Error(
        `Local: Failed to get commit author from git log for commit ${commitSha}. ` +
        'This should be available in your local git repository.'
      );
    }
    return {
      name: gitAuthor.name,
      email: gitAuthor.email
    };
  }
  
  // Unknown environment - this should never happen due to TypeScript exhaustiveness
  const _exhaustive: never = environment;
  throw new Error(`Unknown environment: ${_exhaustive}`);
}

/**
 * Gets git user info from git config (for local uncommitted changes).
 * This represents who is currently working on the changes and will commit them.
 * 
 * No fallbacks - if git config is not set or fails, throws an error.
 */
async function getGitConfigUser(repoRoot: string): Promise<{ name: string; email: string }> {
  const git = simpleGit(repoRoot);
  
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
 * Extracts PR/MR title from context and environment.
 * 
 * Note: GitHub Actions doesn't provide PR title as an env var by default.
 * It would need to be passed from the workflow YAML or fetched via API.
 */
function getPRTitle(context: ReviewContext, environment: Environment): string | undefined {
  // Only PR/MR contexts have titles
  if (context.type !== 'pr' && context.type !== 'mr') {
    return undefined;
  }

  // GitLab CI provides MR title as env var
  if (context.type === 'mr' && environment === 'gitlab') {
    return context.prTitle;
  }

  // GitHub Actions doesn't provide PR title as env var
  // Would need to be passed from workflow: PR_TITLE: ${{ github.event.pull_request.title }}
  // or fetched via GitHub API
  if (context.type === 'pr' && environment === 'github') {
    return process.env.PR_TITLE; // Only if passed from workflow
  }

  return undefined;
}

