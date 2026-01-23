/**
 * CI Environment Configuration
 * 
 * This is the ONLY place where CI-specific environment variables are read.
 * Each CI provider has different env var names for the same concepts.
 * This config maps them to a common interface.
 * 
 * Everything else (repo URL, commit SHA, author, diff) uses shared git commands.
 */

export type CIEnvironment = 'github' | 'gitlab' | 'bitbucket' | 'vercel';

export interface CIConfig {
  /** Check if this is a PR/MR pipeline */
  isPullRequest: () => boolean;
  /** Get target/base branch for PR (only valid if isPullRequest) */
  getTargetBranch: () => string | undefined;
  /** Get current branch name (CI env var - git returns "HEAD" in detached state) */
  getBranchName: () => string;
  /** Get PR/MR title (optional) */
  getPRTitle: () => string | undefined;
}

/**
 * CI configuration for each environment.
 * Only reads env vars - no git commands here.
 */
export const CI_CONFIGS: Record<CIEnvironment, CIConfig> = {
  github: {
    isPullRequest: () => process.env.GITHUB_EVENT_NAME === 'pull_request',
    getTargetBranch: () => process.env.GITHUB_BASE_REF,
    getBranchName: () => {
      const refName = process.env.GITHUB_REF_NAME;
      if (!refName) {
        throw new Error(
          'GitHub Actions: GITHUB_REF_NAME is not set. ' +
          'This should be automatically provided by GitHub Actions.'
        );
      }
      return refName;
    },
    getPRTitle: () => process.env.PR_TITLE, // Must be passed from workflow YAML
  },

  gitlab: {
    isPullRequest: () => !!process.env.CI_MERGE_REQUEST_IID,
    getTargetBranch: () => process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    getBranchName: () => {
      const refName = process.env.CI_COMMIT_REF_NAME;
      if (!refName) {
        throw new Error(
          'GitLab CI: CI_COMMIT_REF_NAME is not set. ' +
          'This should be automatically provided by GitLab CI.'
        );
      }
      return refName;
    },
    getPRTitle: () => process.env.CI_MERGE_REQUEST_TITLE,
  },

  bitbucket: {
    isPullRequest: () => !!process.env.BITBUCKET_PR_ID,
    getTargetBranch: () => process.env.BITBUCKET_PR_DESTINATION_BRANCH,
    getBranchName: () => {
      const branchName = process.env.BITBUCKET_BRANCH;
      if (!branchName) {
        throw new Error(
          'Bitbucket Pipelines: BITBUCKET_BRANCH is not set. ' +
          'This should be automatically provided by Bitbucket Pipelines.'
        );
      }
      return branchName;
    },
    getPRTitle: () => undefined, // Bitbucket doesn't expose PR title as env var
  },

  vercel: {
    isPullRequest: () => false, // Vercel only supports commit deployments
    getTargetBranch: () => undefined,
    getBranchName: () => {
      const branch = process.env.VERCEL_GIT_COMMIT_REF;
      if (!branch) {
        throw new Error(
          'Vercel: VERCEL_GIT_COMMIT_REF is not set. ' +
          'This should be automatically provided by Vercel.'
        );
      }
      return branch;
    },
    getPRTitle: () => undefined,
  },
};
