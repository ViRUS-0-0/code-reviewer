"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubService = void 0;
const axios_1 = require("axios");
/**
 * GitHub API service with rate limit handling and exponential backoff
 */
class GitHubService {
    constructor(token) {
        this.rateLimitRemaining = 60;
        this.rateLimitReset = 0;
        if (!token || token.trim().length === 0) {
            throw new Error('GitHub token is required');
        }
        this.client = axios_1.default.create({
            baseURL: GitHubService.GITHUB_API_URL,
            headers: {
                Authorization: `Bearer ${token.trim()}`,
                Accept: 'application/vnd.github.v3+json',
            },
            timeout: 10000,
        });
        // Add response interceptor to track rate limits
        this.client.interceptors.response.use((response) => {
            this.updateRateLimitInfo(response.headers);
            return response;
        }, (error) => {
            if (error.response) {
                this.updateRateLimitInfo(error.response.headers);
            }
            return Promise.reject(error);
        });
    }
    /**
     * Update rate limit information from response headers
     */
    updateRateLimitInfo(headers) {
        const remaining = parseInt(headers['x-ratelimit-remaining'] || '60', 10);
        const reset = parseInt(headers['x-ratelimit-reset'] || '0', 10);
        this.rateLimitRemaining = remaining;
        this.rateLimitReset = reset;
        if (remaining < GitHubService.RATE_LIMIT_THRESHOLD) {
            console.warn(`GitHub API rate limit warning: ${remaining} requests remaining. Reset at ${new Date(reset * 1000).toISOString()}`);
        }
    }
    /**
     * Get current rate limit status
     */
    getRateLimitStatus() {
        return {
            remaining: this.rateLimitRemaining,
            reset: new Date(this.rateLimitReset * 1000),
        };
    }
    /**
     * Execute a request with exponential backoff retry logic
     */
    async executeWithRetry(fn, retryCount = 0) {
        try {
            return await fn();
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                // Check if it's a rate limit error
                if (error.response?.status === 429) {
                    const retryAfter = parseInt(error.response.headers['retry-after'] || '60', 10);
                    if (retryCount < GitHubService.MAX_RETRIES) {
                        const delay = retryAfter * 1000;
                        console.warn(`Rate limited. Retrying after ${retryAfter}s (attempt ${retryCount + 1}/${GitHubService.MAX_RETRIES})`);
                        await this.sleep(delay);
                        return this.executeWithRetry(fn, retryCount + 1);
                    }
                }
                // Check if it's a temporary error (5xx)
                if (error.response?.status && error.response.status >= 500 && retryCount < GitHubService.MAX_RETRIES) {
                    const delay = GitHubService.INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
                    console.warn(`Server error (${error.response.status}). Retrying after ${delay}ms (attempt ${retryCount + 1}/${GitHubService.MAX_RETRIES})`);
                    await this.sleep(delay);
                    return this.executeWithRetry(fn, retryCount + 1);
                }
                // Handle specific error codes
                if (error.response?.status === 401) {
                    throw new Error('GitHub authentication failed. Please check your token.');
                }
                if (error.response?.status === 403) {
                    throw new Error('GitHub API access forbidden. Check token permissions.');
                }
                if (error.response?.status === 404) {
                    throw new Error('GitHub resource not found.');
                }
            }
            throw error;
        }
    }
    /**
     * Sleep utility for retry delays
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get pull request details
     */
    async getPullRequest(owner, repo, prNumber) {
        return this.executeWithRetry(async () => {
            const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}`);
            const pr = response.data;
            return {
                number: pr.number,
                title: pr.title,
                body: pr.body || '',
                state: pr.state,
                author: pr.user.login,
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
                url: pr.html_url,
                headBranch: pr.head.ref,
                baseBranch: pr.base.ref,
                additions: pr.additions,
                deletions: pr.deletions,
                changedFiles: pr.changed_files,
            };
        });
    }
    /**
     * Get files changed in a pull request
     */
    async getPRFiles(owner, repo, prNumber) {
        return this.executeWithRetry(async () => {
            const files = [];
            let page = 1;
            const perPage = 100;
            while (true) {
                const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
                    params: { page, per_page: perPage },
                });
                if (response.data.length === 0) {
                    break;
                }
                files.push(...response.data.map((file) => ({
                    filename: file.filename,
                    status: file.status,
                    additions: file.additions,
                    deletions: file.deletions,
                    changes: file.changes,
                    patch: file.patch,
                    previousFilename: file.previous_filename,
                })));
                if (response.data.length < perPage) {
                    break;
                }
                page++;
            }
            return files;
        });
    }
    /**
     * Get branch information
     */
    async getBranch(owner, repo, branch) {
        return this.executeWithRetry(async () => {
            const response = await this.client.get(`/repos/${owner}/${repo}/branches/${branch}`);
            return response.data;
        });
    }
    /**
     * Compare two branches
     */
    async compareBranches(owner, repo, base, head) {
        return this.executeWithRetry(async () => {
            const response = await this.client.get(`/repos/${owner}/${repo}/compare/${base}...${head}`);
            const comparison = response.data;
            return {
                baseCommit: comparison.base_commit.sha,
                headCommit: comparison.head_commit.sha,
                aheadBy: comparison.ahead_by,
                behindBy: comparison.behind_by,
                totalCommits: comparison.total_commits,
                files: comparison.files.map((file) => ({
                    filename: file.filename,
                    status: file.status,
                    additions: file.additions,
                    deletions: file.deletions,
                    changes: file.changes,
                    patch: file.patch,
                    previousFilename: file.previous_filename,
                })),
                status: comparison.status,
            };
        });
    }
    /**
     * Get issues linked to a pull request
     */
    async getLinkedIssues(owner, repo, prNumber) {
        return this.executeWithRetry(async () => {
            // Get PR details to extract linked issues from body
            const prResponse = await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}`);
            const prBody = prResponse.data.body || '';
            // Simple regex to find issue references (e.g., #123, fixes #456)
            const issueRegex = /#(\d+)/g;
            const issueNumbers = new Set();
            let match;
            while ((match = issueRegex.exec(prBody)) !== null) {
                issueNumbers.add(parseInt(match[1], 10));
            }
            // Fetch details for each linked issue
            const issues = [];
            for (const issueNumber of issueNumbers) {
                try {
                    const issueResponse = await this.client.get(`/repos/${owner}/${repo}/issues/${issueNumber}`);
                    const issue = issueResponse.data;
                    issues.push({
                        number: issue.number,
                        title: issue.title,
                        state: issue.state,
                        url: issue.html_url,
                        createdAt: issue.created_at,
                        updatedAt: issue.updated_at,
                    });
                }
                catch (error) {
                    console.warn(`Failed to fetch issue #${issueNumber}:`, error);
                }
            }
            return issues;
        });
    }
    /**
     * Get repository information
     */
    async getRepository(owner, repo) {
        return this.executeWithRetry(async () => {
            const response = await this.client.get(`/repos/${owner}/${repo}`);
            const repository = response.data;
            return {
                name: repository.name,
                owner: repository.owner.login,
                url: repository.html_url,
                description: repository.description || '',
                isPrivate: repository.private,
                defaultBranch: repository.default_branch,
                language: repository.language,
                stargazersCount: repository.stargazers_count,
                forksCount: repository.forks_count,
            };
        });
    }
    /**
     * Get a specific commit
     */
    async getCommit(owner, repo, sha) {
        return this.executeWithRetry(async () => {
            const response = await this.client.get(`/repos/${owner}/${repo}/commits/${sha}`);
            return response.data;
        });
    }
    /**
     * Get file content from a repository
     */
    async getFileContent(owner, repo, path, ref) {
        return this.executeWithRetry(async () => {
            const params = {};
            if (ref) {
                params.ref = ref;
            }
            const response = await this.client.get(`/repos/${owner}/${repo}/contents/${path}`, { params });
            if (response.data.type !== 'file') {
                throw new Error(`Path ${path} is not a file`);
            }
            // GitHub returns content as base64
            return Buffer.from(response.data.content, 'base64').toString('utf-8');
        });
    }
}
exports.GitHubService = GitHubService;
GitHubService.GITHUB_API_URL = 'https://api.github.com';
GitHubService.MAX_RETRIES = 3;
GitHubService.INITIAL_RETRY_DELAY = 1000; // 1 second
GitHubService.RATE_LIMIT_THRESHOLD = 10; // Warn if less than 10 requests remaining
//# sourceMappingURL=githubService.js.map