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
  provider: 'bedrock' | 'openai',
  bedrockConfig: {
    accessKeyId: string;
    secretAccessKey: string;
    model: string;
    region: string;
  } | undefined,
  openaiConfig: {
    apiKey: string;
    model: string;
    serviceTier: string;
  } | undefined,
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
  
  const modelName = provider === 'bedrock' ? bedrockConfig?.model : openaiConfig?.model;
  logger.debug(`   📝 Processing ${threadline.id}: ${relevantFiles.length} relevant files, ${filesInFilteredDiff.length} files in filtered diff`);
  logger.debug(`   🤖 Calling LLM (${provider}, ${modelName}) for ${threadline.id}...`);
  
  // Capture timing for LLM call
  const llmCallStartedAt = new Date().toISOString();
  let llmCallFinishedAt: string;
  let llmCallResponseTimeMs: number;
  let llmCallTokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
  let llmCallStatus: 'success' | 'timeout' | 'error' = 'success';
  let llmCallErrorMessage: string | null = null;

  try {
    let actualModel: string | undefined;
    let content: string;

    if (provider === 'bedrock' && bedrockConfig) {
      const bedrockResult = await callBedrockAPI(bedrockConfig, prompt);
      actualModel = bedrockResult.model;
      content = bedrockResult.content;
      llmCallTokens = bedrockResult.tokens;
    } else if (provider === 'openai' && openaiConfig) {
      const openaiResult = await callOpenAIAPI(openaiConfig, prompt);
      actualModel = openaiResult.model;
      content = openaiResult.content;
      llmCallTokens = openaiResult.tokens;
    } else {
      throw new Error(`Invalid provider configuration: ${provider}`);
    }

    llmCallFinishedAt = new Date().toISOString();
    llmCallResponseTimeMs = new Date(llmCallFinishedAt).getTime() - new Date(llmCallStartedAt).getTime();
    
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
    logger.error(`   ❌ ${provider.toUpperCase()} error: ${JSON.stringify(error, null, 2)}`);
    
    // Extract error details from the error object
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
    const apiError = errorObj?.error || {};
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
        type: apiError?.type || errorObj?.type,
        code: apiError?.code || errorObj?.code,
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

// Interface for aws4 request options
interface Aws4RequestOptions {
  hostname: string;
  path: string;
  method: string;
  service: string;
  region: string;
  headers: Record<string, string>;
  body: string;
}

// Type for aws4 module
interface Aws4Module {
  sign: (request: Aws4RequestOptions, credentials: { accessKeyId: string; secretAccessKey: string }) => void;
}

async function callBedrockAPI(
  config: { accessKeyId: string; secretAccessKey: string; model: string; region: string },
  prompt: string
): Promise<{ model: string; content: string; tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null }> {
  // Dynamic import - only loads aws4 when Bedrock is configured
  // aws4 is a required dependency, so it should always be available
  const aws4Module = await import('aws4' as string) as { default?: Aws4Module } & Aws4Module;
  const aws4: Aws4Module = aws4Module.default || aws4Module;

  // Define JSON schema for structured output via Tool Use
  // This ensures Claude returns properly structured JSON without markdown wrapping
  const toolSchema = {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['compliant', 'attention', 'not_relevant'],
      },
      reasoning: {
        type: 'string' as const,
      },
      file_references: {
        type: 'array' as const,
        items: {
          type: 'string' as const,
        },
      },
    },
    required: ['status', 'reasoning', 'file_references'],
  };

  // System message focused on analysis, not JSON format (tool enforces structure)
  const systemMessage = 'You are a code quality checker. Analyze code changes against the threadline guidelines. Be precise - only flag actual violations.';

  logger.debug(`   🔧 Bedrock: Using Tool Use for structured JSON output`);

  // Prepare the Converse API request body with Tool Use configuration
  const body = JSON.stringify({
    modelId: config.model,
    system: [
      {
        text: systemMessage,
      },
    ],
    messages: [
      {
        role: 'user' as const,
        content: [{ text: prompt }],
      },
    ],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: 'return_analysis_result',
            description: 'Returns the code quality analysis result as structured JSON',
            inputSchema: {
              json: toolSchema,
            },
          },
        },
      ],
    },
    toolChoice: {
      type: 'tool' as const,
      tool: {
        name: 'return_analysis_result',
      },
    },
    inferenceConfig: {
      maxTokens: 4000, // Match OpenAI's typical max
    },
  });

  // Prepare request options for aws4 signing
  // Bedrock Converse API endpoint: POST /model/{modelId}/converse
  const requestOptions: Aws4RequestOptions = {
    hostname: `bedrock-runtime.${config.region}.amazonaws.com`,
    path: `/model/${config.model}/converse`,
    method: 'POST',
    service: 'bedrock',
    region: config.region,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body,
  };

  // Sign the request with AWS SigV4
  aws4.sign(requestOptions, {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  // Use AbortController for timeout (higher-level timeout in expert.ts is 40s, use 45s here as safety margin)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  let httpResponse: Response;
  try {
    // Make the HTTP request using native fetch (Node 18+)
    const url = `https://${requestOptions.hostname}${requestOptions.path}`;
    httpResponse = await fetch(url, {
      method: requestOptions.method,
      headers: requestOptions.headers,
      body: requestOptions.body,
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
    
    // Try to parse Bedrock error structure
    try {
      const errorData = JSON.parse(errorText) as {
        message?: string;
        __type?: string;
      };
      if (errorData.message) {
        errorMessage = errorData.message;
        // Create error object matching SDK error structure for compatibility
        const errorObj = new Error(errorMessage) as Error & {
          status?: number;
          error?: {
            type?: string;
            code?: string;
          };
        };
        errorObj.status = httpResponse.status;
        errorObj.error = {
          type: errorData.__type,
        };
        throw errorObj;
      }
    } catch (parseError: unknown) {
      // If it's already our structured error, re-throw it
      const structuredError = parseError as Error & { status?: number };
      if (structuredError.status) {
        throw parseError;
      }
      // Otherwise create a basic error
      throw new Error(errorMessage);
    }
  }

  const responseData = await httpResponse.json() as {
    output?: {
      message?: {
        content?: Array<{
          text?: string;
          toolUse?: {
            id?: string;
            name?: string;
            input?: unknown;
          };
        }>;
      };
    };
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };

  logger.debug(`   🔧 Bedrock: Parsing Tool Use response`);

  // Extract structured JSON from Tool Use response
  // With toolChoice set, Claude should always return a toolUse block
  let toolUseInput: unknown = null;
  
  if (responseData.output?.message?.content) {
    const contentBlocks = responseData.output.message.content;
    logger.debug(`   🔧 Bedrock: Found ${contentBlocks.length} content block(s)`);
    
    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i];
      
      if (block.toolUse) {
        logger.debug(`   🔧 Bedrock: Found toolUse block ${i + 1}: name="${block.toolUse.name}", id="${block.toolUse.id}"`);
        
        if (block.toolUse.name !== 'return_analysis_result') {
          throw new Error(`Unexpected tool name: ${block.toolUse.name}. Expected: return_analysis_result`);
        }
        
        if (!block.toolUse.input) {
          throw new Error(`Tool Use block missing input field. Tool ID: ${block.toolUse.id}`);
        }
        
        toolUseInput = block.toolUse.input;
        break; // Use first matching toolUse block
      } else if (block.text) {
        logger.debug(`   🔧 Bedrock: Found text block ${i + 1} (unexpected when toolChoice is set)`);
      }
    }
  }

  // Hard error if no toolUse block found (shouldn't happen with toolChoice)
  if (!toolUseInput) {
    logger.error(`   ❌ Bedrock: No toolUse block found in response`);
    logger.error(`   ❌ Bedrock: Response structure: ${JSON.stringify(responseData, null, 2)}`);
    throw new Error('Bedrock Tool Use failed: No toolUse block found in response. Claude did not use the required tool.');
  }

  logger.debug(`   🔧 Bedrock: Successfully extracted tool input`);

  // Convert tool input (already a JSON object) to string for consistency with OpenAI path
  const content = JSON.stringify(toolUseInput);

  // Map Bedrock token structure to OpenAI format
  let tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
  if (responseData.usage) {
    tokens = {
      prompt_tokens: responseData.usage.inputTokens || 0,
      completion_tokens: responseData.usage.outputTokens || 0,
      total_tokens: responseData.usage.totalTokens || 0
    };
  }

  return {
    model: config.model,
    content,
    tokens
  };
}

async function callOpenAIAPI(
  config: { apiKey: string; model: string; serviceTier: string },
  prompt: string
): Promise<{ model: string; content: string; tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null }> {
  // Build request body for OpenAI API (direct HTTP call - zero dependencies)
  const requestBody: {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    response_format: { type: 'json_object' };
    temperature: number;
    service_tier?: 'auto' | 'default' | 'flex';
  } = {
    model: config.model,
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
  const normalizedServiceTier = config.serviceTier.toLowerCase();
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
        'Authorization': `Bearer ${config.apiKey}`,
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
      const errorData = JSON.parse(errorText) as {
        error?: {
          message?: string;
          type?: string;
          code?: string;
          param?: string;
        };
      };
      if (errorData.error) {
        errorMessage = errorData.error.message || errorText;
        // Create error object matching SDK error structure for compatibility
        const errorObj = new Error(errorMessage) as Error & {
          status?: number;
          error?: {
            type?: string;
            code?: string;
            param?: string;
          };
        };
        errorObj.status = httpResponse.status;
        errorObj.error = {
          type: errorData.error.type,
          code: errorData.error.code,
          param: errorData.error.param,
        };
        throw errorObj;
      }
    } catch (parseError: unknown) {
      // If it's already our structured error, re-throw it
      const structuredError = parseError as Error & { status?: number };
      if (structuredError.status) {
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
  const actualModel = response.model || config.model;

  // Capture token usage if available
  let tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
  if (response.usage) {
    tokens = {
      prompt_tokens: response.usage.prompt_tokens || 0,
      completion_tokens: response.usage.completion_tokens || 0,
      total_tokens: response.usage.total_tokens || 0
    };
  }

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No response from LLM');
  }

  return {
    model: actualModel,
    content,
    tokens
  };
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
