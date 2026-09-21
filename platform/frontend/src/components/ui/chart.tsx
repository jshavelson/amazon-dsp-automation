import React from 'react';
import clsx from 'clsx';

interface ChartProps {
  className?: string;
  children?: React.ReactNode;
}

export const Chart: React.FC<ChartProps> = ({ className, children }) => (
  <div className={clsx('h-[300px] w-full', className)}>
    {children || <p className="text-muted-foreground text-center py-12">Chart placeholder</p>}
  </div>
);

Chart.displayName = 'Chart';
