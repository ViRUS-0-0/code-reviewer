import * as vscode from 'vscode';
import { OpenAIProvider } from './providers/openai';
import { CopilotProvider } from './providers/copilot';
import { AIProvider } from './providers/types';
import { GitService } from './services/git';
import { ReviewOrchestrator, ReviewSource } from './services/reviewOrchestrator';
import { SidebarProvider, ReviewResult } from './webview/sidebarProvider';
import { PRSelectionPanel } from './webview/prSelectionPanel';
import { GitHubTokenManager } from './services/githubTokenManager';
import { GeminiProvider } from './providers/gemini';
import { ReviewPanel } from './webview/reviewPanel';
import { OMLXProvider } from './providers/omlx';
import { AntigravityProvider } from './providers/antigravity';

let errorHandlersRegistered = false;

function resolveAIProvider(config: vscode.WorkspaceConfiguration): AIProvider {
	const aiProviderType = config.get<string>('aiProvider') || 'Antigravity';

	if (aiProviderType === 'Antigravity') {
		const model = config.get<string>('antigravityModel') || 'auto';
		const endpoint = config.get<string>('antigravityEndpoint') || '';
		const apiKey = config.get<string>('antigravityApiKey') || '';
		const cliPath = config.get<string>('antigravityCliPath') || '';
		return new AntigravityProvider({ modelPreference: model, endpoint, apiKey, cliPath });
	}

	if (aiProviderType === 'GitHub Copilot') {
		return new CopilotProvider();
	}

	if (aiProviderType === 'Gemini') {
		const apiKey = config.get<string>('geminiApiKey');
		if (!apiKey) {
			throw new Error('Please set your Gemini API Key in settings (code-review.geminiApiKey) or switch to GitHub Copilot.');
		}
		return new GeminiProvider(apiKey);
	}

	if (aiProviderType === 'oMLX') {
		const baseUrl = config.get<string>('omlxBaseUrl') || 'http://localhost:11436/v1';
		const model = config.get<string>('omlxModel') || 'llama3';
		const apiKey = config.get<string>('omlxApiKey') || '';
		return new OMLXProvider(baseUrl, model, apiKey);
	}

	const apiKey = config.get<string>('openaiApiKey');
	if (!apiKey) {
		throw new Error('Please set your OpenAI API Key in settings (code-review.openaiApiKey) or switch to GitHub Copilot.');
	}
	return new OpenAIProvider(apiKey);
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "code-review" is now active!');
	const outputChannel = vscode.window.createOutputChannel('Code Review');
	context.subscriptions.push(outputChannel);

	if (!errorHandlersRegistered) {
		errorHandlersRegistered = true;
		process.on('uncaughtException', (error) => {
			const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
			outputChannel.appendLine(`Uncaught exception: ${message}`);
		});
		process.on('unhandledRejection', (reason) => {
			const message = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason);
			outputChannel.appendLine(`Unhandled rejection: ${message}`);
		});
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Please open a workspace to use Code Review.');
		return;
	}

	const gitService = new GitService(workspaceRoot);
	const tokenManager = new GitHubTokenManager(context.secrets);

	const sidebarProvider = new SidebarProvider(context.extensionUri);
	const prSelectionPanel = new PRSelectionPanel(
		context.extensionUri,
		workspaceRoot,
		tokenManager,
		async () => {
			try {
				return await tokenManager.ensureToken();
			} catch (error: any) {
				vscode.window.showErrorMessage(`GitHub token required: ${error.message}`);
				return null;
			}
		}
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebarProvider
		)
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			PRSelectionPanel.viewType,
			prSelectionPanel
		)
	);

	// Store current review source
	let currentReviewSource: ReviewSource | null = null;

	// Command to select review source
	let selectSourceCommand = vscode.commands.registerCommand('code-review.selectSource', async () => {
		const options = ['Local Changes', 'Current Branch', 'Specific PR', 'Compare Branches', 'Active File'];
		const selected = await vscode.window.showQuickPick(options, {
			placeHolder: 'Select review source',
		});

		if (selected === 'Local Changes') {
			currentReviewSource = { type: 'local' };
			sidebarProvider.setSourceSelection('local', {});
			vscode.window.showInformationMessage('Selected local changes for review');
		} else if (selected === 'Current Branch') {
			try {
				const branch = await gitService.getCurrentBranch();
				currentReviewSource = { type: 'branch', branch };
				sidebarProvider.setSourceSelection('branch', { branch });
				vscode.window.showInformationMessage(`Selected branch: ${branch}`);
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to get current branch: ${error.message}`);
			}
		} else if (selected === 'Specific PR') {
			let defaultRepo = 'owner/repo';
			try {
				const remoteUrl = await gitService.getRemoteUrl();
				const match = remoteUrl.match(/github\.com[:\/](.*)\.git/);
				if (match) {
					defaultRepo = match[1];
				}
			} catch (e) {}

			const repo = await vscode.window.showInputBox({
				placeHolder: 'Enter repo (owner/repo)',
				value: defaultRepo,
			});
			if (!repo) return;

			const prNumber = await vscode.window.showInputBox({
				placeHolder: 'Enter PR number',
				validateInput: (value) => {
					return /^\d+$/.test(value) ? null : 'Please enter a valid PR number';
				},
			});
			if (prNumber) {
				currentReviewSource = {
					type: 'pr',
					repo,
					prNumber: parseInt(prNumber),
				};
				sidebarProvider.setSourceSelection('pr', {
					repo,
					prNumber: parseInt(prNumber),
				});
				vscode.window.showInformationMessage(`Selected PR #${prNumber} from ${repo}`);
			}
		} else if (selected === 'Compare Branches') {
			const base = await vscode.window.showInputBox({
				placeHolder: 'Enter base branch (e.g., main)',
			});
			if (!base) return;

			const head = await vscode.window.showInputBox({
				placeHolder: 'Enter head branch (e.g., feature)',
			});
			if (head) {
				currentReviewSource = {
					type: 'compare',
					baseBranch: base,
					headBranch: head,
				};
				sidebarProvider.setSourceSelection('compare', { base, head });
				vscode.window.showInformationMessage(`Selected comparison: ${base}...${head}`);
			}
		} else if (selected === 'Active File') {
			const activeFile = vscode.window.activeTextEditor?.document.fileName;
			if (!activeFile) {
				vscode.window.showErrorMessage('No active file. Please open a file to review.');
				return;
			}
			currentReviewSource = { type: 'file', filePath: activeFile };
			sidebarProvider.setSourceSelection('file', { filePath: activeFile });
			vscode.window.showInformationMessage(`Selected file: ${activeFile}`);
		}
	});

	// Command to set review source from webviews
	let setSourceCommand = vscode.commands.registerCommand(
		'code-review.setSource',
		async (sourceType: string, sourceData: any) => {
			switch (sourceType) {
				case 'branch':
					currentReviewSource = { type: 'branch', branch: sourceData.branch };
					sidebarProvider.setSourceSelection('branch', { branch: sourceData.branch });
					break;
				case 'pr':
					currentReviewSource = {
						type: 'pr',
						repo: sourceData.repo,
						prNumber: sourceData.prNumber,
					};
					sidebarProvider.setSourceSelection('pr', {
						repo: sourceData.repo,
						prNumber: sourceData.prNumber,
					});
					break;
				case 'compare':
					currentReviewSource = {
						type: 'compare',
						baseBranch: sourceData.base,
						headBranch: sourceData.head,
					};
					sidebarProvider.setSourceSelection('compare', {
						base: sourceData.base,
						head: sourceData.head,
					});
					break;
				case 'file':
					currentReviewSource = { type: 'file', filePath: sourceData.filePath };
					sidebarProvider.setSourceSelection('file', { filePath: sourceData.filePath });
					break;
				case 'local':
					currentReviewSource = { type: 'local' };
					sidebarProvider.setSourceSelection('local', {});
					break;
				default:
					throw new Error(`Unknown source type: ${sourceType}`);
			}
		}
	);

	context.subscriptions.push(selectSourceCommand, setSourceCommand);

	// Command to review changes
	let reviewCommand = vscode.commands.registerCommand('code-review.reviewChanges', async () => {
		try {
			outputChannel.appendLine('Starting code review...');
			// Determine review source
			let source = currentReviewSource;

			if (!source) {
				// Default to local changes if no source selected
				source = { type: 'local' };
			}

			// Get AI provider configuration
			const config = vscode.workspace.getConfiguration('code-review');
			const provider = resolveAIProvider(config);

			// Get GitHub token for PR details (prompt when needed)
			let githubToken: string | undefined;
			try {
				githubToken = (await tokenManager.ensureToken()) || undefined;
			} catch (error: any) {
				githubToken = undefined;
				vscode.window.showWarningMessage(`GitHub token not set: ${error.message}`);
				outputChannel.appendLine(`GitHub token not set: ${error.message}`);
			}

			// Create orchestrator
			const orchestrator = new ReviewOrchestrator(workspaceRoot, provider, githubToken);

			// Show loading state
			sidebarProvider.setLoading(true);

			// Generate review with progress updates
			const review = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Generating Code Review...',
					cancellable: false,
				},
				async (progress) => {
					return orchestrator.generateReview(source!, {}, (message) => {
						progress.report({ message });
						console.log(`[Review] ${message}`);
						outputChannel.appendLine(`[Review] ${message}`);
					});
				}
			);

			// Display result
			sidebarProvider.setLoading(false);
			sidebarProvider.setReviewResult(review);

			// ALSO show in full editor panel for better readability
			ReviewPanel.createOrShow(context.extensionUri, review);

			vscode.window.showInformationMessage('Code review completed successfully!');
			outputChannel.appendLine('Code review completed successfully.');
		} catch (error: any) {
			sidebarProvider.setLoading(false);
			console.error('Review failed:', error);
			outputChannel.appendLine(`Review failed: ${error.message || error}`);
			vscode.window.showErrorMessage(`Review failed: ${error.message}`);
			sidebarProvider.setError(error.message || 'Review failed');
		}
	});

	context.subscriptions.push(reviewCommand);
 
	// Register Chat Participant (Agent)
	const agent = vscode.chat.createChatParticipant('code-review.agent', async (request, context, response, token) => {
		try {
			response.markdown('_Analyzing workspace changes..._');
			
			// Get AI provider from config
			const config = vscode.workspace.getConfiguration('code-review');
			let provider: AIProvider;
			try {
				provider = resolveAIProvider(config);
			} catch (err: any) {
				response.markdown(err.message);
				return;
			}
			
			// Get GitHub token
			let githubToken: string | undefined;
			try {
				githubToken = await tokenManager.getToken() || undefined;
			} catch {
				githubToken = undefined;
			}
 
			// Create orchestrator
			const orchestrator = new ReviewOrchestrator(workspaceRoot, provider, githubToken);
 
			// Determine source based on request text or active file
			let source: ReviewSource;
			if (request.prompt.toLowerCase().includes('pr')) {
				const prMatch = request.prompt.match(/#(\d+)/);
				if (prMatch && currentReviewSource?.type === 'pr') {
					source = currentReviewSource;
				} else {
					response.markdown('Please select a PR in the sidebar first or specify a file.');
					return;
				}
			} else {
				const activeFile = vscode.window.activeTextEditor?.document.fileName;
				if (!activeFile) {
					response.markdown('Please open a file to review or select a branch in the sidebar.');
					return;
				}
				source = { type: 'file', filePath: activeFile };
			}
 
			response.markdown(`_Generating review for ${source.type === 'file' ? 'active file' : 'selected source'}..._`);
			
			const review = await orchestrator.generateReview(source, { includeFileBreakdown: true }, (msg) => {
				// Progress updates via italicized markdown
				response.markdown(`_${msg}_... `);
			});
 
			// Format and output the review to chat
			if (typeof review === 'string') {
				response.markdown('\n\n' + review);
			} else {
				const aiName = review.aiProvider || provider.name || 'AI Engine';
				const aiModel = review.aiModel || provider.model;
				const aiDisplay = aiModel ? `${aiName} (${aiModel})` : aiName;

				response.markdown(`\n\n> ⚡ **AI Engine:** ${aiDisplay}\n\n`);
				response.markdown(`## Code Review Verdict: ${review.verdict.toUpperCase().replace(/-/g, ' ')}\n\n`);
				
				if (review.copyableSummary) {
					response.markdown(`### 📋 Actionable Summary of Requested Changes\n\n\`\`\`markdown\n${review.copyableSummary}\n\`\`\`\n\n`);
				}

				response.markdown(`### Overview\n${review.summary}\n\n`);
				
				if (review.issues && review.issues.length > 0) {
					response.markdown(`### ⚠️ Detected Issues & Remediation (${review.issues.length})\n\n`);
					review.issues.forEach((issue, idx) => {
						const loc = issue.file ? ` \`📍 ${issue.file}${issue.line ? `:${issue.line}` : ''}\`` : '';
						response.markdown(`#### ${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.title}${loc}\n\n`);
						response.markdown(`${issue.description}\n\n`);
						
						const currentCode = issue.currentCode || issue.snippet;
						if (currentCode) {
							response.markdown(`**Problematic Code:**\n\`\`\`\n${currentCode}\n\`\`\`\n\n`);
						}
						
						if (issue.resolution) {
							response.markdown(`**💡 Resolution:** ${issue.resolution}\n\n`);
						}
						
						if (issue.updatedCode) {
							response.markdown(`**Suggested Fix:**\n\`\`\`\n${issue.updatedCode}\n\`\`\`\n\n`);
						}
					});
				}

				if (review.fileBreakdown && review.fileBreakdown.length > 0) {
					response.markdown(`### 📁 Detailed File Breakdown\n\n`);
					review.fileBreakdown.forEach((file) => {
						response.markdown(`- **\`${file.filename}\`** (${file.status.toUpperCase()}): ${file.summary || 'Analyzed'}\n`);
					});
					response.markdown('\n');
				}
			}
		} catch (error: any) {
			response.markdown(`### Review Failed\n${error.message}`);
		}
	});
 
	agent.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
	context.subscriptions.push(agent);
}

export function deactivate() {}
