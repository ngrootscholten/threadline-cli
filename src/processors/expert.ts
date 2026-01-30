import { processThreadline, ProcessThreadlineResult } from './single-expert';
import { ExpertResult } from '../api/client';
import { logger } from '../utils/logger';

export interface ProcessThreadlinesRequest {
  threadlines: Array<{
    id: string;
    version: string;
    patterns: string[];
    content: string;
    contextFiles?: string[];
    contextContent?: Record<string, string>;
  }>;
  diff: string;
  files: string[];
  apiKey: string;
  model: string;
  serviceTier: string;
  contextLinesForLLM: number;
}

export interface ProcessThreadlinesResponse {
  results: (ExpertResult | ProcessThreadlineResult)[];
  metadata: {
    totalThreadlines: number;
    completed: number;
    timedOut: number;
    errors: number;
    llmModel?: string; // Model used for processing (same for all threadlines)
  };
}

const EXPERT_TIMEOUT = 40000; // 40 seconds

export async function processThreadlines(request: ProcessThreadlinesRequest): Promise<ProcessThreadlinesResponse> {
  const { threadlines, diff, files, apiKey, model, serviceTier, contextLinesForLLM } = request;
  
  // Determine LLM model (same for all threadlines in this check)
  const llmModel = `${model} ${serviceTier}`;
  
  // Create promises with timeout
  const promises = threadlines.map(threadline => {
    let timeoutId: NodeJS.Timeout | null = null;
    let resolved = false;
    
    const timeoutPromise = new Promise<ProcessThreadlineResult>((resolve) => {
      timeoutId = setTimeout(() => {
        // Only log and resolve if we haven't already resolved
        if (!resolved) {
          logger.error(`Request timed out after ${EXPERT_TIMEOUT / 1000}s for threadline: ${threadline.id}`);
          resolved = true;
          resolve({
            expertId: threadline.id,
            status: 'error',
            reasoning: `Error: Request timed out after ${EXPERT_TIMEOUT / 1000}s`,
            error: {
              message: `Request timed out after ${EXPERT_TIMEOUT / 1000}s`,
              type: 'timeout'
            },
            fileReferences: [],
            relevantFiles: [],
            filteredDiff: '',
            filesInFilteredDiff: [],
            actualModel: undefined
          });
        }
      }, EXPERT_TIMEOUT);
    });
    
    const actualPromise = processThreadline(threadline, diff, files, apiKey, model, serviceTier, contextLinesForLLM).then(result => {
      // Mark as resolved and clear timeout if it hasn't fired yet
      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return result;
    });
    
    return Promise.race([actualPromise, timeoutPromise]);
  });

  // Wait for all (some may timeout)
  const results = await Promise.allSettled(promises);

  // Process results
  const expertResults: (ExpertResult | ProcessThreadlineResult)[] = [];
  let completed = 0;
  let timedOut = 0;
  let errors = 0;
  let actualModelFromResponse: string | undefined;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const threadline = threadlines[i];

    if (result.status === 'fulfilled') {
      const expertResult = result.value;
      // Check status directly - errors and timeouts are now 'error' status
      if (expertResult.status === 'error') {
        // Check if it's a timeout (has error.type === 'timeout')
        if ('error' in expertResult && expertResult.error?.type === 'timeout') {
          timedOut++;
        } else {
          errors++;
        }
      } else {
        completed++;
      }
      expertResults.push(expertResult);
      
      // Capture actual model from first successful result (all threadlines use same model)
      if (!actualModelFromResponse && 'actualModel' in expertResult && expertResult.actualModel) {
        actualModelFromResponse = expertResult.actualModel;
      }
    } else {
      errors++;
      expertResults.push({
        expertId: threadline.id,
        status: 'error',
        reasoning: `Error: ${result.reason?.message || 'Unknown error'}`,
        error: {
          message: result.reason?.message || 'Unknown error',
          rawResponse: result.reason
        },
        fileReferences: [],
        relevantFiles: [],
        filteredDiff: '',
        filesInFilteredDiff: []
      });
    }
  }

  // Use actual model from OpenAI response, append service tier
  let modelToStore: string | undefined;
  if (actualModelFromResponse) {
    modelToStore = `${actualModelFromResponse} ${serviceTier}`;
  } else {
    // All calls failed - log prominently and preserve requested model for debugging
    logger.error(`No successful LLM responses received. Requested model: ${llmModel}`);
    logger.error(`Completed: ${completed}, Timed out: ${timedOut}, Errors: ${errors}`);
    // Store requested model so we can debug what was attempted
    modelToStore = `${llmModel} (no successful responses)`;
  }

  // Return all results - CLI will handle filtering/display
  return {
    results: expertResults,
    metadata: {
      totalThreadlines: threadlines.length,
      completed,
      timedOut,
      errors,
      llmModel: modelToStore
    }
  };
}
