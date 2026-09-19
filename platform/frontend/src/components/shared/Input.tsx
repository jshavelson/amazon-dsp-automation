import React, { forwardRef, useState } from 'react';
import clsx from 'clsx';
import { Eye, EyeOff, AlertCircle, CheckCircle, XCircle, Info } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  success?: string;
  hint?: string;
  required?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = 'text',
      label,
      error,
      success,
      hint,
      required = false,
      leftIcon,
      rightIcon,
      fullWidth = true,
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    // Determine input type for password visibility toggle
    const inputType = type === 'password' && showPassword ? 'text' : type;

    // Toggle password visibility
    const togglePasswordVisibility = () => {
      setShowPassword(!showPassword);
    };

    // Get icon based on state
    const getStateIcon = () => {
      if (error) {
        return <AlertCircle size={18} className="text-danger-500" />;
      }
      if (success) {
        return <CheckCircle size={18} className="text-success-500" />;
      }
      if (hint) {
        return <Info size={18} className="text-gray-400" />;
      }
      return null;
    };

    return (
      <div className={clsx('flex flex-col', { 'w-full': fullWidth })}>
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            {label}
            {required && <span className="text-danger-500 ml-1">*</span>}
          </label>
        )}

        {/* Input wrapper */}
        <div className="relative">
          {/* Left icon */}
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {leftIcon}
            </div>
          )}

          {/* Input */}
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${inputId}-error` :
              success ? `${inputId}-success` :
              hint ? `${inputId}-hint` :
              undefined
            }
            className={clsx(
              'w-full px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400',
              'transition-colors duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:outline-none',
              {
                'pl-10': leftIcon,
                'pr-10': rightIcon || (type === 'password') || (error || success || hint),
                'border-danger-500 focus:border-danger-500 focus:ring-danger-500': error,
                'border-success-500 focus:border-success-500 focus:ring-success-500': success,
                'border-gray-300': !error && !success,
                'bg-gray-50 cursor-not-allowed': disabled,
              },
              className
            )}
            {...props}
          />

          {/* Right icon */}
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {rightIcon}
            </div>
          )}

          {/* Password visibility toggle */}
          {type === 'password' && (
            <button
              type="button"
              onClick={togglePasswordVisibility}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}

          {/* State icon */}
          {(error || success || hint) && !rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {getStateIcon()}
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <p
            id={`${inputId}-error`}
            className="mt-1 text-sm text-danger-500"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Success message */}
        {success && (
          <p
            id={`${inputId}-success`}
            className="mt-1 text-sm text-success-500"
          >
            {success}
          </p>
        )}

        {/* Hint message */}
        {hint && !error && !success && (
          <p
            id={`${inputId}-hint`}
            className="mt-1 text-sm text-gray-500"
          >
            {hint}
          </p>
        )}
      </div>
    );
  }
);

// Textarea component
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  success?: string;
  hint?: string;
  required?: boolean;
  fullWidth?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      error,
      success,
      hint,
      required = false,
      fullWidth = true,
      disabled,
      id,
      rows = 4,
      ...props
    },
    ref
  ) => {
    const inputId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className={clsx('flex flex-col', { 'w-full': fullWidth })}>
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            {label}
            {required && <span className="text-danger-500 ml-1">*</span>}
          </label>
        )}

        {/* Textarea */}
        <textarea
          ref={ref}
          id={inputId}
          disabled={disabled}
          rows={rows}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${inputId}-error` :
            success ? `${inputId}-success` :
            hint ? `${inputId}-hint` :
            undefined
          }
          className={clsx(
            'w-full px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400 resize-none',
            'transition-colors duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:outline-none',
            {
              'border-danger-500 focus:border-danger-500 focus:ring-danger-500': error,
              'border-success-500 focus:border-success-500 focus:ring-success-500': success,
              'border-gray-300': !error && !success,
              'bg-gray-50 cursor-not-allowed': disabled,
            },
            className
          )}
          {...props}
        />

        {/* Error message */}
        {error && (
          <p
            id={`${inputId}-error`}
            className="mt-1 text-sm text-danger-500"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Success message */}
        {success && (
          <p
            id={`${inputId}-success`}
            className="mt-1 text-sm text-success-500"
          >
            {success}
          </p>
        )}

        {/* Hint message */}
        {hint && !error && !success && (
          <p
            id={`${inputId}-hint`}
            className="mt-1 text-sm text-gray-500"
          >
            {hint}
          </p>
        )}
      </div>
    );
  }
);

// Export components
Input.displayName = 'Input';
Textarea.displayName = 'Textarea';

export { Input, Textarea };
