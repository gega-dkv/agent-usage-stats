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
  width?: number;
  height?: number;
  title?: string;
  formatValue?: (value: number) => string;
};

export function CostStackedBarChart({
  data,
  width = 400,
  height = 200,
  title,
  formatValue,
}: CostStackedBarChartProps) {
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

  const allValues = data.flatMap((d) => d.stacks.map((s) => s.value));
  const maxValue = Math.max(...allValues);
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const format = formatValue || ((v: number) => v.toLocaleString());

  const defaultColors = [
    'hsl(222.2, 47.4%, 11.2%)',
    'hsl(210, 40%, 50%)',
    'hsl(150, 50%, 40%)',
    'hsl(30, 80%, 50%)',
    'hsl(280, 60%, 50%)',
  ];

  const barWidth = Math.min(40, (chartWidth - data.length * 8) / data.length);

  return (
    <div className="relative">
      {title && <h3 className="text-sm font-medium mb-2">{title}</h3>}
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

        {/* Stacked bars */}
        {data.map((d, i) => {
          const x = padding.left + i * (barWidth + 8);
          let currentY = padding.top + chartHeight;

          return (
            <g key={i}>
              {d.stacks.map((stack, j) => {
                const stackHeight = (stack.value / maxValue) * chartHeight;
                currentY -= stackHeight;
                const color = stack.color || defaultColors[j % defaultColors.length];

                return (
                  <rect
                    key={j}
                    x={x}
                    y={currentY}
                    width={barWidth}
                    height={stackHeight}
                    fill={color}
                    rx={j === d.stacks.length - 1 ? 4 : 0}
                  />
                );
              })}
              <text
                x={x + barWidth / 2}
                y={height - 10}
                textAnchor="middle"
                className="fill-current text-xs"
                style={{ color: 'hsl(var(--muted-foreground))' }}
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
