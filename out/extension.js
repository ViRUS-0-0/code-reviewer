"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const openai_1 = require("./providers/openai");
const copilot_1 = require("./providers/copilot");
const git_1 = require("./services/git");
const promptManager_1 = require("./services/promptManager");
const knowledgeStore_1 = require("./services/knowledgeStore");
const diffProcessor_1 = require("./services/diffProcessor");
const sidebarProvider_1 = require("./webview/sidebarProvider");
function activate(context) {
    console.log('Congratulations, your extension "code-review" is now active!');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Please open a workspace to use Code Review.');
        return;
    }
    const gitService = new git_1.GitService(workspaceRoot);
    const promptManager = new promptManager_1.PromptManager();
    const knowledgeStore = new knowledgeStore_1.KnowledgeStore(workspaceRoot);
    const sidebarProvider = new sidebarProvider_1.SidebarProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(sidebarProvider_1.SidebarProvider.viewType, sidebarProvider));
    let disposable = vscode.commands.registerCommand('code-review.reviewChanges', async () => {
        try {
            const config = vscode.workspace.getConfiguration('code-review');
            const aiProviderType = config.get('aiProvider') || 'OpenAI';
            let provider;
            if (aiProviderType === 'GitHub Copilot') {
                provider = new copilot_1.CopilotProvider();
            }
            else {
                const apiKey = config.get('openaiApiKey');
                if (!apiKey) {
                    vscode.window.showErrorMessage('Please set your OpenAI API Key in settings or switch to GitHub Copilot.');
                    return;
                }
                provider = new openai_1.OpenAIProvider(apiKey);
            }
            const activeFile = vscode.window.activeTextEditor?.document.fileName;
            const changes = await gitService.getChanges(activeFile);
            const diff = changes.activeFileDiff || changes.stagedDiff;
            if (!diff) {
                vscode.window.showInformationMessage('No changes detected to review (ensure your changes are tracked by git).');
                return;
            }
            // Parse diff to get file information
            const diffFiles = diffProcessor_1.DiffProcessor.parseDiff(diff);
            const changeSummary = diffProcessor_1.DiffProcessor.generateChangeSummary(diffFiles);
            // Convert DiffFile to ParsedFile for PromptManager
            const parsedFiles = diffFiles.map(file => ({
                filename: file.filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
            }));
            // Format tech stack
            const techStackString = promptManager.formatTechStack(changeSummary.techStack);
            // Calculate risk level
            const riskLevel = promptManager.calculateRiskLevel(changeSummary.totalFiles, changeSummary.totalAdditions, changeSummary.totalDeletions, false // Can be enhanced to detect security-related changes
            );
            // Build system prompt
            const systemMessage = promptManager.buildSystemPrompt(techStackString, {
                techStack: changeSummary.techStack,
                fileStats: {
                    totalFiles: changeSummary.totalFiles,
                    totalAdditions: changeSummary.totalAdditions,
                    totalDeletions: changeSummary.totalDeletions,
                },
                riskLevel,
            });
            // Build user message
            const userMessage = promptManager.buildUserMessage(diff, parsedFiles);
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Generating Code Review...",
                cancellable: false
            }, async (progress) => {
                const review = await provider.generateReview(userMessage, systemMessage);
                sidebarProvider.setReviewResult(review);
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Review failed: ${error.message}`);
        }
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map