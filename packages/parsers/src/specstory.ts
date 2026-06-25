import fs from 'fs';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedMessage,
} from '@agent-usage/shared';
import {
  applyPrivacyContent,
  buildSession,
  fileReadWarning,
  maybeEstimateTokens,
  newMessageId,
} from './parser-helpers.js';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const TOKEN_META = /tokens?:\s*(\d+)\s*\/\s*(\d+)/i;

export const specstoryParser: ProviderParser = {
  provider: 'specstory',

  canParse(filePath: string, _sample: string): boolean {
    return filePath.includes('.specstory') && filePath.endsWith('.md');
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const allowEstimate = options?.estimatePromptOnlySources === true;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const sessionId = path.basename(filePath, '.md');
      const { title, date, body } = parseFrontmatter(content, filePath);
      const messages: NormalizedMessage[] = [];

      const sections = body.split(/^##\s+(User|Assistant)\s*$/im).filter(Boolean);
      if (sections.length > 1) {
        for (let i = 0; i < sections.length; i += 2) {
          const roleLabel = sections[i];
          const text = (sections[i + 1] || '').trim();
          if (!text) continue;
          messages.push(buildSpecstoryMessage(sessionId, roleLabel, text, allowEstimate, options));
        }
      } else {
        const userBlocks = body.split(/^#\s*User\s*$/im);
        for (const block of userBlocks.slice(1)) {
          const parts = block.split(/^#\s*Assistant\s*$/im);
          const userText = parts[0]?.trim();
          if (userText) {
            messages.push(
              buildSpecstoryMessage(sessionId, 'User', userText, allowEstimate, options),
            );
          }
          const assistantText = parts[1]?.trim();
          if (assistantText) {
            messages.push(
              buildSpecstoryMessage(sessionId, 'Assistant', assistantText, allowEstimate, options),
            );
          }
        }
      }

      if (messages.length === 0 && content.trim()) {
        messages.push(
          buildSpecstoryMessage(sessionId, 'User', body.trim(), allowEstimate, options),
        );
      }

      if (messages.length === 0) {
        return {
          sessions: [],
          warnings: [
            {
              file: filePath,
              message: 'No SpecStory markdown content found',
              severity: 'warning',
              code: 'missing-token-fields',
            },
          ],
        };
      }

      const hasStructuredUsage = messages.some((m) => m.usageConfidence === 'exact');
      if (!hasStructuredUsage && !allowEstimate) {
        warnings.push({
          file: filePath,
          message: 'SpecStory parsed as prompt-history-only without structured token metadata',
          severity: 'warning',
          code: 'missing-token-fields',
        });
      }

      return {
        sessions: [
          buildSession(sessionId, 'specstory', messages, {
            sourcePath: filePath,
            storageKind: 'markdown',
            supportLevel: 'prompt-history-only',
            usageConfidence: hasStructuredUsage
              ? 'exact'
              : allowEstimate
                ? 'estimated-from-text'
                : 'metadata-only',
            projectPath: path.dirname(filePath),
            projectName: path.basename(path.dirname(path.dirname(filePath))),
            startedAt: date,
            metadata: title ? { title } : undefined,
            tokenUsageEstimated: allowEstimate && !hasStructuredUsage,
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

function parseFrontmatter(
  content: string,
  filePath: string,
): { title?: string; date?: string; body: string } {
  const fm = content.match(FRONTMATTER);
  if (!fm) {
    const titleFromName = path.basename(filePath, '.md').replace(/_/g, ' ');
    return { title: titleFromName, body: content };
  }
  const meta = fm[1];
  const title = meta.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  const date = meta.match(/^date:\s*(.+)$/m)?.[1]?.trim();
  return { title, date, body: content.slice(fm[0].length) };
}

function buildSpecstoryMessage(
  sessionId: string,
  roleLabel: string,
  text: string,
  allowEstimate: boolean,
  options?: ParseOptions,
): NormalizedMessage {
  const role: NormalizedMessage['role'] = roleLabel.toLowerCase().startsWith('user')
    ? 'user'
    : 'assistant';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let usageConfidence: NormalizedMessage['usageConfidence'] = 'metadata-only';
  const tokenMatch = text.match(TOKEN_META);
  if (tokenMatch) {
    inputTokens = Number(tokenMatch[1]);
    outputTokens = Number(tokenMatch[2]);
    usageConfidence = 'exact';
  }
  const privacy = applyPrivacyContent(role, text.replace(TOKEN_META, '').trim(), options);
  const estimated = maybeEstimateTokens(role, inputTokens, outputTokens, text, allowEstimate);
  if (estimated.estimated) usageConfidence = 'estimated-from-text';
  return {
    id: newMessageId(),
    sessionId,
    role,
    ...privacy,
    inputTokens: estimated.inputTokens,
    outputTokens: estimated.outputTokens,
    usageConfidence,
  };
}
