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
      <div
        className="flex items-center justify-center py-8 text-sm text-muted-foreground"
        role="img"
        aria-label="No data available"
      >
        No data available
      </div>
    );
  }

  const formatC = formatCost || ((v: number) => `$${v.toFixed(2)}`);
  const formatT = formatTokens || ((v: number) => v.toLocaleString());
  const maxCost = Math.max(...data.map((d) => d.cost), 1);

  return (
    <div className="flex flex-col gap-4">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      {data.map((item, i) => (
        <div key={item.model} className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">#{i + 1}</span>
              <span className="font-mono">{item.model}</span>
            </div>
            <span className="font-mono">{formatC(item.cost)}</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
              style={{ width: `${(item.cost / maxCost) * 100}%` }}
              role="progressbar"
              aria-valuenow={item.cost}
              aria-valuemin={0}
              aria-valuemax={maxCost}
              aria-label={`${item.model} cost`}
              tabIndex={0}
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
