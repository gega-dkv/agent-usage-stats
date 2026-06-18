type DonutPoint = { label: string; value: number; color?: string };

type DonutChartProps = {
  data: DonutPoint[];
  size?: number;
  formatValue?: (v: number) => string;
};

const COLORS = [
  'hsl(217, 91%, 60%)',  // blue
  'hsl(160, 84%, 39%)',  // emerald
  'hsl(38, 92%, 50%)',   // amber
  'hsl(280, 65%, 60%)',  // purple
  'hsl(340, 82%, 52%)',  // pink
];

export function DonutChart({ data, size = 200, formatValue }: DonutChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ width: size, height: size }}
      >
        No data
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  const fmt = formatValue || ((v) => v.toLocaleString());
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
    return { ...d, start, end, color: d.color || COLORS[i % COLORS.length] };
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
      <svg width={size} height={size} className="flex-shrink-0">
        {segments.map((s, i) => (
          <path
            key={i}
            d={arc(s.start, s.end)}
            fill={s.color}
            className="transition-opacity hover:opacity-80"
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
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="10"
          className="fill-muted-foreground"
        >
          Total
        </text>
      </svg>
      <div className="space-y-2">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
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
