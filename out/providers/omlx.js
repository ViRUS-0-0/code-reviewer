"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMLXProvider = void 0;
const openai_1 = require("openai");
class OMLXProvider {
    constructor(baseUrl, model, apiKey) {
        this.name = 'oMLX';
        const key = apiKey || 'no-key-needed';
        let normalizedBaseUrl = baseUrl.trim();
        if (!normalizedBaseUrl.endsWith('/v1') && !normalizedBaseUrl.endsWith('/v1/')) {
            normalizedBaseUrl = normalizedBaseUrl.endsWith('/')
                ? `${normalizedBaseUrl}v1`
                : `${normalizedBaseUrl}/v1`;
        }
        this.client = new openai_1.default({
            baseURL: normalizedBaseUrl,
            apiKey: key,
        });
        this.model = model || 'llama3';
    }
    async generateReview(userMessage, systemMessage) {
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
        }
        catch (error) {
            throw new Error(`oMLX Review generation failed: ${error.message}`);
        }
    }
}
exports.OMLXProvider = OMLXProvider;
//# sourceMappingURL=omlx.js.map