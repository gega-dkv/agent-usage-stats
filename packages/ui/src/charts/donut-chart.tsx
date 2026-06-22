import { CHART_COLORS, shortNumber } from './chart-utils.js';

type DonutChartData = {
  label: string;
  value: number;
  color?: string;
};

type ProviderDonutChartProps = {
  data: DonutChartData[];
  size?: number;
  title?: string;
  formatValue?: (value: number) => string;
  /** Resolve a color for a label (e.g. provider hue). Falls back to the palette. */
  colorFor?: (label: string, index: number) => string | undefined;
};

export function ProviderDonutChart({
  data,
  size = 200,
  title,
  formatValue,
  colorFor,
}: ProviderDonutChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ width: size, height: size }}
        role="img"
        aria-label="No data available"
      >
        No data available
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const fmt = formatValue || shortNumber;
  const r = size / 2 - 10;
  const inner = r * 0.6;
  const cx = size / 2;
  const cy = size / 2;

  let acc = 0;
  const segments = data.map((d, i) => {
    const angle = (d.value / total) * Math.PI * 2;
    const start = acc;
    const end = acc + angle;
    acc = end;
    return { ...d, start, end, color: d.color || colorFor?.(d.label, i) || CHART_COLORS[i % CHART_COLORS.length] };
  });

  function arc(start: number, end: number) {
    const x1 = cx + r * Math.cos(start - Math.PI / 2);
    const y1 = cy + r * Math.sin(start - Math.PI / 2);
    const x2 = cx + r * Math.cos(end - Math.PI / 2);
    const y2 = cy + r * Math.sin(end - Math.PI / 2);
    const x3 = cx + inner * Math.cos(end - Math.PI / 2);
    const y3 = cy + inner * Math.sin(end - Math.PI / 2);
    const x4 = cx + inner * Math.cos(start - Math.PI / 2);
    const y4 = cy + inner * Math.sin(start - Math.PI / 2);
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
  }

  return (
    <div className="flex items-center gap-6">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      <svg width={size} height={size} className="shrink-0" role="img" aria-label="Provider donut chart">
        {segments.map((s, i) => (
          <path
            key={i}
            d={arc(s.start, s.end)}
            fill={s.color}
            className="transition-opacity hover:opacity-80"
            tabIndex={0}
            aria-label={`${s.label}: ${fmt(s.value)}`}
          />
        ))}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="14"
          fontWeight="600"
          className="fill-foreground"
        >
          {fmt(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
          Total
        </text>
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="size-3 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="text-foreground">{s.label}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
