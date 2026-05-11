export interface AIProvider {
  generateReview(userMessage: string, systemMessage?: string): Promise<string>;
}
