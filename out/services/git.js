"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class GitService {
    constructor(workspaceRoot) {
        if (!workspaceRoot) {
            throw new Error('Workspace root is required for Git operations');
        }
        this.workspaceRoot = workspaceRoot;
    }
    async runGit(command) {
        try {
            const { stdout } = await execAsync(`git ${command}`, {
                cwd: this.workspaceRoot,
            });
            return stdout;
        }
        catch (error) {
            if (error.message.includes('not a git repository')) {
                throw new Error('The current workspace is not a git repository');
            }
            throw error;
        }
    }
    async getChanges(activeFilePath) {
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
exports.GitService = GitService;
//# sourceMappingURL=git.js.map