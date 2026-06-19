type CalendarHeatmapData = {
  date: string;
  value: number;
};

type CalendarHeatmapProps = {
  data: CalendarHeatmapData[];
  width?: number;
  height?: number;
  title?: string;
  colorScale?: string[];
};

export function CalendarHeatmap({
  data,
  width = 700,
  height = 150,
  title,
  colorScale = [
    'hsl(var(--muted))',
    'hsl(150, 50%, 70%)',
    'hsl(150, 50%, 50%)',
    'hsl(150, 50%, 30%)',
  ],
}: CalendarHeatmapProps) {
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
  const padding = { top: 20, right: 20, bottom: 20, left: 20 };
  const cellSize = 15;
  const cellGap = 3;

  const valueToColor = (value: number) => {
    if (value === 0) return colorScale[0];
    const ratio = value / maxValue;
    const index = Math.min(
      Math.ceil(ratio * (colorScale.length - 1)),
      colorScale.length - 1,
    );
    return colorScale[index];
  };

  // Generate date map for quick lookup
  const dateMap = new Map(data.map((d) => [d.date, d.value]));

  // Generate calendar grid (last 365 days)
  const today = new Date();
  const days: Array<{ date: string; value: number; dayOfWeek: number; week: number }> = [];

  for (let i = 364; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();
    const week = Math.floor(i / 7);

    days.push({
      date: dateStr,
      value: dateMap.get(dateStr) || 0,
      dayOfWeek,
      week,
    });
  }

  const totalWeeks = Math.ceil(365 / 7);

  return (
    <div className="relative">
      {title && <h3 className="text-sm font-medium mb-2">{title}</h3>}
      <svg width={width} height={height} className="w-full h-auto">
        {/* Day labels */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
          <text
            key={day}
            x={padding.left - 5}
            y={padding.top + i * (cellSize + cellGap) + cellSize / 2 + 4}
            textAnchor="end"
            className="fill-current text-xs"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            {i % 2 === 0 ? day : ''}
          </text>
        ))}

        {/* Calendar cells */}
        {days.map((day, i) => {
          const x = padding.left + (day.week % totalWeeks) * (cellSize + cellGap);
          const y = padding.top + day.dayOfWeek * (cellSize + cellGap);

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              fill={valueToColor(day.value)}
              rx={2}
              className="hover:stroke-foreground hover:stroke-2"
            >
              <title>{`${day.date}: ${day.value}`}</title>
            </rect>
          );
        })}

        {/* Legend */}
        <g transform={`translate(${width - 100}, ${padding.top})`}>
          <text
            x={0}
            y={0}
            className="fill-current text-xs"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            Less
          </text>
          {colorScale.map((color, i) => (
            <rect
              key={i}
              x={30 + i * (cellSize + 2)}
              y={-10}
              width={cellSize}
              height={cellSize}
              fill={color}
              rx={2}
            />
          ))}
          <text
            x={30 + colorScale.length * (cellSize + 2) + 5}
            y={0}
            className="fill-current text-xs"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            More
          </text>
        </g>
      </svg>
    </div>
  );
}
