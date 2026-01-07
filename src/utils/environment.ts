/**
 * CI/CD Environment Detection
 * 
 * Detects which CI/CD platform or local environment the code is running in.
 * This is the first step in determining how to collect context and metadata.
 */

export type Environment = 'github' | 'gitlab' | 'vercel' | 'local';

/**
 * Detects the current environment based on environment variables.
 * 
 * Detection order:
 * 1. Vercel: VERCEL=1
 * 2. GitHub Actions: GITHUB_ACTIONS=1
 * 3. GitLab CI: GITLAB_CI=1 or (CI=1 + CI_COMMIT_SHA)
 * 4. Local: None of the above
 */
export function detectEnvironment(): Environment {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.GITHUB_ACTIONS) return 'github';
  if (process.env.GITLAB_CI || (process.env.CI && process.env.CI_COMMIT_SHA)) return 'gitlab';
  return 'local';
}

/**
 * Returns true if running in a CI/CD environment (not local)
 */
export function isCIEnvironment(env: Environment): boolean {
  return env !== 'local';
}

