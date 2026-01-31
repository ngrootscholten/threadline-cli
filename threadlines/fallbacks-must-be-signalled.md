---
id: fallbacks-must-be-signalled
version: 1.0.0
patterns:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
context_files: []
---

# Fallbacks Must Be Clearly Signalled

When code uses a fallback strategy (trying an alternative approach after a failure or to handle a known limitation), it must be clearly signalled to the user through logs. Users need to know when something didn't work as expected or when a suboptimal but acceptable path is being used.

**Note:** This threadline applies to error-handling fallbacks and documented fallbacks for known limitations. It does NOT apply to normal workflow selection (e.g., "if staged files exist, check staged; else check unstaged" - both are valid workflows, not fallbacks).

## Guidelines

1. **Always log fallbacks** - When a fallback is used, log it clearly with context about what happened and what alternative is being used.

2. **Use appropriate log levels based on intent**:
   - **Error-handling fallbacks** (unexpected failures): Use `logger.warn()` or `logger.error()`
   - **Documented fallbacks** (known limitations, well-explained): `logger.info()` is acceptable if clearly documented
   - **Workflow selection** (choosing between normal, expected paths): Not a fallback - `logger.info()` is appropriate

3. **Include context** - Log what happened, why the fallback is acceptable, and what the fallback behavior is.

4. **Focus on intent, not mechanics** - The key is whether you're hiding an error or clearly explaining a workflow choice. If the code clearly expresses intent with comments and logging, it's compliant.

## Examples

```typescript
// ❌ Bad - Silent fallback (no logging)
async function getDiff(commitSha: string): Promise<string> {
  try {
    return await git.show([commitSha, '--format=', '--no-color', '-U200']);
  } catch {
    // Silent fallback - user has no idea this happened
    return await git.diff([`${commitSha}^..${commitSha}`, '-U200']);
  }
}

// ✅ Good - Fallback clearly signalled
async function getDiff(commitSha: string): Promise<string> {
  try {
    return await git.show([commitSha, '--format=', '--no-color', '-U200']);
  } catch (error) {
    // Fallback clearly signalled with context
    logger.warn(`git.show() failed for commit ${commitSha}, using git.diff() as fallback: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return await git.diff([`${commitSha}^..${commitSha}`, '-U200']);
  }
}

// ✅ Good - Fallback with explanation of why it's acceptable
try {
  await syncResultsToWebApp(results);
  logger.info('✓ Results synced successfully');
} catch (error) {
  // Fallback clearly signalled: sync failed but local processing succeeded
  logger.error(`Failed to sync results to web app: ${error instanceof Error ? error.message : 'Unknown error'}`);
  logger.warn('Check results are still valid - sync failure does not affect local processing.');
  // Continue execution - local check succeeded, sync is optional
}
```

## When Fallbacks Are Acceptable

- When a non-critical feature fails (e.g., optional sync, optional telemetry)
- When the primary functionality succeeded and the fallback is for enhancement
- When the fallback behavior is documented and expected
- When handling known limitations with clear documentation (e.g., shallow clones in CI)

## What Is NOT a Fallback

- **Workflow selection**: Choosing between normal, expected workflows (e.g., staged vs unstaged files) is not a fallback
- **Conditional logic**: If/else selecting between valid paths based on user state is not a fallback
- **Feature flags**: Enabling/disabling features based on configuration is not a fallback

## When NOT to Use Fallbacks

- For critical functionality - fail loudly instead
- When the fallback hides a configuration error - fix the configuration instead
- When the fallback makes debugging harder - prefer explicit errors
