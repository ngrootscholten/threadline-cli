import { ExpertResult } from '../api/client';
import { buildPrompt, ThreadlineInput } from '../llm/prompt-builder';
import { filterDiffByFiles, extractFilesFromDiff } from '../utils/diff-filter';
import { createSlimDiff } from '../utils/slim-diff';
import { logger } from '../utils/logger';

export interface ProcessThreadlineResult extends ExpertResult {
  relevantFiles: string[]; // Files that matched threadline patterns
  filteredDiff: string; // The actual diff sent to LLM (filtered to only relevant files)
  filesInFilteredDiff: string[]; // Files actually present in the filtered diff sent to LLM
  actualModel?: string; // Actual model returned by OpenAI (may differ from requested)
  llmCallMetrics?: {
    startedAt: string; // ISO 8601
    finishedAt: string; // ISO 8601
    responseTimeMs: number;
    tokens?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    } | null;
    status: 'success' | 'timeout' | 'error';
    errorMessage?: string | null;
  };
}

export async function processThreadline(
  threadline: ThreadlineInput,
  diff: string,
  files: string[],
  apiKey: string,
  model: string,
  serviceTier: string,
  contextLinesForLLM: number
): Promise<ProcessThreadlineResult> {

  // Filter files that match threadline patterns
  const relevantFiles = files.filter(file => 
    threadline.patterns.some(pattern => matchesPattern(file, pattern))
  );

  // If no files match, return not_relevant
  if (relevantFiles.length === 0) {
    logger.debug(`   ⚠️  ${threadline.id}: No files matched patterns ${threadline.patterns.join(', ')}`);
    logger.debug(`      Files checked: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
    return {
      expertId: threadline.id,
      status: 'not_relevant',
      reasoning: `No files match threadline patterns: ${threadline.patterns.join(', ')}`,
      fileReferences: [],
      relevantFiles: [],
      filteredDiff: '',
      filesInFilteredDiff: []
    };
  }

  // Filter diff to only include relevant files
  const filteredDiff = filterDiffByFiles(diff, relevantFiles);
  
  // Extract files actually present in the filtered diff
  const filesInFilteredDiff = extractFilesFromDiff(filteredDiff);

  // Trim diff for LLM to reduce token costs (keep full diff for storage/UI)
  // The CLI sends diffs with -U200 (200 lines context), which can be expensive.
  // This trims the diff to only N context lines before sending to LLM.
  // Note: Full filtered diff is still stored in DB for UI viewing.
  const trimmedDiffForLLM = createSlimDiff(filteredDiff, contextLinesForLLM);
  
  // Log diff trimming if it occurred
  const originalLines = filteredDiff.split('\n').length;
  const trimmedLines = trimmedDiffForLLM.split('\n').length;
  if (trimmedLines < originalLines) {
    const reductionPercent = Math.round(((originalLines - trimmedLines) / originalLines) * 100);
    logger.debug(`   ✂️  Trimmed diff for LLM: ${originalLines} → ${trimmedLines} lines (${reductionPercent}% reduction, ${contextLinesForLLM} context lines)`);
  }

  // Build prompt with trimmed diff (full filtered diff is still stored for UI)
  const prompt = buildPrompt(threadline, trimmedDiffForLLM, filesInFilteredDiff);
  
  logger.debug(`   📝 Processing ${threadline.id}: ${relevantFiles.length} relevant files, ${filesInFilteredDiff.length} files in filtered diff`);
  logger.debug(`   🤖 Calling LLM (${model}) for ${threadline.id}...`);
  
  // Capture timing for LLM call
  const llmCallStartedAt = new Date().toISOString();
  let llmCallFinishedAt: string;
  let llmCallResponseTimeMs: number;
  let llmCallTokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
  let llmCallStatus: 'success' | 'timeout' | 'error' = 'success';
  let llmCallErrorMessage: string | null = null;

  try {
    // Build request body for OpenAI API (direct HTTP call - zero dependencies)
    const requestBody: {
      model: string;
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      response_format: { type: 'json_object' };
      temperature: number;
      service_tier?: 'auto' | 'default' | 'flex';
    } = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a code quality checker. Analyze code changes against the threadline guidelines. Be precise - only flag actual violations. Return only valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    };

    // Add service_tier if not 'standard'
    const normalizedServiceTier = serviceTier.toLowerCase();
    if (normalizedServiceTier !== 'standard' && (normalizedServiceTier === 'auto' || normalizedServiceTier === 'default' || normalizedServiceTier === 'flex')) {
      requestBody.service_tier = normalizedServiceTier as 'auto' | 'default' | 'flex';
    }

    // Direct HTTP call to OpenAI API (native fetch - zero dependencies)
    // Use AbortController for timeout (higher-level timeout in expert.ts is 40s, use 45s here as safety margin)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    let httpResponse: Response;
    try {
      httpResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      // Handle AbortError from timeout
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw fetchError;
    }

    if (!httpResponse.ok) {
      const errorText = await httpResponse.text();
      let errorMessage = `HTTP ${httpResponse.status}: ${errorText}`;
      
      // Try to parse OpenAI error structure
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error) {
          errorMessage = errorData.error.message || errorText;
          // Create error object matching SDK error structure for compatibility
          const errorObj: any = new Error(errorMessage);
          errorObj.status = httpResponse.status;
          errorObj.error = {
            type: errorData.error.type,
            code: errorData.error.code,
            param: errorData.error.param,
          };
          throw errorObj;
        }
      } catch (parseError: any) {
        // If it's already our structured error, re-throw it
        if (parseError.status) {
          throw parseError;
        }
        // Otherwise create a basic error
        throw new Error(errorMessage);
      }
    }

    const response = await httpResponse.json() as {
      id?: string;
      model?: string;
      choices?: Array<{
        message?: {
          role?: string;
          content?: string;
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    // Capture the actual model returned by OpenAI (may differ from requested)
    const actualModel = response.model;

    llmCallFinishedAt = new Date().toISOString();
    llmCallResponseTimeMs = new Date(llmCallFinishedAt).getTime() - new Date(llmCallStartedAt).getTime();
    
    // Capture token usage if available
    if (response.usage) {
      llmCallTokens = {
        prompt_tokens: response.usage.prompt_tokens || 0,
        completion_tokens: response.usage.completion_tokens || 0,
        total_tokens: response.usage.total_tokens || 0
      };
    }

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No response from LLM');
    }
    
    const parsed = JSON.parse(content);
    
    logger.debug(`   ✅ ${threadline.id}: ${parsed.status}`);
    
    // Extract file references - rely entirely on LLM to provide them
    let fileReferences: string[] = [];
    
    if (parsed.file_references && Array.isArray(parsed.file_references) && parsed.file_references.length > 0) {
      // LLM provided file references - validate they're in filesInFilteredDiff
      fileReferences = parsed.file_references.filter((file: string) => filesInFilteredDiff.includes(file));
      if (parsed.file_references.length !== fileReferences.length) {
        logger.debug(`   ⚠️  Warning: LLM provided ${parsed.file_references.length} file references, but only ${fileReferences.length} match the files sent to LLM`);
      }
    } else {
      // LLM did not provide file_references
      const status = parsed.status || 'not_relevant';
      
      if (status === 'attention') {
        // This is a problem - we have violations but don't know which files
        logger.error(`   ❌ Error: LLM returned "attention" status but no file_references for threadline ${threadline.id}`);
        logger.error(`   Cannot accurately report violations without file references. This may indicate a prompt/LLM issue.`);
        // Return empty file references - better than guessing
        fileReferences = [];
      }
      // For "compliant" or "not_relevant" status, file references are optional
    }

    return {
      expertId: threadline.id,
      status: parsed.status || 'not_relevant',
      reasoning: parsed.reasoning,
      fileReferences: fileReferences,
      relevantFiles: relevantFiles,
      filteredDiff: filteredDiff,
      filesInFilteredDiff: filesInFilteredDiff,
      actualModel: actualModel,
      llmCallMetrics: {
        startedAt: llmCallStartedAt,
        finishedAt: llmCallFinishedAt,
        responseTimeMs: llmCallResponseTimeMs,
        tokens: llmCallTokens,
        status: llmCallStatus,
        errorMessage: llmCallErrorMessage
      }
    };
  } catch (error: unknown) {
    // Capture error timing
    llmCallFinishedAt = new Date().toISOString();
    llmCallResponseTimeMs = new Date(llmCallFinishedAt).getTime() - new Date(llmCallStartedAt).getTime();
    llmCallStatus = 'error';
    
    // Extract error details safely
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    llmCallErrorMessage = errorMessage;
    
    // Log full error for debugging
    logger.error(`   ❌ OpenAI error: ${JSON.stringify(error, null, 2)}`);
    
    // Extract OpenAI error details from the error object
    // Handle both SDK-style errors and HTTP errors
    const errorObj = error as {
      error?: { type?: string; code?: string; param?: string; message?: string };
      status?: number;
      headers?: unknown;
      request_id?: unknown;
      code?: string;
      param?: unknown;
      type?: string;
      message?: string;
    };
    const openAIError = errorObj?.error || {};
    const rawErrorResponse = {
      status: errorObj?.status,
      headers: errorObj?.headers,
      request_id: errorObj?.request_id,
      error: errorObj?.error || {
        type: errorObj?.type,
        code: errorObj?.code,
        param: errorObj?.param,
        message: errorObj?.message,
      },
      code: errorObj?.code,
      param: errorObj?.param,
      type: errorObj?.type
    };
    
    // Return error result with metrics instead of throwing
    // This allows metrics to be captured even when LLM call fails
    // Use 'error' status - errors are errors, not attention items
    return {
      expertId: threadline.id,
      status: 'error',
      reasoning: `Error: ${errorMessage}`,
      error: {
        message: errorMessage,
        type: openAIError?.type || errorObj?.type,
        code: openAIError?.code || errorObj?.code,
        rawResponse: rawErrorResponse
      },
      fileReferences: [],
      relevantFiles: relevantFiles,
      filteredDiff: filteredDiff,
      filesInFilteredDiff: filesInFilteredDiff,
      llmCallMetrics: {
        startedAt: llmCallStartedAt,
        finishedAt: llmCallFinishedAt,
        responseTimeMs: llmCallResponseTimeMs,
        tokens: llmCallTokens,
        status: llmCallStatus,
        errorMessage: llmCallErrorMessage
      }
    };
  }
}

function matchesPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Handle ** first (before single *), escape it to avoid double replacement
  let regexPattern = pattern
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}
