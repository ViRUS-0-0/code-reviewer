export interface AIProvider {
  name: string;
  model?: string;
  generateReview(userMessage: string, systemMessage?: string): Promise<string>;
}

