import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'outline' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    // Base styles
    const baseStyles = `
      inline-flex items-center justify-center font-medium rounded-lg
      transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
    `;

    // Variant styles
    const variantStyles = {
      primary: `
        bg-primary-600 text-white
        hover:bg-primary-700
        focus:ring-primary-500
        active:bg-primary-800
      `,
      secondary: `
        bg-gray-100 text-gray-700
        hover:bg-gray-200
        focus:ring-gray-500
        active:bg-gray-300
      `,
      success: `
        bg-success-600 text-white
        hover:bg-success-700
        focus:ring-success-500
        active:bg-success-800
      `,
      warning: `
        bg-warning-600 text-white
        hover:bg-warning-700
        focus:ring-warning-500
        active:bg-warning-800
      `,
      danger: `
        bg-danger-600 text-white
        hover:bg-danger-700
        focus:ring-danger-500
        active:bg-danger-800
      `,
      outline: `
        border-2 border-gray-300 text-gray-700 bg-transparent
        hover:bg-gray-50
        focus:ring-gray-500
        active:bg-gray-100
      `,
      ghost: `
        text-gray-600 bg-transparent
        hover:bg-gray-100
        focus:ring-gray-500
        active:bg-gray-200
      `,
      link: `
        text-primary-600 bg-transparent underline-offset-4
        hover:text-primary-700 hover:underline
        focus:ring-primary-500
        p-0
      `,
    };

    // Size styles
    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
      xl: 'px-8 py-4 text-lg',
    };

    // Full width style
    const fullWidthStyle = fullWidth ? 'w-full' : '';

    // Loading state
    const showLoading = isLoading || disabled;

    return (
      <button
        ref={ref}
        className={clsx(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          fullWidthStyle,
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {showLoading ? (
          <>
            <Loader2
              size={size === 'sm' ? 14 : size === 'md' ? 16 : 18}
              className="animate-spin mr-2"
            />
            {children}
          </>
        ) : (
          <>
            {leftIcon && <span className="mr-2">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="ml-2">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

// Icon Button
interface IconButtonProps extends ButtonProps {
  icon: React.ReactNode;
  ariaLabel: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, ariaLabel, className, size = 'md', variant = 'ghost', ...props }, ref) => {
    const sizeClasses = {
      sm: 'p-1.5',
      md: 'p-2',
      lg: 'p-2.5',
      xl: 'p-3',
    };

    return (
      <Button
        ref={ref}
        className={clsx(sizeClasses[size], className)}
        variant={variant}
        aria-label={ariaLabel}
        {...props}
      >
        {icon}
      </Button>
    );
  }
);

// Button Group
interface ButtonGroupProps {
  children: React.ReactNode;
  className?: string;
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ children, className }) => {
  return (
    <div className={clsx('inline-flex items-center space-x-2', className)}>
      {React.Children.map(children, (child, index) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            className: clsx(
              child.props.className,
              index === 0 ? 'rounded-r-none' : '',
              index === React.Children.count(children) - 1 ? 'rounded-l-none' : '',
              index > 0 && index < React.Children.count(children) - 1
                ? 'rounded-none' : ''
            ),
          });
        }
        return child;
      })}
    </div>
  );
};

// Export all components
Button.displayName = 'Button';
IconButton.displayName = 'IconButton';
ButtonGroup.displayName = 'ButtonGroup';

export { Button };
