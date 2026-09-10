# Project: Enterprise Multi-Agent Code Review Orchestrator

A production-ready multi-agent system that automates code review using the Claude Agent SDK.

> Submitted for: **AI Engineering with Claude Nanodegree** — Course 4: *Bounded Autonomy and Guardrails with Claude and Claude Code* — Final Project (Phase 6)

## Project Overview

This system uses multiple specialized AI agents working together to provide comprehensive code reviews:

- **Main Orchestrator** — Coordinates the review process and aggregates results
- **Code Quality Analyzer** — Identifies code smells, anti-patterns, and best practice violations
- **Test Coverage Analyzer** — Evaluates test completeness and suggests missing test cases
- **Refactoring Suggester** — Recommends architectural improvements and refactoring opportunities

Given a GitHub `owner`, `repo`, and pull request number, the orchestrator fetches the PR via the GitHub MCP server, dispatches all three subagents in parallel per changed file, validates the aggregated result against a Zod schema, and generates Markdown, HTML, and JSON reports.

## Implementation Summary

All starter tasks have been completed:

1. **Agent Definitions** (`src/agents/`) — Code Quality Analyzer, Test Coverage Analyzer, and Refactoring Suggester, each with a scoped tool set (`Read`, `Grep`, `Glob`, `Skill`) and a domain-specific Claude Skill.
2. **Prompts** (`src/prompts/`) — Orchestrator prompt (explicit per-agent invocation instructions) plus agent-specific prompts referencing each Zod schema's exact output shape.
3. **MCP Configuration** (`src/config/mcp.config.ts`) — GitHub MCP server (`GITHUB_TOKEN` → `GITHUB_PERSONAL_ACCESS_TOKEN` mapping) and ESLint MCP server.
4. **Orchestrator** (`src/orchestrator.ts`) — Coordinates subagent spawning via the `Task` tool, validates structured output with `ReviewReportSchema.safeParse()`, and wraps the whole review in rate limiting, retry-with-backoff, and a timeout.
5. **Main Entry Point** (`src/main.ts`) — CLI argument validation, authentication validation (Anthropic API key or AWS Bedrock), model validation, and report generation in all three formats.
6. **Error Handler** (`src/utils/error-handler.ts`) — `ReviewError` class, `withRetry` (exponential backoff + jitter), and `withTimeout` (`Promise.race`).
7. **Rate Limiter** (`src/utils/rate-limiter.ts`) — Token bucket with a sliding 60-second window, concurrency limiting, and a wait queue.

## Project Structure

```
├── src/
│   ├── agents/                          # Three subagent definitions
│   │   ├── code-quality-analyzer.ts
│   │   ├── test-coverage-analyzer.ts
│   │   ├── refactoring-suggester.ts
│   │   └── index.ts
│   ├── prompts/                         # Prompts for orchestrator and subagents
│   │   ├── orchestrator.prompt.ts
│   │   ├── code-quality-analyzer.prompt.ts
│   │   ├── test-coverage-analyzer.prompt.ts
│   │   ├── refactoring-suggester.prompt.ts
│   │   └── index.ts
│   ├── config/                          # MCP server configurations
│   │   └── mcp.config.ts
│   ├── utils/                           # Error handling, rate limiting, logging, reports
│   │   ├── error-handler.ts
│   │   ├── rate-limiter.ts
│   │   ├── logger.ts                    # provided
│   │   ├── report-generator.ts          # provided
│   │   └── index.ts
│   ├── types/                           # Zod schemas for all data structures
│   │   ├── analysis-results.ts
│   │   ├── report-types.ts
│   │   └── index.ts
│   ├── orchestrator.ts                  # Main coordination logic
│   └── main.ts                          # CLI entry point with validation
├── tests/
│   ├── schemas.test.ts
│   └── orchestrator.test.ts
├── .claude/
│   └── skills/
│       ├── javascript-best-practices/
│       │   └── SKILL.md
│       └── security-analysis/           # added — see below
│           └── SKILL.md
├── reports/                              # Generated PR review reports (9 files)
├── .env.example
├── package.json
└── tsconfig.json
```

**Note on `src/types/`:** split into `analysis-results.ts` (subagent output schemas) and `report-types.ts` (the aggregated `ReviewReport` schema), re-exported together from `index.ts` — a small deviation from a single-file layout, kept for readability as the schema set grew.

### Claude Skills

Two skills back the Code Quality Analyzer's `Skill` tool invocations:

- **`javascript-best-practices`** — modern ES2015+ syntax, async patterns, common pitfalls, performance, and security-adjacent JS idioms.
- **`security-analysis`** *(added)* — injection risks, auth/authorization gaps, data exposure, input validation, and other unsafe patterns, invoked when the agent suspects a security-relevant issue in the code under review.

Both are referenced in `src/agents/code-quality-analyzer.ts`'s `skills` array and invoked per the guidance in `src/prompts/code-quality-analyzer.prompt.ts`.

## ⚠️ Note on Test Repository Substitution

The originally assigned test repository, **`airaamane/simple-todo-app`**, returned a 404 (repository not found / inaccessible) for all three specified pull requests as of the submission date (2026-09-10). This was confirmed reproducibly across multiple runs and is documented in the generated `reports/airaamane-simple-todo-app-pr{1,2,3}.*` files, each of which contains a populated `access-error` recommendation describing the failure rather than a crash — demonstrating the orchestrator's graceful-failure handling working as designed.

To fulfill the "review three real PRs" requirement, a substitute public repository was created:

**https://github.com/PHIacademy/my-todo-app**

with three equivalent pull requests mirroring the original scenarios:

| PR | Title | Status |
|----|-------|--------|
| #1 | add clean code fixture | Merged |
| #2 | Add search functionality for todos | Merged |
| #3 | Add premium subscription features | Merged |

(Note: PR #2 and #3 were intended to be left open, matching the original assignment's merged/open/open pattern, but were merged by mistake during setup. This does not affect the review system's behavior — the orchestrator's GitHub MCP calls treat merged and open PRs identically, and the reports were generated after the merge with no change in report quality.)

All 9 required report files (JSON, Markdown, HTML × 3 PRs) in `reports/` were generated against this substitute repository, using the same, unmodified orchestrator/CLI implementation described above:

- `PHIacademy-my-todo-app-pr1.{json,md,html}`
- `PHIacademy-my-todo-app-pr2.{json,md,html}`
- `PHIacademy-my-todo-app-pr3.{json,md,html}`

The original (failed) `airaamane/simple-todo-app` reports are retained in `reports/` alongside the substitute reports, as evidence of the access issue and of the orchestrator's graceful error handling.

## Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API access ([your own API key](https://console.anthropic.com/) or AWS Bedrock credentials)
- [GitHub Personal Access Token](https://github.com/settings/tokens) (recommended — scopes: `repo`, `read:org`)

### Installation

```bash
git clone https://github.com/PHIacademy/ai-engineering-claude-c4-enterprise-multi-agent-code-review-orchestrator-project.git
cd ai-engineering-claude-c4-enterprise-multi-agent-code-review-orchestrator-project
npm install
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```bash
# Anthropic API authentication (choose ONE method)
ANTHROPIC_API_KEY=sk-ant-your-key-here
# --- OR ---
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_REGION=us-east-1

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# GitHub Token (RECOMMENDED for higher rate limits)
GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

### Running

```bash
# Development mode
npm run dev -- <owner> <repo> <pr-number>

# Production build
npm run build
npm start <owner> <repo> <pr-number>

# Example (substitute test repository)
npm run dev -- PHIacademy my-todo-app 1
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- schemas.test.ts

# Watch mode
npm test -- --watch
```

## Key Technologies

- **Claude Agent SDK** — Multi-agent orchestration framework
- **Model Context Protocol (MCP)** — External data integration (GitHub, ESLint)
- **Zod** — Schema validation and type safety
- **TypeScript** — Type-safe development
- **Vitest** — Testing framework
- **Winston** — Structured logging

## Success Criteria

- [x] TypeScript compiles without errors: `npm run build`
- [x] All tests pass: `npm test`
- [x] Reviews a real PR: `npm run dev -- octocat Hello-World 1`
- [x] Generates reports in all three formats (MD, HTML, JSON)
- [x] Rate limiting prevents API throttling
- [x] Errors are handled gracefully (no raw stack traces; graceful degradation on PR-fetch failure)

## Resources

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Zod Documentation](https://zod.dev/)
