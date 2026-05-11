# Code Review AI 🚀

An intelligent VS Code extension that provides expert-level code reviews directly in your editor. Using GitHub Copilot, OpenAI, or Google Gemini, it analyzes your diffs for security vulnerabilities, performance bottlenecks, and logical bugs.

## ✨ Features

- **Multi-Source Reviews**: Review local changes, specific PRs, branches, or even just the active file.
- **Visual Dashboard**: Beautiful, full-screen dashboard with high-impact visuals and color-coded severities.
- **Direct Navigation**: Click any detected issue to jump straight to the exact file and line number.
- **Smart Context**: Automatically detects your repository and includes PR descriptions for better AI understanding.
- **Multiple AI Providers**: Seamless integration with GitHub Copilot Chat, OpenAI, and Google Gemini.

## 🛠️ Installation (Development)

If you are running the extension from source:

1.  **Clone the repository**
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Compile the code**:
    ```bash
    npm run compile
    ```
4.  **Launch**: Press `F5` in VS Code to open a new "Extension Development Host" window with the extension active.

## 📦 Exporting for Personal Use (.vsix)

To use this extension permanently in your main VS Code instance without running it in debug mode, you can package it as a `.vsix` file.

### 1. Install VSCE
`vsce` (Visual Studio Code Extensions) is the CLI tool for packaging extensions.
```bash
npm install -g @vscode/vsce
```

### 2. Package the Extension
Run this command in the root directory of the project:
```bash
vsce package
```
*Note: You might get a warning about a missing 'publisher'. For personal use, you can ignore this or add `"publisher": "your-name"` to `package.json`.*

This will create a file named `code-review-0.0.1.vsix` in your folder.

### 3. Install the .vsix
1.  Open VS Code.
2.  Go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Click the **...** (three dots) in the top right of the Extensions pane.
4.  Select **Install from VSIX...**
5.  Choose the `.vsix` file you just created.

## ⚙️ Configuration

Go to VS Code Settings (`Cmd+,`) and search for "Code Review AI":

- **AI Provider**: Choose between GitHub Copilot, OpenAI, or Gemini.
- **API Keys**: Provide your OpenAI or Gemini keys if using those providers.
- **GitHub Token**: Optional, used for private repo PR fetching.

## 🚀 How to Use

1.  Open the **Code Review** icon in the Activity Bar (the checklist icon).
2.  Click **Select Source** to choose what to review (Local Changes is default).
3.  Click **Start AI Review**.
4.  Explore the findings in the automatically opened **Review Dashboard**.

---
*Built with ❤️ for better code quality.*
