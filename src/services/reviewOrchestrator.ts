import * as vscode from 'vscode';
import { AIProvider } from '../providers/types';
import { GitService } from './git';
import { GitHubService, PRDetails as GitHubPRDetails } from './githubService';
import { DiffProcessor, DiffFile } from './diffProcessor';
import { PromptManager, ParsedFile, PRDetails } from './promptManager';
import { ReviewResult } from '../webview/sidebarProvider';

/**
 * Source type for review
 */
export type ReviewSourceType = 'branch' | 'pr' | 'compare' | 'file' | 'local';

/**
 * Source data for review
 */
export interface ReviewSource {
  type: ReviewSourceType;
  branch?: string;
  prNumber?: number;
  repo?: string;
  baseBranch?: string;
  headBranch?: string;
  filePath?: string;
}

/**
 * Review generation options
 */
export interface ReviewOptions {
  maxFiles?: number;
  maxTokens?: number;
  includeFileBreakdown?: boolean;
  parseStructuredResult?: boolean;
}

/**
 * Orchestrates the full code review flow
 */
export class ReviewOrchestrator {
  private gitService: GitService;
  private promptManager: PromptManager;
  private githubService?: GitHubService;

  constructor(
    workspaceRoot: string,
    private aiProvider: AIProvider,
    githubToken?: string
  ) {
    this.gitService = new GitService(workspaceRoot);
    this.promptManager = new PromptManager();

    if (githubToken) {
      try {
        this.githubService = new GitHubService(githubToken);
      } catch (error) {
        console.warn('Failed to initialize GitHub service:', error);
      }
    }
  }

  /**
   * Generate a code review for the given source
   */
  async generateReview(
    source: ReviewSource,
    options: ReviewOptions = {},
    onProgress?: (message: string) => void
  ): Promise<ReviewResult | string> {
    try {
      onProgress?.('Fetching diff...');
      const diff = await this.fetchDiff(source);

      if (!diff || diff.trim().length === 0) {
        throw new Error('No changes detected to review');
      }

      onProgress?.('Parsing diff...');
      const diffFiles = DiffProcessor.parseDiff(diff);

      if (diffFiles.length === 0) {
        throw new Error('No files found in diff');
      }

      onProgress?.('Detecting tech stack...');
      const changeSummary = DiffProcessor.generateChangeSummary(diffFiles);

      onProgress?.('Building prompts...');
      const { systemMessage, userMessage } = await this.buildPrompts(
        source,
        diff,
        diffFiles,
        changeSummary,
        options
      );

      onProgress?.('Generating review with AI...');
      const review = await this.aiProvider.generateReview(userMessage, systemMessage);

      onProgress?.('Parsing review results...');
      if (options.parseStructuredResult !== false) {
        try {
          const result = this.parseReviewResult(review, diffFiles);
          return result;
        } catch (error) {
          console.warn('Failed to parse structured review, returning raw text:', error);
          return review;
        }
      }

      return review;
    } catch (error: any) {
      console.error('Review generation failed:', error);
      throw new Error(`Review generation failed: ${error.message}`);
    }
  }

  /**
   * Fetch diff for the given source
   */
  private async fetchDiff(source: ReviewSource): Promise<string> {
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
        return this.gitService.getChanges(source.filePath).then(
          (changes) => changes.activeFileDiff || changes.stagedDiff || ''
        );

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
  private async fetchPRDiff(repo: string, prNumber: number): Promise<string> {
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
  private async buildPrompts(
    source: ReviewSource,
    diff: string,
    diffFiles: DiffFile[],
    changeSummary: any,
    options: ReviewOptions
  ): Promise<{ systemMessage: string; userMessage: string }> {
    // Get PR details if available
    let prDetails: PRDetails | undefined;
    if (source.type === 'pr' && source.prNumber && source.repo && this.githubService) {
      try {
        const [owner, repo] = source.repo.split('/');
        const ghPRDetails = await this.githubService.getPullRequest(owner, repo, source.prNumber);
        prDetails = {
          title: ghPRDetails.title,
          description: ghPRDetails.body,
          author: ghPRDetails.author,
        };
      } catch (error) {
        console.warn('Failed to fetch PR details:', error);
      }
    }

    // Convert DiffFile to ParsedFile
    const parsedFiles: ParsedFile[] = diffFiles.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    }));

    // Format tech stack
    const techStackString = this.promptManager.formatTechStack(changeSummary.techStack);

    // Calculate risk level
    const riskLevel = this.promptManager.calculateRiskLevel(
      changeSummary.totalFiles,
      changeSummary.totalAdditions,
      changeSummary.totalDeletions,
      false
    );

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
  private parseReviewResult(review: string, diffFiles: DiffFile[]): ReviewResult {
    // Try to extract JSON from the review
    const jsonMatch = review.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (this.isValidReviewResult(parsed)) {
          return parsed;
        }
      } catch (error) {
        console.warn('Failed to parse JSON from review:', error);
      }
    }

    // Fallback: parse review text to extract verdict and issues
    return this.parseReviewText(review, diffFiles);
  }

  /**
   * Check if parsed object is a valid ReviewResult
   */
  private isValidReviewResult(obj: any): obj is ReviewResult {
    return (
      obj &&
      typeof obj === 'object' &&
      ['approved', 'approved-with-comments', 'changes-requested'].includes(obj.verdict) &&
      typeof obj.summary === 'string' &&
      Array.isArray(obj.issues) &&
      Array.isArray(obj.fileBreakdown)
    );
  }

  /**
   * Parse review text to extract structured information
   */
  private parseReviewText(review: string, diffFiles: DiffFile[]): ReviewResult {
    // Determine verdict based on keywords
    let verdict: 'approved' | 'approved-with-comments' | 'changes-requested' = 'approved-with-comments';

    if (
      review.toLowerCase().includes('approved') &&
      !review.toLowerCase().includes('changes requested')
    ) {
      verdict = 'approved';
    } else if (review.toLowerCase().includes('changes requested')) {
      verdict = 'changes-requested';
    }

    // Extract issues by severity
    const issues = this.extractIssues(review);

    // Create file breakdown
    const fileBreakdown = diffFiles.map((file) => ({
      filename: file.filename,
      status: (file.status === 'renamed' ? 'modified' : file.status) as 'added' | 'modified' | 'deleted',
      issues: issues.filter((issue) => !issue.file || issue.file === file.filename),
    }));

    return {
      verdict,
      summary: review.substring(0, 500), // Use first 500 chars as summary
      issues,
      fileBreakdown,
    };
  }

  /**
   * Extract issues from review text
   */
  private extractIssues(review: string): Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    file?: string;
    line?: number;
  }> {
    const issues = [];

    // Simple pattern matching for issues
    const severityPatterns = [
      { pattern: /critical|security|vulnerability/gi, severity: 'critical' as const },
      { pattern: /error|bug|issue|problem/gi, severity: 'high' as const },
      { pattern: /warning|concern|consider/gi, severity: 'medium' as const },
      { pattern: /suggestion|note|tip|improvement/gi, severity: 'low' as const },
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
