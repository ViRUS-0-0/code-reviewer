import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class KnowledgeStore {
  private workspaceRoot: string;
  private readonly MAX_KNOWLEDGE_TOKENS = 1000;
  private readonly CHARS_PER_TOKEN = 4; // Rough approximation

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async getKnowledge(activeFilePath?: string): Promise<string> {
    let knowledge = '';

    // 1. Try reading knowledge.md
    const knowledgePath = path.join(this.workspaceRoot, 'knowledge.md');
    if (fs.existsSync(knowledgePath)) {
      try {
        knowledge += fs.readFileSync(knowledgePath, 'utf-8') + '\n\n';
      } catch (error) {
        console.error('Error reading knowledge.md:', error);
      }
    }

    // 2. Search for relevant context based on the active file
    if (activeFilePath) {
      const relevantSnippets = await this.findRelevantSnippets(activeFilePath);
      if (relevantSnippets) {
        knowledge += `Relevant Context from Workspace:\n${relevantSnippets}\n`;
      }
    }

    if (!knowledge) {
      return 'No specific agent knowledge available.';
    }

    // 3. Limit the total 'knowledge' context to ~1000 tokens
    const maxChars = this.MAX_KNOWLEDGE_TOKENS * this.CHARS_PER_TOKEN;
    if (knowledge.length > maxChars) {
      knowledge = knowledge.substring(0, maxChars) + '... [Knowledge Truncated]';
    }

    return knowledge;
  }

  private async findRelevantSnippets(activeFilePath: string): Promise<string> {
    const fileName = path.basename(activeFilePath);
    const fileNameWithoutExt = path.parse(fileName).name;
    
    // Look for files with similar names (e.g., matching the prefix/suffix or part of the name)
    // and common config/doc files.
    const searchPattern = `**/{*${fileNameWithoutExt}*,README.md,CONTRIBUTING.md,docs/*.md}`;
    const files = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**', 5);
    
    let snippets = '';
    for (const file of files) {
      if (file.fsPath === activeFilePath) continue;
      
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(content).toString('utf-8');
        snippets += `--- File: ${path.relative(this.workspaceRoot, file.fsPath)} ---\n`;
        // Take a small chunk of each relevant file
        snippets += text.substring(0, 500) + (text.length > 500 ? '...' : '') + '\n\n';
      } catch (err) {
        console.error(`Error reading ${file.fsPath}:`, err);
      }
    }

    return snippets;
  }
}
