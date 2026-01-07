import axios, { AxiosInstance } from 'axios';

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
}

export interface ExpertResult {
  expertId: string;
  status: 'compliant' | 'attention' | 'not_relevant';
  reasoning?: string;
  lineReferences?: number[];
  fileReferences?: string[];
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

export class ReviewAPIClient {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 60000, // 60s timeout for entire request
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    try {
      const response = await this.client.post<ReviewResponse>('/api/threadline-check', request);
      return response.data;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response: { status: number; data?: { message?: string } }; message?: string };
        throw new Error(`API error: ${axiosError.response.status} - ${axiosError.response.data?.message || axiosError.message || 'Unknown error'}`);
      } else if (error && typeof error === 'object' && 'request' in error) {
        throw new Error(`Network error: Could not reach Threadline server at ${this.client.defaults.baseURL}`);
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Request error: ${errorMessage}`);
      }
    }
  }
}

