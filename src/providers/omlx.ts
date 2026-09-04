import OpenAI from 'openai';
import { AIProvider } from './types';

export class OMLXProvider implements AIProvider {
  public name = 'oMLX';
  public model: string;
  private client: OpenAI;

  constructor(baseUrl: string, model: string, apiKey: string) {
    const key = apiKey || 'no-key-needed';
    let normalizedBaseUrl = baseUrl.trim();
    if (!normalizedBaseUrl.endsWith('/v1') && !normalizedBaseUrl.endsWith('/v1/')) {
      normalizedBaseUrl = normalizedBaseUrl.endsWith('/')
        ? `${normalizedBaseUrl}v1`
        : `${normalizedBaseUrl}/v1`;
    }
    this.client = new OpenAI({
      baseURL: normalizedBaseUrl,
      apiKey: key,
    });
    this.model = model || 'llama3';
  }

  async generateReview(userMessage: string, systemMessage?: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
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
      throw new Error(`oMLX Review generation failed: ${error.message}`);
    }
  }
}
