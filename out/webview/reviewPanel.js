"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewPanel = void 0;
const vscode = require("vscode");
class ReviewPanel {
    static createOrShow(extensionUri, result) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ReviewPanel.currentPanel) {
            ReviewPanel.currentPanel._panel.reveal(column);
            ReviewPanel.currentPanel._update(result);
            return;
        }
        const panel = vscode.window.createWebviewPanel('codeReviewResult', 'Code Review Dashboard', column || vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [extensionUri],
            retainContextWhenHidden: true,
        });
        ReviewPanel.currentPanel = new ReviewPanel(panel, extensionUri, result);
    }
    constructor(panel, extensionUri, result) {
        this._disposables = [];
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._update(result);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'openFile':
                    this._openFile(message.file, message.line);
                    return;
            }
        }, null, this._disposables);
    }
    async _openFile(file, line) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return;
        // Try to find the file in the workspace
        const files = await vscode.workspace.findFiles(`**/${file}`, null, 1);
        if (files.length > 0) {
            const doc = await vscode.workspace.openTextDocument(files[0]);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            if (line) {
                const pos = new vscode.Position(line - 1, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        }
    }
    dispose() {
        ReviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
    _update(result) {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, result);
    }
    _getHtmlForWebview(webview, result) {
        const resultJson = JSON.stringify(result).replace(/</g, '\\u003c');
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --primary: #007acc;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-foreground);
      --card-bg: var(--vscode-sideBar-background);
      --border: var(--vscode-widget-border);
      --critical: #f48771;
      --high: #ffcc00;
      --medium: #3794ff;
      --low: #89d185;
      --approved: #89d185;
    }

    body {
      font-family: var(--vscode-font-family);
      color: var(--fg);
      background-color: var(--bg);
      padding: 0;
      margin: 0;
      line-height: 1.6;
    }

    .hero {
      background: linear-gradient(135deg, #007acc 0%, #004b7a 100%);
      color: white;
      padding: 40px;
      text-align: center;
      margin-bottom: 40px;
    }

    .verdict-large {
      display: inline-block;
      padding: 12px 30px;
      border-radius: 50px;
      font-size: 24px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-top: 20px;
      box-shadow: 0 10px 20px rgba(0,0,0,0.2);
    }

    .verdict-approved { background: var(--low); color: #1e1e1e; }
    .verdict-changes-requested { background: var(--critical); color: white; }
    .verdict-approved-with-comments { background: var(--high); color: #1e1e1e; }

    .main-content {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 40px 60px 40px;
    }

    .summary-section {
      background: var(--card-bg);
      border-radius: 16px;
      padding: 30px;
      margin-bottom: 40px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
    }

    h2 {
      font-size: 22px;
      margin-top: 0;
      border-bottom: 2px solid var(--primary);
      display: inline-block;
      padding-bottom: 5px;
      margin-bottom: 25px;
    }

    .issue-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 25px;
    }

    .issue-card {
      background: var(--card-bg);
      border-radius: 12px;
      border-left: 6px solid #ccc;
      padding: 20px;
      transition: transform 0.2s;
      cursor: pointer;
      border-top: 1px solid var(--border);
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .issue-card:hover {
      transform: translateY(-5px);
      background: var(--vscode-editor-lineHighlightBackground);
    }

    .issue-card.sev-critical { border-left-color: var(--critical); }
    .issue-card.sev-high { border-left-color: var(--high); }
    .issue-card.sev-medium { border-left-color: var(--medium); }
    .issue-card.sev-low { border-left-color: var(--low); }

    .severity-tag {
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 4px;
      margin-bottom: 10px;
      display: inline-block;
    }

    .sev-critical .severity-tag { background: rgba(244, 135, 113, 0.2); color: var(--critical); }
    .sev-high .severity-tag { background: rgba(255, 204, 0, 0.2); color: var(--high); }
    .sev-medium .severity-tag { background: rgba(55, 148, 255, 0.2); color: var(--medium); }
    .sev-low .severity-tag { background: rgba(137, 209, 133, 0.2); color: var(--low); }

    .issue-title { font-weight: 700; font-size: 16px; margin-bottom: 10px; }
    .issue-desc { font-size: 14px; opacity: 0.8; margin-bottom: 15px; }
    .issue-loc { font-family: monospace; font-size: 12px; color: var(--primary); font-weight: bold; }

    .file-analysis { margin-top: 50px; }
    .file-row {
      background: var(--card-bg);
      border-radius: 10px;
      margin-bottom: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .file-header {
      padding: 15px 25px;
      background: rgba(0,0,0,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .file-summary { padding: 15px 25px; font-size: 14px; border-bottom: 1px solid var(--border); }
    .code-snippet {
      padding: 20px;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: 'Fira Code', 'Courier New', monospace;
      font-size: 13px;
      overflow-x: auto;
      white-space: pre;
    }
  </style>
</head>
<body>
  <div id="content"></div>
  <script id="review-data" type="application/json">${resultJson}</script>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const dataElement = document.getElementById('review-data');
      const result = JSON.parse(dataElement.textContent);
      const contentDiv = document.getElementById('content');

      function escapeHtml(unsafe) {
        return (unsafe || '')
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      window.openFile = function(file, line) {
        vscode.postMessage({ command: 'openFile', file, line });
      };

      function render() {
        if (typeof result === 'string') {
          contentDiv.innerHTML = '<div class="main-content"><div class="summary-section"><h2>Raw Review</h2><pre style="white-space: pre-wrap;">' + escapeHtml(result) + '</pre></div></div>';
          return;
        }

        const issuesHtml = (result.issues || []).map(issue => {
          const snippetHtml = issue.snippet ? '<div class="code-snippet" style="font-size: 11px; margin-bottom: 10px; padding: 10px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">' + escapeHtml(issue.snippet) + '</div>' : '';
          const locHtml = issue.file ? '<div class="issue-loc">📍 ' + escapeHtml(issue.file) + (issue.line ? ':' + issue.line : '') + '</div>' : '';
          
          return '<div class="issue-card sev-' + issue.severity + '" onclick="openFile(\\'' + escapeHtml(issue.file || '') + '\\', ' + (issue.line || 0) + ')">' +
                    '<span class="severity-tag">' + issue.severity + '</span>' +
                    '<div class="issue-title">' + escapeHtml(issue.title) + '</div>' +
                    '<div class="issue-desc">' + escapeHtml(issue.description) + '</div>' +
                    snippetHtml +
                    locHtml +
                  '</div>';
        }).join('');

        const filesHtml = (result.fileBreakdown || []).map(file => {
          const summaryHtml = file.summary ? '<div class="file-summary">' + escapeHtml(file.summary) + '</div>' : '';
          const snippetHtml = file.snippet ? '<div class="code-snippet">' + escapeHtml(file.snippet) + '</div>' : '';
          
          return '<div class="file-row">' +
                    '<div class="file-header">' +
                      '<span>📄 ' + escapeHtml(file.filename) + '</span>' +
                      '<span style="opacity: 0.6; font-size: 12px;">' + escapeHtml(file.status).toUpperCase() + '</span>' +
                    '</div>' +
                    summaryHtml +
                    snippetHtml +
                  '</div>';
        }).join('');

        contentDiv.innerHTML = 
          '<div class="hero">' +
            '<h1 style="margin:0; font-size: 42px;">Code Review Complete</h1>' +
            '<div class="verdict-large verdict-' + (result.verdict || 'approved').replace(/_/g, '-') + '">' +
              (result.verdict || 'approved').toUpperCase().replace(/-/g, ' ') +
            '</div>' +
          '</div>' +
          '<div class="main-content">' +
            '<div class="summary-section">' +
              '<h2>Overview</h2>' +
              '<div style="font-size: 18px;">' + (result.summary ? result.summary.replace(/\\n/g, '<br>') : '') + '</div>' +
            '</div>' +
            '<div class="section">' +
              '<h2>Detected Issues</h2>' +
              '<div class="issue-grid">' + issuesHtml + '</div>' +
            '</div>' +
            '<div class="file-analysis">' +
              '<h2>Detailed File Breakdown</h2>' +
              filesHtml +
            '</div>' +
          '</div>';
      }

      render();
    })();
  </script>
</body>
</html>`;
    }
}
exports.ReviewPanel = ReviewPanel;
//# sourceMappingURL=reviewPanel.js.map