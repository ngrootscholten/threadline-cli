/**
 * Creates a slim version of a git diff with reduced context lines.
 * 
 * Git diffs typically have 3 lines of context by default, but we may have
 * diffs with much more context (e.g., 200 lines). This function creates
 * a version with only the specified number of context lines around changes.
 * 
 * @param fullDiff - The full git diff string
 * @param contextLines - Number of context lines to keep above/below changes (default: 3)
 * @returns A slim diff string with reduced context
 */
export function createSlimDiff(fullDiff: string, contextLines: number = 3): string {
  if (!fullDiff || fullDiff.trim() === '') {
    return '';
  }

  const lines = fullDiff.split('\n');
  const result: string[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // File header: diff --git a/path b/path
    if (line.startsWith('diff --git ')) {
      result.push(line);
      i++;
      
      // Copy file metadata lines until we hit the first hunk
      while (i < lines.length && !lines[i].startsWith('@@')) {
        result.push(lines[i]);
        i++;
      }
      continue;
    }
    
    // Hunk header: @@ -start,count +start,count @@
    if (line.startsWith('@@')) {
      // Process this hunk
      i++;
      
      // Collect all lines in this hunk (until next @@ or diff --git or end)
      const hunkLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git ')) {
        hunkLines.push(lines[i]);
        i++;
      }
      
      // Find which lines are changes
      const changeIndices: number[] = [];
      for (let j = 0; j < hunkLines.length; j++) {
        const hunkLine = hunkLines[j];
        if (hunkLine.startsWith('+') || hunkLine.startsWith('-')) {
          changeIndices.push(j);
        }
      }
      
      // If no changes in this hunk, skip it
      if (changeIndices.length === 0) {
        continue;
      }
      
      // Determine which lines to keep (changes + context)
      const keepLines = new Set<number>();
      for (const changeIdx of changeIndices) {
        // Keep the change line
        keepLines.add(changeIdx);
        // Keep N lines before
        for (let k = 1; k <= contextLines; k++) {
          if (changeIdx - k >= 0) {
            keepLines.add(changeIdx - k);
          }
        }
        // Keep N lines after
        for (let k = 1; k <= contextLines; k++) {
          if (changeIdx + k < hunkLines.length) {
            keepLines.add(changeIdx + k);
          }
        }
      }
      
      // Build the slim hunk
      const sortedKeepIndices = Array.from(keepLines).sort((a, b) => a - b);
      const slimHunkLines: string[] = [];
      
      for (const idx of sortedKeepIndices) {
        slimHunkLines.push(hunkLines[idx]);
      }
      
      // Calculate new hunk header
      // Count old and new lines
      let oldLineCount = 0;
      let newLineCount = 0;
      for (const slimLine of slimHunkLines) {
        if (slimLine.startsWith('-')) {
          oldLineCount++;
        } else if (slimLine.startsWith('+')) {
          newLineCount++;
        } else {
          // Context line counts for both
          oldLineCount++;
          newLineCount++;
        }
      }
      
      // Parse original hunk header to get starting line numbers
      const hunkHeaderMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)?/);
      if (hunkHeaderMatch) {
        const oldStart = parseInt(hunkHeaderMatch[1], 10);
        const newStart = parseInt(hunkHeaderMatch[2], 10);
        const hunkTitle = hunkHeaderMatch[3] || '';
        
        // Adjust starting line based on which lines we kept
        // The first kept line's offset from the original hunk start
        const firstKeptIdx = sortedKeepIndices[0];
        let oldOffset = 0;
        let newOffset = 0;
        for (let j = 0; j < firstKeptIdx; j++) {
          const skippedLine = hunkLines[j];
          if (skippedLine.startsWith('-')) {
            oldOffset++;
          } else if (skippedLine.startsWith('+')) {
            newOffset++;
          } else {
            oldOffset++;
            newOffset++;
          }
        }
        
        const newOldStart = oldStart + oldOffset;
        const newNewStart = newStart + newOffset;
        
        result.push(`@@ -${newOldStart},${oldLineCount} +${newNewStart},${newLineCount} @@${hunkTitle}`);
        result.push(...slimHunkLines);
      }
      
      continue;
    }
    
    // Any other line (shouldn't happen in well-formed diffs)
    i++;
  }
  
  return result.join('\n');
}
