"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntigravityProvider = void 0;
const vscode = require("vscode");
const openai_1 = require("openai");
/**
 * Antigravity AI Provider
 * Supports VS Code Language Model API (vscode.lm) and custom/local endpoints
 */
class AntigravityProvider {
    constructor(options = {}) {
        this.name = 'Google Antigravity';
        this.model = 'auto';
        this.modelPreference = options.modelPreference?.trim();
        this.endpoint = options.endpoint?.trim();
        this.apiKey = options.apiKey?.trim();
        if (this.modelPreference && this.modelPreference !== 'auto') {
            this.model = this.modelPreference;
        }
    }
    async generateReview(userMessage, systemMessage) {
        // If a custom HTTP endpoint is explicitly configured, use direct endpoint
        if (this.endpoint) {
            return this.generateViaEndpoint(userMessage, systemMessage);
        }
        // Default: Use VS Code Language Model API (vscode.lm)
        return this.generateViaLM(userMessage, systemMessage);
    }
    /**
     * Generates review using vscode.lm API
     */
    async generateViaLM(userMessage, systemMessage) {
        try {
            console.log('Searching for Antigravity / Google language models...');
            let model;
            // 1. Try specified model preference if provided
            if (this.modelPreference && this.modelPreference !== 'auto' && this.modelPreference !== 'default') {
                const preferredModels = await vscode.lm.selectChatModels({
                    family: this.modelPreference,
                });
                if (preferredModels && preferredModels.length > 0) {
                    model = preferredModels[0];
                    console.log(`Found preferred Antigravity model: ${model.id}`);
                }
            }
            // 2. Try vendor: 'antigravity'
            if (!model) {
                const agModels = await vscode.lm.selectChatModels({ vendor: 'antigravity' });
                if (agModels && agModels.length > 0) {
                    model = agModels[0];
                    console.log(`Found Antigravity vendor model: ${model.id}`);
                }
            }
            // 3. Try vendor: 'google'
            if (!model) {
                const googleModels = await vscode.lm.selectChatModels({ vendor: 'google' });
                if (googleModels && googleModels.length > 0) {
                    model = googleModels[0];
                    console.log(`Found Google vendor model: ${model.id}`);
                }
            }
            // 4. Try family: 'gemini'
            if (!model) {
                const geminiModels = await vscode.lm.selectChatModels({ family: 'gemini' });
                if (geminiModels && geminiModels.length > 0) {
                    model = geminiModels[0];
                    console.log(`Found Gemini family model: ${model.id}`);
                }
            }
            // 5. Fallback: Any available chat model in VS Code / Antigravity IDE
            if (!model) {
                console.log('Falling back to any available chat model in host environment...');
                const allModels = await vscode.lm.selectChatModels();
                if (allModels && allModels.length > 0) {
                    model = allModels[0];
                    console.log(`Using fallback chat model: ${model.id}`);
                }
            }
            if (!model) {
                throw new Error('No suitable Language Models found in VS Code / Antigravity IDE.\n' +
                    'Please ensure that Antigravity, Gemini, or a compatible language model provider extension is installed and active, ' +
                    'or configure code-review.antigravityEndpoint in settings.');
            }
            this.model = model.id || model.family || this.model;
            console.log(`Using Antigravity model: ${this.model} (${model.family} by ${model.vendor})`);
            const fullPrompt = systemMessage
                ? `SYSTEM INSTRUCTIONS:\n${systemMessage}\n\nUSER REQUEST:\n${userMessage}`
                : userMessage;
            const messages = [
                vscode.LanguageModelChatMessage.User(fullPrompt),
            ];
            const cancellationTokenSource = new vscode.CancellationTokenSource();
            try {
                const response = await model.sendRequest(messages, {
                    justification: 'Generate a code review for changes in the workspace using Antigravity.',
                }, cancellationTokenSource.token);
                let result = '';
                for await (const fragment of response.text) {
                    result += fragment;
                }
                if (!result || result.trim().length === 0) {
                    throw new Error('Antigravity model returned an empty response.');
                }
                return result;
            }
            finally {
                cancellationTokenSource.dispose();
            }
        }
        catch (error) {
            console.error('Error in AntigravityProvider (vscode.lm):', error);
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`Antigravity Language Model Error (${error.code}): ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Generates review using custom HTTP OpenAI-compatible endpoint
     */
    async generateViaEndpoint(userMessage, systemMessage) {
        try {
            let normalizedBaseUrl = this.endpoint;
            if (!normalizedBaseUrl.endsWith('/v1') && !normalizedBaseUrl.endsWith('/v1/')) {
                normalizedBaseUrl = normalizedBaseUrl.endsWith('/')
                    ? `${normalizedBaseUrl}v1`
                    : `${normalizedBaseUrl}/v1`;
            }
            const client = new openai_1.default({
                baseURL: normalizedBaseUrl,
                apiKey: this.apiKey || 'antigravity',
            });
            const modelName = this.modelPreference &&
                this.modelPreference !== 'auto' &&
                this.modelPreference !== 'default'
                ? this.modelPreference
                : 'gemini-3.7-flash';
            const response = await client.chat.completions.create({
                model: modelName,
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
            throw new Error(`Antigravity endpoint review generation failed: ${error.message}`);
        }
    }
}
exports.AntigravityProvider = AntigravityProvider;
//# sourceMappingURL=antigravity.js.map