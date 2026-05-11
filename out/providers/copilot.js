"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotProvider = void 0;
const vscode = require("vscode");
class CopilotProvider {
    async generateReview(userMessage, systemMessage) {
        try {
            // 1. Select the model. vscode.lm is the new API.
            // We can filter for GPT-4 or use the default.
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
            let model;
            if (models.length > 0) {
                model = models[0];
            }
            else {
                // Fallback to any available chat model
                const allModels = await vscode.lm.selectChatModels();
                if (allModels.length > 0) {
                    model = allModels[0];
                }
            }
            if (!model) {
                throw new Error('No GitHub Copilot chat models available. Please ensure the GitHub Copilot Chat extension is installed and you are logged in.');
            }
            const messages = [
                vscode.LanguageModelChatMessage.Assistant(systemMessage || 'You are an expert code reviewer performing a thorough code review.'),
                vscode.LanguageModelChatMessage.User(userMessage),
            ];
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            let result = '';
            for await (const fragment of response.text) {
                result += fragment;
            }
            return result || 'No review generated.';
        }
        catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                console.error(`Language Model Error: ${error.message}, Code: ${error.code}`);
                throw new Error(`GitHub Copilot Review failed: ${error.message}`);
            }
            throw error;
        }
    }
}
exports.CopilotProvider = CopilotProvider;
//# sourceMappingURL=copilot.js.map