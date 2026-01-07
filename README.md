# threadlines

Threadline CLI - AI-powered linter based on your natural language documentation.

## Why Threadline?

Getting teams to follow consistent quality standards is **hard**. Really hard.

- **Documentation** → Nobody reads it. Or it's outdated before you finish writing it.
- **Linting** → Catches syntax errors, but misses nuanced stuff.
- **AI Code Reviewers** → Powerful, but you can't trust them. Did they actually check what you care about? Can you customize them with your team's specific rules?

**Threadline solves this** by running **separate, parallel, highly focused AI-powered reviews** - each focused on a single, specific concern. Your coding standards live in your repository as markdown files, version-controlled and always in sync with your codebase. Each threadline gets its own dedicated AI check, ensuring focused attention on what matters to your team.

### What Makes Threadline Different?

- **🎯 Focused Reviews** - Instead of one AI trying to check everything, Threadline runs multiple specialized AI reviewers in parallel. Each threadline focuses on one thing and does it well.

- **📝 Documentation That Lives With Your Code** - Your coding standards live in your repo, in a `/threadlines` folder. They're version-controlled, reviewable, and always in sync with your codebase.

- **🔍 Fully Auditable** - Every AI review decision is logged and traceable. You can see exactly what was checked, why it passed or failed, and have confidence in the results.

- **⚡ Fast & Parallel** - Multiple threadlines run simultaneously, so you get comprehensive feedback in seconds, not minutes.

## Installation

### Option 1: Global Installation (Recommended for Regular Use)

```bash
npm install -g threadlines
```

Then use directly:
```bash
threadlines check
```

### Option 2: Use with npx (No Installation)

```bash
npx threadlines check
```

**For non-interactive environments** (CI/CD, AI assistants like Cursor):
```bash
npx --yes threadlines check
```

The `--yes` flag auto-confirms package installation, preventing prompts that block automation.

### Option 3: Local Project Dependency (Recommended for Teams)

```bash
npm install --save-dev threadlines
```

Then use:
```bash
npx threadlines check
```

This ensures everyone on your team uses the same version.

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

## Usage

### Initialize Threadline Template

```bash
threadlines init
```

Creates a template threadline file to get you started. The command will:
- Create the `/threadlines` directory if it doesn't exist
- Generate `threadlines/example.md` with boilerplate content
- Display instructions for API key configuration

### Check Code Against Threadlines

```bash
threadlines check
```

By default, analyzes your staged/unstaged git changes against all threadlines in the `/threadlines` directory.

**Common Use Cases:**

**Check latest commit locally:**
```bash
threadlines check --commit HEAD
```

**Check a specific commit:**
```bash
threadlines check --commit abc123def
```

**Check all commits in a branch:**
```bash
threadlines check --branch feature/new-feature
```

**Check entire file(s):**
```bash
threadlines check --file src/api/users.ts
threadlines check --files src/api/users.ts src/api/posts.ts
threadlines check --folder src/api
```

**Show all results (not just violations):**
```bash
threadlines check --full
```

**Options:**
- `--api-url <url>` - Override the server URL (default: http://localhost:3000)
- `--commit <ref>` - Review specific commit. Accepts commit SHA or git reference (e.g., `HEAD`, `HEAD~1`, `abc123`)
- `--branch <name>` - Review all commits in branch vs base
- `--file <path>` - Review entire file (all lines as additions)
- `--folder <path>` - Review all files in folder recursively
- `--files <paths...>` - Review multiple specified files
- `--full` - Show all results (compliant, attention, not_relevant). Default: only attention items

**Auto-detection in CI:**
- CI with branch detected → reviews all commits in branch vs base
- CI with commit SHA detected → reviews specific commit
- Local development → reviews staged/unstaged changes

## Configuration

### Environment Variables

- `THREADLINE_API_KEY` - **Required.** Your Threadline API key for authentication
  - Can be set in `.env.local` file (recommended for local development)
  - Or as an environment variable (required for CI/CD)
- `THREADLINE_API_URL` - Server URL (default: http://localhost:3000)
  - Can also be set with `--api-url` flag: `npx threadlines check --api-url http://your-server.com`

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

### Example: SQL Queries with Schema Context

```markdown
---
id: sql-queries
version: 1.0.0
patterns:
  - "**/queries/**"
  - "**/*.sql"
context_files:
  - "schema.sql"
---

# SQL Query Standards

All SQL queries must:
- Reference tables and columns that exist in schema.sql
- Use parameterized queries (no string concatenation)
- Include proper indexes for WHERE clauses
```

The `schema.sql` file will always be included as context, even if you're only changing query files.

