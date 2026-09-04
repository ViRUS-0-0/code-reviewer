"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
const vscode = require("vscode");
const reviewPanel_1 = require("./reviewPanel");
class SidebarProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._isLoading = false;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('[Sidebar] Received message:', data.type);
            switch (data.type) {
                case 'selectSource':
                    vscode.commands.executeCommand('code-review.selectSource');
                    break;
                case 'review':
                    vscode.commands.executeCommand('code-review.reviewChanges');
                    break;
                case 'openDashboard':
                    if (data.result) {
                        reviewPanel_1.ReviewPanel.createOrShow(this._extensionUri, data.result);
                    }
                    break;
                case 'copyReview':
                    await this._copyReviewToClipboard(data.content);
                    break;
            }
        });
    }
    setLoading(isLoading) {
        this._isLoading = isLoading;
        if (this._view) {
            this._view.webview.postMessage({
                type: 'setLoading',
                isLoading,
            });
        }
    }
    setReviewResult(result) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'reviewResult',
                result,
            });
        }
    }
    setError(message) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'reviewError',
                message,
            });
        }
    }
    setSourceSelection(sourceType, sourceData) {
        this._currentSelection = { sourceType, sourceData };
        this._updateSourceDisplay();
    }
    _updateSourceDisplay() {
        if (!this._view || !this._currentSelection) {
            return;
        }
        let displayText = '';
        const { sourceType, sourceData } = this._currentSelection;
        switch (sourceType) {
            case 'branch':
                displayText = `Branch: ${sourceData.branch}`;
                break;
            case 'pr':
                displayText = `PR #${sourceData.prNumber}`;
                break;
            case 'compare':
                displayText = `${sourceData.base}...${sourceData.head}`;
                break;
            case 'file':
                const parts = sourceData.filePath.split(/[\\/]/);
                displayText = `File: ${parts[parts.length - 1]}`;
                break;
            case 'local':
                displayText = 'Local Changes';
                break;
        }
        this._view.webview.postMessage({
            type: 'updateSourceDisplay',
            displayText,
        });
    }
    async _copyReviewToClipboard(content) {
        try {
            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage('Review copied to clipboard');
        }
        catch (error) {
            vscode.window.showErrorMessage('Failed to copy review');
        }
    }
    _getHtmlForWebview(webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --primary: #007acc;
      --primary-hover: #0062a3;
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground);
      --input-bg: var(--vscode-input-background);
      --border: var(--vscode-widget-border);
      --card-bg: var(--vscode-editor-background);
      --critical: #f48771;
      --high: #ffcc00;
      --medium: #3794ff;
      --low: #89d185;
    }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      padding: 15px;
      margin: 0;
    }

    .container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .glass-card {
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }

    .label {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: bold;
      opacity: 0.7;
      margin-bottom: 8px;
      display: block;
    }

    .source-info {
      font-weight: 600;
      word-break: break-all;
    }

    button {
      width: 100%;
      padding: 10px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-weight: bold;
      font-family: inherit;
      transition: all 0.2s;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-outline:hover {
      background: var(--border);
    }

    .loading-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top: 2px solid #fff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .hidden { display: none !important; }

    .review-status {
      text-align: center;
      padding: 40px 20px;
      opacity: 0.5;
    }

    .issue-summary {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
    }

    .sev-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .sev-critical { background: var(--critical); }
    .sev-high { background: var(--high); }
    .sev-medium { background: var(--medium); }
    .sev-low { background: var(--low); }

    .verdict-banner {
      padding: 8px;
      border-radius: 4px;
      text-align: center;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .verdict-approved { background: rgba(137, 209, 133, 0.2); color: var(--low); border: 1px solid var(--low); }
    .verdict-changes-requested { background: rgba(244, 135, 113, 0.2); color: var(--critical); border: 1px solid var(--critical); }
    .verdict-approved-with-comments { background: rgba(255, 204, 0, 0.2); color: var(--high); border: 1px solid var(--high); }
    .ai-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border);
      margin-bottom: 8px;
      font-weight: 600;
    }
    .action-btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .btn-sm {
      padding: 6px 10px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="glass-card">
      <span class="label">Review Source</span>
      <div id="source-display" class="source-info">No source selected</div>
      <div style="margin-top: 12px;">
        <button class="btn-outline" id="select-source-btn">
          <span>📂</span> Select Source
        </button>
      </div>
    </div>

    <button class="btn-primary" id="start-review-btn">
      <span id="btn-icon">🚀</span>
      <span id="btn-text">Start AI Review</span>
      <div id="btn-spinner" class="loading-spinner hidden"></div>
    </button>

    <div id="review-preview" class="glass-card hidden">
      <div id="ai-provider-badge" class="ai-badge hidden">
        <span>⚡</span> <span id="ai-provider-name">AI Engine</span>
      </div>
      <div id="verdict-banner" class="verdict-banner"></div>
      <div id="summary-text" style="font-size: 12px; line-height: 1.4; opacity: 0.9;"></div>
      <div class="issue-summary">
        <div><span class="sev-dot sev-critical"></span> <span id="count-critical">0</span></div>
        <div><span class="sev-dot sev-high"></span> <span id="count-high">0</span></div>
        <div><span class="sev-dot sev-medium"></span> <span id="count-medium">0</span></div>
        <div><span class="sev-dot sev-low"></span> <span id="count-low">0</span></div>
      </div>
      <div class="action-btn-row">
        <button class="btn-outline btn-sm" id="copy-summary-btn" style="flex: 1;">
          <span>📋</span> Copy Summary
        </button>
        <button class="btn-primary btn-sm" id="open-dashboard-btn" style="flex: 1;">
          <span>🔍</span> Full Report
        </button>
      </div>
    </div>

    <div id="empty-state" class="review-status">
      <div style="font-size: 32px; margin-bottom: 10px;">🤖</div>
      <div>Ready for review</div>
    </div>

    <div id="error-card" class="glass-card hidden" style="border-color: var(--critical);">
      <span class="label" style="color: var(--critical);">Error</span>
      <div id="error-message" style="font-size: 12px;"></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const selectBtn = document.getElementById('select-source-btn');
    const startBtn = document.getElementById('start-review-btn');
    const sourceDisplay = document.getElementById('source-display');
    const btnSpinner = document.getElementById('btn-spinner');
    const btnIcon = document.getElementById('btn-icon');
    const btnText = document.getElementById('btn-text');
    const reviewPreview = document.getElementById('review-preview');
    const emptyState = document.getElementById('empty-state');
    const errorCard = document.getElementById('error-card');
    const errorMessage = document.getElementById('error-message');
    const copySummaryBtn = document.getElementById('copy-summary-btn');
    const openDashboardBtn = document.getElementById('open-dashboard-btn');
    const aiProviderBadge = document.getElementById('ai-provider-badge');
    const aiProviderName = document.getElementById('ai-provider-name');

    let currentReviewResult = null;

    selectBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'selectSource' });
    });

    startBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'review' });
    });

    copySummaryBtn.addEventListener('click', () => {
      if (!currentReviewResult) return;
      let textToCopy = '';
      if (typeof currentReviewResult === 'string') {
        textToCopy = currentReviewResult;
      } else if (currentReviewResult.copyableSummary) {
        textToCopy = currentReviewResult.copyableSummary;
      } else {
        const issuesSummary = (currentReviewResult.issues || []).map(i => '- [' + i.severity.toUpperCase() + '] ' + i.title + (i.file ? ' (' + i.file + (i.line ? ':' + i.line : '') + ')' : '')).join('\\n');
        textToCopy = '## Review Summary: ' + currentReviewResult.verdict.toUpperCase() + '\\n\\n' + currentReviewResult.summary + (issuesSummary ? '\\n\\n### Action Items:\\n' + issuesSummary : '');
      }
      vscode.postMessage({ type: 'copyReview', content: textToCopy });
    });

    openDashboardBtn.addEventListener('click', () => {
      if (currentReviewResult) {
        vscode.postMessage({ type: 'openDashboard', result: currentReviewResult });
      }
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'updateSourceDisplay':
          sourceDisplay.textContent = message.displayText;
          break;
        case 'setLoading':
          if (message.isLoading) {
            startBtn.disabled = true;
            btnSpinner.classList.remove('hidden');
            btnIcon.classList.add('hidden');
            btnText.textContent = 'Analyzing...';
            errorCard.classList.add('hidden');
          } else {
            startBtn.disabled = false;
            btnSpinner.classList.add('hidden');
            btnIcon.classList.remove('hidden');
            btnText.textContent = 'Start AI Review';
          }
          break;
        case 'reviewResult':
          const result = message.result;
          currentReviewResult = result;
          emptyState.classList.add('hidden');
          reviewPreview.classList.remove('hidden');
          
          if (typeof result === 'string') {
            aiProviderBadge.classList.add('hidden');
            document.getElementById('summary-text').textContent = result.substring(0, 200) + '...';
            return;
          }

          if (result.aiProvider) {
            aiProviderBadge.classList.remove('hidden');
            aiProviderName.textContent = result.aiProvider + (result.aiModel ? ' (' + result.aiModel + ')' : '');
          } else {
            aiProviderBadge.classList.add('hidden');
          }

          const banner = document.getElementById('verdict-banner');
          banner.textContent = result.verdict.toUpperCase().replace(/-/g, ' ');
          banner.className = 'verdict-banner verdict-' + result.verdict.replace(/_/g, '-');
          
          document.getElementById('summary-text').textContent = result.summary.substring(0, 150) + '...';
          
          // Count severities
          const counts = { critical: 0, high: 0, medium: 0, low: 0 };
          (result.issues || []).forEach(i => {
            if (counts[i.severity] !== undefined) {
              counts[i.severity]++;
            }
          });
          
          document.getElementById('count-critical').textContent = counts.critical;
          document.getElementById('count-high').textContent = counts.high;
          document.getElementById('count-medium').textContent = counts.medium;
          document.getElementById('count-low').textContent = counts.low;
          break;
        case 'reviewError':
          errorCard.classList.remove('hidden');
          errorMessage.textContent = message.message;
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