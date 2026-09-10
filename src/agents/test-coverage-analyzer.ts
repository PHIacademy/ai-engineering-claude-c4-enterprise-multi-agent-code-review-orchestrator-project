import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

/**
 * Test Coverage Analyzer subagent.
 *
 * Estimates test completeness for changed file(s) by statically comparing
 * source code against any corresponding test files (no test execution),
 * and suggests specific, actionable test cases for untested paths. Returns
 * findings matching TestCoverageResultSchema (see
 * src/types/analysis-results.ts).
 *
 * Tool choices:
 * - Read: view both the source file and any candidate test file(s).
 * - Glob: locate test files that plausibly correspond to a given source
 *   file (e.g. matching *.test.ts / *.spec.ts naming or a mirrored
 *   tests/ directory structure).
 * - Grep: confirm a function/branch is actually referenced by an
 *   assertion in a test file, rather than assuming coverage just because
 *   a test file exists or imports the module.
 * - Skill: included so this agent can invoke a testing-focused Claude
 *   Skill (e.g. "unit-testing-patterns") to sanity-check that its
 *   suggested test structure and assertions follow good practice.
 *
 * model: 'inherit' — uses whatever model the parent orchestrator query is
 * configured with.
 */
export const testCoverageAnalyzerAgent: AgentDefinition = {
  description:
    'Evaluates test completeness for a pull request by comparing source ' +
    'files against their corresponding test files and identifying ' +
    'untested functions, branches, and edge cases. Use this agent whenever ' +
    'test coverage, missing assertions, or test-quality gaps need to be ' +
    'assessed.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Glob', 'Grep', 'Skill'],
  model: 'inherit',
  skills: ['unit-testing-patterns'],
};
