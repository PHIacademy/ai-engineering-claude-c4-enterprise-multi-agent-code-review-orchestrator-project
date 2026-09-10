import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema,
} from '../src/types/analysis-results';
import { ReviewReportSchema, ReviewReportJSONSchema } from '../src/types/report-types';

// ---------------------------------------------------------------------------
// Fixtures — one valid object per schema, reused and mutated per test case.
// ---------------------------------------------------------------------------

const validCodeQualityResult = {
  file: 'src/example.ts',
  issues: [
    {
      line: 42,
      severity: 'high',
      category: 'security',
      description: 'Potential SQL injection via string concatenation.',
      suggestion: 'Use a parameterized query instead.',
    },
  ],
  overallScore: 78,
  summary: 'One high-severity security issue found.',
};

const validTestCoverageResult = {
  file: 'src/example.ts',
  hasTests: true,
  testFiles: ['src/example.test.ts'],
  untestedPaths: [
    {
      type: 'function',
      location: 'parseInput()',
      priority: 'high',
      reasoning: 'No test exercises the empty-input branch.',
      suggestedTest: 'Call parseInput("") and expect a ValidationError to be thrown.',
    },
  ],
  coverageEstimate: 65,
  summary: 'Core path is tested; the empty-input edge case is not.',
};

const validRefactoringSuggestion = {
  file: 'src/example.ts',
  suggestions: [
    {
      type: 'extract-function',
      location: 'processOrder(), lines 10-40',
      impact: 'medium',
      description: 'processOrder() mixes validation and persistence logic.',
      before: 'function processOrder(o) { /* validation + save mixed together */ }',
      after: 'function processOrder(o) { validate(o); save(o); }',
      benefits: 'Improves readability and makes each concern independently testable.',
    },
  ],
  summary: 'One extraction opportunity found.',
};

const validReviewReport = {
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [
    {
      file: 'src/example.ts',
      codeQuality: validCodeQualityResult,
      testCoverage: validTestCoverageResult,
      refactorings: validRefactoringSuggestion,
    },
  ],
  summary: {
    totalFiles: 1,
    overallScore: 78,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 1,
  },
  recommendations: [
    {
      priority: 'high',
      category: 'security',
      description: 'Fix the SQL injection risk before merging.',
      files: ['src/example.ts'],
    },
  ],
  metadata: {
    analyzedAt: '2026-08-27T12:00:00.000Z',
    duration: 42.5,
    agentVersions: { 'code-quality-analyzer': '1.0' },
  },
};

// ---------------------------------------------------------------------------
// CodeQualityResultSchema
// ---------------------------------------------------------------------------

describe('CodeQualityResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => CodeQualityResultSchema.parse(validCodeQualityResult)).not.toThrow();
  });

  it('rejects data missing a required top-level field', () => {
    const { file: _file, ...withoutFile } = validCodeQualityResult;
    expect(() => CodeQualityResultSchema.parse(withoutFile)).toThrow();
  });

  it('rejects an invalid severity enum value', () => {
    const invalid = {
      ...validCodeQualityResult,
      issues: [{ ...validCodeQualityResult.issues[0], severity: 'super-critical' }],
    };
    expect(() => CodeQualityResultSchema.parse(invalid)).toThrow();
  });

  it('rejects an invalid category enum value', () => {
    const invalid = {
      ...validCodeQualityResult,
      issues: [{ ...validCodeQualityResult.issues[0], category: 'not-a-real-category' }],
    };
    expect(() => CodeQualityResultSchema.parse(invalid)).toThrow();
  });

  it('rejects a non-number line', () => {
    const invalid = {
      ...validCodeQualityResult,
      issues: [{ ...validCodeQualityResult.issues[0], line: 'forty-two' }],
    };
    expect(() => CodeQualityResultSchema.parse(invalid)).toThrow();
  });

  it('accepts an empty issues array (a clean file)', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQualityResult, issues: [] })).not.toThrow();
  });

  it('accepts boundary overallScore values (0 and 100)', () => {
    expect(() =>
      CodeQualityResultSchema.parse({ ...validCodeQualityResult, overallScore: 0 })
    ).not.toThrow();
    expect(() =>
      CodeQualityResultSchema.parse({ ...validCodeQualityResult, overallScore: 100 })
    ).not.toThrow();
  });

  it('rejects overallScore outside the 0-100 range', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQualityResult, overallScore: -1 })).toThrow();
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQualityResult, overallScore: 101 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TestCoverageResultSchema
// ---------------------------------------------------------------------------

describe('TestCoverageResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => TestCoverageResultSchema.parse(validTestCoverageResult)).not.toThrow();
  });

  it('rejects a non-boolean hasTests', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverageResult, hasTests: 'yes' })
    ).toThrow();
  });

  it('rejects an invalid untestedPaths[].type enum value', () => {
    const invalid = {
      ...validTestCoverageResult,
      untestedPaths: [{ ...validTestCoverageResult.untestedPaths[0], type: 'method' }],
    };
    expect(() => TestCoverageResultSchema.parse(invalid)).toThrow();
  });

  it('rejects an invalid priority enum value', () => {
    const invalid = {
      ...validTestCoverageResult,
      untestedPaths: [{ ...validTestCoverageResult.untestedPaths[0], priority: 'urgent' }],
    };
    expect(() => TestCoverageResultSchema.parse(invalid)).toThrow();
  });

  it('accepts empty testFiles and untestedPaths arrays (e.g. a fully untested or fully covered file)', () => {
    expect(() =>
      TestCoverageResultSchema.parse({
        ...validTestCoverageResult,
        testFiles: [],
        untestedPaths: [],
      })
    ).not.toThrow();
  });

  it('accepts boundary coverageEstimate values (0 and 100)', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverageResult, coverageEstimate: 0 })
    ).not.toThrow();
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverageResult, coverageEstimate: 100 })
    ).not.toThrow();
  });

  it('rejects coverageEstimate outside the 0-100 range', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverageResult, coverageEstimate: -5 })
    ).toThrow();
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverageResult, coverageEstimate: 150 })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RefactoringSuggestionSchema
// ---------------------------------------------------------------------------

describe('RefactoringSuggestionSchema', () => {
  it('accepts valid data', () => {
    expect(() => RefactoringSuggestionSchema.parse(validRefactoringSuggestion)).not.toThrow();
  });

  it('rejects an invalid suggestions[].type enum value', () => {
    const invalid = {
      ...validRefactoringSuggestion,
      suggestions: [{ ...validRefactoringSuggestion.suggestions[0], type: 'rewrite-everything' }],
    };
    expect(() => RefactoringSuggestionSchema.parse(invalid)).toThrow();
  });

  it('rejects an invalid impact enum value', () => {
    const invalid = {
      ...validRefactoringSuggestion,
      suggestions: [{ ...validRefactoringSuggestion.suggestions[0], impact: 'massive' }],
    };
    expect(() => RefactoringSuggestionSchema.parse(invalid)).toThrow();
  });

  it('rejects a suggestion missing the before/after code snippets', () => {
    const { before: _before, ...withoutBefore } = validRefactoringSuggestion.suggestions[0];
    const invalid = { ...validRefactoringSuggestion, suggestions: [withoutBefore] };
    expect(() => RefactoringSuggestionSchema.parse(invalid)).toThrow();
  });

  it('accepts an empty suggestions array (no refactoring needed)', () => {
    expect(() =>
      RefactoringSuggestionSchema.parse({ ...validRefactoringSuggestion, suggestions: [] })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReviewReportSchema
// ---------------------------------------------------------------------------

describe('ReviewReportSchema', () => {
  it('accepts valid data', () => {
    expect(() => ReviewReportSchema.parse(validReviewReport)).not.toThrow();
  });

  it('rejects the wrong type for pullRequest.number', () => {
    const invalid = {
      ...validReviewReport,
      pullRequest: { ...validReviewReport.pullRequest, number: '1' },
    };
    expect(() => ReviewReportSchema.parse(invalid)).toThrow();
  });

  it('rejects a fileReviews entry missing a nested subagent result', () => {
    const { codeQuality: _codeQuality, ...withoutCodeQuality } = validReviewReport.fileReviews[0];
    const invalid = { ...validReviewReport, fileReviews: [withoutCodeQuality] };
    expect(() => ReviewReportSchema.parse(invalid)).toThrow();
  });

  it('rejects an invalid recommendations[].priority enum value', () => {
    const invalid = {
      ...validReviewReport,
      recommendations: [{ ...validReviewReport.recommendations[0], priority: 'urgent' }],
    };
    expect(() => ReviewReportSchema.parse(invalid)).toThrow();
  });

  it('accepts an empty fileReviews array (e.g. a PR with no analyzable files)', () => {
    expect(() =>
      ReviewReportSchema.parse({
        ...validReviewReport,
        fileReviews: [],
        summary: { ...validReviewReport.summary, totalFiles: 0 },
      })
    ).not.toThrow();
  });

  it('accepts an empty recommendations array', () => {
    expect(() =>
      ReviewReportSchema.parse({ ...validReviewReport, recommendations: [] })
    ).not.toThrow();
  });

  it('rejects a metadata.agentVersions value that is not a string', () => {
    const invalid = {
      ...validReviewReport,
      metadata: { ...validReviewReport.metadata, agentVersions: { agent: 123 } },
    };
    expect(() => ReviewReportSchema.parse(invalid)).toThrow();
  });

  // NOTE: none of the current schemas declare any `.optional()` fields —
  // every field on every schema is required. So "optional field present vs.
  // absent" isn't directly testable here; the closest equivalent is the
  // "missing required field" tests above (a required field absent always
  // throws) and the "empty array" tests (an array field can be empty
  // without being *absent*, which is a distinct, valid case).
});

// ---------------------------------------------------------------------------
// JSON Schema export validation
// ---------------------------------------------------------------------------

describe('JSON Schema exports', () => {
  it('CodeQualityResultJSONSchema is a well-formed JSON schema object', () => {
    expect(CodeQualityResultJSONSchema).toBeTypeOf('object');
    expect(CodeQualityResultJSONSchema).toHaveProperty('properties');
    expect(CodeQualityResultJSONSchema).toHaveProperty('required');
  });

  it('CodeQualityResultJSONSchema marks all required top-level fields', () => {
    const required = (CodeQualityResultJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining(['file', 'issues', 'overallScore', 'summary'])
    );
  });

  it('TestCoverageResultJSONSchema marks all required top-level fields', () => {
    const required = (TestCoverageResultJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining([
        'file',
        'hasTests',
        'testFiles',
        'untestedPaths',
        'coverageEstimate',
        'summary',
      ])
    );
  });

  it('RefactoringSuggestionJSONSchema marks all required top-level fields', () => {
    const required = (RefactoringSuggestionJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(expect.arrayContaining(['file', 'suggestions', 'summary']));
  });

  it('ReviewReportJSONSchema marks all required top-level fields', () => {
    const required = (ReviewReportJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining([
        'pullRequest',
        'fileReviews',
        'summary',
        'recommendations',
        'metadata',
      ])
    );
  });

  it('regenerating ReviewReportSchema as JSON schema produces the same shape as the export', () => {
    const fresh = zodToJsonSchema(ReviewReportSchema, { $refStrategy: 'root' }) as {
      properties?: Record<string, unknown>;
    };
    expect(fresh).toHaveProperty('properties');
    expect(fresh.properties).toHaveProperty('pullRequest');
    expect(fresh.properties).toHaveProperty('fileReviews');
  });
});
