import * as vscode from 'vscode';
import { AIProvider } from '../providers/types';
import { GitService } from './git';
import { GitHubService, PRDetails as GitHubPRDetails } from './githubService';
import { DiffProcessor, DiffFile, DiffHunk } from './diffProcessor';
import { PromptManager, ParsedFile, PRDetails, Issue } from './promptManager';
import { ReviewResult, ReviewIssue, FileReview } from '../webview/sidebarProvider';

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

export function repairJsonString(raw: string): string {
  // 1. Repair unescaped quotes inside known string property values
  const repaired = raw.replace(
    /"(currentCode|snippet|updatedCode|resolution|description|title|summary|copyableSummary)":\s*"([\s\S]*?)"(?=\s*,\s*"[a-zA-Z_]+":|\s*,\s*\}|\s*\}|\s*,\s*\{)/g,
    (_match, key, val) => {
      const escapedVal = val.replace(/(?<!\\)"/g, '\\"');
      return `"${key}": "${escapedVal}"`;
    }
  );

  // 2. Escape literal unescaped control characters inside quoted string literals
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
      } else if (ch === '\\') {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }
  }

  // 3. Strip trailing commas before closing braces or brackets
  out = out.replace(/,\s*([}\]])/g, '$1');

  return out;
}

export function autoCloseJson(str: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        stack.push(ch);
      } else if (ch === '}' && stack[stack.length - 1] === '{') {
        stack.pop();
      } else if (ch === ']' && stack[stack.length - 1] === '[') {
        stack.pop();
      }
    }
  }

  let res = str;
  if (inString) res += '"';
  res = res.replace(/,\s*$/, '');
  while (stack.length > 0) {
    const top = stack.pop();
    res += top === '{' ? '}' : ']';
  }
  return res;
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
      let diffFiles: DiffFile[] = [];
      let diff: string = '';

      if (source.type === 'pr' && source.prNumber && source.repo && this.githubService) {
        onProgress?.('Fetching PR files...');
        const [owner, repoName] = source.repo.split('/');
        const prFiles = await this.githubService.getPRFiles(owner, repoName, source.prNumber);
        
        diffFiles = prFiles.map(file => {
          // Parse the patch to get hunks if available
          let hunks: DiffHunk[] = [];
          if (file.patch) {
            // Create a dummy unified diff for this file to use the existing parser
            const fileDiff = `diff --git a/${file.filename} b/${file.filename}\n${file.patch}`;
            const parsed = DiffProcessor.parseDiff(fileDiff);
            if (parsed.length > 0) {
              hunks = parsed[0].hunks;
            }
          }

          return {
            filename: file.filename,
            status: (file.status === 'removed' ? 'deleted' : file.status) as any,
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
      } else {
        onProgress?.('Fetching diff...');
        diff = await this.fetchDiff(source);

        if (!diff || diff.trim().length === 0) {
          throw new Error('No changes detected to review');
        }

        onProgress?.('Parsing diff...');
        diffFiles = DiffProcessor.parseDiff(diff);
      }

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
    // Get PR details and linked issues if available
    let prDetails: PRDetails | undefined;
    let issues: Issue[] = [];
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
        } catch (issueError) {
          console.warn('Failed to fetch linked issues:', issueError);
        }
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
    const userMessage = this.promptManager.buildUserMessage(diff, parsedFiles, prDetails, issues);

    return { systemMessage, userMessage };
  }

  /**
   * Parse AI review result into structured format
   */
  private parseReviewResult(review: string, diffFiles: DiffFile[]): ReviewResult {
    const aiProviderName = this.aiProvider.name;
    const aiModelName = this.aiProvider.model;

    const hasJsonIndicators =
      review.includes('"verdict"') ||
      review.includes('"issues"') ||
      review.includes('"summary"') ||
      review.trim().startsWith('{');

    if (hasJsonIndicators) {
      // Clean outer markdown code blocks without breaking code fences inside string fields
      let cleanedReview = review.trim();
      const codeBlockMatch = cleanedReview.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch) {
        cleanedReview = codeBlockMatch[1].trim();
      } else {
        const firstBrace = cleanedReview.indexOf('{');
        const lastBrace = cleanedReview.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleanedReview = cleanedReview.substring(firstBrace, lastBrace + 1);
        }
      }

      let parsed: any;

      // Strategy 1: Direct JSON.parse
      try {
        parsed = JSON.parse(cleanedReview);
      } catch (err1) {
        // Strategy 2: Repaired & Sanitized JSON.parse
        try {
          parsed = JSON.parse(repairJsonString(cleanedReview));
        } catch (err2) {
          // Strategy 3: Auto-closed and repaired JSON.parse
          try {
            parsed = JSON.parse(autoCloseJson(repairJsonString(cleanedReview)));
          } catch (err3) {
            // Strategy 4: Raw review boundaries with auto-closing
            try {
              const first = review.indexOf('{');
              const last = review.lastIndexOf('}');
              if (first !== -1 && last !== -1 && last > first) {
                const sub = review.substring(first, last + 1);
                parsed = JSON.parse(autoCloseJson(repairJsonString(sub)));
              }
            } catch (err4) {
              // Ignore and fall through to regex extractor
            }
          }
        }
      }

      if (parsed && typeof parsed === 'object') {
        const rawVerdict = String(parsed.verdict || 'approved-with-comments').toLowerCase().replace(/_/g, '-');
        const verdict = (['approved', 'approved-with-comments', 'changes-requested'].includes(rawVerdict)
          ? rawVerdict
          : (rawVerdict.includes('change') || rawVerdict.includes('reject') ? 'changes-requested' : 'approved')) as any;

        parsed.verdict = verdict;
        parsed.summary = typeof parsed.summary === 'string' ? parsed.summary : '';
        parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
        parsed.fileBreakdown = Array.isArray(parsed.fileBreakdown) ? parsed.fileBreakdown : [];
        parsed.aiProvider = aiProviderName;
        parsed.aiModel = aiModelName;

        // Normalize issue fields
        parsed.issues = parsed.issues.map((issue: any) => {
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
        const aiFiles = new Set(parsed.fileBreakdown.map((f: any) => f.filename));
        const missingFiles = diffFiles.filter(df => !aiFiles.has(df.filename));

        if (missingFiles.length > 0) {
          const extraBreakdown = missingFiles.map(df => ({
            filename: df.filename,
            status: (df.status === 'renamed' ? 'modified' : df.status) as 'added' | 'modified' | 'deleted',
            summary: 'No specific issues identified for this file.'
          }));
          parsed.fileBreakdown.push(...extraBreakdown);
        }

        // Generate copyableSummary if missing
        if (!parsed.copyableSummary || String(parsed.copyableSummary).trim().length === 0) {
          parsed.copyableSummary = this.generateCopyableSummary(parsed);
        }

        return parsed as ReviewResult;
      }

      // Strategy 5: Robust regex extraction from JSON text
      console.warn('JSON.parse failed on review output, recovering fields with regex JSON extractor');
      const extracted = this.extractReviewFromJsonText(review, diffFiles);
      extracted.aiProvider = aiProviderName;
      extracted.aiModel = aiModelName;
      return extracted;
    }

    // Fallback: parse review text to extract verdict and issues
    const fallbackResult = this.parseReviewText(review, diffFiles);
    fallbackResult.aiProvider = aiProviderName;
    fallbackResult.aiModel = aiModelName;
    fallbackResult.copyableSummary = this.generateCopyableSummary(fallbackResult);
    return fallbackResult;
  }

  /**
   * Robust regex-based fallback extractor for JSON output
   */
  private extractReviewFromJsonText(text: string, diffFiles: DiffFile[]): ReviewResult {
    let verdict: 'approved' | 'approved-with-comments' | 'changes-requested' = 'approved-with-comments';
    const verdictMatch = text.match(/"verdict"\s*:\s*"([^"]+)"/i);
    if (verdictMatch) {
      const raw = verdictMatch[1].toLowerCase().replace(/_/g, '-');
      if (['approved', 'approved-with-comments', 'changes-requested'].includes(raw)) {
        verdict = raw as any;
      } else if (raw.includes('change') || raw.includes('reject')) {
        verdict = 'changes-requested';
      } else {
        verdict = 'approved';
      }
    }

    let summary = '';
    const summaryMatch = text.match(/"summary"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"(?:issues|copyableSummary|fileBreakdown)")/);
    if (summaryMatch) {
      summary = summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      const simpleSummary = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (simpleSummary) {
        summary = simpleSummary[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    }

    let copyableSummary = '';
    const copyMatch = text.match(/"copyableSummary"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"(?:issues|summary|fileBreakdown)")/);
    if (copyMatch) {
      copyableSummary = copyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }

    const issues: ReviewIssue[] = [];
    const issueBlockRegex = /\{[\s\S]*?(?=\}\s*,\s*\{|\}\s*\]|\}\s*$)/g;
    const issuesSection = text.match(/"issues"\s*:\s*\[([\s\S]*)/);
    const issuesText = issuesSection ? issuesSection[1] : text;

    let match: RegExpExecArray | null;
    while ((match = issueBlockRegex.exec(issuesText)) !== null) {
      const block = match[0] + '}';
      const getField = (field: string): string | undefined => {
        const m = block.match(new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,\\s*"[a-zA-Z_]+"|\\s*\\})`));
        if (m) {
          return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        return undefined;
      };

      const title = getField('title');
      if (!title || title.trim().length === 0) continue;

      const rawSeverity = (getField('severity') || 'medium').toLowerCase();
      const severity: 'critical' | 'high' | 'medium' | 'low' =
        (['critical', 'high', 'medium', 'low'].includes(rawSeverity) ? rawSeverity : 'medium') as any;

      const description = getField('description') || title;
      const file = getField('file');
      const lineMatch = block.match(/"line"\s*:\s*(\d+)/);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
      const currentCode = getField('currentCode') || getField('snippet');
      const resolution = getField('resolution');
      const updatedCode = getField('updatedCode');

      issues.push({
        severity,
        title,
        description,
        file,
        line,
        snippet: currentCode,
        currentCode,
        resolution,
        updatedCode
      });
    }

    const fileBreakdown: FileReview[] = diffFiles.map(df => ({
      filename: df.filename,
      status: (df.status === 'renamed' ? 'modified' : df.status) as any,
      summary: `Analyzed ${df.filename} (+${df.additions}/-${df.deletions})`
    }));

    const result: ReviewResult = {
      verdict,
      summary: summary || 'Completed automated code review.',
      copyableSummary,
      issues,
      fileBreakdown,
      aiProvider: this.aiProvider.name,
      aiModel: this.aiProvider.model
    };

    if (!result.copyableSummary || result.copyableSummary.trim().length === 0) {
      result.copyableSummary = this.generateCopyableSummary(result);
    }

    return result;
  }

  /**
   * Helper to generate a clean, copyable markdown summary of requested changes
   */
  private generateCopyableSummary(result: Partial<ReviewResult>): string {
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
  private isValidReviewResult(obj: any): obj is ReviewResult {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.summary === 'string' &&
      Array.isArray(obj.issues) &&
      Array.isArray(obj.fileBreakdown)
    );
  }

  /**
   * Parse review text to extract structured information
   */
  private parseReviewText(review: string, diffFiles: DiffFile[]): ReviewResult {
    // If the review appears to contain JSON, delegate to JSON recovery
    if (review.includes('"verdict"') || review.includes('"issues"') || review.trim().startsWith('{')) {
      return this.extractReviewFromJsonText(review, diffFiles);
    }

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

    // Extract structured issues from review text
    const issues = this.extractIssues(review);

    // Create file breakdown
    const fileBreakdown = diffFiles.map((file) => ({
      filename: file.filename,
      status: (file.status === 'renamed' ? 'modified' : file.status) as 'added' | 'modified' | 'deleted',
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
  private extractIssues(review: string): Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    file?: string;
    line?: number;
    snippet?: string;
    currentCode?: string;
    resolution?: string;
    updatedCode?: string;
  }> {
    const issues: Array<{
      severity: 'critical' | 'high' | 'medium' | 'low';
      title: string;
      description: string;
      file?: string;
      line?: number;
      snippet?: string;
      currentCode?: string;
      resolution?: string;
      updatedCode?: string;
    }> = [];

    // Split review by block headers (e.g., File:, Issue:, or numbered issues)
    const blocks = review.split(/(?:^|\n)(?=(?:File:\s*|Issue:\s*|\d+\.\s+\*\*|###?\s+Issue))/i);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const fileMatch = block.match(/File:\s*([^\n:]+)(?::(\d+))?/i);
      const issueMatch = block.match(/(?:Issue|Finding|Problem):\s*([^\n]+)/i) || block.match(/^\s*(?:\d+\.\s+)?\*\*([^*]+)\*\*/m);
      if (!issueMatch) continue;

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
      let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      const lowerText = (title + ' ' + (resolution || '')).toLowerCase();
      if (lowerText.includes('critical') || lowerText.includes('security') || lowerText.includes('vulnerability')) {
        severity = 'critical';
      } else if (lowerText.includes('error') || lowerText.includes('bug') || lowerText.includes('failure')) {
        severity = 'high';
      } else if (lowerText.includes('suggestion') || lowerText.includes('style') || lowerText.includes('nit')) {
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

    // If structured blocks were not found, fall back to line matching (only for genuine plain text)
    if (issues.length === 0) {
      const severityPatterns = [
        { pattern: /critical|security|vulnerability/gi, severity: 'critical' as const },
        { pattern: /error|bug|issue|problem/gi, severity: 'high' as const },
        { pattern: /warning|concern|consider/gi, severity: 'medium' as const },
        { pattern: /suggestion|note|tip|improvement/gi, severity: 'low' as const },
      ];

      const lines = review.split('\n');
      for (const line of lines) {
        // Skip JSON syntax lines
        if (/^\s*["{}\[\],]/.test(line) || /^\s*"[a-zA-Z_]+"\s*:/.test(line)) {
          continue;
        }

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
