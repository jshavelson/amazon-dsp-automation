import React from 'react';
import {
  Bar,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';

interface BarChartProps {
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
  layout?: 'horizontal' | 'vertical';
  config?: Record<string, unknown>;
  onBarClick?: (data: Record<string, unknown>, index: number) => void;
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

const BarChart: React.FC<BarChartProps> = ({
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
  layout = 'vertical',
  config,
  onBarClick,
}) => {
  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[${height}px] bg-muted rounded-lg ${className}`}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const handleBarClick = (
    _: Record<string, unknown>,
    index: number
  ): void => {
    if (onBarClick) {
      onBarClick(data[index], index);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {title && (
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
      )}
      <div className="rounded-lg border bg-card p-4">
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart
            data={data}
            layout={layout}
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
            {yKeys.map((yKey, index) => (
              <Bar
                key={yKey}
                dataKey={yKey}
                fill={colors[index % colors.length]}
                radius={[4, 4, 0, 0]}
                onClick={handleBarClick}
                name={yKey}
              >
                {data.map((_, cellIndex) => (
                  <Cell
                    key={`cell-${cellIndex}`}
                    fill={colors[index % colors.length]}
                  />
                ))}
              </Bar>
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default BarChart;
