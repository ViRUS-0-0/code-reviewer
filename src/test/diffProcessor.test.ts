import * as assert from 'assert';
import { DiffProcessor, DiffFile, TechStack } from '../services/diffProcessor';
import { AntigravityProvider } from '../providers/antigravity';
import { GitService } from '../services/git';
import { ReviewOrchestrator, repairJsonString, autoCloseJson } from '../services/reviewOrchestrator';
import { AIProvider } from '../providers/types';

suite('DiffProcessor', () => {
  suite('parseDiff', () => {
    test('should parse simple diff with one file', () => {
      const diff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..abcdefg 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function hello() {
+  console.log('Hello');
   return 'world';
 }`;

      const files = DiffProcessor.parseDiff(diff);

      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].filename, 'src/index.ts');
      assert.strictEqual(files[0].status, 'modified');
      assert.strictEqual(files[0].additions, 1);
      assert.strictEqual(files[0].deletions, 0);
      assert.strictEqual(files[0].hunks.length, 1);
    });

    test('should parse diff with added file', () => {
      const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function test() {
+  return 'test';
+}`;

      const files = DiffProcessor.parseDiff(diff);

      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].filename, 'src/new.ts');
      assert.strictEqual(files[0].status, 'added');
      assert.strictEqual(files[0].additions, 3);
    });

    test('should parse diff with deleted file', () => {
      const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return 'old';
-}`;

      const files = DiffProcessor.parseDiff(diff);

      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].filename, 'src/old.ts');
      assert.strictEqual(files[0].status, 'deleted');
      assert.strictEqual(files[0].deletions, 3);
    });

    test('should parse diff with multiple files', () => {
      const diff = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1,2 @@
 export const a = 1;
+export const b = 2;
diff --git a/file2.ts b/file2.ts
index 7654321..fedcba9 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1 +0,0 @@
-export const c = 3;`;

      const files = DiffProcessor.parseDiff(diff);

      assert.strictEqual(files.length, 2);
      assert.strictEqual(files[0].filename, 'file1.ts');
      assert.strictEqual(files[1].filename, 'file2.ts');
    });

    test('should handle empty diff', () => {
      const files = DiffProcessor.parseDiff('');
      assert.strictEqual(files.length, 0);
    });
  });

  suite('detectTechStack', () => {
    test('should detect TypeScript', () => {
      const files: DiffFile[] = [
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.5,
        },
      ];

      const stack = DiffProcessor.detectTechStack(files);

      assert(stack.languages.has('TypeScript'));
    });

    test('should detect multiple languages', () => {
      const files: DiffFile[] = [
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.5,
        },
        {
          filename: 'styles/main.css',
          status: 'modified',
          additions: 20,
          deletions: 10,
          hunks: [],
          importance: 0.5,
        },
      ];

      const stack = DiffProcessor.detectTechStack(files);

      assert(stack.languages.has('TypeScript'));
      assert(stack.languages.has('CSS'));
    });

    test('should detect frameworks', () => {
      const files: DiffFile[] = [
        {
          filename: 'src/components/App.tsx',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.5,
        },
      ];

      const stack = DiffProcessor.detectTechStack(files);

      assert(stack.frameworks.has('React'));
    });

    test('should detect tools from config files', () => {
      const files: DiffFile[] = [
        {
          filename: 'package.json',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
          importance: 0.95,
        },
        {
          filename: 'Dockerfile',
          status: 'added',
          additions: 20,
          deletions: 0,
          hunks: [],
          importance: 0.85,
        },
      ];

      const stack = DiffProcessor.detectTechStack(files);

      assert(stack.tools.has('npm/yarn'));
      assert(stack.tools.has('Docker'));
    });
  });

  suite('selectImportantFiles', () => {
    test('should select files by importance', () => {
      const files: DiffFile[] = [
        {
          filename: 'README.md',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.4,
        },
        {
          filename: 'package.json',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
          importance: 0.95,
        },
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 50,
          deletions: 20,
          hunks: [],
          importance: 0.8,
        },
      ];

      const selected = DiffProcessor.selectImportantFiles(files, 2);

      assert.strictEqual(selected.length, 2);
      assert.strictEqual(selected[0].filename, 'package.json');
      assert.strictEqual(selected[1].filename, 'src/index.ts');
    });

    test('should respect max files limit', () => {
      const files: DiffFile[] = Array.from({ length: 20 }, (_, i) => ({
        filename: `file${i}.ts`,
        status: 'modified' as const,
        additions: 10,
        deletions: 5,
        hunks: [],
        importance: 0.5,
      }));

      const selected = DiffProcessor.selectImportantFiles(files, 5);

      assert.strictEqual(selected.length, 5);
    });

    test('should respect token budget', () => {
      const files: DiffFile[] = [
        {
          filename: 'large.ts',
          status: 'modified',
          additions: 10000,
          deletions: 5000,
          hunks: [],
          importance: 0.9,
        },
        {
          filename: 'small.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.5,
        },
      ];

      const selected = DiffProcessor.selectImportantFiles(files, 10, 1000);

      // Large file should be excluded due to token budget
      assert(selected.length <= 1);
    });
  });

  suite('generateChangeSummary', () => {
    test('should generate summary with correct totals', () => {
      const files: DiffFile[] = [
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.5,
        },
        {
          filename: 'src/utils.ts',
          status: 'added',
          additions: 20,
          deletions: 0,
          hunks: [],
          importance: 0.5,
        },
      ];

      const summary = DiffProcessor.generateChangeSummary(files);

      assert.strictEqual(summary.totalFiles, 2);
      assert.strictEqual(summary.totalAdditions, 30);
      assert.strictEqual(summary.totalDeletions, 5);
      assert(summary.summary.includes('1 modified'));
      assert(summary.summary.includes('1 added'));
    });

    test('should include tech stack in summary', () => {
      const files: DiffFile[] = [
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
          importance: 0.5,
        },
      ];

      const summary = DiffProcessor.generateChangeSummary(files);

      assert(summary.summary.includes('TypeScript'));
    });
  });

  suite('formatDiffForDisplay', () => {
    test('should format diff for display', () => {
      const files: DiffFile[] = [
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [
            {
              oldStart: 1,
              oldCount: 3,
              newStart: 1,
              newCount: 4,
              lines: [' line1', '+line2', ' line3'],
            },
          ],
          importance: 0.5,
        },
      ];

      const formatted = DiffProcessor.formatDiffForDisplay(files);

      assert(formatted.includes('src/index.ts'));
      assert(formatted.includes('modified'));
      assert(formatted.includes('+10'));
      assert(formatted.includes('-5'));
    });
  });
});

suite('AntigravityProvider', () => {
  test('should initialize with default settings', () => {
    const provider = new AntigravityProvider();
    assert.strictEqual(provider.name, 'Google Antigravity');
    assert.strictEqual(provider.model, 'auto');
  });

  test('should initialize with custom model preference', () => {
    const provider = new AntigravityProvider({ modelPreference: 'gemini-3.1-pro-high' });
    assert.strictEqual(provider.model, 'gemini-3.1-pro-high');
  });

  test('should map model preferences correctly', () => {
    const provider = new AntigravityProvider() as any;
    assert.strictEqual(provider.mapToAgyModel('pro'), 'gemini-3.1-pro-high');
    assert.strictEqual(provider.mapToAgyModel('flash'), 'gemini-3.8-flash-high');
    assert.strictEqual(provider.mapToAgyModel('gemini-3.8-flash'), 'gemini-3.8-flash-high');
    assert.strictEqual(provider.mapToAgyModel('gemini-3.1-pro'), 'gemini-3.1-pro-high');
    assert.strictEqual(provider.mapToAgyModel('claude-sonnet'), 'claude-sonnet-4-6');
    assert.strictEqual(provider.mapToAgyModel('opus'), 'claude-opus-4-6-thinking');
  });

  test('should resolve agy CLI path when installed', () => {
    const provider = new AntigravityProvider() as any;
    const resolvedPath = provider.resolveAgyCliPath();
    if (resolvedPath) {
      assert(resolvedPath.endsWith('agy'));
    }
  });
});

suite('Git Remote and Repo Resolution', () => {
  test('should parse various GitHub URL formats correctly', () => {
    const urls = [
      'git@github.com:fossasia/eventyay.git',
      'git@github.com:fossasia/eventyay',
      'https://github.com/fossasia/eventyay.git',
      'https://github.com/fossasia/eventyay',
      'https://user:token@github.com/fossasia/eventyay.git',
      'ssh://git@github.com/fossasia/eventyay.git',
    ];

    const regex = /(?:github\.com[:/])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;

    for (const url of urls) {
      const match = url.trim().match(regex);
      assert.ok(match, `Failed to match URL: ${url}`);
      assert.strictEqual(match[1], 'fossasia', `Owner mismatch for URL: ${url}`);
      assert.strictEqual(match[2].replace(/\.git$/, ''), 'eventyay', `Name mismatch for URL: ${url}`);
    }
  });

  test('GitService getRemoteUrl prioritizes upstream over origin', async () => {
    const gitService = new GitService('/tmp');
    (gitService as any).runGit = async (cmd: string) => {
      if (cmd === 'remote get-url upstream') {
        return 'https://github.com/fossasia/eventyay.git\n';
      }
      if (cmd === 'remote get-url origin') {
        return 'https://github.com/myfork/eventyay.git\n';
      }
      throw new Error('Command failed');
    };

    const url = await gitService.getRemoteUrl();
    assert.strictEqual(url, 'https://github.com/fossasia/eventyay.git');
  });

  test('GitService getRemoteUrl falls back to origin if upstream does not exist', async () => {
    const gitService = new GitService('/tmp');
    (gitService as any).runGit = async (cmd: string) => {
      if (cmd === 'remote get-url upstream') {
        throw new Error('fatal: No such remote "upstream"');
      }
      if (cmd === 'remote get-url origin') {
        return 'https://github.com/myfork/eventyay.git\n';
      }
      throw new Error('Command failed');
    };

    const url = await gitService.getRemoteUrl();
    assert.strictEqual(url, 'https://github.com/myfork/eventyay.git');
  });
});

suite('ReviewOrchestrator JSON Parsing & Repair', () => {
  const mockAiProvider: AIProvider = {
    name: 'Google Antigravity',
    model: 'gemini-3.1-pro-high',
    generateReview: async () => 'mock review'
  };

  const dummyFiles: DiffFile[] = [
    {
      filename: 'src/auth.ts',
      status: 'modified',
      additions: 10,
      deletions: 2,
      hunks: [],
      importance: 0.9
    }
  ];

  test('repairJsonString escapes literal newlines inside strings', () => {
    const raw = '{\n  "summary": "Line 1\nLine 2"\n}';
    const repaired = repairJsonString(raw);
    const parsed = JSON.parse(repaired);
    assert.strictEqual(parsed.summary, 'Line 1\nLine 2');
  });

  test('repairJsonString repairs unescaped double quotes inside currentCode and resolution', () => {
    const raw = `{\n  "issues": [\n    {\n      "title": "Bug",\n      "currentCode": "const x = "bad";",\n      "resolution": "Use 'bad'"\n    }\n  ]\n}`;
    const repaired = repairJsonString(raw);
    const parsed = JSON.parse(repaired);
    assert.strictEqual(parsed.issues[0].currentCode, 'const x = "bad";');
  });

  test('autoCloseJson closes unclosed brackets and braces in truncated JSON', () => {
    const truncated = '{"verdict": "changes-requested", "summary": "Truncated", "issues": [{"title": "Unfinished"';
    const closed = autoCloseJson(truncated);
    const parsed = JSON.parse(closed);
    assert.strictEqual(parsed.verdict, 'changes-requested');
    assert.strictEqual(parsed.issues[0].title, 'Unfinished');
  });

  test('parseReviewResult parses clean JSON and preserves currentCode and resolution', () => {
    const orchestrator = new ReviewOrchestrator('/tmp', mockAiProvider) as any;
    const cleanJson = JSON.stringify({
      verdict: 'changes-requested',
      summary: 'Found critical issue.',
      issues: [
        {
          severity: 'high',
          title: 'Null pointer risk',
          description: 'Token may be null',
          file: 'src/auth.ts',
          line: 42,
          currentCode: 'return user.token.trim();',
          resolution: 'Add optional chaining',
          updatedCode: 'return user.token?.trim();'
        }
      ],
      fileBreakdown: []
    });

    const result = orchestrator.parseReviewResult(cleanJson, dummyFiles);
    assert.strictEqual(result.verdict, 'changes-requested');
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].title, 'Null pointer risk');
    assert.strictEqual(result.issues[0].currentCode, 'return user.token.trim();');
    assert.strictEqual(result.issues[0].resolution, 'Add optional chaining');
    assert.strictEqual(result.issues[0].updatedCode, 'return user.token?.trim();');
  });

  test('parseReviewResult recovers from malformed JSON with unescaped newlines and quotes', () => {
    const orchestrator = new ReviewOrchestrator('/tmp', mockAiProvider) as any;
    // Malformed JSON with raw newlines inside currentCode
    const malformed = `\`\`\`json
{
  "verdict": "changes-requested",
  "summary": "Executive overview of changes.",
  "issues": [
    {
      "severity": "critical",
      "title": "SQL Injection",
      "description": "Unsanitized user input",
      "file": "src/auth.ts",
      "line": 88,
      "currentCode": "db.query("SELECT * FROM users WHERE id = " + id);",
      "resolution": "Use parameterized query",
      "updatedCode": "db.query('SELECT * FROM users WHERE id = $1', [id]);"
    }
  ]
}
\`\`\``;

    const result = orchestrator.parseReviewResult(malformed, dummyFiles);
    assert.strictEqual(result.verdict, 'changes-requested');
    assert.strictEqual(result.summary, 'Executive overview of changes.');
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].title, 'SQL Injection');
    assert.strictEqual(result.issues[0].severity, 'critical');
    assert.strictEqual(result.issues[0].file, 'src/auth.ts');
    assert.strictEqual(result.issues[0].line, 88);
    assert.ok(result.issues[0].currentCode);
    assert.ok(result.issues[0].resolution);
  });

  test('parseReviewText does NOT extract JSON syntax as issue titles', () => {
    const orchestrator = new ReviewOrchestrator('/tmp', mockAiProvider) as any;
    const jsonWithExtra = `Some preface text
{
  "verdict": "approved-with-comments",
  "summary": "A clean summary here.",
  "issues": [
    {
      "severity": "medium",
      "title": "Missing validation",
      "file": "src/auth.ts",
      "line": 12,
      "currentCode": "validate()",
      "resolution": "check errors"
    }
  ]
}`;

    const result = orchestrator.parseReviewResult(jsonWithExtra, dummyFiles);
    assert.strictEqual(result.verdict, 'approved-with-comments');
    assert.strictEqual(result.summary, 'A clean summary here.');
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].title, 'Missing validation');
    assert.notStrictEqual(result.issues[0].title, '"summary": "A clean summary here."');
  });
});

