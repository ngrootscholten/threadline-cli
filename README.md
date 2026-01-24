# Threadline

Threadline CLI - AI-powered linter based on your natural language documentation.

## Why Threadline?

Getting teams to consistently follow coding patterns and quality standards is **hard**. Really hard.

- **Documentation** → Nobody reads it. Or it's outdated before you finish writing it.
- **Linting** → Catches syntax errors, but misses nuanced stuff.
- **AI Code Reviewers** → Powerful, but you can't trust them. Did they actually check what you care about? Can you customize them with your team's specific rules?

**Threadline solves this** by running **separate, parallel, highly focused AI-powered reviews** - each focused on a single, specific concern or pattern: the stuff that takes engineers months to internalise - and they keep forgetting. Your coding patterns live in your repository as 'Threadline' markdown files, version-controlled and always in sync with your codebase. Each threadline is its own AI agent, ensuring focused attention on what matters to your team.

### What Makes Threadline Different?

- **Focused Reviews** - Instead of one AI agent checking everything, Threadline runs multiple specialized AI reviewers in parallel. Each threadline focuses on one thing and does it well.

- **Documentation That Lives With Your Code** - Your coding standards live in your repo, in a `/threadlines` folder. They're version-controlled, reviewable, and always in sync with your codebase.

- **Fully Auditable** - Every AI review decision is logged and traceable. You can see exactly what was checked, why it passed or failed, and have confidence in the results.

- **Fast & Parallel** - Multiple threadlines run simultaneously, so you get comprehensive feedback in seconds, not minutes.

## Installation

### Option 1: Use with npx (No Installation)

```bash
npx threadlines check
```

**For non-interactive environments** (CI/CD, AI assistants like Cursor):
```bash
npx --yes threadlines check
```

The `--yes` flag auto-confirms package installation, preventing prompts that block automation.

## Quick Start

### 1. Initialize Your First Threadline

```bash
npx threadlines init
```

This command:
- Creates a `/threadlines` directory in your project root
- Generates `threadlines/example.md` with a template threadline
- Provides instructions for setting up your API key

### 2. Configure API Key

Create a `.env.local` file in your project root:

```bash
THREADLINE_API_KEY=your-api-key-here
```

**Important:** Make sure `.env.local` is in your `.gitignore` file!

For CI/CD environments, set `THREADLINE_API_KEY` as an environment variable in your platform settings.

### 3. Edit Your Threadline

Edit `threadlines/example.md` with your coding standards, then rename it to something descriptive (e.g., `error-handling.md`).

### 4. Run Checks

```bash
npx threadlines check
```

By default, analyzes your staged/unstaged git changes against all threadlines in the `/threadlines` directory.

**Review Context Types:**
- `local` - Staged/unstaged changes (default for local development)
- `commit` - Specific commit (when using `--commit` flag)
- `pr` - Pull Request/Merge Request (auto-detected in CI)
- `file` - Single file (when using `--file` flag)
- `folder` - Folder contents (when using `--folder` flag)
- `files` - Multiple files (when using `--files` flag)

**Common Use Cases:**

**Check latest commit locally:**
```bash
threadlines check --commit HEAD
```

**Check a specific commit:**
```bash
threadlines check --commit abc123def
```

**Check entire file(s):**
```bash
threadlines check --file src/api/users.ts
threadlines check --files src/api/users.ts src/api/posts.ts
threadlines check --folder src/api
```

**Debug mode (verbose output):**
```bash
threadlines check --debug
```

**Show all results (not just violations):**
```bash
threadlines check --full
```

**Enable debug logging:**
```bash
threadlines check --debug
```

**Options:**
- `--commit <ref>` - Review specific commit. Accepts commit SHA or git reference (e.g., `HEAD`, `HEAD~1`, `abc123`). Sets review context to `commit`.
- `--file <path>` - Review entire file (all lines as additions). Sets review context to `file`.
- `--folder <path>` - Review all files in folder recursively. Sets review context to `folder`.
- `--files <paths...>` - Review multiple specified files. Sets review context to `files`.
- `--full` - Show all results (compliant, attention, not_relevant). Default: only attention items
- `--debug` - Enable debug logging (verbose output for troubleshooting)

**Note:** Flags (`--commit`, `--file`, `--folder`, `--files`) are for local development only. In CI/CD environments, these flags are ignored and the CLI auto-detects the appropriate context.

**Auto-detection in CI:**
- **Pull Request/Merge Request context** → Reviews all changes in the PR/MR (review context: `pr`)
- **Push to any branch** → Reviews the commit being pushed (review context: `commit`)
- **Local development** → Reviews staged/unstaged changes (review context: `local`)

## Configuration

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `THREADLINE_API_KEY` | Authentication with Threadlines API | Yes |
| `THREADLINE_ACCOUNT` | Your Threadlines account email | Yes |

Both required variables can be set in a `.env.local` file (recommended for local development) or as environment variables (required for CI/CD).

**Local Development:**
Create a `.env.local` file in your project root:
```bash
THREADLINE_API_KEY=your-api-key-here
THREADLINE_ACCOUNT=your-email@example.com
```

**CI/CD:**
Set these as environment variables in your platform:
- **GitHub Actions**: Settings → Secrets → Add variables
- **GitLab CI**: Settings → CI/CD → Variables
- **Bitbucket Pipelines**: Repository settings → Repository variables
- **Vercel**: Settings → Environment Variables

Get your credentials at: https://devthreadline.com/settings

### Configuration File (`.threadlinerc`)

You can customize the API endpoint and other settings by creating a `.threadlinerc` file in your project root:

```json
{
  "mode": "online",
  "api_url": "https://devthreadline.com",
  "openai_model": "gpt-5.2",
  "openai_service_tier": "Flex",
  "diff_context_lines": 10
}
```

The `api_url` field allows you to point to a custom server if needed. Default is `https://devthreadline.com`.

## Threadline Files

Create a `/threadlines` folder in your repository. Each markdown file is a threadline defining a code quality standard.

### Format

Each threadline file must have YAML frontmatter and a markdown body:

```markdown
---
id: unique-id
version: 1.0.0
patterns:
  - "**/api/**"
  - "**/*.ts"
context_files:
  - "path/to/context-file.ts"
---

# Your Threadline Title

Your guidelines and standards here...
```

### Required Fields

- **`id`**: Unique identifier (e.g., `sql-queries`, `error-handling`)
- **`version`**: Semantic version (e.g., `1.0.0`)
- **`patterns`**: Array of glob patterns matching files to check (e.g., `["**/api/**", "**/*.ts"]`)
- **Body**: Markdown content describing your standards

### Optional Fields

- **`context_files`**: Array of file paths that provide context (always included, even if unchanged)

### Example: Feature Flagging Standards

```markdown
---
id: feature-flags
version: 1.0.0
patterns:
  - "**/features/**"
  - "**/components/**"
  - "**/*.tsx"
  - "**/*.ts"
context_files:
  - "config/feature-flags.ts"
---

# Feature Flag Standards

All feature flag usage must:
- Check flags using the centralized `isFeatureEnabled()` function from `config/feature-flags.ts`
- Never hardcode feature flag names as strings (use constants from the config)
- Include proper cleanup: remove feature flag checks when features are fully rolled out
- Document rollout plan in PR description (target percentage, timeline)
- Use feature flags for gradual rollouts, not as permanent configuration

**Violations:**
- ❌ `if (process.env.NEW_FEATURE === 'true')` (hardcoded, not using registry)
- ❌ `if (flags['new-feature'])` (string literal instead of constant)
- ✅ `if (isFeatureEnabled(FeatureFlags.NEW_DASHBOARD))` (using centralized function)
```

The `config/feature-flags.ts` file will always be included as context, ensuring the AI reviewer can verify that:
- Feature flag names match the registry
- The correct flag checking function is used
- Flags are properly typed and documented

