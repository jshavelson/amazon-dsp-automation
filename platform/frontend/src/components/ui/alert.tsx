import React from 'react';
import clsx from 'clsx';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive' | 'warning' | 'info' | 'success';
}

export const Alert: React.FC<AlertProps> = ({ className, variant = 'default', children, ...props }) => (
  <div
    className={clsx(
      'rounded-md border p-4',
      {
        'bg-background text-foreground': variant === 'default',
        'bg-destructive/10 text-destructive border-destructive': variant === 'destructive',
        'bg-warning/10 text-warning border-warning': variant === 'warning',
        'bg-info/10 text-info border-info': variant === 'info',
        'bg-success/10 text-success border-success': variant === 'success',
      },
      className
    )}
    role="alert"
    {...props}
  >
    {children}
  </div>
);

Alert.displayName = 'Alert';

interface AlertTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export const AlertTitle: React.FC<AlertTitleProps> = ({ className, ...props }) => (
  <h5
    className={clsx('mb-1 font-medium leading-none tracking-tight', className)}
    {...props}
  />
);

AlertTitle.displayName = 'AlertTitle';

interface AlertDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export const AlertDescription: React.FC<AlertDescriptionProps> = ({ className, ...props }) => (
  <div
    className={clsx('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
);

AlertDescription.displayName = 'AlertDescription';
