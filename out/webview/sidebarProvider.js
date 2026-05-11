"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
const vscode = require("vscode");
class SidebarProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'review':
                    vscode.commands.executeCommand('code-review.reviewChanges');
                    break;
            }
        });
    }
    setReviewResult(result) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'reviewResult', value: result });
        }
    }
    _getHtmlForWebview(webview) {
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<style>
					body { padding: 10px; line-height: 1.4; }
					button { width: 100%; padding: 8px; margin-bottom: 5px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
					button:hover { background: var(--vscode-button-hoverBackground); }
					#review-result { margin-top: 15px; border-top: 1px solid var(--vscode-widget-border); padding-top: 10px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
					.label { margin-bottom: 5px; font-weight: bold; display: block; }
				</style>
			</head>
			<body>
				<button id="review-btn">Review Changes</button>

				<div class="label">Review Result</div>
				<div id="review-result">No review yet.</div>

				<script>
					const vscode = acquireVsCodeApi();
					const reviewBtn = document.getElementById('review-btn');
					const reviewResultEl = document.getElementById('review-result');

					reviewBtn.addEventListener('click', () => {
						vscode.postMessage({ type: 'review' });
					});

					window.addEventListener('message', event => {
						const message = event.data;
						switch (message.type) {
							case 'reviewResult':
								reviewResultEl.innerText = message.value;
								break;
						}
					});
				</script>
			</body>
			</html>`;
    }
}
exports.SidebarProvider = SidebarProvider;
SidebarProvider.viewType = 'code-review-sidebar';
//# sourceMappingURL=sidebarProvider.js.map