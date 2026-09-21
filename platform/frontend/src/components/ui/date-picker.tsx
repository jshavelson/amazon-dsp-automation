import React from 'react';
import clsx from 'clsx';

interface DatePickerProps {
  className?: string;
  value?: string;
  onChange?: (date: string) => void;
}

export const DatePicker: React.FC<DatePickerProps> = ({ className, value, onChange }) => (
  <input
    type="date"
    value={value}
    onChange={(e) => onChange?.(e.target.value)}
    className={clsx(
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
  />
);

DatePicker.displayName = 'DatePicker';
