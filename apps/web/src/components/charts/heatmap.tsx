'use client';

import { useEffect, useState } from 'react';

type HeatmapCell = { date: string; value: number };

type HeatmapProps = {
  data: HeatmapCell[];
  weeks?: number;
};

export function CalendarHeatmap({ data, weeks = 26 }: HeatmapProps) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const map = new Map(data.map((d) => [d.date, d.value]));
  const max = Math.max(...data.map((d) => d.value), 1);
  const cell = 14;
  const gap = 3;
  const w = weeks * (cell + gap) + 30;
  const h = 7 * (cell + gap) + 20;

  const today = new Date();
  const startDay = new Date(today);
  startDay.setDate(today.getDate() - weeks * 7 + 1);

  const cells: { x: number; y: number; date: string; value: number; intensity: number }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const value = map.get(dateStr) || 0;
    const intensity = value / max;
    const dow = d.getDay();
    const week = Math.floor(i / 7);
    cells.push({
      x: 30 + week * (cell + gap),
      y: 10 + dow * (cell + gap),
      date: dateStr,
      value,
      intensity,
    });
  }

  function color(intensity: number) {
    if (intensity === 0) return dark ? 'hsl(220, 13%, 18%)' : 'hsl(214, 32%, 91%)';
    if (intensity < 0.25) return dark ? 'hsl(217, 91%, 30%)' : 'hsl(217, 91%, 90%)';
    if (intensity < 0.5) return dark ? 'hsl(217, 91%, 45%)' : 'hsl(217, 91%, 70%)';
    if (intensity < 0.75) return dark ? 'hsl(217, 91%, 60%)' : 'hsl(217, 91%, 55%)';
    return dark ? 'hsl(217, 91%, 70%)' : 'hsl(217, 91%, 40%)';
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[600px]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) =>
          i % 2 === 0 ? (
            <text
              key={day}
              x={26}
              y={10 + i * (cell + gap) + cell - 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {day}
            </text>
          ) : null,
        )}
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width={cell}
            height={cell}
            fill={color(c.intensity)}
            rx="2"
            className="transition-opacity hover:opacity-80"
          >
            <title>
              {c.date}: {c.value}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
