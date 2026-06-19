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
};

export function ProviderDonutChart({
  data,
  size = 200,
  title,
  formatValue,
}: ProviderDonutChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ width: size, height: size }}
      >
        No data available
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const format = formatValue || ((v: number) => v.toLocaleString());

  const defaultColors = [
    'hsl(222.2, 47.4%, 11.2%)',
    'hsl(210, 40%, 50%)',
    'hsl(150, 50%, 40%)',
    'hsl(30, 80%, 50%)',
    'hsl(280, 60%, 50%)',
  ];

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 20;
  const innerRadius = radius * 0.6;

  let currentAngle = -90;

  const segments = data.map((d, i) => {
    const percentage = d.value / total;
    const angle = percentage * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const ix1 = cx + innerRadius * Math.cos(startRad);
    const iy1 = cy + innerRadius * Math.sin(startRad);
    const ix2 = cx + innerRadius * Math.cos(endRad);
    const iy2 = cy + innerRadius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    const pathD = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1}`,
      'Z',
    ].join(' ');

    const color = d.color || defaultColors[i % defaultColors.length];

    return { pathD, color, percentage, label: d.label, value: d.value };
  });

  return (
    <div className="flex items-center gap-4">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      <svg width={size} height={size} className="flex-shrink-0">
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.pathD}
            fill={seg.color}
            className="hover:opacity-80 transition-opacity"
          />
        ))}
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          className="fill-current text-lg font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          {format(total)}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          className="fill-current text-xs"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          Total
        </text>
      </svg>
      <div className="space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-mono">{format(seg.value)}</span>
            <span className="text-muted-foreground">
              ({(seg.percentage * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
