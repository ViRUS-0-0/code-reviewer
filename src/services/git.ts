import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitChanges {
  activeFileDiff: string;
  stagedDiff: string;
}

export class GitService {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    if (!workspaceRoot) {
      throw new Error('Workspace root is required for Git operations');
    }
    this.workspaceRoot = workspaceRoot;
  }

  private async runGit(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`git ${command}`, {
        cwd: this.workspaceRoot,
      });
      return stdout;
    } catch (error: any) {
      if (error.message.includes('not a git repository')) {
        throw new Error('The current workspace is not a git repository');
      }
      throw error;
    }
  }

  async getChanges(activeFilePath?: string): Promise<GitChanges> {
    let activeFileDiff = '';
    if (activeFilePath) {
      // Get diff of the active file (both staged and unstaged vs HEAD)
      // If we want just unstaged changes: `git diff <file>`
      // If we want all changes since last commit: `git diff HEAD <file>`
      activeFileDiff = await this.runGit(`diff HEAD -- "${activeFilePath}"`);
    }

    // Get all staged changes in the repository
    const stagedDiff = await this.runGit('diff --cached');

    return {
      activeFileDiff,
      stagedDiff,
    };
  }
}
