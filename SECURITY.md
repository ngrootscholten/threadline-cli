# Security Policy

## Environment Variables

The Threadlines CLI reads the following environment variables:

| Variable | Purpose | Required |
|----------|---------|----------|
| `THREADLINE_API_KEY` | Authentication with Threadlines API | Yes |
| `THREADLINE_ACCOUNT` | Your Threadlines account email | Yes |
| `THREADLINE_API_URL` | Custom API endpoint (default: https://devthreadline.com) | No |

### What We Do NOT Read

This CLI does **not** access, read, or transmit any other environment variables. We do not:

- Enumerate `process.env` to discover other secrets
- Read AWS, GCP, or other cloud credentials
- Access database connection strings
- Read any secrets beyond what's documented above

You can verify this by:
1. Searching the source code for `process.env` usage
2. Auditing the `src/utils/environment.ts` file which contains all env var access

## Data Transmission

The CLI sends the following data to the Threadlines API:

1. **Git diff content** - The code changes being analyzed
2. **Threadline definitions** - Your markdown files from `/threadlines`
3. **Metadata** - Repository name, branch, commit SHA

We do **not** send:
- Your entire codebase
- Environment variables or secrets
- File contents outside of the diff

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by emailing:

**security@threadlines.dev**

Please do **not** open a public GitHub issue for security vulnerabilities.

We will respond within 48 hours and work with you to understand and address the issue.

## Auditing This Package

To verify the published npm package matches this source:

```bash
# Compare published package to source
npm pack threadlines
tar -xzf threadlines-*.tgz
diff -r package/dist dist/  # After building locally
```

All releases are published via GitHub Actions with npm provenance attestation,
which cryptographically links each npm package to its source commit.

