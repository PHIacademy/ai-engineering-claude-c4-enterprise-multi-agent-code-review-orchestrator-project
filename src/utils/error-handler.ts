/**
 * Custom error class for review operations
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    Error.captureStackTrace(this, ReviewError);
  }
}

/**
 * Error codes for the review system
 */
export const ErrorCodes = {
  // Configuration errors
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // GitHub errors
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Agent errors
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',

  // General errors
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/** Sleep helper: wraps setTimeout in a Promise so it can be awaited. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry utility with exponential backoff
 *
 * Algorithm:
 * 1. Try to execute the function
 * 2. If it succeeds, return the result
 * 3. If it fails and retries remain:
 *    - Calculate backoff delay: delayMs * 2^(attempt - 1)
 *    - Add jitter (random 0-100ms) to prevent thundering herd
 *    - Wait for the calculated duration
 *    - Retry
 * 4. If all retries exhausted, throw ReviewError with RETRY_EXHAUSTED code
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param delayMs - Base delay in milliseconds (default: 1000)
 * @returns The result of the successful function execution
 * @throws ReviewError with RETRY_EXHAUSTED code if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Last attempt failed — nothing left to retry, so stop looping and
      // fall through to throw RETRY_EXHAUSTED below instead of sleeping
      // needlessly before giving up.
      if (attempt === maxRetries) {
        break;
      }

      const backoff = delayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 100;
      await sleep(backoff + jitter);
    }
  }

  throw new ReviewError(
    `Operation failed after ${maxRetries} attempt(s): ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
    ErrorCodes.RETRY_EXHAUSTED,
    {
      maxRetries,
      lastError: lastError instanceof Error ? lastError.message : String(lastError),
    }
  );
}

/**
 * Wrap an async function with timeout
 *
 * This function races the provided function against a timeout.
 * Whichever completes first wins.
 *
 * @param fn - Async function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message
 * @returns The result of the function if it completes before timeout
 * @throws ReviewError with AGENT_TIMEOUT code if timeout is reached
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new ReviewError(errorMessage, ErrorCodes.AGENT_TIMEOUT, { timeoutMs }));
    }, timeoutMs);
  });

  try {
    // Promise.race resolves/rejects as soon as the first of the two
    // promises settles — if fn() finishes first, its result wins; if the
    // timeout promise rejects first, that rejection wins instead.
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    // Always clear the timer so it doesn't keep the process alive or fire
    // after we've already returned via the fn() path.
    clearTimeout(timeoutHandle);
  }
}

/**
 * Check if an error is a ReviewError
 */
export function isReviewError(error: unknown): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Format error for logging/display
 */
export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}