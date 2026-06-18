import React from 'react';

type LineChartData = {
  label: string;
  value: number;
};

type UsageLineChartProps = {
  data: LineChartData[];
  width?: number;
  height?: number;
  color?: string;
  title?: string;
  formatValue?: (value: number) => string;
};

export function UsageLineChart({
  data,
  width = 400,
  height = 200,
  color = 'hsl(222.2, 47.4%, 11.2%)',
  title,
  formatValue,
}: UsageLineChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ width, height }}
      >
        No data available
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartWidth,
    y: padding.top + chartHeight - (d.value / maxValue) * chartHeight,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  const format = formatValue || ((v: number) => v.toLocaleString());

  return (
    <div className="relative">
      {title && (
        <h3 className="text-sm font-medium mb-2">{title}</h3>
      )}
      <svg width={width} height={height} className="w-full h-auto">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={padding.left}
              y1={padding.top + chartHeight * (1 - ratio)}
              x2={padding.left + chartWidth}
              y2={padding.top + chartHeight * (1 - ratio)}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text
              x={padding.left - 8}
              y={padding.top + chartHeight * (1 - ratio) + 4}
              textAnchor="end"
              className="fill-current text-xs"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              {format(maxValue * ratio)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {data.filter((_, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1).map((d, i) => (
          <text
            key={i}
            x={padding.left + (data.indexOf(d) / (data.length - 1)) * chartWidth}
            y={height - 10}
            textAnchor="middle"
            className="fill-current text-xs"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            {d.label}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaD} fill={color} fillOpacity={0.1} />

        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={color}
            className="hover:r-4 transition-all"
          />
        ))}
      </svg>
    </div>
  );
}
