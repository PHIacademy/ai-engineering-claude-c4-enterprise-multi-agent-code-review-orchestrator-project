import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { formatError } from './utils/error-handler.js';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // --- Validate command line arguments ---
  if (!owner || !repo || !prStr) {
    console.error(
      'Usage: npm run dev -- <owner> <repo> <pr-number>\n' +
        'Example: npm run dev -- octocat Hello-World 1'
    );
    process.exit(1);
  }

  const prNumber = Number.parseInt(prStr, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0 || String(prNumber) !== prStr.trim()) {
    console.error(`Invalid pull request number: "${prStr}". Must be a positive integer.`);
    process.exit(1);
  }

  // --- Validate authentication (choose ONE method) ---
  const hasAnthropicApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasBedrockCredentials = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  if (hasBedrockCredentials) {
    if (!process.env.AWS_REGION) {
      console.error(
        'AWS Bedrock credentials found, but AWS_REGION is not set.\n' +
          'Set AWS_REGION (e.g. "us-east-1") in your .env file.'
      );
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else if (hasAnthropicApiKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else {
    console.error(
      'No authentication configured. Set ONE of the following in your .env file:\n' +
        '  - ANTHROPIC_API_KEY (for the Anthropic API), OR\n' +
        '  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (for AWS Bedrock)'
    );
    process.exit(1);
  }

  // --- Validate ANTHROPIC_MODEL environment variable ---
  // Required for both authentication methods; the expected value differs
  // by method (Bedrock uses the full inference-profile ID, direct API uses
  // the bare model name).
  if (!process.env.ANTHROPIC_MODEL) {
    console.error(
      'ANTHROPIC_MODEL is not set. Set it in your .env file, e.g.:\n' +
        '  - AWS Bedrock:    ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0\n' +
        '  - Anthropic API:  ANTHROPIC_MODEL=claude-sonnet-4-5-20250929'
    );
    process.exit(1);
  }

  console.log(`Reviewing ${owner}/${repo} PR #${prNumber}...`);

  try {
    // --- Create orchestrator instance ---
    const orchestrator = new CodeReviewOrchestrator();

    // --- Run the review ---
    const result = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // --- Generate formatted reports ---
    const reportsDir = path.resolve(process.cwd(), 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const baseName = `${owner}-${repo}-pr${prNumber}`.replace(/[^a-zA-Z0-9-_]/g, '_');

    const generator = new ReportGenerator();
    const jsonReport = generator.generateJSONReport(result);
    const markdownReport = generator.generateMarkdownReport(result);
    const htmlReport = generator.generateHTMLReport(result);

    const jsonPath = path.join(reportsDir, `${baseName}.json`);
    const markdownPath = path.join(reportsDir, `${baseName}.md`);
    const htmlPath = path.join(reportsDir, `${baseName}.html`);

    fs.writeFileSync(jsonPath, jsonReport, 'utf-8');
    fs.writeFileSync(markdownPath, markdownReport, 'utf-8');
    fs.writeFileSync(htmlPath, htmlReport, 'utf-8');

    console.log('✅ Review complete. Reports saved to:');
    console.log(`   - ${jsonPath}`);
    console.log(`   - ${markdownPath}`);
    console.log(`   - ${htmlPath}`);
  } catch (error) {
    // formatError prefixes ReviewError instances with their error code
    // (e.g. "[AGENT_FAILED] ...") and falls back to a plain message for
    // any other thrown value, instead of printing a raw stack trace.
    console.error('❌ Review failed:', formatError(error));
    process.exit(1);
  }
}

main();