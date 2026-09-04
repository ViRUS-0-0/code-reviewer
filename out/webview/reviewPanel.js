"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewPanel = void 0;
const vscode = require("vscode");
const path = require("path");
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
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openFile':
                    this._openFile(message.file, message.line);
                    return;
                case 'copyToClipboard':
                    if (message.text) {
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage('Summary copied to clipboard!');
                    }
                    return;
            }
        }, null, this._disposables);
    }
    async _openFile(file, line) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || !file)
            return;
        const cleanPath = file.replace(/^[ab][/\\]/, '').replace(/^[/\\]+/, '');
        let targetUri;
        if (path.isAbsolute(file)) {
            targetUri = vscode.Uri.file(file);
        }
        else {
            for (const folder of workspaceFolders) {
                const directUri = vscode.Uri.joinPath(folder.uri, cleanPath);
                try {
                    await vscode.workspace.fs.stat(directUri);
                    targetUri = directUri;
                    break;
                }
                catch { }
            }
        }
        if (!targetUri) {
            const files = await vscode.workspace.findFiles(`**/${cleanPath}`, null, 1);
            if (files.length > 0) {
                targetUri = files[0];
            }
        }
        if (targetUri) {
            try {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
                if (line && line > 0) {
                    const pos = new vscode.Position(line - 1, 0);
                    editor.selection = new vscode.Selection(pos, pos);
                    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                }
            }
            catch (err) {
                vscode.window.showErrorMessage(`Failed to open file ${file}: ${err.message}`);
            }
        }
        else {
            vscode.window.showWarningMessage(`Could not locate file: ${file}`);
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
  <title>Code Review Report</title>
  <style>
    :root {
      --primary: #007acc;
      --primary-hover: #0062a3;
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-foreground, #cccccc);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --card-alt-bg: var(--vscode-editorWidget-background, #2d2d2d);
      --border: var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      --critical: #f48771;
      --high: #ffcc00;
      --medium: #3794ff;
      --low: #89d185;
      --approved: #89d185;
      --code-bg: #141414;
      --code-border: #333333;
    }

    * { box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      color: var(--fg);
      background-color: var(--bg);
      padding: 0;
      margin: 0;
      line-height: 1.6;
    }

    .hero {
      background: linear-gradient(135deg, #094771 0%, #04253a 100%);
      color: white;
      padding: 36px 40px 32px 40px;
      border-bottom: 1px solid var(--border);
      position: relative;
    }

    .hero-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }

    .ai-engine-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .ai-engine-badge .sparkle {
      font-size: 14px;
    }

    .hero-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 20px;
    }

    .hero-title {
      margin: 0;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .verdict-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 24px;
      border-radius: 30px;
      font-size: 18px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      box-shadow: 0 6px 16px rgba(0,0,0,0.3);
    }

    .verdict-approved { background: var(--approved); color: #121212; border: 2px solid rgba(255,255,255,0.4); }
    .verdict-changes-requested { background: var(--critical); color: #121212; border: 2px solid rgba(255,255,255,0.4); }
    .verdict-approved-with-comments { background: var(--high); color: #121212; border: 2px solid rgba(255,255,255,0.4); }

    .stat-pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }

    .stat-pill {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .stat-pill strong { font-size: 15px; }

    .main-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 30px 40px 80px 40px;
    }

    .card {
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      padding: 24px;
      margin-bottom: 28px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-copy {
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s;
    }
    .btn-copy:hover { background: var(--primary-hover); }
    .btn-copy.copied { background: #388e3c; }

    .summary-box {
      background: var(--card-alt-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .overview-text {
      font-size: 15px;
      line-height: 1.7;
      opacity: 0.95;
    }

    .section-title {
      font-size: 20px;
      font-weight: 700;
      margin: 36px 0 18px 0;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 6px;
      width: fit-content;
    }

    .issue-list {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .issue-card {
      background: var(--card-bg);
      border-radius: 10px;
      border: 1px solid var(--border);
      border-left: 6px solid #888;
      padding: 20px;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .issue-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.15);
    }

    .issue-card.sev-critical { border-left-color: var(--critical); }
    .issue-card.sev-high { border-left-color: var(--high); }
    .issue-card.sev-medium { border-left-color: var(--medium); }
    .issue-card.sev-low { border-left-color: var(--low); }

    .issue-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .issue-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .severity-badge {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .sev-critical .severity-badge { background: rgba(244, 135, 113, 0.2); color: var(--critical); border: 1px solid var(--critical); }
    .sev-high .severity-badge { background: rgba(255, 204, 0, 0.2); color: var(--high); border: 1px solid var(--high); }
    .sev-medium .severity-badge { background: rgba(55, 148, 255, 0.2); color: var(--medium); border: 1px solid var(--medium); }
    .sev-low .severity-badge { background: rgba(137, 209, 133, 0.2); color: var(--low); border: 1px solid var(--low); }

    .issue-title {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }

    .issue-loc-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 122, 204, 0.15);
      border: 1px solid rgba(0, 122, 204, 0.4);
      color: #4fc1ff;
      border-radius: 6px;
      padding: 4px 10px;
      font-family: monospace;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .issue-loc-btn:hover {
      background: rgba(0, 122, 204, 0.35);
      text-decoration: underline;
    }

    .issue-desc {
      font-size: 14px;
      line-height: 1.6;
      margin: 10px 0 14px 0;
      opacity: 0.9;
    }

    .snippet-container {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .snippet-box {
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--code-border);
      background: var(--code-bg);
    }

    .snippet-label {
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .snippet-label-current {
      background: rgba(244, 135, 113, 0.15);
      color: var(--critical);
      border-bottom: 1px solid rgba(244, 135, 113, 0.3);
    }

    .snippet-label-updated {
      background: rgba(137, 209, 133, 0.15);
      color: var(--low);
      border-bottom: 1px solid rgba(137, 209, 133, 0.3);
    }

    .code-snippet {
      padding: 14px 18px;
      margin: 0;
      font-family: 'Fira Code', 'Courier New', Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      color: #e0e0e0;
    }

    .resolution-box {
      background: rgba(0, 122, 204, 0.08);
      border-left: 4px solid var(--primary);
      padding: 10px 14px;
      border-radius: 0 6px 6px 0;
      font-size: 13.5px;
      margin-top: 10px;
    }

    .file-row {
      background: var(--card-bg);
      border-radius: 10px;
      border: 1px solid var(--border);
      margin-bottom: 16px;
      overflow: hidden;
    }

    .file-header {
      padding: 12px 20px;
      background: var(--card-alt-bg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--border);
    }

    .file-name-btn {
      font-weight: 700;
      font-size: 14px;
      color: #4fc1ff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: none;
      padding: 0;
      font-family: inherit;
    }
    .file-name-btn:hover { text-decoration: underline; }

    .file-status-badge {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .status-added { background: rgba(137, 209, 133, 0.2); color: var(--low); border: 1px solid var(--low); }
    .status-modified { background: rgba(55, 148, 255, 0.2); color: var(--medium); border: 1px solid var(--medium); }
    .status-deleted { background: rgba(244, 135, 113, 0.2); color: var(--critical); border: 1px solid var(--critical); }

    .file-body {
      padding: 16px 20px;
      font-size: 13.5px;
      line-height: 1.6;
    }

    .empty-message {
      padding: 24px;
      text-align: center;
      opacity: 0.7;
      font-style: italic;
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

      function openFile(file, line) {
        if (!file) return;
        vscode.postMessage({ command: 'openFile', file, line: line || 1 });
      }

      function copySummary(text) {
        vscode.postMessage({ command: 'copyToClipboard', text });
        const btn = document.getElementById('btn-copy-summary');
        if (btn) {
          btn.classList.add('copied');
          btn.innerHTML = '<span>✓</span> Copied to Clipboard!';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<span>📋</span> Copy Summary';
          }, 3000);
        }
      }

      document.addEventListener('click', function(e) {
        const fileTarget = e.target.closest('[data-open-file]');
        if (fileTarget) {
          const file = fileTarget.getAttribute('data-open-file');
          const lineStr = fileTarget.getAttribute('data-open-line');
          const line = lineStr ? parseInt(lineStr, 10) : 1;
          openFile(file, line);
          return;
        }

        const copyTarget = e.target.closest('#btn-copy-summary');
        if (copyTarget) {
          const contentElem = document.getElementById('copyable-content');
          if (contentElem) {
            copySummary(contentElem.textContent || '');
          }
        }
      });

      function render() {
        if (typeof result === 'string') {
          contentDiv.innerHTML = '<div class="main-content"><div class="card"><div class="card-header"><h2 class="card-title">Code Review Output</h2></div><pre class="code-snippet">' + escapeHtml(result) + '</pre></div></div>';
          return;
        }

        const verdict = (result.verdict || 'approved').toLowerCase();
        const verdictClass = 'verdict-' + verdict.replace(/_/g, '-');
        const verdictText = verdict.toUpperCase().replace(/-/g, ' ');

        // AI Provider info at the top
        const aiProviderName = result.aiProvider || 'AI Reviewer';
        const aiModelName = result.aiModel ? ' (Model: ' + escapeHtml(result.aiModel) + ')' : '';
        const aiDisplay = escapeHtml(aiProviderName) + aiModelName;

        // Count severities
        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        (result.issues || []).forEach(i => {
          if (counts[i.severity] !== undefined) {
            counts[i.severity]++;
          }
        });
        const totalIssues = (result.issues || []).length;
        const totalFiles = (result.fileBreakdown || []).length;

        // Copyable Summary content
        const copyableSummaryText = result.copyableSummary || result.summary || '';

        // Render Issues
        let issuesHtml = '';
        if (result.issues && result.issues.length > 0) {
          issuesHtml = result.issues.map((issue, idx) => {
            const locText = issue.file ? escapeHtml(issue.file) + (issue.line ? ':' + issue.line : '') : '';
            const locButton = issue.file 
              ? '<button class="issue-loc-btn" data-open-file="' + escapeHtml(issue.file) + '" data-open-line="' + (issue.line || 1) + '"><span>📍</span> ' + locText + '</button>'
              : '';

            const currentCode = issue.currentCode || issue.snippet || '';
            const currentCodeHtml = currentCode 
              ? '<div class="snippet-box">' +
                  '<div class="snippet-label snippet-label-current"><span>⚠️</span> Current / Problematic Code</div>' +
                  '<pre class="code-snippet">' + escapeHtml(currentCode) + '</pre>' +
                '</div>'
              : '';

            const resolutionHtml = issue.resolution
              ? '<div class="resolution-box"><strong>💡 Resolution:</strong> ' + escapeHtml(issue.resolution) + '</div>'
              : '';

            const updatedCodeHtml = issue.updatedCode
              ? '<div class="snippet-box">' +
                  '<div class="snippet-label snippet-label-updated"><span>✅</span> Suggested Fix / Updated Code</div>' +
                  '<pre class="code-snippet">' + escapeHtml(issue.updatedCode) + '</pre>' +
                '</div>'
              : '';

            return '<div class="issue-card sev-' + (issue.severity || 'medium') + '">' +
              '<div class="issue-top">' +
                '<div class="issue-title-group">' +
                  '<span class="severity-badge">' + (issue.severity || 'medium') + '</span>' +
                  '<h3 class="issue-title">' + (idx + 1) + '. ' + escapeHtml(issue.title || 'Finding') + '</h3>' +
                '</div>' +
                locButton +
              '</div>' +
              '<div class="issue-desc">' + escapeHtml(issue.description || '') + '</div>' +
              resolutionHtml +
              '<div class="snippet-container">' +
                currentCodeHtml +
                updatedCodeHtml +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          issuesHtml = '<div class="card empty-message">🎉 No code issues or vulnerabilities detected! All checks passed.</div>';
        }

        // Render File Breakdown
        let filesHtml = '';
        if (result.fileBreakdown && result.fileBreakdown.length > 0) {
          filesHtml = result.fileBreakdown.map(file => {
            const status = (file.status || 'modified').toLowerCase();
            const summaryHtml = file.summary ? '<div style="margin-bottom: 10px;">' + escapeHtml(file.summary) + '</div>' : '';
            const snippetHtml = file.snippet 
              ? '<div class="snippet-box"><div class="snippet-label" style="background: rgba(255,255,255,0.05);">Relevant File Snippet</div><pre class="code-snippet">' + escapeHtml(file.snippet) + '</pre></div>'
              : '';

            return '<div class="file-row">' +
              '<div class="file-header">' +
                '<button class="file-name-btn" data-open-file="' + escapeHtml(file.filename) + '" data-open-line="1">' +
                  '<span>📄</span> ' + escapeHtml(file.filename) +
                '</button>' +
                '<span class="file-status-badge status-' + status + '">' + escapeHtml(status).toUpperCase() + '</span>' +
              '</div>' +
              '<div class="file-body">' +
                summaryHtml +
                snippetHtml +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          filesHtml = '<div class="card empty-message">No file breakdown available.</div>';
        }

        contentDiv.innerHTML = 
          '<div class="hero">' +
            '<div class="hero-meta">' +
              '<div class="ai-engine-badge">' +
                '<span class="sparkle">⚡</span>' +
                '<span>AI Review Engine: <strong>' + aiDisplay + '</strong></span>' +
              '</div>' +
              '<div style="font-size: 13px; opacity: 0.85;">' + new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div>' +
            '</div>' +
            '<div class="hero-title-row">' +
              '<h1 class="hero-title">Automated Code Review</h1>' +
              '<div class="verdict-badge ' + verdictClass + '">' +
                verdictText +
              '</div>' +
            '</div>' +
            '<div class="stat-pill-row">' +
              '<div class="stat-pill"><span>🔴 Critical:</span> <strong>' + counts.critical + '</strong></div>' +
              '<div class="stat-pill"><span>🟡 High:</span> <strong>' + counts.high + '</strong></div>' +
              '<div class="stat-pill"><span>🔵 Medium:</span> <strong>' + counts.medium + '</strong></div>' +
              '<div class="stat-pill"><span>🟢 Low:</span> <strong>' + counts.low + '</strong></div>' +
              '<div class="stat-pill"><span>📁 Files Analyzed:</span> <strong>' + totalFiles + '</strong></div>' +
            '</div>' +
          '</div>' +

          '<div class="main-content">' +
            // Copyable Summary Card
            '<div class="card" style="border-left: 6px solid var(--primary);">' +
              '<div class="card-header">' +
                '<h2 class="card-title"><span>📋</span> Actionable Summary of Requested Changes</h2>' +
                '<button id="btn-copy-summary" class="btn-copy">' +
                  '<span>📋</span> Copy Summary' +
                '</button>' +
              '</div>' +
              '<div id="copyable-content" class="summary-box">' + escapeHtml(copyableSummaryText) + '</div>' +
            '</div>' +

            // Executive Summary Card
            '<div class="card">' +
              '<div class="card-header">' +
                '<h2 class="card-title"><span>🔍</span> Executive Overview & Findings</h2>' +
              '</div>' +
              '<div class="overview-text">' + (result.summary ? escapeHtml(result.summary).replace(/\\n/g, '<br>') : 'No summary provided.') + '</div>' +
            '</div>' +

            // Issues Section
            '<div class="section-title"><span>⚠️</span> Detected Issues & Remediation (' + totalIssues + ')</div>' +
            '<div class="issue-list">' + issuesHtml + '</div>' +

            // File Breakdown Section
            '<div class="section-title"><span>📁</span> Detailed File Breakdown (' + totalFiles + ')</div>' +
            '<div>' + filesHtml + '</div>' +
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