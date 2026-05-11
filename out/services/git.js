"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const child_process_1 = require("child_process");
const path = require("path");
class GitService {
    constructor(workspaceRoot) {
        if (!workspaceRoot) {
            throw new Error('Workspace root is required for Git operations');
        }
        this.workspaceRoot = workspaceRoot;
    }
    async runGit(command) {
        return new Promise((resolve, reject) => {
            const parts = command.split(' ');
            const args = parts.slice(0);
            // Add exclusions for diff commands to keep them manageable
            if (args[0] === 'diff') {
                const exclusions = [
                    'package-lock.json',
                    'yarn.lock',
                    'pnpm-lock.yaml',
                    'composer.lock',
                    '*.map',
                    '*.min.js',
                    'dist/*',
                    'out/*',
                    'build/*',
                    '.next/*',
                ];
                args.push('--', '.');
                exclusions.forEach(e => args.push(`:!${e}`));
            }
            const child = (0, child_process_1.spawn)('git', args, {
                cwd: this.workspaceRoot,
                env: { ...process.env, LANG: 'en_US.UTF-8' }
            });
            let stdout = '';
            let stderr = '';
            const MAX_AI_DIFF_SIZE = 200 * 1024; // 200KB limit for AI review to prevent token overflow
            child.stdout.on('data', (data) => {
                if (stdout.length < MAX_AI_DIFF_SIZE) {
                    stdout += data.toString();
                }
                else if (!stdout.endsWith('\n... (diff truncated due to size)')) {
                    stdout += '\n... (diff truncated due to size)';
                }
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                }
                else {
                    reject(new Error(stderr || `Git command failed with code ${code}`));
                }
            });
            child.on('error', reject);
        });
    }
    async getChanges(activeFilePath) {
        let activeFileDiff = '';
        if (activeFilePath) {
            const relativePath = path.relative(this.workspaceRoot, activeFilePath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                throw new Error('Active file is outside the workspace repository');
            }
            const normalizedPath = relativePath.replace(/\\/g, '/');
            try {
                activeFileDiff = await this.runGit(`diff HEAD -- "${normalizedPath}"`);
            }
            catch (error) {
                try {
                    activeFileDiff = await this.runGit(`diff -- "${normalizedPath}"`);
                }
                catch (innerError) {
                    activeFileDiff = '';
                }
            }
        }
        let stagedDiff = '';
        try {
            stagedDiff = await this.runGit('diff --cached');
        }
        catch (error) {
            stagedDiff = '';
        }
        return { activeFileDiff, stagedDiff };
    }
    async getCurrentBranch() {
        const branch = await this.runGit('rev-parse --abbrev-ref HEAD');
        return branch.trim();
    }
    async getDiffForBranch(branch) {
        const bases = ['main', 'master', 'develop', 'origin/main', 'origin/master'];
        let lastError;
        // Try each base branch with triple-dot syntax
        for (const base of bases) {
            try {
                const diff = await this.runGit(`diff ${base}...${branch}`);
                if (diff && diff.trim().length > 0) {
                    return diff;
                }
            }
            catch (error) {
                lastError = error;
            }
        }
        // Try remote refs if branch not found locally
        try {
            const allRefs = await this.runGit('branch -a');
            const matchedRef = allRefs.split('\n')
                .map(r => r.trim().replace(/^\* /, ''))
                .find(r => r === branch || r.endsWith('/' + branch));
            if (matchedRef && matchedRef !== branch) {
                return this.getDiffForBranch(matchedRef);
            }
        }
        catch (error) {
            // Ignore
        }
        throw new Error(`Failed to get diff for branch ${branch}. Tried main, master, etc. ${lastError?.message || ''}`);
    }
    async getDiffBetweenBranches(baseBranch, headBranch) {
        return this.runGit(`diff ${baseBranch}...${headBranch}`);
    }
    async getUncommittedChanges() {
        // This gets both staged and unstaged changes relative to HEAD
        try {
            const diff = await this.runGit('diff HEAD');
            return diff;
        }
        catch (error) {
            // If HEAD doesn't exist (e.g. empty repo), try just diff
            return this.runGit('diff');
        }
    }
    async getRemoteUrl() {
        try {
            const url = await this.runGit('remote get-url origin');
            return url.trim();
        }
        catch (error) {
            return '';
        }
    }
}
exports.GitService = GitService;
//# sourceMappingURL=git.js.map