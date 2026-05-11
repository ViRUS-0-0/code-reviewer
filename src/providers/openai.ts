import OpenAI from 'openai';
import { AIProvider } from './types';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.client = new OpenAI({ apiKey });
  }

  async generateReview(userMessage: string, systemMessage?: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o', // Using a standard high-performance model
        messages: [
          {
            role: 'system',
            content: systemMessage || 'You are an expert code reviewer performing a thorough code review.',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      });

      return response.choices[0]?.message?.content || 'No review generated.';
    } catch (error: any) {
      throw new Error(`OpenAI Review generation failed: ${error.message}`);
    }
  }
}
