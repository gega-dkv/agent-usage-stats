import { CHART_COLORS, DEFAULT_LINE_COLOR, shortNumber } from './chart-utils.js';

type BarChartData = {
  label: string;
  value: number;
  color?: string;
};

type UsageBarChartProps = {
  data: BarChartData[];
  height?: number;
  title?: string;
  formatValue?: (value: number) => string;
  horizontal?: boolean;
};

export function UsageBarChart({
  data,
  height = 200,
  title,
  formatValue,
  horizontal = true,
}: UsageBarChartProps) {
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
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 600;
  const h = height;
  const padL = 70;
  const padR = 70;
  const padT = 20;
  const padB = 20;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  if (horizontal) {
    const barH = Math.min(28, (chartH - (data.length - 1) * 8) / data.length);

    return (
      <div className="relative">
        {title && <h3 className="mb-2 text-sm font-medium">{title}</h3>}
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Usage bar chart">
          {data.map((d, i) => {
            const y = padT + i * (barH + 8);
            const barW = (d.value / max) * chartW;
            const color = d.color || CHART_COLORS[i % CHART_COLORS.length] || DEFAULT_LINE_COLOR;
            return (
              <g key={i} className="group">
                <text
                  x={padL - 8}
                  y={y + barH / 2 + 4}
                  textAnchor="end"
                  className="fill-foreground"
                  fontSize="11"
                  fontWeight="500"
                >
                  {d.label}
                </text>
                <rect
                  x={padL}
                  y={y}
                  width={chartW}
                  height={barH}
                  fill="currentColor"
                  fillOpacity="0.05"
                  rx="4"
                />
                <rect
                  x={padL}
                  y={y}
                  width={barW}
                  height={barH}
                  fill={color}
                  rx="4"
                  className="transition-all group-hover:opacity-90"
                  tabIndex={0}
                />
                <text
                  x={padL + barW + 8}
                  y={y + barH / 2 + 4}
                  className="fill-muted-foreground"
                  fontSize="11"
                >
                  {fmt(d.value)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  const barWidth = Math.min(40, (chartW - data.length * 8) / data.length);

  return (
    <div className="relative">
      {title && <h3 className="mb-2 text-sm font-medium">{title}</h3>}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Usage bar chart">
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
              {fmt(max * ratio)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * (barWidth + 8);
          const barHeight = (d.value / max) * chartH;
          const y = padT + chartH - barHeight;
          const color = d.color || CHART_COLORS[i % CHART_COLORS.length] || DEFAULT_LINE_COLOR;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={color} rx="4" tabIndex={0} />
              <text
                x={x + barWidth / 2}
                y={h - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
