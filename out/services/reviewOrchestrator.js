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
            let diffFiles = [];
            let diff = '';
            if (source.type === 'pr' && source.prNumber && source.repo && this.githubService) {
                onProgress?.('Fetching PR files...');
                const [owner, repoName] = source.repo.split('/');
                const prFiles = await this.githubService.getPRFiles(owner, repoName, source.prNumber);
                diffFiles = prFiles.map(file => {
                    // Parse the patch to get hunks if available
                    let hunks = [];
                    if (file.patch) {
                        // Create a dummy unified diff for this file to use the existing parser
                        const fileDiff = `diff --git a/${file.filename} b/${file.filename}\n${file.patch}`;
                        const parsed = diffProcessor_1.DiffProcessor.parseDiff(fileDiff);
                        if (parsed.length > 0) {
                            hunks = parsed[0].hunks;
                        }
                    }
                    return {
                        filename: file.filename,
                        status: (file.status === 'removed' ? 'deleted' : file.status),
                        additions: file.additions,
                        deletions: file.deletions,
                        hunks: hunks,
                        importance: 0
                    };
                });
                // Reconstruct unified diff string for the AI if it's within reasonable limits
                diff = prFiles
                    .filter(f => f.patch)
                    .map(f => `diff --git a/${f.filename} b/${f.filename}\n${f.patch}`)
                    .join('\n');
            }
            else {
                onProgress?.('Fetching diff...');
                diff = await this.fetchDiff(source);
                if (!diff || diff.trim().length === 0) {
                    throw new Error('No changes detected to review');
                }
                onProgress?.('Parsing diff...');
                diffFiles = diffProcessor_1.DiffProcessor.parseDiff(diff);
            }
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
        // Get PR details and linked issues if available
        let prDetails;
        let issues = [];
        if (source.type === 'pr' && source.prNumber && source.repo && this.githubService) {
            try {
                const [owner, repo] = source.repo.split('/');
                const ghPRDetails = await this.githubService.getPullRequest(owner, repo, source.prNumber);
                prDetails = {
                    title: ghPRDetails.title,
                    description: ghPRDetails.body,
                    author: ghPRDetails.author,
                };
                // Fetch linked issues (from body and branch name)
                try {
                    const ghIssues = await this.githubService.getLinkedIssues(owner, repo, source.prNumber, ghPRDetails.headBranch);
                    issues = ghIssues.map(issue => ({
                        number: issue.number,
                        title: issue.title,
                        body: issue.body,
                        url: issue.url
                    }));
                }
                catch (issueError) {
                    console.warn('Failed to fetch linked issues:', issueError);
                }
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
        const userMessage = this.promptManager.buildUserMessage(diff, parsedFiles, prDetails, issues);
        return { systemMessage, userMessage };
    }
    /**
     * Parse AI review result into structured format
     */
    parseReviewResult(review, diffFiles) {
        const aiProviderName = this.aiProvider.name;
        const aiModelName = this.aiProvider.model;
        // Clean markdown code blocks if present
        let cleanedReview = review.trim();
        const codeBlockMatch = cleanedReview.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            cleanedReview = codeBlockMatch[1].trim();
        }
        else {
            const firstBrace = cleanedReview.indexOf('{');
            const lastBrace = cleanedReview.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanedReview = cleanedReview.substring(firstBrace, lastBrace + 1);
            }
        }
        try {
            const parsed = JSON.parse(cleanedReview);
            if (parsed && typeof parsed === 'object') {
                const rawVerdict = String(parsed.verdict || 'approved-with-comments').toLowerCase().replace(/_/g, '-');
                const verdict = (['approved', 'approved-with-comments', 'changes-requested'].includes(rawVerdict)
                    ? rawVerdict
                    : (rawVerdict.includes('change') || rawVerdict.includes('reject') ? 'changes-requested' : 'approved'));
                parsed.verdict = verdict;
                parsed.summary = typeof parsed.summary === 'string' ? parsed.summary : '';
                parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
                parsed.fileBreakdown = Array.isArray(parsed.fileBreakdown) ? parsed.fileBreakdown : [];
                parsed.aiProvider = aiProviderName;
                parsed.aiModel = aiModelName;
                // Normalize issue fields
                parsed.issues = parsed.issues.map((issue) => {
                    const currentCode = issue.currentCode || issue.snippet || '';
                    return {
                        severity: issue.severity || 'medium',
                        title: issue.title || 'Code Quality Issue',
                        description: issue.description || '',
                        file: issue.file,
                        line: typeof issue.line === 'number' ? issue.line : (issue.line ? parseInt(issue.line, 10) : undefined),
                        snippet: currentCode,
                        currentCode: currentCode,
                        resolution: issue.resolution,
                        updatedCode: issue.updatedCode
                    };
                });
                // Backfill missing files in fileBreakdown from diffFiles
                const aiFiles = new Set(parsed.fileBreakdown.map((f) => f.filename));
                const missingFiles = diffFiles.filter(df => !aiFiles.has(df.filename));
                if (missingFiles.length > 0) {
                    const extraBreakdown = missingFiles.map(df => ({
                        filename: df.filename,
                        status: (df.status === 'renamed' ? 'modified' : df.status),
                        summary: 'No specific issues identified for this file.'
                    }));
                    parsed.fileBreakdown.push(...extraBreakdown);
                }
                // Generate copyableSummary if missing
                if (!parsed.copyableSummary || String(parsed.copyableSummary).trim().length === 0) {
                    parsed.copyableSummary = this.generateCopyableSummary(parsed);
                }
                return parsed;
            }
        }
        catch (error) {
            console.warn('Failed to parse JSON from review, proceeding with text fallback:', error);
        }
        // Fallback: parse review text to extract verdict and issues
        const fallbackResult = this.parseReviewText(review, diffFiles);
        fallbackResult.aiProvider = aiProviderName;
        fallbackResult.aiModel = aiModelName;
        fallbackResult.copyableSummary = this.generateCopyableSummary(fallbackResult);
        return fallbackResult;
    }
    /**
     * Helper to generate a clean, copyable markdown summary of requested changes
     */
    generateCopyableSummary(result) {
        const issues = result.issues || [];
        if (issues.length === 0) {
            return `### Review Verdict: ${((result.verdict || 'approved')).toUpperCase().replace(/-/g, ' ')}\n\n` +
                `✅ **No blocking changes requested.**\n` +
                `- All modified files passed quality and security checks.\n` +
                `- Ready to proceed with merge once CI passes.`;
        }
        const items = issues.map(issue => {
            const loc = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
            const sev = (issue.severity || 'medium').toUpperCase();
            const res = issue.resolution ? ` → ${issue.resolution}` : '';
            return `- [ ] **[${sev}]** **${issue.title}**${loc}${res}`;
        });
        return `### Requested Changes & Action Items (${((result.verdict || 'changes-requested')).toUpperCase().replace(/-/g, ' ')})\n\n` +
            items.join('\n');
    }
    /**
     * Check if parsed object is a valid ReviewResult
     */
    isValidReviewResult(obj) {
        return (obj &&
            typeof obj === 'object' &&
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
        // Extract structured issues from review text
        const issues = this.extractIssues(review);
        // Create file breakdown
        const fileBreakdown = diffFiles.map((file) => ({
            filename: file.filename,
            status: (file.status === 'renamed' ? 'modified' : file.status),
            summary: `Analyzed ${file.filename} (+${file.additions}/-${file.deletions})`,
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
        // Split review by block headers (e.g., File:, Issue:, or numbered issues)
        const blocks = review.split(/(?:^|\n)(?=(?:File:\s*|Issue:\s*|\d+\.\s+\*\*|###?\s+Issue))/i);
        for (const block of blocks) {
            if (!block.trim())
                continue;
            const fileMatch = block.match(/File:\s*([^\n:]+)(?::(\d+))?/i);
            const issueMatch = block.match(/(?:Issue|Finding|Problem):\s*([^\n]+)/i) || block.match(/^\s*(?:\d+\.\s+)?\*\*([^*]+)\*\*/m);
            if (!issueMatch)
                continue;
            const file = fileMatch ? fileMatch[1].trim() : undefined;
            const line = fileMatch && fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined;
            const title = issueMatch[1].trim();
            const currentCodeMatch = block.match(/Current Code:\s*```[a-z]*\n([\s\S]*?)```/i);
            const resolutionMatch = block.match(/Resolution:\s*([^\n]+(?:\n(?!\s*(?:Updated Code:|File:|Issue:))[^\n]+)*)/i);
            const updatedCodeMatch = block.match(/Updated Code:\s*```[a-z]*\n([\s\S]*?)```/i);
            const currentCode = currentCodeMatch ? currentCodeMatch[1].trim() : undefined;
            const resolution = resolutionMatch ? resolutionMatch[1].trim() : undefined;
            const updatedCode = updatedCodeMatch ? updatedCodeMatch[1].trim() : undefined;
            // Determine severity
            let severity = 'medium';
            const lowerText = (title + ' ' + (resolution || '')).toLowerCase();
            if (lowerText.includes('critical') || lowerText.includes('security') || lowerText.includes('vulnerability')) {
                severity = 'critical';
            }
            else if (lowerText.includes('error') || lowerText.includes('bug') || lowerText.includes('failure')) {
                severity = 'high';
            }
            else if (lowerText.includes('suggestion') || lowerText.includes('style') || lowerText.includes('nit')) {
                severity = 'low';
            }
            issues.push({
                severity,
                title,
                description: resolution ? `${title} - ${resolution}` : title,
                file,
                line,
                snippet: currentCode,
                currentCode,
                resolution,
                updatedCode
            });
        }
        // If structured blocks were not found, fall back to line matching
        if (issues.length === 0) {
            const severityPatterns = [
                { pattern: /critical|security|vulnerability/gi, severity: 'critical' },
                { pattern: /error|bug|issue|problem/gi, severity: 'high' },
                { pattern: /warning|concern|consider/gi, severity: 'medium' },
                { pattern: /suggestion|note|tip|improvement/gi, severity: 'low' },
            ];
            const lines = review.split('\n');
            for (const line of lines) {
                for (const { pattern, severity } of severityPatterns) {
                    if (pattern.test(line) && line.trim().length > 10) {
                        issues.push({
                            severity,
                            title: line.replace(/^[-*#\d.]+\s*/, '').substring(0, 100),
                            description: line.trim(),
                        });
                        break;
                    }
                }
            }
        }
        return issues.slice(0, 20);
    }
}
exports.ReviewOrchestrator = ReviewOrchestrator;
//# sourceMappingURL=reviewOrchestrator.js.map