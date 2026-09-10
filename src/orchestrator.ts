import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

import {
  codeQualityAnalyzerAgent,
  testCoverageAnalyzerAgent,
  refactoringSuggesterAgent,
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/orchestrator.prompt.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types';
import type { ReviewReport } from './types/report-types';
import { globalRateLimiter, withRetry, withTimeout, ReviewError, ErrorCodes } from './utils/index.js';

/**
 * Orchestrator configuration options.
 * All fields optional so the orchestrator can run with sensible defaults,
 * but every default is overridable — nothing is hardcoded inside
 * reviewPullRequest itself.
 */
export interface OrchestratorOptions {
  /**
   * Model to run the orchestrator (and, by extension, any subagent using
   * model: 'inherit') with. Deliberately NOT hardcoded — read from config/
   * env so the same code can target different models per deployment
   * (e.g. a cheaper model for CI smoke tests) without a code change.
   */
  model?: string;
  /**
   * Upper bound on agent turns for a single review. Multi-agent
   * coordination needs headroom for: fetching PR metadata, fetching PR
   * files, N files x 3 parallel subagent invocations, and a final
   * aggregation turn. 40 is a reasonable default for small-to-medium PRs.
   */
  maxTurns?: number;
  /**
   * Wall-clock timeout for the entire review (the whole query() call),
   * in milliseconds. A single-file review observed in testing took ~161s,
   * so 5 minutes gives headroom for multi-file PRs while still failing
   * fast if the SDK hangs.
   */
  timeoutMs?: number;
  /** Max retry attempts for a failed/timed-out review. */
  maxRetries?: number;
  /** Base delay (ms) for exponential backoff between retries. */
  retryDelayMs?: number;
  /**
   * Flat token estimate passed to the rate limiter for this review.
   * Deliberately a single conservative number rather than a per-file
   * calculation — this project runs a handful of reviews at a time, not
   * high-throughput traffic, so a coarse estimate is enough to keep
   * concurrent/overall usage within the configured limits without adding
   * the complexity of pre-fetching file counts before the query starts.
   */
  estimatedTokens?: number;
}

/**
 * Main Code Review Orchestrator.
 * Coordinates subagents to analyze pull requests and generate comprehensive reports.
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly estimatedTokens: number;

  constructor(options: OrchestratorOptions = {}) {
    // Model comes from explicit options, falling back to an env var,
    // falling back to a documented default — never hardcoded as the only
    // option.
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
    this.maxTurns = options.maxTurns ?? 40;
    this.timeoutMs = options.timeoutMs ?? 5 * 60 * 1000; // 5 minutes
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.estimatedTokens = options.estimatedTokens ?? 20000;
  }

  /**
   * Review a pull request using parallel subagent analysis.
   *
   * The whole review (PR fetch + all subagent analysis + aggregation) runs
   * as a single Agent SDK query() call, so retry/timeout/rate-limiting are
   * applied around that entire call rather than per-subagent — the SDK's
   * own Task-tool dispatch to subagents happens inside query() and isn't
   * separately observable from this class.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    await globalRateLimiter.acquire(this.estimatedTokens);
    try {
      return await withRetry(
        () =>
          withTimeout(
            () => this.runReview(owner, repo, prNumber),
            this.timeoutMs,
            `Review of ${owner}/${repo}#${prNumber} timed out after ${this.timeoutMs}ms`
          ),
        this.maxRetries,
        this.retryDelayMs
      );
    } finally {
      // Always release the slot, whether the review succeeded, failed, or
      // was retried — otherwise a failed review would permanently hold a
      // concurrency slot.
      globalRateLimiter.release();
    }
  }

  /**
   * Runs one full attempt of the review: builds the prompt, executes the
   * orchestrator query, and validates/normalizes the structured output.
   * Split out from reviewPullRequest so withRetry can call this repeatedly
   * without re-implementing the rate-limit acquire/release around each
   * attempt (only the outer call acquires/releases a slot).
   */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();

    const prompt = buildOrchestratorPrompt({ owner, repo, prNumber });

    // allowedTools must include Task so the orchestrator can spawn the
    // registered subagents, plus the MCP servers it needs (github for PR
    // data, eslint for linting support the subagents may call into).
    const allowedTools = [
      'Task',
      ...Object.keys(mcpServersConfig).map((serverName) => `mcp__${serverName}`),
    ];

    const options: Options = {
      model: this.model,
      maxTurns: this.maxTurns,
      // bypassPermissions: this pipeline is read-only analysis (no file
      // edits, no destructive commands) intended to run unattended in
      // CI/CD, where no human is available to answer an interactive
      // permission prompt. 'default' would hang waiting for approval.
      permissionMode: 'bypassPermissions',
      mcpServers: mcpServersConfig,
      allowedTools,
      agents: {
        'code-quality-analyzer': codeQualityAnalyzerAgent,
        'test-coverage-analyzer': testCoverageAnalyzerAgent,
        'refactoring-suggester': refactoringSuggesterAgent,
      },
      // Structured outputs: ReviewReportSchema (Zod) has already been
      // converted to JSON Schema in src/types/report-types.ts via
      // zodToJsonSchema. We hand that JSON Schema to the SDK so the
      // orchestrator's final result is constrained to match it.
      //
      // NOTE: the SDK validates against JSON Schema draft-07, while
      // zod-to-json-schema targets a newer draft by default. If structured
      // output validation errors occur, regenerate ReviewReportJSONSchema
      // with an explicit `target: 'draft-7'` option where it's built.
      outputFormat: {
        type: 'json_schema',
        schema: ReviewReportJSONSchema,
      },
    };

    let structuredOutput: unknown;
    let succeeded = false;
    let failureSubtype: string | undefined;

    for await (const message of query({ prompt, options })) {
      if (message.type === 'result') {
        if (message.subtype === 'success' && 'structured_output' in message) {
          structuredOutput = (message as { structured_output?: unknown }).structured_output;
          succeeded = true;
        } else {
          failureSubtype = message.subtype;
        }
      }
    }

    if (!succeeded || structuredOutput === undefined) {
      throw new ReviewError(
        `Orchestrator query for ${owner}/${repo}#${prNumber} did not produce a successful ` +
          `structured result${failureSubtype ? ` (subtype: ${failureSubtype})` : ''}.`,
        ErrorCodes.AGENT_FAILED,
        { owner, repo, prNumber, failureSubtype }
      );
    }

    // safeParse (not parse) so we surface a descriptive error instead of
    // letting a ZodError bubble up raw to the CLI/caller.
    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      throw new ReviewError(
        `Structured output for ${owner}/${repo}#${prNumber} failed ReviewReportSchema ` +
          `validation: ${parsed.error.message}`,
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        { owner, repo, prNumber }
      );
    }

    const durationSeconds = (Date.now() - startedAt);

    // Ensure metadata.duration and metadata.analyzedAt reflect real values —
    // the model has no reliable access to wall-clock time, so analyzedAt
    // in particular is prone to being a fabricated placeholder (e.g. an
    // exact midnight timestamp) if left to the model alone.
    return {
      ...parsed.data,
      metadata: {
        ...parsed.data.metadata,
        analyzedAt: new Date(startedAt).toISOString(),
        duration: durationSeconds,
      },
    };
  }
}