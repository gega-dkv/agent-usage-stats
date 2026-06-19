import type { ProviderParser, ParseResult } from '@agent-usage/shared';

/**
 * Crush has no stable public token/session schema — detection and doctor output only.
 */
export const crushParser: ProviderParser = {
  provider: 'crush',

  canParse(filePath: string, _sample: string): boolean {
    const lower = filePath.toLowerCase();
    return (
      lower.endsWith('crush.json') ||
      lower.endsWith('.crush.json') ||
      lower.includes('/.crush/') ||
      lower.endsWith('crush.log')
    );
  },

  async parse(filePath: string): Promise<ParseResult> {
    return {
      sessions: [],
      warnings: [
        {
          file: filePath,
          message:
            'Crush detected but not parsed for usage. No stable public token/session schema configured.',
          severity: 'warning',
          code: 'detected-only',
        },
      ],
    };
  },
};
