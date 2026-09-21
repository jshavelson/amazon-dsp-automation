import React from 'react';
import clsx from 'clsx';

interface DateRangePickerProps {
  className?: string;
  onChange?: (range: { from: string; to: string }) => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ className, onChange }) => (
  <div className={clsx('flex space-x-2', className)}>
    <input
      type="date"
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      onChange={(e) => onChange?.({ from: e.target.value, to: '' })}
    />
    <span className="py-2">to</span>
    <input
      type="date"
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      onChange={(e) => onChange?.({ from: '', to: e.target.value })}
    />
  </div>
);

DateRangePicker.displayName = 'DateRangePicker';

// Alias for compatibility
export const DatePickerWithRange = DateRangePicker;
