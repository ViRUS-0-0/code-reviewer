/**
 * Utility functions for safely handling and converting errors
 * Prevents strict mode errors when accessing error properties
 */

/**
 * Convert an error object to a plain error message string
 * Safely handles axios errors and other error types
 */
export function extractErrorMessage(error: any): string {
  try {
    // Handle axios errors
    if (error && typeof error === 'object' && 'response' in error) {
      if (error.response?.data?.message) {
        return error.response.data.message;
      }
      if (error.response?.statusText) {
        return `${error.response.status}: ${error.response.statusText}`;
      }
    }

    // Handle Error objects
    if (error instanceof Error) {
      return error.message;
    }

    // Handle strings
    if (typeof error === 'string') {
      return error;
    }

    // Fallback for other types
    return String(error);
  } catch {
    return 'Unknown error occurred';
  }
}

/**
 * Create a safe error object from any error type
 * Prevents strict mode violations when accessing error properties
 */
export class SafeError extends Error {
  public readonly originalError: any;
  public readonly statusCode?: number;
  public readonly details?: string;

  constructor(message: string, originalError?: any, statusCode?: number) {
    super(message);
    this.name = 'SafeError';
    this.originalError = originalError;
    this.statusCode = statusCode;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SafeError);
    }

    // Extract additional details from axios errors
    if (originalError?.response?.data) {
      try {
        this.details = JSON.stringify(originalError.response.data);
      } catch {
        this.details = String(originalError.response.data);
      }
    }
  }
}

/**
 * Wrap async functions to catch and convert errors safely
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  errorContext: string = 'Operation failed'
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const message = extractErrorMessage(error);
    const statusCode = error?.response?.status;
    throw new SafeError(`${errorContext}: ${message}`, error, statusCode);
  }
}
