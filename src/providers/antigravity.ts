import type * as vscodeTypes from 'vscode';
let vscode: typeof vscodeTypes | undefined;
try {
  vscode = require('vscode');
} catch {
  // Running outside VS Code extension host (e.g. unit tests or CLI)
}
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import OpenAI from 'openai';
import { AIProvider } from './types';

export interface AntigravityProviderOptions {
  modelPreference?: string;
  endpoint?: string;
  apiKey?: string;
  cliPath?: string;
}

/**
 * Antigravity AI Provider
 * Supports:
 * 1. Local Antigravity CLI (`agy`) using user's active Pro plan credentials
 * 2. In-editor Language Model Chat API (`vscode.lm`) when available
 * 3. Custom/local HTTP OpenAI-compatible endpoints
 */
export class AntigravityProvider implements AIProvider {
  public name = 'Google Antigravity';
  public model = 'auto';
  private endpoint?: string;
  private apiKey?: string;
  private cliPath?: string;
  private modelPreference?: string;

  constructor(options: AntigravityProviderOptions = {}) {
    this.modelPreference = options.modelPreference?.trim();
    this.endpoint = options.endpoint?.trim();
    this.apiKey = options.apiKey?.trim();
    this.cliPath = options.cliPath?.trim();

    if (this.modelPreference && this.modelPreference !== 'auto') {
      this.model = this.modelPreference;
    }
  }

  async generateReview(userMessage: string, systemMessage?: string): Promise<string> {
    // 1. If a custom HTTP endpoint is explicitly configured, use it
    if (this.endpoint) {
      return this.generateViaEndpoint(userMessage, systemMessage);
    }

    // 2. Prioritize local Antigravity CLI (`agy`) using user's active Pro credentials
    const resolvedCli = this.resolveAgyCliPath();
    if (this.cliPath && !resolvedCli) {
      throw new Error(`Configured Antigravity CLI path does not exist: ${this.cliPath}`);
    }
    if (resolvedCli) {
      return this.generateViaCLI(resolvedCli, userMessage, systemMessage);
    }

    // 3. Fallback: If running inside an IDE where vscode.lm provides an explicit Antigravity/Gemini model, use it
    const lmModel = await this.findAntigravityLMModel();
    if (lmModel) {
      return this.generateViaLM(lmModel, userMessage, systemMessage);
    }

    // 4. If nothing found, provide clear and actionable diagnostic guidance
    throw new Error(
      'Could not connect to Google Antigravity.\n' +
      '1. Verify Antigravity CLI (`agy`) is installed in ~/.local/bin/agy or on PATH.\n' +
      '2. Or configure `code-review.antigravityCliPath` / `code-review.antigravityEndpoint` in VS Code settings.'
    );
  }

  /**
   * Discovers whether vscode.lm has an actual Antigravity / Google model
   */
  private async findAntigravityLMModel(): Promise<vscodeTypes.LanguageModelChat | undefined> {
    if (!vscode?.lm) return undefined;
    try {
      if (this.modelPreference && this.modelPreference !== 'auto' && this.modelPreference !== 'default') {
        const preferred = await vscode.lm.selectChatModels({ family: this.modelPreference });
        if (preferred && preferred.length > 0) return preferred[0];
      }

      const agModels = await vscode.lm.selectChatModels({ vendor: 'antigravity' });
      if (agModels && agModels.length > 0) return agModels[0];

      const googleModels = await vscode.lm.selectChatModels({ vendor: 'google' });
      if (googleModels && googleModels.length > 0) return googleModels[0];

      const geminiModels = await vscode.lm.selectChatModels({ family: 'gemini' });
      if (geminiModels && geminiModels.length > 0) return geminiModels[0];
    } catch (e) {
      console.warn('Failed to query vscode.lm for Antigravity models:', e);
    }
    return undefined;
  }

  /**
   * Generates review using vscode.lm API
   */
  private async generateViaLM(
    model: vscodeTypes.LanguageModelChat,
    userMessage: string,
    systemMessage?: string
  ): Promise<string> {
    if (!vscode?.LanguageModelChatMessage || !vscode?.CancellationTokenSource) {
      throw new Error('vscode.lm API is not available in current environment.');
    }

    try {
      this.model = model.id || model.family || this.model;
      console.log(`Using Antigravity in-editor model: ${this.model} (${model.family} by ${model.vendor})`);

      const fullPrompt = systemMessage
        ? `SYSTEM INSTRUCTIONS:\n${systemMessage}\n\nUSER REQUEST:\n${userMessage}`
        : userMessage;

      const messages: vscodeTypes.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(fullPrompt),
      ];

      const cancellationTokenSource = new vscode.CancellationTokenSource();
      try {
        const response = await model.sendRequest(
          messages,
          {
            justification: 'Generate a code review for changes in the workspace using Antigravity.',
          },
          cancellationTokenSource.token
        );

        let result = '';
        for await (const fragment of response.text) {
          result += fragment;
        }

        if (!result || result.trim().length === 0) {
          throw new Error('Antigravity model returned an empty response.');
        }

        return result;
      } finally {
        cancellationTokenSource.dispose();
      }
    } catch (error: any) {
      console.error('Error in AntigravityProvider (vscode.lm):', error);
      if (vscode?.LanguageModelError && error instanceof vscode.LanguageModelError) {
        throw new Error(`Antigravity Language Model Error (${error.code}): ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Finds the path to the agy CLI binary across standard dirs and PATH
   */
  private resolveAgyCliPath(): string | undefined {
    if (this.cliPath && fs.existsSync(this.cliPath)) {
      return this.cliPath;
    }

    const exeNames = process.platform === 'win32'
      ? ['agy.exe', 'agy.cmd', 'agy.bat', 'agy']
      : ['agy'];

    const standardDirs = [
      path.join(os.homedir(), '.local', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(os.homedir(), 'bin'),
    ];

    for (const dir of standardDirs) {
      for (const exe of exeNames) {
        const candidate = path.join(dir, exe);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    // Traverse directories in PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const exe of exeNames) {
        const candidate = path.join(dir, exe);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return undefined;
  }

  /**
   * Maps preference strings to valid Antigravity CLI models
   */
  private mapToAgyModel(preference?: string): string {
    const pref = (preference || 'auto').toLowerCase().trim();
    if (pref === 'auto' || pref === 'default' || !pref) {
      return 'gemini-3.8-flash-high';
    }

    if (pref === 'gemini-3.8-flash-high' || (pref.includes('3.8') && pref.includes('flash'))) return 'gemini-3.8-flash-high';
    if (pref === 'gemini-3.1-pro-high' || (pref.includes('3.1') && pref.includes('pro'))) return 'gemini-3.1-pro-high';
    if (pref.includes('3.7')) return 'gemini-3.7-flash-high';
    if (pref.includes('3.6')) return 'gemini-3.6-flash-high';
    if (pref === 'pro' || pref === 'gemini-pro') return 'gemini-3.1-pro-high';
    if (pref === 'flash' || pref === 'gemini-flash') return 'gemini-3.8-flash-high';
    if (pref.includes('sonnet')) return 'claude-sonnet-4-6';
    if (pref.includes('opus')) return 'claude-opus-4-6-thinking';
    if (pref.includes('120b') || pref.includes('oss')) return 'gpt-oss-120b-medium';

    return pref;
  }

  /**
   * Generates review by spawning the local agy CLI with the user's Pro plan
   */
  private async generateViaCLI(
    cliPath: string,
    userMessage: string,
    systemMessage?: string
  ): Promise<string> {
    const modelToUse = this.mapToAgyModel(this.modelPreference);
    this.model = modelToUse;
    console.log(`Executing Antigravity CLI at ${cliPath} with model ${modelToUse}...`);

    let fullPrompt = systemMessage
      ? `SYSTEM INSTRUCTIONS (Respond directly with pure JSON review. Do not run any tools):\n${systemMessage}\n\nUSER REQUEST:\n${userMessage}`
      : `Respond directly with pure JSON review. Do not run any tools.\n\n${userMessage}`;

    // Buffer safety check for OS argument length (ARG_MAX / E2BIG safety)
    const maxArgLength = process.platform === 'win32' ? 28000 : 120000;
    if (fullPrompt.length > maxArgLength) {
      fullPrompt = fullPrompt.substring(0, maxArgLength) + '\n\n... [Diff truncated to satisfy OS argument buffer limits]';
    }

    return new Promise<string>((resolve, reject) => {
      const args = [
        '--disable-slash-commands',
        '--dangerously-skip-permissions',
        '--output-format=text',
        `--model=${modelToUse}`,
        `--print=${fullPrompt}`
      ];

      const cliDir = path.dirname(cliPath);
      const extraPaths = [cliDir, '/usr/local/bin', '/opt/homebrew/bin'];
      const currentPath = process.env.PATH || '';
      const env = {
        ...process.env,
        PATH: [...extraPaths, currentPath].filter(Boolean).join(path.delimiter)
      };

      const cwd = vscode?.workspace?.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
      const child = spawn(cliPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let isSettled = false;

      // 3-minute execution timeout to avoid hanging review notifications indefinitely
      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          child.kill('SIGTERM');
          reject(new Error('Antigravity CLI timed out after 180 seconds.'));
        }
      }, 180000);


      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const finish = (code: number | null) => {
        clearTimeout(timer);
        if (isSettled) return;
        isSettled = true;

        if (code === 0 || (!code && stdout.trim().length > 0)) {
          if (!stdout || stdout.trim().length === 0) {
            reject(new Error('Antigravity CLI returned an empty response.'));
          } else {
            resolve(stdout);
          }
        } else {
          const errDetail = stderr.trim() || stdout.trim() || `exit code ${code}`;
          reject(new Error(`Antigravity CLI failed (${errDetail})`));
        }
      };

      child.on('exit', (code) => finish(code));
      child.on('close', (code) => finish(code));

      child.on('error', (err) => {
        clearTimeout(timer);
        if (isSettled) return;
        isSettled = true;
        reject(new Error(`Failed to spawn Antigravity CLI (${cliPath}): ${err.message}`));
      });
    });
  }

  /**
   * Generates review using custom HTTP OpenAI-compatible endpoint
   */
  private async generateViaEndpoint(userMessage: string, systemMessage?: string): Promise<string> {
    try {
      let normalizedBaseUrl = this.endpoint!;
      if (!normalizedBaseUrl.endsWith('/v1') && !normalizedBaseUrl.endsWith('/v1/')) {
        normalizedBaseUrl = normalizedBaseUrl.endsWith('/')
          ? `${normalizedBaseUrl}v1`
          : `${normalizedBaseUrl}/v1`;
      }

      const client = new OpenAI({
        baseURL: normalizedBaseUrl,
        apiKey: this.apiKey || 'antigravity',
      });

      const modelName =
        this.modelPreference &&
        this.modelPreference !== 'auto' &&
        this.modelPreference !== 'default'
          ? this.modelPreference
          : 'gemini-3.8-flash-high';

      this.model = modelName;

      const response = await client.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: systemMessage || 'You are an expert code reviewer performing a thorough code review.',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      });

      return response.choices[0]?.message?.content || 'No review generated.';
    } catch (error: any) {
      throw new Error(`Antigravity endpoint review generation failed: ${error.message}`);
    }
  }
}
