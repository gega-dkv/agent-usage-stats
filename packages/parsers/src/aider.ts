import fs from 'fs';
import path from 'path';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
import {
  applyPrivacyContent,
  buildSession,
  fileReadWarning,
  maybeEstimateTokens,
  newMessageId,
} from './parser-helpers.js';

const TOKEN_LINE = /tokens?:\s*([\d,]+)\s*(?:in|input)?\s*\/\s*([\d,]+)\s*(?:out|output)?/i;
const COST_LINE = /cost:\s*\$?([\d.]+)/i;

export const aiderParser: ProviderParser = {
  provider: 'aider',

  canParse(filePath: string, _sample: string): boolean {
    return (
      filePath.endsWith('.aider.chat.history.md') ||
      filePath.endsWith('.aider.input.history') ||
      filePath.endsWith('.aider.llm.history') ||
      filePath.includes('aider.chat.history') ||
      filePath.includes('aider.input.history') ||
      filePath.includes('aider.llm.history')
    );
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const allowEstimate = options?.estimatePromptOnlySources === true;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const sessionId = path.basename(filePath).replace(/\.(md|history)$/, '');
      const messages: NormalizedMessage[] = [];
      const blocks = content.split(/\n{2,}/).filter((b) => b.trim());

      for (const block of blocks) {
        const role: NormalizedMessage['role'] = block.startsWith('> ') || block.includes('#### user')
          ? 'user'
          : block.includes('#### assistant')
            ? 'assistant'
            : 'user';
        const text = block.replace(/^>+\s?/gm, '').replace(/^####\s+\w+\s*/i, '').trim();
        if (!text) continue;

        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let recordedCost: number | undefined;
        let usageConfidence: NormalizedMessage['usageConfidence'] = 'metadata-only';

        const tokenMatch = block.match(TOKEN_LINE);
        if (tokenMatch) {
          inputTokens = Number(tokenMatch[1].replace(/,/g, ''));
          outputTokens = Number(tokenMatch[2].replace(/,/g, ''));
          usageConfidence = 'exact';
        }
        const costMatch = block.match(COST_LINE);
        if (costMatch) recordedCost = Number(costMatch[1]);

        const privacy = applyPrivacyContent(role, text, options);
        const estimated = maybeEstimateTokens(role, inputTokens, outputTokens, text, allowEstimate);
        if (estimated.estimated) usageConfidence = 'estimated-from-text';

        messages.push({
          id: newMessageId(),
          sessionId,
          role,
          ...privacy,
          inputTokens: estimated.inputTokens,
          outputTokens: estimated.outputTokens,
          usageConfidence,
          recordedCost,
        });
      }

      if (messages.length === 0) {
        return {
          sessions: [],
          warnings: [
            {
              file: filePath,
              message: 'No Aider history content found',
              severity: 'warning',
              code: 'prompt-storage-disabled',
            },
          ],
        };
      }

      if (!allowEstimate && !messages.some((m) => m.inputTokens || m.outputTokens)) {
        warnings.push({
          file: filePath,
          message: 'Aider prompt history parsed without token usage (enable estimatePromptOnlySources to estimate)',
          severity: 'warning',
          code: 'missing-token-fields',
        });
      }

      return {
        sessions: [
          buildSession(sessionId, 'aider', messages, {
            sourcePath: filePath,
            storageKind: 'markdown',
            supportLevel: 'prompt-history-only',
            usageConfidence: messages.some((m) => m.usageConfidence === 'exact')
              ? 'exact'
              : allowEstimate
                ? 'estimated-from-text'
                : 'metadata-only',
            projectPath: path.dirname(filePath),
            projectName: path.basename(path.dirname(filePath)),
            tokenUsageEstimated: allowEstimate && !messages.some((m) => m.usageConfidence === 'exact'),
          }),
        ],
        warnings,
      };
    } catch (error) {
      warnings.push(fileReadWarning(filePath, error));
      return { sessions: [], warnings };
    }
  },
};
