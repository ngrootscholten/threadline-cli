/**
 * Prompt Builder for LLM Threadline Checks
 * 
 * Builds prompts for OpenAI API calls to check code changes against threadline guidelines.
 */

export interface ThreadlineInput {
  id: string;
  version: string;
  patterns: string[];
  content: string;
  contextFiles?: string[];
  contextContent?: Record<string, string>;
}

export function buildPrompt(
  threadline: ThreadlineInput,
  diff: string,
  matchingFiles: string[]
): string {
  // Build context files section if available
  const contextFilesSection = threadline.contextContent && Object.keys(threadline.contextContent).length > 0
    ? `Context Files:\n${Object.entries(threadline.contextContent)
        .map(([file, content]) => `\n--- ${file} ---\n${content}`)
        .join('\n')}\n\n`
    : '';

  return `You are a code quality checker focused EXCLUSIVELY on: ${threadline.id}

CRITICAL: You must ONLY check for violations of THIS SPECIFIC threadline. Do NOT flag other code quality issues, style problems, or unrelated concerns. If the code does not violate THIS threadline's specific rules, return "compliant" even if other issues exist.

Threadline Guidelines:
${threadline.content}

${contextFilesSection}Code Changes (Git Diff Format):
${diff}

Changed Files:
${matchingFiles.join('\n')}

Review the code changes AGAINST ONLY THE THREADLINE GUIDELINES ABOVE.

YOUR OBJECTIVE:
Your job is twofold:
1. Detect new violations being introduced in the code changes
2. Review whether engineers have successfully addressed earlier violations

This is why it's important to look very carefully at the diff structure. You'll come across diffs that introduce new violations. You will also come across some that address earlier violations. The diff structure should allow you to tell which is which, because lines starting with '-' are removed in favour of lines with '+'.

When analyzing the diff:
- Lines starting with "+" represent NEW code being added - violations here are NEW violations that need attention
- Lines starting with "-" represent code being REMOVED - if this removed code contained violations, the engineer is fixing them
- Each file section starts with "diff --git a/path/to/file b/path/to/file" - use this to identify which file each violation belongs to
- File sections contain "@@ -start,count +start,count @@" headers indicating line ranges - line numbers after the "+" refer to the NEW file
- If you see a violation in a "+" line, that's a new violation being introduced
- If you see a violation only in "-" lines (being removed), that's a fix - the engineer is addressing the violation
- If both "+" and "-" lines contain violations, the new violations in "+" lines take priority (the fix isn't complete)
- Some violations may not be line-specific (e.g., file-level patterns, overall structure) - include those in your reasoning as well

CONCRETE EXAMPLES:
Example 1: "+ const fruit = 'banana';" (threadline forbids "banana")
→ This is NEW code introducing a violation → return "attention"

Example 2: "- const fruit = 'banana';" (threadline forbids "banana")
→ This is code being REMOVED that contained a violation → the engineer is fixing it → return "compliant"

Example 3: "+ const fruit = 'banana';" AND "- const fruit = 'apple';"
→ The addition introduces a new violation → return "attention" (the removal doesn't matter if new violations are introduced)

IMPORTANT:
- Only flag violations of the specific rules defined in this threadline
- Ignore all other code quality issues, style problems, or unrelated concerns
- Focus on understanding the diff structure to distinguish between new violations and fixes

Return JSON only with this exact structure:
{
  "status": "compliant" | "attention" | "not_relevant",
  "reasoning": "explanation with file paths and line numbers embedded in the text (e.g., 'app/api/checks/route.ts:8 - The addition of...')",
  "file_references": [file paths where violations occur - MUST match files from the diff, include ONLY files with violations]
}

CRITICAL: For each violation, you MUST:
1. Embed the file path and line number(s) directly in your reasoning text (e.g., "app/api/checks/route.ts:8 - The addition of 'c.files_changed_counts' violates...")
2. For line-specific violations, include the line number (e.g., "file.ts:42")
3. For file-level or pattern violations, just include the file path (e.g., "file.ts")
4. Include ONLY files that actually contain violations in "file_references" array
5. Do NOT include files that don't have violations, even if they appear in the diff
6. The "file_references" array should be a simple list of file paths - no line numbers needed there since they're in the reasoning

Status meanings:
- "compliant": Code follows THIS threadline's guidelines, no violations found (even if other issues exist)
- "attention": Code DIRECTLY violates THIS threadline's specific guidelines
- "not_relevant": This threadline doesn't apply to these files/changes (e.g., wrong file type, no matching code patterns)
`;
}
