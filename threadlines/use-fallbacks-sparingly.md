---
id: use-fallbacks-sparingly
version: 1.0.0
patterns:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
context_files: []
---

# Use Fallbacks Sparingly

Fallbacks should only be used when it's very important that a larger piece of functionality still works. Most failures should propagate and fail loudly.

## Guidelines

1. **Prefer failing loudly** - Most errors should propagate up and fail the operation. This makes problems visible and forces fixes.

2. **Use fallbacks only for critical paths** - Only use fallbacks when:
   - The primary functionality succeeded and the failure is in optional/non-critical code
   - The larger operation must continue even if a non-essential part fails
   - The fallback behavior is well-understood and safe

3. **Don't use fallbacks to hide errors** - If something fails, it's usually better to fail loudly than to silently try something else.

4. **Well-justified fallbacks are compliant** - If a fallback is well-justified, explained (with comments), and signalled (with appropriate logging), it is compliant with this threadline.

## Examples

```typescript
// ❌ Bad - Fallback hides a critical failure
function getApiKey(): string {
  try {
    return process.env.API_KEY!;
  } catch {
    // Bad: fallback hides missing required config
    return 'default-key'; // This should fail loudly instead
  }
}

// ✅ Good - Fail loudly for critical failures
function getApiKey(): string {
  const key = process.env.API_KEY;
  if (!key) {
    throw new Error('API_KEY environment variable is required');
  }
  return key;
}

// ✅ Good - Fallback acceptable: local processing succeeded, sync is optional
try {
  await syncResultsToWebApp(results);
  logger.info('✓ Results synced successfully');
} catch (error) {
  // Acceptable fallback: local check succeeded, sync is optional enhancement
  logger.error(`Failed to sync results to web app: ${error instanceof Error ? error.message : 'Unknown error'}`);
  logger.warn('Check results are still valid - sync failure does not affect local processing.');
  // Continue - the primary functionality (code checking) succeeded
}

// ❌ Bad - Fallback for critical functionality
async function processCode(diff: string): Promise<Results> {
  try {
    return await callLLM(diff);
  } catch {
    // Bad: fallback hides LLM failure - this is critical functionality
    return { status: 'compliant' }; // Should fail loudly instead
  }
}

// ✅ Good - Fail loudly for critical functionality
async function processCode(diff: string): Promise<Results> {
  // If LLM fails, error propagates and fails loudly
  // This is critical functionality - no fallback
  return await callLLM(diff);
}
```

## When Fallbacks Are Appropriate

- **Optional features**: Syncing results, telemetry, optional caching
- **Enhancement features**: Performance optimizations, nice-to-have features
- **Non-critical paths**: Logging, metrics, optional validation

## When NOT to Use Fallbacks

- **Core functionality**: Code checking, LLM calls, git operations
- **Required configuration**: Missing API keys, invalid config files
- **Data integrity**: Parsing errors, validation failures
- **When debugging would be harder**: Prefer explicit errors over hidden fallbacks
