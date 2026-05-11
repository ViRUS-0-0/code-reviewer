import * as assert from 'assert';
import { DiffProcessor, DiffFile, TechStack } from '../services/diffProcessor';

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
