"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewOrchestrator = void 0;
const git_1 = require("./git");
const githubService_1 = require("./githubService");
const diffProcessor_1 = require("./diffProcessor");
const promptManager_1 = require("./promptManager");
/**
 * Orchestrates the full code review flow
 */
class ReviewOrchestrator {
    constructor(workspaceRoot, aiProvider, githubToken) {
        this.aiProvider = aiProvider;
        this.gitService = new git_1.GitService(workspaceRoot);
        this.promptManager = new promptManager_1.PromptManager();
        if (githubToken) {
            try {
                this.githubService = new githubService_1.GitHubService(githubToken);
            }
            catch (error) {
                console.warn('Failed to initialize GitHub service:', error);
            }
        }
    }
    /**
     * Generate a code review for the given source
     */
    async generateReview(source, options = {}, onProgress) {
        try {
            onProgress?.('Fetching diff...');
            const diff = await this.fetchDiff(source);
            if (!diff || diff.trim().length === 0) {
                throw new Error('No changes detected to review');
            }
            onProgress?.('Parsing diff...');
            const diffFiles = diffProcessor_1.DiffProcessor.parseDiff(diff);
            if (diffFiles.length === 0) {
                throw new Error('No files found in diff');
            }
            onProgress?.('Detecting tech stack...');
            const changeSummary = diffProcessor_1.DiffProcessor.generateChangeSummary(diffFiles);
            onProgress?.('Building prompts...');
            const { systemMessage, userMessage } = await this.buildPrompts(source, diff, diffFiles, changeSummary, options);
            onProgress?.('Generating review with AI...');
            const review = await this.aiProvider.generateReview(userMessage, systemMessage);
            onProgress?.('Parsing review results...');
            if (options.parseStructuredResult !== false) {
                try {
                    const result = this.parseReviewResult(review, diffFiles);
                    return result;
                }
                catch (error) {
                    console.warn('Failed to parse structured review, returning raw text:', error);
                    return review;
                }
            }
            return review;
        }
        catch (error) {
            console.error('Review generation failed:', error);
            throw new Error(`Review generation failed: ${error.message}`);
        }
    }
    /**
     * Fetch diff for the given source
     */
    async fetchDiff(source) {
        switch (source.type) {
            case 'branch':
                if (!source.branch) {
                    throw new Error('Branch name is required for branch source');
                }
                return this.gitService.getDiffForBranch(source.branch);
            case 'file':
                if (!source.filePath) {
                    throw new Error('File path is required for file source');
                }
                return this.gitService.getChanges(source.filePath).then((changes) => changes.activeFileDiff || changes.stagedDiff || '');
            case 'pr':
                if (!source.prNumber || !source.repo) {
                    throw new Error('PR number and repo are required for PR source');
                }
                return this.fetchPRDiff(source.repo, source.prNumber);
            case 'compare':
                if (!source.baseBranch || !source.headBranch) {
                    throw new Error('Base and head branches are required for compare source');
                }
                return this.gitService.getDiffBetweenBranches(source.baseBranch, source.headBranch);
            case 'local':
                return this.gitService.getUncommittedChanges();
            default:
                throw new Error(`Unknown source type: ${source.type}`);
        }
    }
    /**
     * Fetch PR diff from GitHub
     */
    async fetchPRDiff(repo, prNumber) {
        if (!this.githubService) {
            throw new Error('GitHub service not initialized. Please provide a GitHub token.');
        }
        const [owner, repoName] = repo.split('/');
        if (!owner || !repoName) {
            throw new Error('Invalid repo format. Use "owner/repo"');
        }
        // Directly fetch the unified diff from GitHub for maximum accuracy
        return this.githubService.getPRDiff(owner, repoName, prNumber);
    }
    /**
     * Build system and user prompts
     */
    async buildPrompts(source, diff, diffFiles, changeSummary, options) {
        // Get PR details if available
        let prDetails;
        if (source.type === 'pr' && source.prNumber && source.repo && this.githubService) {
            try {
                const [owner, repo] = source.repo.split('/');
                const ghPRDetails = await this.githubService.getPullRequest(owner, repo, source.prNumber);
                prDetails = {
                    title: ghPRDetails.title,
                    description: ghPRDetails.body,
                    author: ghPRDetails.author,
                };
            }
            catch (error) {
                console.warn('Failed to fetch PR details:', error);
            }
        }
        // Convert DiffFile to ParsedFile
        const parsedFiles = diffFiles.map((file) => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
        }));
        // Format tech stack
        const techStackString = this.promptManager.formatTechStack(changeSummary.techStack);
        // Calculate risk level
        const riskLevel = this.promptManager.calculateRiskLevel(changeSummary.totalFiles, changeSummary.totalAdditions, changeSummary.totalDeletions, false);
        // Build system prompt
        const systemMessage = this.promptManager.buildSystemPrompt(techStackString, {
            techStack: changeSummary.techStack,
            fileStats: {
                totalFiles: changeSummary.totalFiles,
                totalAdditions: changeSummary.totalAdditions,
                totalDeletions: changeSummary.totalDeletions,
            },
            riskLevel,
        });
        // Build user message
        const userMessage = this.promptManager.buildUserMessage(diff, parsedFiles, prDetails);
        return { systemMessage, userMessage };
    }
    /**
     * Parse AI review result into structured format
     */
    parseReviewResult(review, diffFiles) {
        // Try to extract JSON from the review
        const jsonMatch = review.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (this.isValidReviewResult(parsed)) {
                    return parsed;
                }
            }
            catch (error) {
                console.warn('Failed to parse JSON from review:', error);
            }
        }
        // Fallback: parse review text to extract verdict and issues
        return this.parseReviewText(review, diffFiles);
    }
    /**
     * Check if parsed object is a valid ReviewResult
     */
    isValidReviewResult(obj) {
        return (obj &&
            typeof obj === 'object' &&
            ['approved', 'approved-with-comments', 'changes-requested'].includes(obj.verdict) &&
            typeof obj.summary === 'string' &&
            Array.isArray(obj.issues) &&
            Array.isArray(obj.fileBreakdown));
    }
    /**
     * Parse review text to extract structured information
     */
    parseReviewText(review, diffFiles) {
        // Determine verdict based on keywords
        let verdict = 'approved-with-comments';
        if (review.toLowerCase().includes('approved') &&
            !review.toLowerCase().includes('changes requested')) {
            verdict = 'approved';
        }
        else if (review.toLowerCase().includes('changes requested')) {
            verdict = 'changes-requested';
        }
        // Extract issues by severity
        const issues = this.extractIssues(review);
        // Create file breakdown
        const fileBreakdown = diffFiles.map((file) => ({
            filename: file.filename,
            status: (file.status === 'renamed' ? 'modified' : file.status),
            issues: issues.filter((issue) => !issue.file || issue.file === file.filename),
        }));
        return {
            verdict,
            summary: review.substring(0, 500),
            issues,
            fileBreakdown,
        };
    }
    /**
     * Extract issues from review text
     */
    extractIssues(review) {
        const issues = [];
        // Simple pattern matching for issues
        const severityPatterns = [
            { pattern: /critical|security|vulnerability/gi, severity: 'critical' },
            { pattern: /error|bug|issue|problem/gi, severity: 'high' },
            { pattern: /warning|concern|consider/gi, severity: 'medium' },
            { pattern: /suggestion|note|tip|improvement/gi, severity: 'low' },
        ];
        const lines = review.split('\n');
        for (const line of lines) {
            for (const { pattern, severity } of severityPatterns) {
                if (pattern.test(line)) {
                    issues.push({
                        severity,
                        title: line.substring(0, 100),
                        description: line,
                    });
                    break;
                }
            }
        }
        return issues.slice(0, 10); // Limit to 10 issues
    }
}
exports.ReviewOrchestrator = ReviewOrchestrator;
//# sourceMappingURL=reviewOrchestrator.js.map