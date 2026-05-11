"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotProvider = void 0;
const vscode = require("vscode");
/**
 * GitHub Copilot LM API Provider
 * Uses the vscode.lm API to access GitHub Copilot models
 */
class CopilotProvider {
    /**
     * Generate a code review using GitHub Copilot
     */
    async generateReview(userMessage, systemMessage) {
        try {
            console.log('Searching for AI models...');
            // 1. Try to get the best model (GPT-4o)
            let models = await vscode.lm.selectChatModels({
                vendor: 'github',
                family: 'gpt-4o'
            });
            let model;
            if (models && models.length > 0) {
                console.log(`Found GPT-4o model: ${models[0].id}`);
                model = models[0];
            }
            else {
                // 2. Fallback to any GitHub model
                console.log('GPT-4o not found, falling back to any GitHub model...');
                models = await vscode.lm.selectChatModels({ vendor: 'github' });
                if (models && models.length > 0) {
                    console.log(`Found GitHub model: ${models[0].id}`);
                    model = models[0];
                }
                else {
                    // 3. Final fallback: Any available chat model
                    console.log('No GitHub models found, trying any available chat model...');
                    models = await vscode.lm.selectChatModels();
                    if (models && models.length > 0) {
                        console.log(`Found fallback model: ${models[0].id}`);
                        model = models[0];
                    }
                }
            }
            if (!model) {
                throw new Error('No AI models available in VS Code. Please ensure:\n' +
                    '1. GitHub Copilot Chat is installed and enabled\n' +
                    '2. You are signed in to GitHub\n' +
                    '3. You have an active subscription');
            }
            console.log(`Using model: ${model.id} (${model.family} by ${model.vendor})`);
            // Build messages
            const fullPrompt = systemMessage
                ? `SYSTEM INSTRUCTIONS:\n${systemMessage}\n\nUSER REQUEST:\n${userMessage}`
                : userMessage;
            const messages = [
                vscode.LanguageModelChatMessage.User(fullPrompt),
            ];
            const cancellationTokenSource = new vscode.CancellationTokenSource();
            const response = await model.sendRequest(messages, {
                justification: 'Generate a code review for changes in the workspace.',
            }, cancellationTokenSource.token);
            let result = '';
            for await (const fragment of response.text) {
                result += fragment;
            }
            if (!result || result.trim().length === 0) {
                throw new Error('AI returned an empty response');
            }
            return result;
        }
        catch (error) {
            console.error('Error in CopilotProvider:', error);
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`VS Code AI Error (${error.code}): ${error.message}`);
            }
            throw error;
        }
    }
}
exports.CopilotProvider = CopilotProvider;
//# sourceMappingURL=copilot.js.map