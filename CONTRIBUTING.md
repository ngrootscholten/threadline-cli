# Contributing to Threadlines CLI

Thank you for your interest in contributing! This document provides guidelines
for contributing to the Threadlines CLI.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/threadlines/cli.git
   cd cli
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Run the CLI locally:
   ```bash
   node dist/index.js --help
   ```

## Development Workflow

### Making Changes

1. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the `src/` directory

3. Run checks before committing:
   ```bash
   npm run check    # Runs lint + typecheck
   npm run build    # Builds to dist/
   ```

4. Test your changes locally:
   ```bash
   node dist/index.js check
   ```

### Code Style

- We use ESLint with TypeScript rules
- Run `npm run lint:fix` to auto-fix issues
- Follow existing patterns in the codebase

### Commit Messages

Use clear, descriptive commit messages:
- `feat: add support for GitLab CI detection`
- `fix: handle empty diff correctly`
- `docs: update README with new options`

## Pull Requests

1. Ensure all checks pass (`npm run check`)
2. Update documentation if needed
3. Add a clear description of your changes
4. Reference any related issues

## Reporting Issues

When reporting bugs, please include:
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Relevant error messages

## Security

If you discover a security vulnerability, please email security@threadlines.dev
instead of opening a public issue. See [SECURITY.md](SECURITY.md) for details.

## Questions?

Open a [discussion](https://github.com/threadlines/cli/discussions) or
reach out at hello@threadlines.dev.

