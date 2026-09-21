import React from 'react';
import clsx from 'clsx';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', children, ...props }) => (
  <span
    className={clsx(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      {
        'bg-primary text-primary-foreground': variant === 'default',
        'bg-secondary text-secondary-foreground': variant === 'secondary',
        'bg-destructive text-destructive-foreground': variant === 'destructive',
        'text-foreground': variant === 'outline',
      },
      className
    )}
    {...props}
  >
    {children}
  </span>
);

Badge.displayName = 'Badge';
