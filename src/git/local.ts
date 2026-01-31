/**
 * Local Environment
 * 
 * All Local-specific logic is contained in this file.
 * No dependencies on other environment implementations.
 * 
 * Exports a single function: getLocalContext() that returns:
 * - diff: GitDiffResult
 * - repoName: string
 * - branchName: string
 * - commitAuthor: { name: string; email: string }
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GitDiffResult } from '../types/git';
import { getCommitMessage, getCommitAuthor, getCommitDiff, getRepoUrl } from './diff';
import { ReviewContextType } from '../api/client';
import { logger } from '../utils/logger';

export interface LocalContext {
  diff: GitDiffResult;
  repoName: string;
  branchName: string;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor: { name: string; email: string };
  prTitle?: string; // Not applicable for local, but included for consistency
  reviewContext: ReviewContextType;
}

/**
 * Gets all Local context 
 */
export async function getLocalContext(
  repoRoot: string,
  commitSha?: string
): Promise<LocalContext> {
  // Check if we're in a git repo
  try {
    execSync('git rev-parse --git-dir', { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    throw new Error('Not a git repository. Threadline requires a git repository.');
  }

  // Get all Local context
  const diff = commitSha ? await getCommitDiff(repoRoot, commitSha) : await getDiff(repoRoot);
  const repoName = await getRepoUrl(repoRoot);  // Shared git command
  const branchName = await getBranchName(repoRoot);
  const reviewContext: ReviewContextType = commitSha ? 'commit' : 'local';
  
  // Get commit author (fails loudly if unavailable)
  const commitAuthor = commitSha
    ? await getCommitAuthorFromGit(repoRoot, commitSha)
    : await getCommitAuthorFromConfig(repoRoot);
  
  // Get commit message if we have a SHA (fails loudly if commit doesn't exist)
  let commitMessage: string | undefined;
  if (commitSha) {
    commitMessage = await getCommitMessage(repoRoot, commitSha);
  }

  return {
    diff,
    repoName,
    branchName,
    commitSha,
    commitMessage,
    commitAuthor,
    prTitle: undefined, // Not applicable for local
    reviewContext
  };
}

/**
 * Get diff for local development environment
 * 
 * For local development, we check staged changes first, then unstaged changes.
 * This allows developers to review what they've staged before committing,
 * or review unstaged changes if nothing is staged.
 */
async function getDiff(repoRoot: string): Promise<GitDiffResult> {
  // Get git status in porcelain format to determine what changes exist
  // Porcelain format: XY filename
  // X = staged status, Y = unstaged status
  // ' ' = no change, 'M' = modified, 'A' = added, 'D' = deleted, etc.
  // '?' = untracked (only in Y position, X is always '?' too)
  const statusOutput = execSync('git status --porcelain', {
    encoding: 'utf-8',
    cwd: repoRoot
  }).trim();
  
  const lines = statusOutput ? statusOutput.split('\n') : [];
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  
  for (const line of lines) {
    const stagedStatus = line[0];
    const unstagedStatus = line[1];
    
    // Collect untracked files separately (they need special handling)
    if (stagedStatus === '?' && unstagedStatus === '?') {
      // Format: "?? filename" - skip 3 characters
      const file = line.slice(3);
      untracked.push(file);
      continue;
    }
    
    // For tracked files, the format can be:
    // - "M filename" (staged, no leading space) - skip 2 characters
    // - " M filename" (unstaged, leading space) - skip 3 characters
    // - "MM filename" (both staged and unstaged) - skip 3 characters
    let file: string;
    if (stagedStatus !== ' ' && unstagedStatus === ' ') {
      // Staged only: "M filename" - skip 2 characters (M + space)
      file = line.slice(2);
    } else {
      // Unstaged or both: " M filename" or "MM filename" - skip 3 characters
      file = line.slice(3);
    }
    
    if (stagedStatus !== ' ') {
      staged.push(file);
    }
    if (unstagedStatus !== ' ' && unstagedStatus !== '?') {
      unstaged.push(file);
    }
  }
  
  let diff: string;
  let changedFiles: string[];

  // Check if there are actually staged files (use git diff as source of truth)
  // git status parsing can be inconsistent, so we verify with git diff
  const stagedFilesOutput = execSync('git diff --cached --name-only', {
    encoding: 'utf-8',
    cwd: repoRoot
  }).trim();
  const actualStagedFiles = stagedFilesOutput ? stagedFilesOutput.split('\n') : [];
  
  // Workflow A: Developer has staged files - check ONLY staged files
  // (Ignore unstaged and untracked - developer explicitly chose to check staged)
  if (actualStagedFiles.length > 0) {
    diff = execSync('git diff --cached -U200', {
      encoding: 'utf-8',
      cwd: repoRoot
    });
    changedFiles = actualStagedFiles;
    
    // If staged files exist but diff is empty, something is wrong
    if (!diff || diff.trim() === '') {
      throw new Error(
        `Staged files exist but diff is empty. ` +
        `This may indicate binary files, whitespace-only changes, or a git issue. ` +
        `Staged files: ${actualStagedFiles.join(', ')}`
      );
    }
    
    logger.info(`Checking STAGED changes (${changedFiles.length} file(s))`);
    
    return {
      diff: diff || '',
      changedFiles
    };
  }
  
  // No staged files - log clearly and continue to unstaged/untracked
  if (staged.length > 0) {
    // git status showed staged files but git diff doesn't - they were likely unstaged
    logger.info(`No staged files detected (files may have been unstaged), checking unstaged/untracked files instead.`);
  } else {
    logger.info(`No staged files, checking unstaged/untracked files.`);
  }
  
  // Workflow B: Developer hasn't staged files - check unstaged + untracked files
  // (Untracked files are conceptually "unstaged" - files being worked on but not committed)
  if (unstaged.length > 0 || untracked.length > 0) {
    // Get unstaged diff if there are unstaged files
    if (unstaged.length > 0) {
      diff = execSync('git diff -U200', {
        encoding: 'utf-8',
        cwd: repoRoot
      });
      const changedFilesOutput = execSync('git diff --name-only', {
        encoding: 'utf-8',
        cwd: repoRoot
      }).trim();
      changedFiles = changedFilesOutput ? changedFilesOutput.split('\n') : [];
    } else {
      diff = '';
      changedFiles = [];
    }
    
    // Handle untracked files: read their content and create artificial diffs
    // Fails loudly if any untracked file cannot be read (permissions, filesystem errors, etc.)
    const untrackedDiffs: string[] = [];
    const untrackedFileList: string[] = [];
    
    for (const file of untracked) {
      const fullPath = path.resolve(repoRoot, file);
      
      // Skip if it's a directory (git status can show directories)
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) {
        continue;
      }
      
      // Read file content - fails loudly on any error (permissions, encoding, etc.)
      const content = fs.readFileSync(fullPath, 'utf-8');
      
      // Normalize path to forward slashes for cross-platform consistency
      const normalizedPath = file.replace(/\\/g, '/');
      
      // Create artificial diff (all lines as additions, similar to getFileContent)
      const lines = content.split('\n');
      const fileDiff = lines.map((line) => `+${line}`).join('\n');
      
      // Add git diff header (matches format expected by server's filterDiffByFiles)
      const diffHeader = `diff --git a/${normalizedPath} b/${normalizedPath}\n--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n`;
      untrackedDiffs.push(diffHeader + fileDiff);
      untrackedFileList.push(normalizedPath);
    }
    
    // Combine unstaged changes with untracked files
    const combinedDiff = untrackedDiffs.length > 0
      ? (diff ? diff + '\n' : '') + untrackedDiffs.join('\n')
      : diff;
    
    const allChangedFiles = [...changedFiles, ...untrackedFileList];
    
    const unstagedCount = changedFiles.length;
    const untrackedCount = untrackedFileList.length;
    if (unstagedCount > 0 && untrackedCount > 0) {
      logger.info(`Checking UNSTAGED changes (${unstagedCount} file(s)) + ${untrackedCount} untracked file(s)`);
    } else if (unstagedCount > 0) {
      logger.info(`Checking UNSTAGED changes (${unstagedCount} file(s))`);
    } else {
      logger.info(`Checking UNTRACKED files (${untrackedCount} file(s))`);
    }
    
    return {
      diff: combinedDiff || '',
      changedFiles: allChangedFiles
    };
  }
  
  // No changes at all - fail loudly
  throw new Error(
    'No changes detected. Stage files with "git add" or modify files to run threadlines.'
  );
}


/**
 * Gets branch name for local environment
 * (Uses git command directly - works in local because not in detached HEAD state)
 */
async function getBranchName(repoRoot: string): Promise<string> {
  try {
    const currentBranch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    if (!currentBranch) {
      throw new Error('Could not determine current branch. Are you in a git repository?');
    }

    return currentBranch;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get branch name: ${errorMessage}`);
  }
}

/**
 * Gets commit author from git config (for uncommitted changes)
 * This represents who is currently working on the changes and will commit them.
 * 
 * No fallbacks - if git config is not set or fails, throws an error.
 */
async function getCommitAuthorFromConfig(repoRoot: string): Promise<{ name: string; email: string }> {
  try {
    const name = execSync('git config --get user.name', {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    const email = execSync('git config --get user.email', {
      encoding: 'utf-8',
      cwd: repoRoot
    }).trim();
    
    if (!name || !email) {
      throw new Error(
        'Git config user.name or user.email is not set. ' +
        'Run: git config user.name "Your Name" && git config user.email "your.email@example.com"'
      );
    }
    
    return {
      name: name,
      email: email
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get git config user: ${errorMessage}`);
  }
}

/**
 * Gets commit author from git log (for specific commits)
 * getCommitAuthor throws on failure with descriptive error
 */
async function getCommitAuthorFromGit(
  repoRoot: string,
  commitSha: string
): Promise<{ name: string; email: string }> {
  return getCommitAuthor(repoRoot, commitSha);
}

