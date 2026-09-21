import React from 'react';
import clsx from 'clsx';

interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {}

export const RadioGroup: React.FC<RadioGroupProps> = ({ className, ...props }) => (
  <div
    className={clsx('grid gap-2', className)}
    role="radiogroup"
    {...props}
  />
);

RadioGroup.displayName = 'RadioGroup';

interface RadioGroupItemProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const RadioGroupItem: React.FC<RadioGroupItemProps> = ({ className, ...props }) => (
  <div className="flex items-center space-x-2">
    <input
      type="radio"
      className={clsx(
        'h-4 w-4 border border-primary text-primary ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  </div>
);

RadioGroupItem.displayName = 'RadioGroupItem';
