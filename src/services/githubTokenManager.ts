import * as vscode from 'vscode';
import axios from 'axios';

/**
 * Manages GitHub token storage and validation using VS Code's SecretStorage API
 */
export class GitHubTokenManager {
  private static readonly TOKEN_KEY = 'github.token';
  private static readonly GITHUB_API_URL = 'https://api.github.com';
  private static readonly TOKEN_VALIDATION_TIMEOUT = 5000; // 5 seconds

  constructor(private secretStorage: vscode.SecretStorage) {}

  /**
   * Store a GitHub token securely
   * @param token The GitHub personal access token
   * @throws Error if token is empty or invalid
   */
  async storeToken(token: string): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new Error('Token cannot be empty');
    }

    try {
      await this.secretStorage.store(GitHubTokenManager.TOKEN_KEY, token.trim());
      console.log('GitHub token stored successfully');
    } catch (error) {
      throw new Error(`Failed to store GitHub token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieve the stored GitHub token
   * @returns The stored token or null if not found
   */
  async getToken(): Promise<string | null> {
    try {
      const configToken = vscode.workspace.getConfiguration('code-review').get<string>('githubToken');
      if (configToken && configToken.trim().length > 0) {
        return configToken.trim();
      }

      const token = await this.secretStorage.get(GitHubTokenManager.TOKEN_KEY);
      return token || null;
    } catch (error) {
      console.error('Failed to retrieve GitHub token:', error);
      return null;
    }
  }

  /**
   * Clear the stored GitHub token
   */
  async clearToken(): Promise<void> {
    try {
      await this.secretStorage.delete(GitHubTokenManager.TOKEN_KEY);
      console.log('GitHub token cleared successfully');
    } catch (error) {
      throw new Error(`Failed to clear GitHub token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate a GitHub token by calling the GitHub API
   * @param token The token to validate
   * @returns true if valid, false otherwise
   */
  async validateToken(token: string): Promise<boolean> {
    if (!token || token.trim().length === 0) {
      return false;
    }

    try {
      const response = await axios.get(`${GitHubTokenManager.GITHUB_API_URL}/user`, {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: GitHubTokenManager.TOKEN_VALIDATION_TIMEOUT,
      });

      return response.status === 200 && response.data && response.data.login;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          console.warn('GitHub token validation failed: Unauthorized (401)');
        } else if (error.response?.status === 403) {
          console.warn('GitHub token validation failed: Forbidden (403)');
        } else {
          console.warn(`GitHub token validation failed: ${error.message}`);
        }
      }
      return false;
    }
  }

  /**
   * Ensure a valid GitHub token is available, prompting user if needed
   * @returns The valid token
   * @throws Error if no valid token is available or user cancels
   */
  async ensureToken(): Promise<string> {
    // Try to get existing token
    let token = await this.getToken();

    if (token) {
      // Validate existing token
      const isValid = await this.validateToken(token);
      if (isValid) {
        return token;
      }
      console.warn('Stored GitHub token is invalid, prompting for new token');
    }

    // Prompt user for token
    const newToken = await vscode.window.showInputBox({
      prompt: 'Enter your GitHub Personal Access Token',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'ghp_...',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Token cannot be empty';
        }
        if (!value.startsWith('ghp_') && !value.startsWith('github_pat_')) {
          return 'Invalid token format. GitHub tokens typically start with ghp_ or github_pat_';
        }
        return null;
      },
    });

    if (!newToken) {
      throw new Error('GitHub token is required but was not provided');
    }

    // Validate the new token
    const isValid = await this.validateToken(newToken);
    if (!isValid) {
      throw new Error('The provided GitHub token is invalid. Please check your token and try again.');
    }

    // Store the valid token
    await this.storeToken(newToken);
    return newToken;
  }

  /**
   * Get the current user's login from the stored token
   * @returns The GitHub username or null if token is invalid
   */
  async getCurrentUser(): Promise<string | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }

    try {
      const response = await axios.get(`${GitHubTokenManager.GITHUB_API_URL}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: GitHubTokenManager.TOKEN_VALIDATION_TIMEOUT,
      });

      return response.data?.login || null;
    } catch (error) {
      console.error('Failed to get current user:', error);
      return null;
    }
  }
}
