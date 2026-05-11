import * as vscode from 'vscode';
import { OpenAIProvider } from './providers/openai';
import { CopilotProvider } from './providers/copilot';
import { AIProvider } from './providers/types';
import { GitService } from './services/git';
import { PromptManager, ParsedFile } from './services/promptManager';
import { KnowledgeStore } from './services/knowledgeStore';
import { DiffProcessor } from './services/diffProcessor';
import { SidebarProvider } from './webview/sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "code-review" is now active!');

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Please open a workspace to use Code Review.');
		return;
	}

	const gitService = new GitService(workspaceRoot);
	const promptManager = new PromptManager();
	const knowledgeStore = new KnowledgeStore(workspaceRoot);

	const sidebarProvider = new SidebarProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebarProvider
		)
	);

	let disposable = vscode.commands.registerCommand('code-review.reviewChanges', async () => {
		try {
			const config = vscode.workspace.getConfiguration('code-review');
			const aiProviderType = config.get<string>('aiProvider') || 'OpenAI';
			
			let provider: AIProvider;

			if (aiProviderType === 'GitHub Copilot') {
				provider = new CopilotProvider();
			} else {
				const apiKey = config.get<string>('openaiApiKey');
				if (!apiKey) {
					vscode.window.showErrorMessage('Please set your OpenAI API Key in settings or switch to GitHub Copilot.');
					return;
				}
				provider = new OpenAIProvider(apiKey);
			}

			const activeFile = vscode.window.activeTextEditor?.document.fileName;
			const changes = await gitService.getChanges(activeFile);

			const diff = changes.activeFileDiff || changes.stagedDiff;
			if (!diff) {
				vscode.window.showInformationMessage('No changes detected to review (ensure your changes are tracked by git).');
				return;
			}

			// Parse diff to get file information
			const diffFiles = DiffProcessor.parseDiff(diff);
			const changeSummary = DiffProcessor.generateChangeSummary(diffFiles);

			// Convert DiffFile to ParsedFile for PromptManager
			const parsedFiles: ParsedFile[] = diffFiles.map(file => ({
				filename: file.filename,
				status: file.status,
				additions: file.additions,
				deletions: file.deletions,
			}));

			// Format tech stack
			const techStackString = promptManager.formatTechStack(changeSummary.techStack);

			// Calculate risk level
			const riskLevel = promptManager.calculateRiskLevel(
				changeSummary.totalFiles,
				changeSummary.totalAdditions,
				changeSummary.totalDeletions,
				false // Can be enhanced to detect security-related changes
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

		} catch (error: any) {
			vscode.window.showErrorMessage(`Review failed: ${error.message}`);
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
