"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
const openai_1 = require("openai");
class OpenAIProvider {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('OpenAI API key is required');
        }
        this.client = new openai_1.default({ apiKey });
    }
    async generateReview(userMessage, systemMessage) {
        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o',
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
        }
        catch (error) {
            throw new Error(`OpenAI Review generation failed: ${error.message}`);
        }
    }
}
exports.OpenAIProvider = OpenAIProvider;
//# sourceMappingURL=openai.js.map