export interface ReviewRequest {
  threadlines: Array<{
    id: string;
    version: string;
    patterns: string[];
    content: string;
    filePath: string;
    contextFiles?: string[];
    contextContent?: Record<string, string>;
  }>;
  diff: string;
  files: string[];
  apiKey: string;
  account: string;        // REQUIRED: Account identifier
  repoName?: string;     // Raw git remote URL (e.g., "https://github.com/user/repo.git")
  branchName?: string;   // Branch name (e.g., "feature/x")
  commitSha?: string;    // Commit SHA (when commit context available)
  commitMessage?: string; // Commit message (when commit context available)
  commitAuthorName?: string; // Commit author name
  commitAuthorEmail?: string; // Commit author email
  prTitle?: string;      // PR/MR title (when GitLab MR context available)
  environment?: string;  // Environment where check was run: 'vercel', 'github', 'gitlab', 'local'
  cliVersion?: string;   // CLI version that ran this check
  reviewContext: ReviewContextType; // REQUIRED: Context type - 'local', 'commit', 'pr' (CI), or 'file', 'folder', 'files' (local only)
}

export type ReviewContextType = 'local' | 'commit' | 'pr' | 'file' | 'folder' | 'files';

export interface ExpertResult {
  expertId: string;
  status: 'compliant' | 'attention' | 'not_relevant' | 'error';
  reasoning?: string;
  lineReferences?: number[];
  fileReferences?: string[];
  error?: {
    message: string;
    type?: string;
    code?: string;
    rawResponse?: unknown;
  };
}

export interface ReviewResponse {
  results: ExpertResult[];
  metadata: {
    totalThreadlines: number;
    completed: number;
    timedOut: number;
    errors: number;
  };
  message?: string; // Optional informational message (e.g., for zero diffs)
}

export interface SyncResultsRequest {
  threadlines: Array<{
    id: string;
    version: string;
    patterns: string[];
    content: string;
    filePath: string;
    contextFiles?: string[];
    contextContent?: Record<string, string>;
  }>;
  diff: string;
  files: string[];
  results: ExpertResult[];
  metadata: {
    totalThreadlines: number;
    completed: number;
    timedOut: number;
    errors: number;
    llmModel?: string;
  };
  apiKey: string;
  account: string;
  repoName?: string;
  branchName?: string;
  commitSha?: string;
  commitMessage?: string;
  commitAuthorName?: string;
  commitAuthorEmail?: string;
  prTitle?: string;
  environment?: string;
  cliVersion?: string;
  reviewContext: ReviewContextType;
}

export interface SyncResultsResponse {
  success: boolean;
  checkId?: string;
}

export class ReviewAPIClient {
  private baseURL: string;
  private readonly timeout: number = 60000; // 60s timeout for entire request

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      // Handle AbortError from timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const url = `${this.baseURL}/api/threadline-check`;
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json() as ReviewResponse;
  }

  async syncResults(request: SyncResultsRequest): Promise<SyncResultsResponse> {
    const url = `${this.baseURL}/api/threadline-check-results`;
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json() as SyncResultsResponse;
  }
}

