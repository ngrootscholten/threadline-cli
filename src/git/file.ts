import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { logger } from '../utils/logger';

export interface FileContentResult {
  diff: string;
  changedFiles: string[];
}

/**
 * Read content of a single file and create artificial diff (all lines as additions)
 */
export async function getFileContent(repoRoot: string, filePath: string): Promise<FileContentResult> {
  const fullPath = path.resolve(repoRoot, filePath);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File '${filePath}' not found`);
  }

  // Check if it's actually a file (not a directory)
  const stats = fs.statSync(fullPath);
  if (!stats.isFile()) {
    throw new Error(`Path '${filePath}' is not a file`);
  }

  // Read file content
  const content = fs.readFileSync(fullPath, 'utf-8');
  
  // Normalize path to forward slashes for cross-platform consistency (git uses forward slashes)
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Create artificial diff (all lines as additions)
  const lines = content.split('\n');
  const diff = lines.map((line) => `+${line}`).join('\n');
  
  // Add git diff header (matches format expected by server's filterDiffByFiles)
  const diffHeader = `diff --git a/${normalizedPath} b/${normalizedPath}\n--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n`;
  const fullDiff = diffHeader + diff;

  return {
    diff: fullDiff,
    changedFiles: [normalizedPath]
  };
}

/**
 * Read content of all files in a folder (recursively) and create artificial diff
 */
export async function getFolderContent(repoRoot: string, folderPath: string): Promise<FileContentResult> {
  const fullPath = path.resolve(repoRoot, folderPath);
  
  // Check if folder exists
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Folder '${folderPath}' not found`);
  }

  // Check if it's actually a directory
  const stats = fs.statSync(fullPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path '${folderPath}' is not a folder`);
  }

  // Find all files recursively (normalize to forward slashes for glob on Windows)
  const pattern = path.join(fullPath, '**', '*').replace(/\\/g, '/');
  const files = await glob(pattern, {
    cwd: repoRoot,
    absolute: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
  });

  // Filter to only actual files (not directories)
  const filePaths = files.filter(file => {
    const fileFullPath = path.resolve(repoRoot, file);
    try {
      return fs.statSync(fileFullPath).isFile();
    } catch {
      return false;
    }
  });

  if (filePaths.length === 0) {
    throw new Error(`No files found in folder '${folderPath}'`);
  }

  // Read all files and create combined diff
  const diffs: string[] = [];
  const changedFiles: string[] = [];

  for (const filePath of filePaths) {
    try {
      const content = fs.readFileSync(path.resolve(repoRoot, filePath), 'utf-8');
      const lines = content.split('\n');
      
      // Normalize path to forward slashes for cross-platform consistency
      const normalizedPath = filePath.replace(/\\/g, '/');
      
      // Create artificial diff for this file (git diff format)
      const fileDiff = lines.map((line) => `+${line}`).join('\n');
      const diffHeader = `diff --git a/${normalizedPath} b/${normalizedPath}\n--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n`;
      diffs.push(diffHeader + fileDiff);
      
      changedFiles.push(normalizedPath);
    } catch (error: unknown) {
      // Skip files that can't be read (permissions, etc.)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Could not read file '${filePath}': ${errorMessage}`);
    }
  }

  return {
    diff: diffs.join('\n'),
    changedFiles
  };
}

/**
 * Read content of multiple specified files and create artificial diff
 */
export async function getMultipleFilesContent(repoRoot: string, filePaths: string[]): Promise<FileContentResult> {
  if (filePaths.length === 0) {
    throw new Error('No files specified');
  }

  const diffs: string[] = [];
  const changedFiles: string[] = [];

  for (const filePath of filePaths) {
    const fullPath = path.resolve(repoRoot, filePath);
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File '${filePath}' not found`);
    }

    // Check if it's actually a file
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      throw new Error(`Path '${filePath}' is not a file`);
    }

    // Read file content
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    // Normalize path to forward slashes for cross-platform consistency
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Create artificial diff for this file (git diff format)
    const fileDiff = lines.map((line) => `+${line}`).join('\n');
    const diffHeader = `diff --git a/${normalizedPath} b/${normalizedPath}\n--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n`;
    diffs.push(diffHeader + fileDiff);
    
    changedFiles.push(normalizedPath);
  }

  return {
    diff: diffs.join('\n'),
    changedFiles
  };
}


