import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider } from './types';

/**
 * Google Gemini AI Provider
 */
export class GeminiProvider implements AIProvider {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateReview(userMessage: string, systemMessage?: string): Promise<string> {
    // List of models to try in order of preference
    const modelsToTry = [
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro-latest',
      'gemini-pro'
    ];

    let lastError: any;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting to use Gemini model: ${modelName}`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        
        // Final safety truncation (approx 150k characters is safe for almost any model)
        const safeUserMessage = userMessage.length > 150000 
          ? userMessage.substring(0, 150000) + '\n... (truncated for token limit)'
          : userMessage;

        const prompt = systemMessage 
          ? `SYSTEM INSTRUCTIONS:\n${systemMessage}\n\nUSER REQUEST:\n${safeUserMessage}`
          : safeUserMessage;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (text && text.trim().length > 0) {
          console.log(`Successfully used Gemini model: ${modelName}`);
          return text;
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`Gemini model ${modelName} failed: ${error.message}`);
        // If it's a 404, we continue to the next model
        if (error.message?.includes('404') || error.message?.includes('not found')) {
          continue;
        }
        // If it's another kind of error (like auth), we should probably stop
        if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('401')) {
          throw new Error(`Invalid Gemini API Key: ${error.message}`);
        }
      }
    }

    throw new Error(`Failed to generate review with Gemini. Tried multiple models but all failed. Last error: ${lastError?.message}`);
  }
}
