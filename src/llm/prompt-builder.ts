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

CRITICAL: You must ONLY check for violations of THIS SPECIFIC threadline. Do NOT flag other code quality issues, style problems, or unrelated concerns. 
If the code does not violate THIS threadline's specific rules, return "compliant" even if other issues exist.

Threadline Guidelines:
${threadline.content}

${contextFilesSection}Code Changes (Git Diff Format):
${diff}

Changed Files:
${matchingFiles.join('\n')}

Review the code changes AGAINST ONLY THE THREADLINE GUIDELINES ABOVE.

YOUR OBJECTIVES:
1. Detect new violations being introduced in the code changes
2. Review whether engineers have successfully addressed earlier violations

This is why it's important to look very carefully at the diff structure. You'll come across diffs that introduce new violations. You will also come across some that address earlier violations. The diff structure should allow you to tell which is which, because lines starting with '-' are removed in favour of lines with '+'.

CRITICAL CHECK BEFORE FLAGGING VIOLATIONS:
Before commenting on or flagging a violation in any line, look at the FIRST CHARACTER of that line:
* If it's a "-", the code is deleted.
  → Only flag violations in lines starting with "+" (new code being added)
* If the first character is "+", this is NEW code being added - flag violations here if they violate the threadline
* If the line doesn't start with "+" or "-" (context lines), these are UNCHANGED - do NOT flag violations here
* Some violations may not be line-specific (e.g., file-level patterns, overall structure) - include those in your reasoning as well


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
