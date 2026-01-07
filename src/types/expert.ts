export interface Threadline {
  id: string;
  version: string;
  patterns: string[];
  contextFiles?: string[];
  content: string;
  filePath: string;
}

export interface ThreadlineValidationResult {
  valid: boolean;
  threadline?: Threadline;
  errors?: string[];
}

