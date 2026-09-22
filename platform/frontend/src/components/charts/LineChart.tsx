import React from 'react';
import {
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

interface LineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  title?: string;
  colors?: string[];
  height?: number;
  className?: string;
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  showDots?: boolean;
  strokeWidth?: number;
  referenceLines?: { value: number; label?: string; stroke?: string }[];
  onLineClick?: (data: Record<string, unknown>, index: number) => void;
}

const DEFAULT_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
  'hsl(var(--tertiary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--danger))',
  'hsl(var(--info))',
];

const LineChart: React.FC<LineChartProps> = ({
  data,
  xKey,
  yKeys,
  title,
  colors = DEFAULT_COLORS,
  height = 300,
  className = '',
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  showDots = true,
  strokeWidth = 2,
  referenceLines = [],
  onLineClick,
}) => {
  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[${height}px] bg-muted rounded-lg ${className}`}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const handleLineClick = (
    _: Record<string, unknown>,
    index: number
  ): void => {
    if (onLineClick) {
      onLineClick(data[index], index);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {title && (
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
      )}
      <div className="rounded-lg border bg-card p-4">
        <ResponsiveContainer width="100%" height={height}>
          <RechartsLineChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            {showGrid && (
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            )}
            <XAxis
              dataKey={xKey}
              stroke="hsl(var(--foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="hsl(var(--foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => {
                if (typeof value === 'number') {
                  if (value >= 1000) {
                    return `$${(value / 1000).toFixed(1)}K`;
                  }
                  return value.toString();
                }
                return String(value);
              }}
            />
            {showTooltip && (
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  padding: '12px',
                }}
                formatter={(value: unknown, name: string) => [
                  typeof value === 'number' ? `$${value.toLocaleString()}` : String(value),
                  name,
                ]}
              />
            )}
            {showLegend && (
              <Legend
                wrapperStyle={{
                  paddingTop: '20px',
                }}
                formatter={(value) => (
                  <span className="text-sm text-foreground">{value}</span>
                )}
              />
            )}
            {referenceLines.map((line, index) => (
              <ReferenceLine
                key={`ref-line-${index}`}
                y={line.value}
                stroke={line.stroke || 'hsl(var(--danger))'}
                strokeDasharray="3 3"
                label={{
                  value: line.label || `Target: ${line.value}`,
                  fill: line.stroke || 'hsl(var(--danger))',
                  fontSize: 12,
                }}
              />
            ))}
            {yKeys.map((yKey, index) => (
              <Line
                key={yKey}
                type="monotone"
                dataKey={yKey}
                stroke={colors[index % colors.length]}
                strokeWidth={strokeWidth}
                dot={showDots}
                activeDot={{ r: 8, fill: colors[index % colors.length] }}
                name={yKey}
                onClick={() => handleLineClick(data[0] || {}, 0)}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LineChart;
