export type TimeRange = 'day' | 'week' | 'month' | 'year' | 'custom';
export type Granularity = 'day' | 'week' | 'month' | 'year';
export type GroupBy = 'provider' | 'model' | 'project' | 'role';
export type Metric =
  | 'tokens'
  | 'input'
  | 'output'
  | 'cached'
  | 'reasoning'
  | 'cost'
  | 'prompts'
  | 'sessions';

export function resolveDateRange(
  range: TimeRange,
  customFrom?: string,
  customTo?: string,
): { from?: string; to?: string } {
  if (range === 'custom') {
    return { from: customFrom, to: customTo };
  }

  const now = new Date();
  const to = now.toISOString();
  const start = new Date(now);

  switch (range) {
    case 'day':
      start.setUTCDate(start.getUTCDate() - 1);
      break;
    case 'week':
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case 'month':
      start.setUTCDate(start.getUTCDate() - 30);
      break;
    case 'year':
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      break;
    default:
      break;
  }

  return { from: start.toISOString(), to };
}

export function metricLabel(metric: Metric): string {
  switch (metric) {
    case 'tokens':
      return 'Total tokens';
    case 'input':
      return 'Input tokens';
    case 'output':
      return 'Output tokens';
    case 'cached':
      return 'Cached tokens';
    case 'reasoning':
      return 'Reasoning tokens';
    case 'cost':
      return 'Estimated cost';
    case 'prompts':
      return 'Prompts';
    case 'sessions':
      return 'Sessions';
    default:
      return metric;
  }
}
