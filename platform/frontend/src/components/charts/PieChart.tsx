import React from 'react';
import {
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';

interface PieChartProps {
  data: { name: string; value: number; [key: string]: unknown }[];
  title?: string;
  colors?: string[];
  height?: number;
  className?: string;
  showTooltip?: boolean;
  showLegend?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
  innerRadius?: number;
  outerRadius?: number;
  label?: boolean;
  onSliceClick?: (data: { name: string; value: number; [key: string]: unknown }, index: number) => void;
}

const DEFAULT_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
  'hsl(var(--tertiary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--danger))',
  'hsl(var(--info))',
  '#8884d8',
  '#a4de6c',
  '#d0ed57',
  '#ffc658',
];

const RADIAN = Math.PI / 180;

const renderCustomizedLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  index,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  index: number;
}) => {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="hsl(var(--foreground))"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
    >
      {percent > 0.05 ? `${(percent * 100).toFixed(1)}%` : ''}
    </text>
  );
};

const PieChart: React.FC<PieChartProps> = ({
  data,
  title,
  colors = DEFAULT_COLORS,
  height = 300,
  className = '',
  showTooltip = true,
  showLegend = true,
  legendPosition = 'bottom',
  innerRadius = 0,
  outerRadius = '80%',
  label = false,
  onSliceClick,
}) => {
  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[${height}px] bg-muted rounded-lg ${className}`}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const handleSliceClick = (
    _: { name: string; value: number; [key: string]: unknown },
    index: number
  ): void => {
    if (onSliceClick) {
      onSliceClick(data[index], index);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {title && (
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
      )}
      <div className="rounded-lg border bg-card p-4">
        <ResponsiveContainer width="100%" height={height}>
          <RechartsPieChart margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={label}
              label={label ? renderCustomizedLabel : undefined}
              outerRadius={outerRadius}
              innerRadius={innerRadius}
              fill="#8884d8"
              dataKey="value"
              nameKey="name"
              onClick={handleSliceClick}
            >
              {data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colors[index % colors.length]}
                />
              ))}
            </Pie>
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
                layout={legendPosition === 'left' || legendPosition === 'right' ? 'vertical' : 'horizontal'}
                align={legendPosition === 'left' ? 'left' : legendPosition === 'right' ? 'right' : 'center'}
                verticalAlign={legendPosition === 'top' ? 'top' : legendPosition === 'bottom' ? 'bottom' : 'middle'}
                wrapperStyle={{
                  paddingTop: legendPosition === 'bottom' ? '20px' : '0',
                  paddingLeft: legendPosition === 'right' ? '20px' : '0',
                }}
                formatter={(value) => (
                  <span className="text-sm text-foreground">{value}</span>
                )}
              />
            )}
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PieChart;
