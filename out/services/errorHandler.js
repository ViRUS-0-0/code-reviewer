"use strict";
/**
 * Utility functions for safely handling and converting errors
 * Prevents strict mode errors when accessing error properties
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeExecute = exports.SafeError = exports.extractErrorMessage = void 0;
/**
 * Convert an error object to a plain error message string
 * Safely handles axios errors and other error types
 */
function extractErrorMessage(error) {
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
    }
    catch {
        return 'Unknown error occurred';
    }
}
exports.extractErrorMessage = extractErrorMessage;
/**
 * Create a safe error object from any error type
 * Prevents strict mode violations when accessing error properties
 */
class SafeError extends Error {
    constructor(message, originalError, statusCode) {
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
            }
            catch {
                this.details = String(originalError.response.data);
            }
        }
    }
}
exports.SafeError = SafeError;
/**
 * Wrap async functions to catch and convert errors safely
 */
async function safeExecute(fn, errorContext = 'Operation failed') {
    try {
        return await fn();
    }
    catch (error) {
        const message = extractErrorMessage(error);
        const statusCode = error?.response?.status;
        throw new SafeError(`${errorContext}: ${message}`, error, statusCode);
    }
}
exports.safeExecute = safeExecute;
//# sourceMappingURL=errorHandler.js.map