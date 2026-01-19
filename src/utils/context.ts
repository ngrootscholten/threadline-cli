/**
 * Review Context Types
 * 
 * Type definitions for the different code review contexts:
 * - PR/MR: Comparing source branch vs target branch (branch-level diff)
 * - Commit: Single commit changes (any push without PR/MR)
 * - Local: Staged/unstaged changes in working directory
 */

export type ContextType = 'pr' | 'mr' | 'commit' | 'local';

export interface PRContext {
  type: 'pr';
  prNumber: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface MRContext {
  type: 'mr';
  mrNumber: string;
  sourceBranch: string;
  targetBranch: string;
  prTitle?: string;
}

export interface CommitContext {
  type: 'commit';
  commitSha: string;
}

export interface LocalContext {
  type: 'local';
}

export type ReviewContext = PRContext | MRContext | CommitContext | LocalContext;
