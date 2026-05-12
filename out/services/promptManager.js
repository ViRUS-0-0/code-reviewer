"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptManager = void 0;
const reviewInstructions_1 = require("../constants/reviewInstructions");
/**
 * PromptManager handles building system and user prompts for code reviews
 */
class PromptManager {
    /**
     * Build a comprehensive system prompt with review instructions and context
     */
    buildSystemPrompt(techStack, context) {
        const parts = [reviewInstructions_1.REVIEW_INSTRUCTIONS];
        // Add tech stack information
        if (techStack) {
            parts.push(`\n## Technology Stack Context\nThe code being reviewed uses: ${techStack}`);
        }
        // Add file change statistics
        if (context?.fileStats) {
            const stats = context.fileStats;
            parts.push(`\n## Change Statistics\n` +
                `- Total files affected: ${stats.totalFiles}\n` +
                `- Total additions: ${stats.totalAdditions} lines\n` +
                `- Total deletions: ${stats.totalDeletions} lines`);
        }
        // Add risk level assessment
        if (context?.riskLevel) {
            const riskDescription = this.getRiskLevelDescription(context.riskLevel);
            parts.push(`\n## Risk Level Assessment\n${riskDescription}`);
        }
        return parts.join('\n');
    }
    /**
     * Build a comprehensive user message with PR details and diff
     */
    buildUserMessage(diff, files, prDetails, issues) {
        const parts = [];
        // Add PR title and description
        if (prDetails?.title) {
            parts.push(`## Pull Request: ${prDetails.title}`);
        }
        if (prDetails?.description) {
            parts.push(`\n### Description\n${prDetails.description}`);
        }
        if (prDetails?.author) {
            parts.push(`\n### Author\n${prDetails.author}`);
        }
        // Add linked GitHub issues
        if (issues && issues.length > 0) {
            parts.push('\n### Linked Issues (Requirements)');
            for (const issue of issues) {
                const issueLink = issue.url ? `[#${issue.number}](${issue.url})` : `#${issue.number}`;
                parts.push(`- **${issueLink}: ${issue.title}**`);
                if (issue.body) {
                    parts.push(`\n**Requirement Details for #${issue.number}:**\n${issue.body}\n`);
                }
            }
        }
        // Add affected files list
        if (files && files.length > 0) {
            parts.push('\n### Affected Files');
            for (const file of files) {
                const changes = `+${file.additions}/-${file.deletions}`;
                parts.push(`- **${file.filename}** (${file.status}) ${changes}`);
            }
        }
        // Add the full diff with clear markers
        parts.push('\n### Code Changes\n');
        parts.push('The following is a unified diff showing the changes. Lines starting with "-" are removed, and lines starting with "+" are added. Hunk headers (@@ -start,len +start,len @@) provide line number context.');
        parts.push('```diff\n' + diff + '\n```');
        // Add review request
        parts.push('\n---\n' +
            '### Review Instructions\n' +
            'Please perform a thorough code review. **Crucially, you must evaluate EVERY file listed in the "Affected Files" section above.**\n\n' +
            'For each file:\n' +
            '1. Identify potential bugs, logic errors, or security vulnerabilities.\n' +
            '2. Suggest performance optimizations or better patterns where applicable.\n' +
            '3. In your response, ensure the "fileBreakdown" array contains an entry for every single file mentioned, even if only to say "No issues found".\n\n' +
            'Be specific about which files and line numbers you are referring to.');
        return parts.join('\n');
    }
    /**
     * Build the full prompt combining system and user messages
     * This is useful for providers that need a single prompt string
     */
    buildFullPrompt(systemMessage, userMessage) {
        return `${systemMessage}\n\n---\n\n${userMessage}`;
    }
    /**
     * Get a description of the risk level
     */
    getRiskLevelDescription(riskLevel) {
        const descriptions = {
            low: 'Low Risk: Changes are minimal, well-tested, and have limited impact on core functionality.',
            medium: 'Medium Risk: Changes affect important functionality or have moderate scope. Careful review recommended.',
            high: 'High Risk: Changes affect critical functionality, security, or have significant scope. Thorough review required.',
        };
        return descriptions[riskLevel] || 'Unknown risk level';
    }
    /**
     * Calculate risk level based on change statistics
     */
    calculateRiskLevel(totalFiles, totalAdditions, totalDeletions, affectsSecurityOrCore = false) {
        // High risk if affects security/core or large changes
        if (affectsSecurityOrCore || totalAdditions > 500 || totalDeletions > 500) {
            return 'high';
        }
        // Medium risk if moderate changes
        if (totalFiles > 5 || totalAdditions > 100 || totalDeletions > 100) {
            return 'medium';
        }
        // Low risk for small changes
        return 'low';
    }
    /**
     * Format tech stack for display
     */
    formatTechStack(techStack) {
        const parts = [];
        if (techStack.languages && techStack.languages.size > 0) {
            parts.push(`Languages: ${Array.from(techStack.languages).join(', ')}`);
        }
        if (techStack.frameworks && techStack.frameworks.size > 0) {
            parts.push(`Frameworks: ${Array.from(techStack.frameworks).join(', ')}`);
        }
        if (techStack.tools && techStack.tools.size > 0) {
            parts.push(`Tools: ${Array.from(techStack.tools).join(', ')}`);
        }
        return parts.join(' | ') || 'Unknown tech stack';
    }
}
exports.PromptManager = PromptManager;
//# sourceMappingURL=promptManager.js.map