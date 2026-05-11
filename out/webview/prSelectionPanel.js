"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRSelectionPanel = void 0;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const child_process_1 = require("child_process");
const githubService_1 = require("../services/githubService");
async function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const parts = command.split(' ');
        const child = (0, child_process_1.spawn)(parts[0], parts.slice(1), { cwd });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => stdout += data.toString());
        child.stderr.on('data', (data) => stderr += data.toString());
        child.on('close', (code) => {
            if (code === 0)
                resolve(stdout);
            else
                reject(new Error(stderr || `Command failed with code ${code}`));
        });
        child.on('error', reject);
    });
}
class PRSelectionPanel {
    constructor(_extensionUri, workspaceRoot, tokenManager, getToken) {
        this._extensionUri = _extensionUri;
        this._prCache = new Map();
        this._cacheTTL = 5 * 60 * 1000; // 5 minutes
        this._workspaceRoot = workspaceRoot;
        this._tokenManager = tokenManager;
        this._getToken = getToken;
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
                case 'getRepoInfo':
                    await this._handleGetRepoInfo();
                    break;
                case 'getCurrentBranch':
                    await this._handleGetCurrentBranch();
                    break;
                case 'getBranches':
                    await this._handleGetBranches(data.repoOwner, data.repoName);
                    break;
                case 'getPRs':
                    await this._handleGetPRs(data.repoOwner, data.repoName);
                    break;
                case 'selectSource':
                    await this._handleSelectSource(data.sourceType, data.sourceData);
                    break;
            }
        });
    }
    async _handleGetRepoInfo() {
        try {
            const repoInfo = await this._getRepoInfo();
            this._postMessage({
                type: 'repoInfo',
                data: repoInfo,
            });
        }
        catch (error) {
            this._postMessage({
                type: 'error',
                message: `Failed to get repository info: ${error.message}`,
            });
        }
    }
    async _handleGetBranches(repoOwner, repoName) {
        try {
            const branches = await this._getBranches(repoOwner, repoName);
            this._postMessage({
                type: 'branches',
                data: branches,
            });
        }
        catch (error) {
            this._postMessage({
                type: 'error',
                message: `Failed to get branches: ${error.message}`,
            });
        }
    }
    async _handleGetPRs(repoOwner, repoName) {
        try {
            const cacheKey = `${repoOwner}/${repoName}`;
            const cached = this._prCache.get(cacheKey);
            // Check if cache is still valid
            if (cached && Date.now() - cached.timestamp < this._cacheTTL) {
                this._postMessage({
                    type: 'prs',
                    data: cached.data,
                });
                return;
            }
            const prs = await this._getPRs(repoOwner, repoName);
            this._prCache.set(cacheKey, {
                data: prs,
                timestamp: Date.now(),
            });
            this._postMessage({
                type: 'prs',
                data: prs,
            });
        }
        catch (error) {
            this._postMessage({
                type: 'error',
                message: `Failed to get PRs: ${error.message}`,
            });
        }
    }
    async _handleSelectSource(sourceType, sourceData) {
        try {
            await vscode.commands.executeCommand('code-review.setSource', sourceType, sourceData);
            this._postMessage({
                type: 'sourceSelected',
                sourceType,
                sourceData,
            });
            // Automatically trigger the review after source selection
            await vscode.commands.executeCommand('code-review.reviewChanges');
        }
        catch (error) {
            this._postMessage({
                type: 'error',
                message: `Failed to select source: ${error.message}`,
            });
        }
    }
    async _handleGetCurrentBranch() {
        try {
            const stdout = await runCommand('git rev-parse --abbrev-ref HEAD', this._workspaceRoot);
            this._postMessage({
                type: 'currentBranch',
                branch: stdout.trim(),
            });
        }
        catch (error) {
            this._postMessage({
                type: 'error',
                message: `Failed to get current branch: ${error.message}`,
            });
        }
    }
    async _getRepoInfo() {
        try {
            const configPath = path.join(this._workspaceRoot, '.git', 'config');
            if (!fs.existsSync(configPath)) {
                throw new Error('Not a git repository');
            }
            const configContent = fs.readFileSync(configPath, 'utf-8');
            const urlMatch = configContent.match(/url\s*=\s*(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\/(.+?)(?:\.git)?$/m);
            if (!urlMatch) {
                throw new Error('Could not parse GitHub repository from .git/config');
            }
            return {
                owner: urlMatch[1],
                name: urlMatch[2].replace(/\.git$/, ''),
            };
        }
        catch (error) {
            throw new Error(`Failed to get repo info: ${error.message}`);
        }
    }
    async _getBranches(repoOwner, repoName) {
        try {
            // Get local branches
            const stdout = await runCommand('git branch -a', this._workspaceRoot);
            const branches = stdout
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('*'))
                .map((line) => line.replace(/^remotes\/origin\//, ''))
                .filter((value, index, self) => self.indexOf(value) === index) // Remove duplicates
                .sort();
            return branches;
        }
        catch (error) {
            throw new Error(`Failed to get branches: ${error.message}`);
        }
    }
    async _getPRs(repoOwner, repoName) {
        try {
            const token = await this._getToken();
            if (!token) {
                throw new Error('GitHub token not available');
            }
            const service = new githubService_1.GitHubService(token);
            const prs = await service.listPullRequests(repoOwner, repoName, 'open', 20);
            return prs;
        }
        catch (error) {
            throw new Error(`Failed to get PRs: ${error.message}`);
        }
    }
    _postMessage(message) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }
    _getHtmlForWebview(webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prSelection.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <style>
    :root {
      --vscode-foreground: var(--vscode-foreground);
      --vscode-background: var(--vscode-background);
      --vscode-button-background: var(--vscode-button-background);
      --vscode-button-foreground: var(--vscode-button-foreground);
      --vscode-button-hoverBackground: var(--vscode-button-hoverBackground);
      --vscode-input-background: var(--vscode-input-background);
      --vscode-input-foreground: var(--vscode-input-foreground);
      --vscode-input-border: var(--vscode-input-border);
      --vscode-widget-border: var(--vscode-widget-border);
      --vscode-editorError-foreground: #f48771;
      --vscode-editorWarning-foreground: #dcdcaa;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-background);
      line-height: 1.5;
    }

    .container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .section-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-foreground);
      opacity: 0.8;
      margin-bottom: 4px;
    }

    .option-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .option-group:hover {
      border-color: var(--vscode-button-background);
      background: var(--vscode-input-background);
    }

    .option-group.selected {
      border-color: var(--vscode-button-background);
      background: var(--vscode-input-background);
      box-shadow: 0 0 0 2px var(--vscode-button-background);
    }

    .option-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }

    .option-radio {
      width: 16px;
      height: 16px;
      border: 2px solid var(--vscode-widget-border);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s ease;
    }

    .option-group.selected .option-radio {
      border-color: var(--vscode-button-background);
      background: var(--vscode-button-background);
    }

    .option-radio::after {
      content: '';
      width: 4px;
      height: 4px;
      background: var(--vscode-input-background);
      border-radius: 50%;
      opacity: 0;
    }

    .option-group.selected .option-radio::after {
      opacity: 1;
    }

    .option-description {
      font-size: 12px;
      opacity: 0.7;
      margin-left: 24px;
    }

    .option-content {
      display: none;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-widget-border);
    }

    .option-group.selected .option-content {
      display: flex;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .input-label {
      font-size: 12px;
      font-weight: 500;
      opacity: 0.8;
    }

    input[type="text"],
    input[type="number"],
    select {
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
      transition: border-color 0.2s ease;
    }

    input[type="text"]:focus,
    input[type="number"]:focus,
    select:focus {
      outline: none;
      border-color: var(--vscode-button-background);
      box-shadow: 0 0 0 1px var(--vscode-button-background);
    }

    .list-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
    }

    .list-item {
      padding: 6px 8px;
      background: var(--vscode-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 12px;
    }

    .list-item:hover {
      background: var(--vscode-input-background);
      border-color: var(--vscode-button-background);
    }

    .list-item.selected {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    .button-group {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }

    button {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: inherit;
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

    .btn-secondary {
      background: transparent;
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-widget-border);
    }

    .btn-secondary:hover {
      background: var(--vscode-input-background);
      border-color: var(--vscode-button-background);
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      opacity: 0.7;
    }

    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid var(--vscode-widget-border);
      border-top-color: var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-message {
      padding: 8px;
      background: rgba(244, 135, 113, 0.1);
      border: 1px solid var(--vscode-editorError-foreground);
      border-radius: 3px;
      color: var(--vscode-editorError-foreground);
      font-size: 12px;
    }

    .success-message {
      padding: 8px;
      background: rgba(76, 175, 80, 0.1);
      border: 1px solid #4caf50;
      border-radius: 3px;
      color: #4caf50;
      font-size: 12px;
    }

    .pr-item {
      padding: 8px;
      background: var(--vscode-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .pr-item:hover {
      border-color: var(--vscode-button-background);
      background: var(--vscode-input-background);
    }

    .pr-number {
      font-weight: 600;
      color: var(--vscode-button-background);
      font-size: 12px;
    }

    .pr-title {
      font-size: 12px;
      margin-top: 2px;
      word-break: break-word;
    }

    .pr-meta {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 4px;
    }

    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="message-container"></div>

    <div class="section">
      <div class="section-title">
        <span>Select Review Source</span>
        <button class="btn-secondary btn-small" id="refresh-btn" style="margin-left: auto; width: auto; flex: none;">Refresh</button>
      </div>

      <!-- Current Branch Option -->
      <div class="option-group" data-option="branch">
        <div class="option-header">
          <div class="option-radio"></div>
          <span>Current Branch</span>
        </div>
        <div class="option-description">Review changes in your current local branch</div>
        <div class="option-content">
          <div class="input-group">
            <label class="input-label">Current Branch</label>
            <input type="text" id="current-branch" readonly>
          </div>
        </div>
      </div>

      <!-- Specific PR Option -->
      <div class="option-group" data-option="pr">
        <div class="option-header">
          <div class="option-radio"></div>
          <span>Specific PR</span>
        </div>
        <div class="option-description">Review a specific pull request from GitHub</div>
        <div class="option-content">
          <div class="input-group">
            <label class="input-label">Repository</label>
            <input type="text" id="pr-repo" placeholder="owner/repo">
          </div>
          <div class="input-group">
            <label class="input-label">PR Number</label>
            <input type="number" id="pr-number" placeholder="123" min="1">
          </div>
          <div class="input-group">
            <label class="input-label">Recent PRs</label>
            <div id="pr-list" class="list-container"></div>
          </div>
        </div>
      </div>

      <!-- Compare Branches Option -->
      <div class="option-group" data-option="compare">
        <div class="option-header">
          <div class="option-radio"></div>
          <span>Compare Branches</span>
        </div>
        <div class="option-description">Compare two branches to review differences</div>
        <div class="option-content">
          <div class="input-group">
            <label class="input-label">Base Branch</label>
            <input type="text" id="compare-base" placeholder="main">
          </div>
          <div class="input-group">
            <label class="input-label">Head Branch</label>
            <input type="text" id="compare-head" placeholder="feature">
          </div>
        </div>
      </div>
    </div>

    <div class="button-group">
      <button class="btn-primary" id="review-btn" disabled>Start Review</button>
      <button class="btn-secondary" id="cancel-btn">Cancel</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let selectedOption = null;
    let selectedPR = null;

    const optionGroups = document.querySelectorAll('.option-group');
    const reviewBtn = document.getElementById('review-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const messageContainer = document.getElementById('message-container');

    // Initialize
    initializePanel();

    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showSuccess('Refreshing repository info...');
      initializePanel();
    });

    async function initializePanel() {
      // Request current branch and repo info from extension host
      vscode.postMessage({ type: 'getCurrentBranch' });
      vscode.postMessage({ type: 'getRepoInfo' });
    }

    // Option group selection
    optionGroups.forEach((group) => {
      group.addEventListener('click', () => {
        optionGroups.forEach((g) => g.classList.remove('selected'));
        group.classList.add('selected');
        selectedOption = group.dataset.option;
        selectedPR = null;
        updateReviewButton();

        // Load data based on selected option
        if (selectedOption === 'pr') {
          loadPRs();
        } else if (selectedOption === 'compare') {
          loadBranches();
        }
      });
    });

    // PR list item selection
    document.addEventListener('click', (e) => {
      if (e.target.closest('.pr-item')) {
        const prItem = e.target.closest('.pr-item');
        document.querySelectorAll('.pr-item').forEach((item) => item.classList.remove('selected'));
        prItem.classList.add('selected');
        selectedPR = prItem.dataset.prNumber;
        updateReviewButton();
      }
    });

    // Review button
    reviewBtn.addEventListener('click', () => {
      reviewBtn.disabled = true;
      reviewBtn.textContent = 'Starting...';
      if (selectedOption === 'branch') {
        vscode.postMessage({
          type: 'selectSource',
          sourceType: 'branch',
          sourceData: { branch: document.getElementById('current-branch').value },
        });
      } else if (selectedOption === 'pr' && selectedPR) {
        vscode.postMessage({
          type: 'selectSource',
          sourceType: 'pr',
          sourceData: {
            repo: document.getElementById('pr-repo').value,
            prNumber: parseInt(selectedPR),
          },
        });
      } else if (selectedOption === 'compare') {
        vscode.postMessage({
          type: 'selectSource',
          sourceType: 'compare',
          sourceData: {
            base: document.getElementById('compare-base').value,
            head: document.getElementById('compare-head').value,
          },
        });
      }
      // Re-enable after a short delay
      setTimeout(() => {
        reviewBtn.disabled = false;
        reviewBtn.textContent = 'Start Review';
      }, 2000);
    });

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    // Message handling
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'repoInfo':
          document.getElementById('pr-repo').value = \`\${message.data.owner}/\${message.data.name}\`;
          vscode.postMessage({
            type: 'getPRs',
            repoOwner: message.data.owner,
            repoName: message.data.name,
          });
          break;
        case 'currentBranch':
          document.getElementById('current-branch').value = message.branch;
          break;
        case 'prs':
          renderPRList(message.data);
          break;
        case 'branches':
          renderBranchList(message.data);
          break;
        case 'sourceSelected':
          showSuccess('Source selected! Starting review...');
          break;
        case 'error':
          showError(message.message);
          break;
      }
    });

    function loadPRs() {
      const repo = document.getElementById('pr-repo').value;
      if (repo) {
        const [owner, name] = repo.split('/');
        vscode.postMessage({
          type: 'getPRs',
          repoOwner: owner,
          repoName: name,
        });
      }
    }

    function loadBranches() {
      const repo = document.getElementById('pr-repo').value;
      if (repo) {
        const [owner, name] = repo.split('/');
        vscode.postMessage({
          type: 'getBranches',
          repoOwner: owner,
          repoName: name,
        });
      }
    }

    function renderPRList(prs) {
      const prList = document.getElementById('pr-list');
      prList.innerHTML = '';
      prs.forEach((pr) => {
        const item = document.createElement('div');
        item.className = 'pr-item';
        item.dataset.prNumber = pr.number;
        item.innerHTML = \`
          <div class="pr-number">#\${pr.number}</div>
          <div class="pr-title">\${pr.title}</div>
          <div class="pr-meta">by \${pr.author} • \${new Date(pr.createdAt).toLocaleDateString()}</div>
        \`;
        prList.appendChild(item);
      });
    }

    function renderBranchList(branches) {
      // Populate branch inputs with autocomplete
      const baseInput = document.getElementById('compare-base');
      const headInput = document.getElementById('compare-head');
      // Simple implementation - could be enhanced with autocomplete
    }

    function updateReviewButton() {
      const isValid =
        (selectedOption === 'branch') ||
        (selectedOption === 'pr' && selectedPR) ||
        (selectedOption === 'compare' &&
          document.getElementById('compare-base').value &&
          document.getElementById('compare-head').value);
      reviewBtn.disabled = !isValid;
    }

    function showError(message) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = message;
      messageContainer.innerHTML = '';
      messageContainer.appendChild(errorDiv);
      setTimeout(() => errorDiv.remove(), 5000);
    }

    function showSuccess(message) {
      const successDiv = document.createElement('div');
      successDiv.className = 'success-message';
      successDiv.textContent = message;
      messageContainer.innerHTML = '';
      messageContainer.appendChild(successDiv);
      setTimeout(() => successDiv.remove(), 3000);
    }

    // Input validation
    document.getElementById('compare-base').addEventListener('input', updateReviewButton);
    document.getElementById('compare-head').addEventListener('input', updateReviewButton);
  </script>
</body>
</html>`;
    }
}
exports.PRSelectionPanel = PRSelectionPanel;
PRSelectionPanel.viewType = 'code-review-pr-selection';
//# sourceMappingURL=prSelectionPanel.js.map