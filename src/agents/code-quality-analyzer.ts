import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Code Quality Analyzer subagent.
 *
 * Analyzes changed file(s) from a pull request for security vulnerabilities,
 * performance issues, and maintainability concerns. Returns findings matching
 * CodeQualityResultSchema (see src/types/analysis-results.ts).
 *
 * Tool choices:
 * - Read: view the actual contents of the file(s) under review.
 * - Grep: search across the repo for a risky pattern found in one file to
 *   see if it's duplicated elsewhere.
 * - Glob: locate related files (config, shared modules) needed to confirm
 *   a finding.
 * - Skill: required so this agent can invoke Claude Skills such as
 *   "javascript-best-practices" or "security-analysis" for specialized
 *   analysis instead of relying solely on general model knowledge.
 *
 * model: 'inherit' — uses whatever model the parent orchestrator query is
 * configured with, keeping model selection centralized.
 */
export const codeQualityAnalyzerAgent: AgentDefinition = {
  description:
    'Analyzes source code changes in a pull request for security ' +
    'vulnerabilities, performance issues, and maintainability concerns. ' +
    'Use this agent whenever code quality, security risk, or performance ' +
    'impact of the changed files needs to be assessed.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit',
  skills: ['javascript-best-practices', 'security-analysis'],
};
