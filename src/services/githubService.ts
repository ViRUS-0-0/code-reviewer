import axios, { AxiosInstance } from 'axios';

/**
 * TypeScript interfaces for GitHub API responses
 */

export interface PRDetails {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  headBranch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PRFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'unchanged' | 'unknown';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

export interface ComparisonResult {
  baseCommit: string;
  headCommit: string;
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  files: PRFile[];
  status: 'identical' | 'behind' | 'ahead' | 'diverged';
}

export interface Issue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryInfo {
  name: string;
  owner: string;
  url: string;
  description: string;
  isPrivate: boolean;
  defaultBranch: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
}

/**
 * GitHub API service with rate limit handling and exponential backoff
 */
export class GitHubService {
  private static readonly GITHUB_API_URL = 'https://api.github.com';
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_RETRY_DELAY = 1000; // 1 second
  private static readonly RATE_LIMIT_THRESHOLD = 10; // Warn if less than 10 requests remaining

  private client: AxiosInstance;
  private rateLimitRemaining: number = 60;
  private rateLimitReset: number = 0;

  constructor(token: string) {
    if (!token || token.trim().length === 0) {
      throw new Error('GitHub token is required');
    }

    this.client = axios.create({
      baseURL: GitHubService.GITHUB_API_URL,
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: 'application/vnd.github.v3+json',
      },
      timeout: 10000,
    });

    // Add response interceptor to track rate limits
    this.client.interceptors.response.use(
      (response) => {
        this.updateRateLimitInfo(response.headers);
        return response;
      },
      (error) => {
        if (error.response) {
          this.updateRateLimitInfo(error.response.headers);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Update rate limit information from response headers
   */
  private updateRateLimitInfo(headers: any): void {
    const remaining = parseInt(headers['x-ratelimit-remaining'] || '60', 10);
    const reset = parseInt(headers['x-ratelimit-reset'] || '0', 10);

    this.rateLimitRemaining = remaining;
    this.rateLimitReset = reset;

    if (remaining < GitHubService.RATE_LIMIT_THRESHOLD) {
      console.warn(
        `GitHub API rate limit warning: ${remaining} requests remaining. Reset at ${new Date(reset * 1000).toISOString()}`
      );
    }
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): { remaining: number; reset: Date } {
    return {
      remaining: this.rateLimitRemaining,
      reset: new Date(this.rateLimitReset * 1000),
    };
  }

  /**
   * Execute a request with exponential backoff retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retryCount: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (axios.isAxiosError(error)) {
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
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get pull request details
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PRDetails> {
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
   * Get the raw unified diff for a pull request
   */
  async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    return this.executeWithRetry(async () => {
      const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: {
          Accept: 'application/vnd.github.v3.diff',
        },
        responseType: 'text',
      });
      return response.data;
    });
  }

  /**
   * List pull requests for a repository
   */
  async listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open', limit: number = 20): Promise<PRDetails[]> {
    return this.executeWithRetry(async () => {
      const response = await this.client.get(`/repos/${owner}/${repo}/pulls`, {
        params: {
          state,
          per_page: Math.min(limit, 100),
          sort: 'updated',
          direction: 'desc',
        },
      });

      return response.data.map((pr: any) => ({
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
      }));
    });
  }

  /**
   * Get files changed in a pull request
   */
  async getPRFiles(owner: string, repo: string, prNumber: number): Promise<PRFile[]> {
    return this.executeWithRetry(async () => {
      const files: PRFile[] = [];
      let page = 1;
      const perPage = 100;

      while (true) {
        const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
          params: { page, per_page: perPage },
        });

        if (response.data.length === 0) {
          break;
        }

        files.push(
          ...response.data.map((file: any) => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch,
            previousFilename: file.previous_filename,
          }))
        );

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
  async getBranch(owner: string, repo: string, branch: string): Promise<any> {
    return this.executeWithRetry(async () => {
      const response = await this.client.get(`/repos/${owner}/${repo}/branches/${branch}`);
      return response.data;
    });
  }

  /**
   * Compare two branches
   */
  async compareBranches(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<ComparisonResult> {
    return this.executeWithRetry(async () => {
      const response = await this.client.get(`/repos/${owner}/${repo}/compare/${base}...${head}`);
      const comparison = response.data;

      return {
        baseCommit: comparison.base_commit.sha,
        headCommit: comparison.head_commit.sha,
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
        totalCommits: comparison.total_commits,
        files: comparison.files.map((file: any) => ({
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
  async getLinkedIssues(owner: string, repo: string, prNumber: number): Promise<Issue[]> {
    return this.executeWithRetry(async () => {
      // Get PR details to extract linked issues from body
      const prResponse = await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}`);
      const prBody = prResponse.data.body || '';

      // Simple regex to find issue references (e.g., #123, fixes #456)
      const issueRegex = /#(\d+)/g;
      const issueNumbers = new Set<number>();
      let match;

      while ((match = issueRegex.exec(prBody)) !== null) {
        issueNumbers.add(parseInt(match[1], 10));
      }

      // Fetch details for each linked issue
      const issues: Issue[] = [];
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
        } catch (error) {
          console.warn(`Failed to fetch issue #${issueNumber}:`, error);
        }
      }

      return issues;
    });
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<RepositoryInfo> {
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
  async getCommit(owner: string, repo: string, sha: string): Promise<any> {
    return this.executeWithRetry(async () => {
      const response = await this.client.get(`/repos/${owner}/${repo}/commits/${sha}`);
      return response.data;
    });
  }

  /**
   * Get file content from a repository
   */
  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
    return this.executeWithRetry(async () => {
      const params: any = {};
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
