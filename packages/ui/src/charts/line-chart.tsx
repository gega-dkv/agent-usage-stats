'use client';

import { useRef, useState } from 'react';
import { DEFAULT_LINE_COLOR, shortNumber } from './chart-utils.js';
import { useResizeObserver } from './use-resize-observer.js';

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

/**
 * Responsive line+area chart with a shared crosshair tooltip.
 * Fills its container width via ResizeObserver; hover/focus reveals a vertical
 * guide and value badge. Empty state renders a muted placeholder.
 */
export function UsageLineChart({
  data,
  height = 220,
  color = DEFAULT_LINE_COLOR,
  gradient = true,
  formatValue,
}: UsageLineChartProps) {
  const { ref, width } = useResizeObserver<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
        style={{ height }}
        role="img"
        aria-label="No data available"
      >
        No data available
      </div>
    );
  }

  const fmt = formatValue || shortNumber;
  const w = Math.max(width || 600, 280);
  const h = height;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const max = Math.max(...data.map((d) => d.value), 1);
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
    yLabels.push({ y: padT + chartH - (i / gridLines) * chartH, value: (i / gridLines) * max });
  }

  const xStep = Math.max(1, Math.ceil(data.length / 7));
  const hoverPoint = hover != null ? points[hover] : null;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = w / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    // Find nearest point by x.
    let nearest = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - x);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = i;
      }
    }
    setHover(nearest);
  };

  return (
    <div ref={ref} className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Usage line chart"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="usageLineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid + Y labels */}
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
            <text x={padL - 8} y={l.y + 4} textAnchor="end" className="fill-muted-foreground" fontSize="10">
              {fmt(l.value)}
            </text>
          </g>
        ))}

        {/* X labels (spaced) */}
        {points.map((p, i) => {
          if (i % xStep !== 0 && i !== data.length - 1) return null;
          return (
            <text key={i} x={p.x} y={h - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              {p.label}
            </text>
          );
        })}

        {/* Crosshair */}
        {hoverPoint && (
          <g>
            <line
              x1={hoverPoint.x}
              y1={padT}
              x2={hoverPoint.x}
              y2={padT + chartH}
              stroke={color}
              strokeOpacity="0.3"
              strokeDasharray="3,3"
            />
          </g>
        )}

        {/* Area + line */}
        {gradient && <path d={areaPath} fill="url(#usageLineGrad)" />}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover point marker */}
        {hoverPoint && <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4" fill={color} stroke="hsl(var(--popover))" strokeWidth="2" />}

        {/* Hover tooltip */}
        {hoverPoint && (
          <g pointerEvents="none">
            {(() => {
              const tw = 80;
              const th = 32;
              // Clamp horizontally so the tooltip stays in view.
              const tx = Math.min(Math.max(hoverPoint.x - tw / 2, padL), w - padR - tw);
              const ty = Math.max(hoverPoint.y - th - 10, padT);
              return (
                <>
                  <rect x={tx} y={ty} width={tw} height={th} rx="6" fill="hsl(var(--popover))" stroke="hsl(var(--border))" />
                  <text x={tx + tw / 2} y={ty + 13} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
                    {hoverPoint.label}
                  </text>
                  <text x={tx + tw / 2} y={ty + 26} textAnchor="middle" fontSize="11" fontWeight="600" className="fill-foreground">
                    {fmt(hoverPoint.value)}
                  </text>
                </>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
