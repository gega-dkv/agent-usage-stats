'use client';

/** Tiny inline sparkline — no axes, just a smoothed area for KPI cards. */
export function Sparkline({
  data,
  color = 'hsl(var(--primary))',
  width = 96,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data.length) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length === 1 ? width : width / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * (height - 4) - 2,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="1.75" fill={color} />}
    </svg>
  );
}
