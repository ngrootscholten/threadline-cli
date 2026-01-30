/**
 * Git Diff Filtering Utilities
 * 
 * Filters git diffs to include only specific files.
 * This is used to send only relevant files to each threadline's LLM call.
 */

/**
 * Filters a git diff to include only the specified files.
 * 
 * Git diff format structure:
 * - Each file section starts with "diff --git a/path b/path"
 * - Followed by metadata lines (index, ---, +++)
 * - Then hunks with "@@ -start,count +start,count @@" headers
 * - Content lines (+, -, space-prefixed)
 * 
 * @param diff - The full git diff string
 * @param filesToInclude - Array of file paths to include (must match paths in diff)
 * @returns Filtered diff containing only the specified files
 */
export function filterDiffByFiles(diff: string, filesToInclude: string[]): string {
  if (!diff || diff.trim() === '') {
    return '';
  }

  if (filesToInclude.length === 0) {
    return '';
  }

  // Normalize file paths for comparison (handle both a/path and b/path formats)
  const normalizedFiles = new Set(
    filesToInclude.map(file => file.trim())
  );

  const lines = diff.split('\n');
  const filteredLines: string[] = [];
  let currentFile: string | null = null;
  let inFileSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for file header: "diff --git a/path b/path"
    const diffHeaderMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (diffHeaderMatch) {
      // Save previous file section if it was included
      if (inFileSection && currentFile && normalizedFiles.has(currentFile)) {
        // File section was included - it's already been added to filteredLines
        // Reset for next file
      }

      // Start new file section
      const filePathB = diffHeaderMatch[2];
      
      // Use the 'b' path (new file) as the canonical path
      currentFile = filePathB;
      inFileSection = normalizedFiles.has(filePathB);

      if (inFileSection) {
        filteredLines.push(line);
      }
      continue;
    }

    // If we're in a file section that should be included, add all lines
    if (inFileSection && currentFile && normalizedFiles.has(currentFile)) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

/**
 * Extracts file paths from a git diff.
 * 
 * @param diff - The git diff string
 * @returns Array of file paths found in the diff
 */
export function extractFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  const lines = diff.split('\n');

  for (const line of lines) {
    const diffHeaderMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (diffHeaderMatch) {
      files.add(diffHeaderMatch[2]); // Use 'b' path
    }
  }
  return Array.from(files);
}

/**
 * Filters hunk content to show only changed lines (removes context lines).
 * Context lines are lines that start with a space (unchanged code).
 * 
 * @param hunkContent - The content of a hunk (array of lines)
 * @returns Filtered hunk content with only changed lines (+ and -)
 */
export function filterHunkToChanges(hunkContent: string[]): string[] {
  return hunkContent.filter(line => {
    // Keep lines that start with + or - (actual changes)
    // Remove lines that start with space (context/unchanged code)
    return line.startsWith('+') || line.startsWith('-');
  });
}

/**
 * Checks if a hunk has any actual changes (not just context).
 * 
 * @param hunkContent - The content of a hunk (array of lines)
 * @returns True if the hunk contains actual changes
 */
export function hasChanges(hunkContent: string[]): boolean {
  return hunkContent.some(line => line.startsWith('+') || line.startsWith('-'));
}
