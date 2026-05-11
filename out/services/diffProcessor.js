"use strict";
/**
 * Diff processing and analysis service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiffProcessor = void 0;
/**
 * Service for processing and analyzing diffs
 */
class DiffProcessor {
    /**
     * Parse unified diff format and extract file information
     */
    static parseDiff(diffContent) {
        const files = [];
        const lines = diffContent.split('\n');
        let currentFile = null;
        let currentHunk = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // File header: diff --git a/path b/path
            if (line.startsWith('diff --git')) {
                if (currentFile) {
                    if (currentHunk) {
                        currentFile.hunks.push(currentHunk);
                    }
                    files.push(currentFile);
                }
                const match = line.match(/diff --git a\/(.*) b\/(.*)/);
                if (match) {
                    const filename = match[2];
                    currentFile = {
                        filename,
                        status: 'modified',
                        additions: 0,
                        deletions: 0,
                        hunks: [],
                        importance: 0,
                    };
                }
            }
            // File status
            if (line.startsWith('new file mode')) {
                if (currentFile) {
                    currentFile.status = 'added';
                }
            }
            if (line.startsWith('deleted file mode')) {
                if (currentFile) {
                    currentFile.status = 'deleted';
                }
            }
            if (line.startsWith('rename from')) {
                if (currentFile) {
                    currentFile.status = 'renamed';
                }
            }
            // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
            if (line.startsWith('@@')) {
                if (currentHunk && currentFile) {
                    currentFile.hunks.push(currentHunk);
                }
                const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (match) {
                    currentHunk = {
                        oldStart: parseInt(match[1], 10),
                        oldCount: parseInt(match[2] || '1', 10),
                        newStart: parseInt(match[3], 10),
                        newCount: parseInt(match[4] || '1', 10),
                        lines: [],
                    };
                }
            }
            // Hunk content
            if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    if (currentFile) {
                        currentFile.additions++;
                    }
                }
                else if (line.startsWith('-') && !line.startsWith('---')) {
                    if (currentFile) {
                        currentFile.deletions++;
                    }
                }
                currentHunk.lines.push(line);
            }
        }
        // Add last file and hunk
        if (currentHunk && currentFile) {
            currentFile.hunks.push(currentHunk);
        }
        if (currentFile) {
            files.push(currentFile);
        }
        return files;
    }
    /**
     * Detect technology stack from file extensions
     */
    static detectTechStack(files) {
        const techStack = {
            languages: new Set(),
            frameworks: new Set(),
            tools: new Set(),
        };
        for (const file of files) {
            const ext = this.getFileExtension(file.filename);
            const basename = this.getFileBasename(file.filename);
            // Detect language
            if (this.LANGUAGE_EXTENSIONS[ext]) {
                techStack.languages.add(this.LANGUAGE_EXTENSIONS[ext]);
            }
            // Detect frameworks
            const fullPath = file.filename.toLowerCase();
            for (const [framework, pattern] of Object.entries(this.FRAMEWORK_PATTERNS)) {
                if (pattern.test(fullPath)) {
                    techStack.frameworks.add(framework);
                }
            }
            // Detect tools from config files
            if (basename === 'package.json') {
                techStack.tools.add('npm/yarn');
            }
            if (basename === 'Dockerfile' || basename === 'docker-compose.yml') {
                techStack.tools.add('Docker');
            }
            if (basename === 'Makefile') {
                techStack.tools.add('Make');
            }
            if (basename === '.github') {
                techStack.tools.add('GitHub Actions');
            }
        }
        return techStack;
    }
    /**
     * Select important files for review based on heuristics
     * Optimizes for token usage by selecting most impactful files
     */
    static selectImportantFiles(files, maxFiles = 10, maxTokens = 8000) {
        // Calculate importance score for each file
        const scoredFiles = files.map((file) => ({
            ...file,
            importance: this.calculateFileImportance(file),
        }));
        // Sort by importance
        scoredFiles.sort((a, b) => b.importance - a.importance);
        // Select files within token budget
        const selected = [];
        let tokenCount = 0;
        for (const file of scoredFiles) {
            if (selected.length >= maxFiles) {
                break;
            }
            // Estimate tokens: roughly 1 token per 4 characters
            const fileTokens = Math.ceil((file.additions + file.deletions) / 4) + 100;
            if (tokenCount + fileTokens <= maxTokens) {
                selected.push(file);
                tokenCount += fileTokens;
            }
        }
        return selected;
    }
    /**
     * Calculate importance score for a file (0-1)
     */
    static calculateFileImportance(file) {
        let score = 0.5; // Base score
        const filename = file.filename.toLowerCase();
        const basename = this.getFileBasename(filename);
        // Check exact filename matches
        for (const [pattern, weight] of Object.entries(this.IMPORTANCE_WEIGHTS)) {
            if (basename === pattern || filename === pattern) {
                return weight;
            }
        }
        // Check partial matches
        for (const [pattern, weight] of Object.entries(this.IMPORTANCE_WEIGHTS)) {
            if (filename.includes(pattern)) {
                score = Math.max(score, weight);
            }
        }
        // Adjust based on change size
        const totalChanges = file.additions + file.deletions;
        if (totalChanges > 500) {
            score = Math.min(1, score + 0.15); // Large changes are important
        }
        else if (totalChanges > 100) {
            score = Math.min(1, score + 0.05);
        }
        // Adjust based on file type
        const ext = this.getFileExtension(filename);
        if (['.test.', '.spec.'].some((t) => filename.includes(t))) {
            score *= 0.7; // Reduce importance of test files
        }
        return Math.min(1, Math.max(0, score));
    }
    /**
     * Generate a summary of changes
     */
    static generateChangeSummary(files) {
        const techStack = this.detectTechStack(files);
        const importantFiles = this.selectImportantFiles(files);
        let totalAdditions = 0;
        let totalDeletions = 0;
        for (const file of files) {
            totalAdditions += file.additions;
            totalDeletions += file.deletions;
        }
        const summary = this.generateSummaryText(files, importantFiles, techStack);
        return {
            totalFiles: files.length,
            totalAdditions,
            totalDeletions,
            techStack,
            importantFiles,
            summary,
        };
    }
    /**
     * Generate human-readable summary text
     */
    static generateSummaryText(allFiles, importantFiles, techStack) {
        const parts = [];
        // File count
        const addedCount = allFiles.filter((f) => f.status === 'added').length;
        const deletedCount = allFiles.filter((f) => f.status === 'deleted').length;
        const modifiedCount = allFiles.filter((f) => f.status === 'modified').length;
        parts.push(`Changes: ${modifiedCount} modified, ${addedCount} added, ${deletedCount} deleted`);
        // Tech stack
        if (techStack.languages.size > 0) {
            parts.push(`Languages: ${Array.from(techStack.languages).join(', ')}`);
        }
        if (techStack.frameworks.size > 0) {
            parts.push(`Frameworks: ${Array.from(techStack.frameworks).join(', ')}`);
        }
        // Important files
        if (importantFiles.length > 0) {
            const importantNames = importantFiles.slice(0, 5).map((f) => f.filename);
            parts.push(`Key files: ${importantNames.join(', ')}`);
        }
        return parts.join(' | ');
    }
    /**
     * Get file extension
     */
    static getFileExtension(filename) {
        const lastDot = filename.lastIndexOf('.');
        if (lastDot === -1) {
            return '';
        }
        return filename.substring(lastDot).toLowerCase();
    }
    /**
     * Get file basename
     */
    static getFileBasename(filename) {
        const lastSlash = filename.lastIndexOf('/');
        if (lastSlash === -1) {
            return filename;
        }
        return filename.substring(lastSlash + 1);
    }
    /**
     * Format diff for display
     */
    static formatDiffForDisplay(files, maxLines = 100) {
        const lines = [];
        for (const file of files) {
            lines.push(`\n=== ${file.filename} (${file.status}) ===`);
            lines.push(`+${file.additions} -${file.deletions}`);
            for (const hunk of file.hunks.slice(0, 2)) {
                // Show first 2 hunks
                lines.push(`\n@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
                lines.push(...hunk.lines.slice(0, 20)); // Show first 20 lines of hunk
            }
            if (lines.length > maxLines) {
                lines.push('... (truncated)');
                break;
            }
        }
        return lines.join('\n');
    }
}
exports.DiffProcessor = DiffProcessor;
DiffProcessor.LANGUAGE_EXTENSIONS = {
    // Web
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.less': 'Less',
    '.json': 'JSON',
    // Backend
    '.py': 'Python',
    '.java': 'Java',
    '.go': 'Go',
    '.rs': 'Rust',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.cs': 'C#',
    '.cpp': 'C++',
    '.c': 'C',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    // Data
    '.sql': 'SQL',
    '.graphql': 'GraphQL',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.xml': 'XML',
    '.toml': 'TOML',
    // Config
    '.env': 'Environment',
    '.dockerfile': 'Docker',
    '.sh': 'Shell',
    '.bash': 'Bash',
};
DiffProcessor.FRAMEWORK_PATTERNS = {
    React: /react|jsx/i,
    Vue: /vue/i,
    Angular: /angular/i,
    Svelte: /svelte/i,
    Next: /next\.js|nextjs/i,
    Nuxt: /nuxt/i,
    Express: /express/i,
    Django: /django/i,
    FastAPI: /fastapi/i,
    Spring: /spring/i,
    Rails: /rails|ruby on rails/i,
    Laravel: /laravel/i,
    Flask: /flask/i,
};
DiffProcessor.IMPORTANCE_WEIGHTS = {
    // Critical files
    'package.json': 0.95,
    'package-lock.json': 0.90,
    'yarn.lock': 0.90,
    'requirements.txt': 0.90,
    'Gemfile': 0.90,
    'go.mod': 0.90,
    'Cargo.toml': 0.90,
    'pom.xml': 0.90,
    'build.gradle': 0.90,
    // Configuration
    'tsconfig.json': 0.85,
    'webpack.config.js': 0.85,
    'vite.config.ts': 0.85,
    '.eslintrc': 0.85,
    'jest.config.js': 0.85,
    'docker-compose.yml': 0.85,
    'Dockerfile': 0.85,
    // Core application files
    'src/index': 0.80,
    'src/main': 0.80,
    'src/app': 0.80,
    'src/server': 0.80,
    // Test files
    '.test.': 0.60,
    '.spec.': 0.60,
    '__tests__': 0.60,
    'test/': 0.60,
    'tests/': 0.60,
    // Documentation
    'README': 0.40,
    '.md': 0.35,
    // Low importance
    '.gitignore': 0.20,
    '.prettierrc': 0.20,
};
//# sourceMappingURL=diffProcessor.js.map