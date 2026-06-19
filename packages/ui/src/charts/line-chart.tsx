import { DEFAULT_LINE_COLOR, shortNumber } from './chart-utils.js';

type LineChartData = {
  label: string;
  value: number;
};

type UsageLineChartProps = {
  data: LineChartData[];
  height?: number;
  color?: string;
  gradient?: boolean;
  formatValue?: (value: number) => string;
};

export function UsageLineChart({
  data,
  height = 200,
  color = DEFAULT_LINE_COLOR,
  gradient = true,
  formatValue,
}: UsageLineChartProps) {
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
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 30;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const points = data.map((d, i) => ({
    x: padL + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW),
    y: padT + chartH - (d.value / max) * chartH,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

  const gridLines = 4;
  const yLabels: { y: number; value: number }[] = [];
  for (let i = 0; i <= gridLines; i++) {
    yLabels.push({
      y: padT + chartH - (i / gridLines) * chartH,
      value: (i / gridLines) * max,
    });
  }

  const xStep = Math.max(1, Math.ceil(data.length / 6));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Usage line chart">
      <defs>
        <linearGradient id="usageLineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {yLabels.map((l, i) => (
        <g key={i}>
          <line
            x1={padL}
            y1={l.y}
            x2={w - padR}
            y2={l.y}
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeDasharray="2,3"
          />
          <text
            x={padL - 8}
            y={l.y + 4}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize="10"
          >
            {fmt(l.value)}
          </text>
        </g>
      ))}

      {points.map((p, i) => {
        if (i % xStep !== 0 && i !== data.length - 1) return null;
        return (
          <text
            key={i}
            x={p.x}
            y={h - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="10"
          >
            {p.label}
          </text>
        );
      })}

      {gradient && <path d={areaPath} fill="url(#usageLineGrad)" />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {points.map((p, i) => (
        <g key={i} className="group">
          <circle cx={p.x} cy={p.y} r="3" fill={color} className="transition-all" tabIndex={0} />
          <circle cx={p.x} cy={p.y} r="6" fill="transparent" className="cursor-pointer" />
          <g className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <rect
              x={p.x - 30}
              y={p.y - 30}
              width="60"
              height="20"
              rx="4"
              fill="hsl(var(--popover))"
              stroke="hsl(var(--border))"
            />
            <text x={p.x} y={p.y - 16} textAnchor="middle" fontSize="10" className="fill-foreground">
              {fmt(p.value)}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}
