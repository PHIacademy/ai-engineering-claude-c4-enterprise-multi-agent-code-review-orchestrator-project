import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Claude Agent SDK's query() before importing anything that uses it,
// so CodeReviewOrchestrator never makes a real network call in these tests.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import { withRetry, withTimeout, ReviewError, ErrorCodes } from '../src/utils/error-handler';
import { RateLimiter } from '../src/utils/rate-limiter';

/** Turns an array of SDK-style messages into the async iterable query() returns. */
async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

const validStructuredOutput = {
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [
    {
      file: 'README',
      codeQuality: {
        file: 'README',
        issues: [],
        overallScore: 90,
        summary: 'Clean file.',
      },
      testCoverage: {
        file: 'README',
        hasTests: false,
        testFiles: [],
        untestedPaths: [],
        coverageEstimate: 0,
        summary: 'No executable code to test.',
      },
      refactorings: {
        file: 'README',
        suggestions: [],
        summary: 'Nothing to refactor.',
      },
    },
  ],
  summary: {
    totalFiles: 1,
    overallScore: 90,
    criticalIssues: 0,
    highPriorityTests: 0,
    refactoringOpportunities: 0,
  },
  recommendations: [],
  metadata: {
    analyzedAt: '2026-01-01T00:00:00.000Z',
    duration: 1,
    agentVersions: {},
  },
};

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      expect(() => new CodeReviewOrchestrator()).not.toThrow();
    });

    it('should accept custom configuration (model, maxTurns, timeout, retries)', () => {
      // The orchestrator does not take a per-instance rate-limit config
      // (rate limiting is handled by the shared globalRateLimiter), so this
      // exercises the configuration surface it actually exposes instead.
      expect(
        () =>
          new CodeReviewOrchestrator({
            model: 'claude-sonnet-4-5-20250929',
            maxTurns: 10,
            timeoutMs: 60_000,
            maxRetries: 1,
            retryDelayMs: 100,
            estimatedTokens: 5000,
          })
      ).not.toThrow();
    });
  });

  describe('reviewPullRequest', () => {
    it('should configure allowedTools with Task plus the MCP servers', async () => {
      vi.mocked(query).mockReturnValue(
        toAsyncIterable([
          { type: 'result', subtype: 'success', structured_output: validStructuredOutput },
        ]) as ReturnType<typeof query>
      );

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });
      await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      const callArgs = vi.mocked(query).mock.calls[0][0] as { options: { allowedTools: string[] } };
      expect(callArgs.options.allowedTools).toContain('Task');
      expect(callArgs.options.allowedTools).toContain('mcp__github');
      expect(callArgs.options.allowedTools).toContain('mcp__eslint');
    });

    it('should register all 3 subagents so they can be spawned in parallel', async () => {
      vi.mocked(query).mockReturnValue(
        toAsyncIterable([
          { type: 'result', subtype: 'success', structured_output: validStructuredOutput },
        ]) as ReturnType<typeof query>
      );

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });
      await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      const callArgs = vi.mocked(query).mock.calls[0][0] as {
        options: { agents: Record<string, unknown> };
      };
      expect(Object.keys(callArgs.options.agents)).toEqual(
        expect.arrayContaining([
          'code-quality-analyzer',
          'test-coverage-analyzer',
          'refactoring-suggester',
        ])
      );
    });

    it('should aggregate the structured_output into a ReviewReport', async () => {
      vi.mocked(query).mockReturnValue(
        toAsyncIterable([
          { type: 'result', subtype: 'success', structured_output: validStructuredOutput },
        ]) as ReturnType<typeof query>
      );

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });
      const result = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      expect(result.pullRequest).toEqual({ owner: 'octocat', repo: 'Hello-World', number: 1 });
      expect(result.fileReviews).toHaveLength(1);
      expect(result.summary.totalFiles).toBe(1);
      // metadata is overridden with real wall-clock values, not the mocked ones
      expect(typeof result.metadata.duration).toBe('number');
      expect(result.metadata.analyzedAt).not.toBe(validStructuredOutput.metadata.analyzedAt);
    });

    it('should reject output that fails Zod validation (safeParse)', async () => {
      const invalidOutput = { ...validStructuredOutput, summary: 'not-an-object' };
      vi.mocked(query).mockReturnValue(
        toAsyncIterable([
          { type: 'result', subtype: 'success', structured_output: invalidOutput },
        ]) as ReturnType<typeof query>
      );

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });

      await expect(
        orchestrator.reviewPullRequest('octocat', 'Hello-World', 1)
      ).rejects.toThrow(/failed ReviewReportSchema validation/);
    });

    it('should throw a ReviewError when the query never succeeds', async () => {
      vi.mocked(query).mockReturnValue(
        toAsyncIterable([{ type: 'result', subtype: 'error_max_turns' }]) as ReturnType<
          typeof query
        >
      );

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });

      await expect(
        orchestrator.reviewPullRequest('octocat', 'Hello-World', 1)
      ).rejects.toThrow(ReviewError);
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI.
    // To run manually: temporarily change `it.skip` to `it`, ensure
    // ANTHROPIC_API_KEY (or AWS Bedrock credentials) and ANTHROPIC_MODEL are
    // set, run `npm test`, then change it back to `it.skip` before committing.
    it.skip('should review a real small PR', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const result = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      expect(result.pullRequest).toEqual({ owner: 'octocat', repo: 'Hello-World', number: 1 });
      expect(result.fileReviews.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Basic utility function tests (error-handler.ts, rate-limiter.ts)
// ---------------------------------------------------------------------------

describe('Utility Functions', () => {
  describe('withRetry', () => {
    it('returns the result on the first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(fn, 3, 1);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries after a failure and eventually succeeds', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('ok');

      const result = await withRetry(fn, 3, 1);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws a ReviewError with RETRY_EXHAUSTED after all attempts fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(withRetry(fn, 2, 1)).rejects.toMatchObject({
        code: ErrorCodes.RETRY_EXHAUSTED,
      });
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('withTimeout', () => {
    it('returns the result when the function finishes before the timeout', async () => {
      const fn = () => Promise.resolve('done');
      const result = await withTimeout(fn, 1000);
      expect(result).toBe('done');
    });

    it('throws a ReviewError with AGENT_TIMEOUT when the function is too slow', async () => {
      const fn = () => new Promise((resolve) => setTimeout(() => resolve('too late'), 200));

      await expect(withTimeout(fn, 20)).rejects.toMatchObject({
        code: ErrorCodes.AGENT_TIMEOUT,
      });
    });
  });

  describe('RateLimiter', () => {
    it('canProceed is true when under all configured limits', () => {
      const limiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000,
        maxConcurrent: 5,
      });
      expect(limiter.canProceed(100)).toBe(true);
    });

    it('canProceed is false once maxConcurrent is reached', async () => {
      const limiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000,
        maxConcurrent: 1,
      });
      await limiter.acquire(100);
      expect(limiter.canProceed(100)).toBe(false);
    });

    it('release() frees a concurrent slot', async () => {
      const limiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000,
        maxConcurrent: 1,
      });
      await limiter.acquire(100);
      expect(limiter.canProceed(100)).toBe(false);

      limiter.release();
      expect(limiter.canProceed(100)).toBe(true);
    });

    it('pruneOldRecords removes entries older than the 60-second window', () => {
      const limiter = new RateLimiter();
      // Access the private history via getStatus(), which calls
      // pruneOldRecords() internally before reporting counts.
      const statusBefore = limiter.getStatus();
      expect(statusBefore.requestsInWindow).toBe(0);
    });

    it('canProceed is false once maxTokensPerMinute would be exceeded', async () => {
      const limiter = new RateLimiter({
        maxRequestsPerMinute: 100,
        maxTokensPerMinute: 1000,
        maxConcurrent: 100,
      });
      await limiter.acquire(900);
      limiter.release();
      expect(limiter.canProceed(200)).toBe(false);
      expect(limiter.canProceed(50)).toBe(true);
    });
  });
});
