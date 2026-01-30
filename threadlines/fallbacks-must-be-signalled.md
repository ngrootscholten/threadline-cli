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

When code uses a fallback strategy (trying an alternative approach after a failure), it must be clearly signalled to the user through logs. Users need to know when something didn't work as expected.

## Guidelines

1. **Always log fallbacks** - When a fallback is used, log it clearly with context about what failed and what alternative is being used.

2. **Use appropriate log levels** - Use `logger.warn()` or `logger.error()` for fallbacks, not `logger.debug()`. Fallbacks indicate something unexpected happened.

3. **Include context** - Log what failed, why the fallback is acceptable, and what the fallback behavior is.

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

## When NOT to Use Fallbacks

- For critical functionality - fail loudly instead
- When the fallback hides a configuration error - fix the configuration instead
- When the fallback makes debugging harder - prefer explicit errors
