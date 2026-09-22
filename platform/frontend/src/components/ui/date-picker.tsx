import React from 'react';
import clsx from 'clsx';

interface DatePickerProps {
  className?: string;
  value?: string;
  onChange?: (date: string) => void;
  date?: Date;
  onSelect?: (date?: Date) => void;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  showTimePicker?: boolean;
}

export const DatePicker: React.FC<DatePickerProps> = ({ className, value, onChange, date, onSelect, disabled, minDate, maxDate }) => (
  <input
    type="date"
    value={value ?? (date ? date.toISOString().slice(0, 10) : '')}
    disabled={disabled}
    min={minDate?.toISOString().slice(0, 10)}
    max={maxDate?.toISOString().slice(0, 10)}
    onChange={(e) => {
      onChange?.(e.target.value);
      onSelect?.(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined);
    }}
    className={clsx(
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
  />
);

DatePicker.displayName = 'DatePicker';
