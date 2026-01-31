# Code Changes Summary

## Overview

This update adds support for Amazon Bedrock (Claude Sonnet) as an alternative LLM provider alongside OpenAI, improves configuration management, and refactors provider selection logic for better clarity and maintainability.

---

## Major Features

### 1. Amazon Bedrock Support

**What's New:**
- Threadlines CLI now supports Amazon Bedrock (Claude Sonnet) as an LLM provider
- Uses AWS Bedrock's Converse API with Tool Use for structured JSON responses
- Ensures reliable, consistent output format without markdown code blocks

**Configuration:**
- Add Bedrock credentials to `.env.local`:
  ```
  BEDROCK_ACCESS_KEY_ID=your-access-key-id
  BEDROCK_SECRET_ACCESS_KEY=your-secret-access-key
  ```
- Configure model and region in `.threadlinerc`:
  ```json
  {
    "bedrock_model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "bedrock_region": "us-east-1"
  }
  ```

**How It Works:**
- Bedrock uses Tool Use with JSON schema validation to ensure structured responses
- Responses are automatically parsed from the tool output format
- No manual JSON extraction needed

---

### 2. Improved Configuration Management

**Clear Separation of Concerns:**
- **Secrets** (API keys, access keys) → Environment variables (`.env.local`)
- **Configuration** (models, regions, service tiers) → `.threadlinerc` file

**Stricter Validation:**
- Configuration values (model, region, service tier) must be explicitly set in `.threadlinerc`
- No silent fallbacks to defaults or environment variables
- Missing configuration values result in clear error messages with setup instructions

**Benefits:**
- More predictable behavior
- Easier to debug configuration issues
- Clear separation between secrets and settings

---

### 3. Explicit Provider Selection

**Before:**
- Provider selection used an if-else chain that looked like a fallback pattern
- Unclear intent when both providers were configured

**After:**
- Explicit case-based selection handling all scenarios:
  - Both configured → Warns user and uses Bedrock (with logging)
  - Only Bedrock → Uses Bedrock
  - Only OpenAI → Uses OpenAI
  - Neither → Fails with helpful error message

**Benefits:**
- Clear intent: provider selection, not fallback behavior
- Better user experience: warns when both are configured
- Easier to understand and maintain

---

## Technical Improvements

### Dependencies
- **aws4** moved from optional to required dependency
  - Ensures Bedrock functionality always works
  - No runtime checks needed for package availability

### Code Quality
- Removed unnecessary try-catch blocks for required dependencies
- Improved type safety with explicit interfaces
- Better error messages with actionable guidance

---

## Migration Guide

### For Existing Users

**No changes required** - OpenAI continues to work as before.

### For New Bedrock Users

1. **Add credentials to `.env.local`:**
   ```
   BEDROCK_ACCESS_KEY_ID=your-access-key-id
   BEDROCK_SECRET_ACCESS_KEY=your-secret-access-key
   ```

2. **Update `.threadlinerc`** (if not already present):
   ```json
   {
     "bedrock_model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
     "bedrock_region": "us-east-1"
   }
   ```

3. **Run `npm install`** to ensure `aws4` is installed

### Configuration Priority

If both Bedrock and OpenAI are configured:
- Bedrock will be used (with a warning message)
- To use OpenAI instead, remove Bedrock credentials from `.env.local`

---

## Breaking Changes

**None** - All changes are backward compatible. Existing OpenAI-only setups continue to work without modification.

---

## Files Changed

- `src/commands/check.ts` - Provider selection logic refactored
- `src/utils/config.ts` - Configuration loading improved, Bedrock support added
- `src/utils/config-file.ts` - Added Bedrock config fields to interface
- `src/processors/single-expert.ts` - Bedrock API implementation with Tool Use
- `src/processors/expert.ts` - Updated to handle both providers
- `src/commands/init.ts` - Updated template to include Bedrock config
- `package.json` - aws4 moved to required dependencies

---

## Testing Recommendations

1. **Test Bedrock configuration:**
   - Verify Bedrock credentials work
   - Check that structured JSON responses are parsed correctly

2. **Test provider selection:**
   - Configure only Bedrock → Should use Bedrock
   - Configure only OpenAI → Should use OpenAI
   - Configure both → Should warn and use Bedrock

3. **Test configuration validation:**
   - Remove model/region from `.threadlinerc` → Should show clear error
   - Verify error messages are helpful and actionable

---

## Future Considerations

- Monitor AWS Bedrock for native structured output support (currently using Tool Use workaround)
- Consider adding provider preference setting in `.threadlinerc` for explicit control
