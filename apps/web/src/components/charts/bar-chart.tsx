type BarPoint = { label: string; value: number; color?: string };

type BarChartProps = {
  data: BarPoint[];
  height?: number;
  formatValue?: (v: number) => string;
};

export function BarChart({ data, height = 200, formatValue }: BarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 600;
  const h = height;
  const padL = 70;
  const padR = 70;
  const padT = 20;
  const padB = 20;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const barH = Math.min(28, (chartH - (data.length - 1) * 8) / data.length);

  const fmt = formatValue || ((v) => v.toLocaleString());

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const y = padT + i * (barH + 8);
        const barW = (d.value / max) * chartW;
        const color = d.color || 'hsl(217, 91%, 60%)';
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
  );
}
