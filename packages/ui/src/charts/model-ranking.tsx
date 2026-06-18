import React from 'react';

type ModelCostData = {
  model: string;
  cost: number;
  tokens: number;
  sessions: number;
};

type ModelCostRankingProps = {
  data: ModelCostData[];
  title?: string;
  formatCost?: (value: number) => string;
  formatTokens?: (value: number) => string;
};

export function ModelCostRanking({
  data,
  title,
  formatCost,
  formatTokens,
}: ModelCostRankingProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground py-8">
        No data available
      </div>
    );
  }

  const formatC = formatCost || ((v: number) => `$${v.toFixed(2)}`);
  const formatT = formatTokens || ((v: number) => v.toLocaleString());
  const maxCost = Math.max(...data.map((d) => d.cost));

  return (
    <div className="space-y-4">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      {data.map((item, i) => (
        <div key={item.model} className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">#{i + 1}</span>
              <span className="font-mono">{item.model}</span>
            </div>
            <span className="font-mono">{formatC(item.cost)}</span>
          </div>
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full"
              style={{ width: `${(item.cost / maxCost) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{formatT(item.tokens)} tokens</span>
            <span>{item.sessions} sessions</span>
          </div>
        </div>
      ))}
    </div>
  );
}
