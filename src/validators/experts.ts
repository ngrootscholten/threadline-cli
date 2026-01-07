import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Threadline, ThreadlineValidationResult } from '../types/expert';

const REQUIRED_FIELDS = ['id', 'version', 'patterns'];

/**
 * Find and validate all threadlines in the threadlines folder.
 * @param searchRoot - Where to look for threadlines (usually cwd)
 * @param gitRoot - Git repository root (for consistent filePath across monorepo)
 */
export async function findThreadlines(searchRoot: string, gitRoot: string): Promise<Threadline[]> {
  const expertsDir = path.join(searchRoot, 'threadlines');
  
  if (!fs.existsSync(expertsDir)) {
    throw new Error('No /threadlines folder found. Run `npx threadlines init` to create your first threadline.');
  }

  const files = fs.readdirSync(expertsDir);
  const expertFiles = files.filter(f => f.endsWith('.md'));

  if (expertFiles.length === 0) {
    throw new Error('No threadline files found in /threadlines folder. Run `npx threadlines init` to create a template.');
  }

  const threadlines: Threadline[] = [];

  for (const file of expertFiles) {
    const result = await validateThreadline(path.join(expertsDir, file), searchRoot, gitRoot);
    if (result.valid && result.threadline) {
      threadlines.push(result.threadline);
    } else {
      console.warn(`⚠️  Skipping ${file}: ${result.errors?.join(', ')}`);
    }
  }

  return threadlines;
}

/**
 * Validate a threadline file and extract its configuration.
 * @param filePath - Absolute path to the threadline file
 * @param searchRoot - Where threadlines were searched from (for context file resolution)
 * @param gitRoot - Git repository root (for consistent filePath in database)
 */
export async function validateThreadline(
  filePath: string,
  searchRoot: string,
  gitRoot: string
): Promise<ThreadlineValidationResult> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    if (!frontmatterMatch) {
      return {
        valid: false,
        errors: ['Missing YAML frontmatter. Threadline files must start with ---']
      };
    }

    const frontmatter = yaml.load(frontmatterMatch[1]) as Record<string, unknown>;
    const body = frontmatterMatch[2].trim();

    // Validate required fields
    const errors: string[] = [];
    
    for (const field of REQUIRED_FIELDS) {
      if (!frontmatter[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate patterns
    if (frontmatter.patterns && !Array.isArray(frontmatter.patterns)) {
      errors.push('patterns must be an array');
    }

    if (Array.isArray(frontmatter.patterns) && frontmatter.patterns.length === 0) {
      errors.push('patterns array cannot be empty');
    }

    // Validate context_files if present
    if (frontmatter.context_files) {
      if (!Array.isArray(frontmatter.context_files)) {
        errors.push('context_files must be an array');
      } else {
        // Check if context files exist (relative to searchRoot)
        for (const contextFile of frontmatter.context_files) {
          if (typeof contextFile === 'string') {
            const fullPath = path.join(searchRoot, contextFile);
            if (!fs.existsSync(fullPath)) {
              errors.push(`Context file not found: ${contextFile}`);
            }
          }
        }
      }
    }

    // Validate body has content
    if (!body || body.length === 0) {
      errors.push('Threadline body cannot be empty');
    }

    // Validate version format (basic semver check)
    if (frontmatter.version && typeof frontmatter.version === 'string' && !/^\d+\.\d+\.\d+/.test(frontmatter.version)) {
      errors.push('version must be in semver format (e.g., 1.0.0)');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Type assertions for required fields (already validated above)
    // filePath is relative to gitRoot for consistent identification across monorepo
    // Normalize to forward slashes for cross-platform consistency (Windows uses backslashes)
    const relativePath = path.relative(gitRoot, filePath);
    const normalizedPath = relativePath.split(path.sep).join('/'); // Always use forward slashes
    
    const threadline: Threadline = {
      id: frontmatter.id as string,
      version: frontmatter.version as string,
      patterns: frontmatter.patterns as string[],
      contextFiles: (Array.isArray(frontmatter.context_files) ? frontmatter.context_files.filter((f): f is string => typeof f === 'string') : []) as string[],
      content: body,
      filePath: normalizedPath
    };

    return { valid: true, threadline };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      valid: false,
      errors: [`Failed to parse threadline file: ${errorMessage}`]
    };
  }
}

