import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

/**
 * Refactoring Suggester subagent.
 *
 * Identifies opportunities to modernize, simplify, or restructure code that
 * already works correctly — as opposed to the Code Quality Analyzer, which
 * flags things that are wrong or risky. Returns findings matching
 * RefactoringSuggestionSchema (see src/types/analysis-results.ts).
 *
 * Tool choices:
 * - Read: view the full file(s) being considered for refactoring.
 * - Grep: check whether a pattern proposed for extraction is duplicated
 *   elsewhere in the repo, which strengthens the case for the refactor.
 * - Glob: locate related files a suggested extraction (e.g. a new shared
 *   utility) would need to sit alongside.
 * - Skill: included so this agent can invoke a language-idiom Claude
 *   Skill (e.g. "typescript-patterns") before finalizing a modernization
 *   suggestion, confirming it's genuinely idiomatic rather than a
 *   personal style preference.
 *
 * model: 'inherit' — uses whatever model the parent orchestrator query is
 * configured with.
 */
export const refactoringSuggesterAgent: AgentDefinition = {
  description:
    'Identifies opportunities to modernize, simplify, or restructure code ' +
    '(extract method/class, apply design patterns, remove dead code) in a ' +
    'pull request. Use this agent whenever code structure, readability, ' +
    'or maintainability improvements need to be suggested for code that ' +
    'is already functioning correctly.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit',
  skills: ['typescript-patterns'],
};
