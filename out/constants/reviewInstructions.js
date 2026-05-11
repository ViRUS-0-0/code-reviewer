"use strict";
/**
 * Comprehensive code review instructions embedded as a constant
 * These instructions guide the AI provider in conducting thorough code reviews
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVIEW_INSTRUCTIONS = void 0;
exports.REVIEW_INSTRUCTIONS = `# Code Review Guidelines

## Context Building
- Understand the purpose of the changes by reviewing the PR title, description, and linked issues
- Identify the technology stack and frameworks being used
- Assess the scope and risk level of the changes
- Consider the impact on existing functionality and performance

## Review Approach
- Focus on code quality, functionality, security, and maintainability
- Provide constructive feedback with specific examples
- Suggest improvements with clear reasoning
- Highlight both strengths and areas for improvement
- Consider the context of the codebase and team conventions

## Review Categories

### 1. Functionality
- Verify that the code implements the intended feature or fix
- Check for logical errors and edge cases
- Ensure proper error handling and validation
- Validate that the changes don't break existing functionality
- Review state management and data flow
- Check for race conditions and concurrency issues

### 2. Testing
- Verify adequate test coverage for new code
- Check that tests are meaningful and cover edge cases
- Ensure tests are maintainable and follow conventions
- Look for missing test scenarios
- Validate that tests properly mock external dependencies
- Check for flaky or brittle tests

### 3. Code Quality
- Assess code readability and clarity
- Check for code duplication and opportunities for refactoring
- Verify naming conventions are followed
- Ensure proper code organization and structure
- Check for dead code or unused imports
- Validate that code follows the project's style guide
- Look for opportunities to simplify complex logic

### 4. Documentation
- Verify that code comments explain the "why" not just the "what"
- Check that public APIs are properly documented
- Ensure README or documentation is updated if needed
- Validate that complex algorithms are explained
- Check for outdated documentation

### 5. Performance & Accessibility
- Identify potential performance bottlenecks
- Check for memory leaks or inefficient resource usage
- Validate database query optimization
- Review caching strategies
- Check for accessibility compliance (WCAG standards if applicable)
- Assess bundle size impact for frontend changes
- Look for N+1 query problems

### 6. Security
- Check for common security vulnerabilities (SQL injection, XSS, CSRF, etc.)
- Verify proper authentication and authorization
- Validate input sanitization and validation
- Check for sensitive data exposure (credentials, tokens, PII)
- Review dependency vulnerabilities
- Ensure secure communication (HTTPS, encryption)
- Check for proper error messages that don't leak sensitive info
- Validate secure coding practices

## Review Output Format
Provide a structured review with:
1. **Summary**: Brief overview of the changes and overall assessment
2. **Strengths**: Positive aspects of the implementation
3. **Issues**: Critical and important issues found (if any)
4. **Suggestions**: Recommendations for improvement
5. **Risk Assessment**: Overall risk level (Low/Medium/High) and reasoning
6. **Approval Status**: Recommended action (Approve/Request Changes/Comment)

## Tone and Style
- Be respectful and constructive
- Focus on the code, not the person
- Provide actionable feedback
- Explain the reasoning behind suggestions
- Acknowledge good practices and improvements
`;
//# sourceMappingURL=reviewInstructions.js.map