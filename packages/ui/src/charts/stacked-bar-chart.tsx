import { CHART_COLORS, shortNumber } from './chart-utils.js';

type StackItem = {
  label: string;
  value: number;
  color?: string;
};

type CostStackedBarChartData = {
  label: string;
  stacks: StackItem[];
};

type CostStackedBarChartProps = {
  data: CostStackedBarChartData[];
  height?: number;
  title?: string;
  formatValue?: (value: number) => string;
};

export function CostStackedBarChart({
  data,
  height = 200,
  title,
  formatValue,
}: CostStackedBarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
        role="img"
        aria-label="No data available"
      >
        No data available
      </div>
    );
  }

  const fmt = formatValue || shortNumber;
  const maxValue = Math.max(
    ...data.map((d) => d.stacks.reduce((sum, s) => sum + s.value, 0)),
    1,
  );
  const w = 600;
  const h = height;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 30;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const barWidth = Math.min(40, (chartW - data.length * 8) / data.length);

  return (
    <div className="relative">
      {title && <h3 className="mb-2 text-sm font-medium">{title}</h3>}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Cost stacked bar chart">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={padL}
              y1={padT + chartH * (1 - ratio)}
              x2={padL + chartW}
              y2={padT + chartH * (1 - ratio)}
              stroke="currentColor"
              strokeOpacity="0.1"
            />
            <text
              x={padL - 8}
              y={padT + chartH * (1 - ratio) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {fmt(maxValue * ratio)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = padL + i * (barWidth + 8);
          let currentY = padT + chartH;
          const total = d.stacks.reduce((sum, s) => sum + s.value, 0);

          return (
            <g key={i} className="group">
              {d.stacks.map((stack, j) => {
                const stackHeight = (stack.value / maxValue) * chartH;
                currentY -= stackHeight;
                const color = stack.color || CHART_COLORS[j % CHART_COLORS.length];
                return (
                  <rect
                    key={j}
                    x={x}
                    y={currentY}
                    width={barWidth}
                    height={stackHeight}
                    fill={color}
                    rx={j === d.stacks.length - 1 ? 4 : 0}
                    tabIndex={0}
                    aria-label={`${d.label} ${stack.label}: ${fmt(stack.value)}`}
                  />
                );
              })}
              <text
                x={x + barWidth / 2}
                y={h - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {d.label}
              </text>
              <title>{`${d.label}: ${fmt(total)}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
