import React, { useState, useEffect, forwardRef } from 'react';
import { useFormContext, Controller, FieldValues, FieldPath, UseControllerProps } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Input, InputProps } from '@/components/ui/input';
import { Textarea, TextareaProps } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox, CheckboxProps } from '@/components/ui/checkbox';
import { Switch, SwitchProps } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem, RadioGroupProps } from '@/components/ui/radio-group';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Calendar, AlertCircle } from 'lucide-react';

// Base FormField props
export interface FormFieldProps<T extends FieldValues> {
  name: FieldPath<T>;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  helperText?: string;
  errorMessage?: string;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
  containerClassName?: string;
}

// Input FormField
export interface FormInputProps<T extends FieldValues> extends FormFieldProps<T>, Omit<InputProps, 'name' | 'value' | 'onChange'> {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
}

export function FormInput<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder,
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  type = 'text',
  ...props
}: FormInputProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const [showPassword, setShowPassword] = useState(false);
  const error = errors[name];
  const isPassword = type === 'password';

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          {label && (
            <Label htmlFor={name} className={cn('flex items-center gap-1', labelClassName)}>
              {label}
              {required && <span className="text-destructive" aria-hidden="true">*</span>}
            </Label>
          )}
          <div className="relative">
            <Input
              id={name}
              type={isPassword && showPassword ? 'text' : type}
              disabled={disabled}
              readOnly={readOnly}
              placeholder={placeholder}
              className={cn(
                'w-full',
                error && 'border-destructive focus-visible:ring-destructive',
                inputClassName
              )}
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
              {...field}
              {...props}
            />
            {isPassword && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-0 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                disabled={disabled || readOnly}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            )}
          </div>
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Textarea FormField
export interface FormTextareaProps<T extends FieldValues> extends FormFieldProps<T>, Omit<TextareaProps, 'name' | 'value' | 'onChange'> {
  rows?: number;
}

export function FormTextarea<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder,
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  rows = 4,
  ...props
}: FormTextareaProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const error = errors[name];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          {label && (
            <Label htmlFor={name} className={cn('flex items-center gap-1', labelClassName)}>
              {label}
              {required && <span className="text-destructive" aria-hidden="true">*</span>}
            </Label>
          )}
          <Textarea
            id={name}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            rows={rows}
            className={cn(
              'w-full',
              error && 'border-destructive focus-visible:ring-destructive',
              inputClassName
            )}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
            {...field}
            {...props}
          />
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Select FormField
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FormSelectProps<T extends FieldValues> extends FormFieldProps<T> {
  options: SelectOption[];
  placeholder?: string;
}

export function FormSelect<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder = 'Select an option',
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  options,
}: FormSelectProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const error = errors[name];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          {label && (
            <Label htmlFor={name} className={cn('flex items-center gap-1', labelClassName)}>
              {label}
              {required && <span className="text-destructive" aria-hidden="true">*</span>}
            </Label>
          )}
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled || readOnly}
            required={required}
          >
            <SelectTrigger
              id={name}
              className={cn(
                'w-full',
                error && 'border-destructive',
                inputClassName
              )}
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Checkbox FormField
export interface FormCheckboxProps<T extends FieldValues> extends FormFieldProps<T>, Omit<CheckboxProps, 'name' | 'checked' | 'onCheckedChange'> {
  labelPlacement?: 'left' | 'right';
}

export function FormCheckbox<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  labelPlacement = 'right',
  ...props
}: FormCheckboxProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const error = errors[name];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          <div className={cn('flex items-center gap-2', labelPlacement === 'left' && 'flex-row-reverse')}>
            <Checkbox
              id={name}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={disabled || readOnly}
              className={cn(
                error && 'border-destructive',
                inputClassName
              )}
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
              {...props}
            />
            {label && (
              <Label htmlFor={name} className={cn('cursor-pointer', labelClassName)}>
                {label}
                {required && <span className="text-destructive" aria-hidden="true">*</span>}
              </Label>
            )}
          </div>
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Switch FormField
export interface FormSwitchProps<T extends FieldValues> extends FormFieldProps<T>, Omit<SwitchProps, 'name' | 'checked' | 'onCheckedChange'> {
  labelPlacement?: 'left' | 'right';
}

export function FormSwitch<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  labelPlacement = 'right',
  ...props
}: FormSwitchProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const error = errors[name];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          <div className={cn('flex items-center gap-2', labelPlacement === 'left' && 'flex-row-reverse')}>
            <Switch
              id={name}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={disabled || readOnly}
              className={cn(
                error && 'border-destructive',
                inputClassName
              )}
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
              {...props}
            />
            {label && (
              <Label htmlFor={name} className={cn('cursor-pointer', labelClassName)}>
                {label}
                {required && <span className="text-destructive" aria-hidden="true">*</span>}
              </Label>
            )}
          </div>
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Date Picker FormField
export interface FormDatePickerProps<T extends FieldValues> extends FormFieldProps<T> {
  dateFormat?: string;
  showTimePicker?: boolean;
  minDate?: Date;
  maxDate?: Date;
}

export function FormDatePicker<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder = 'Select a date',
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  dateFormat = 'MM/dd/yyyy',
  showTimePicker = false,
  minDate,
  maxDate,
}: FormDatePickerProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const error = errors[name];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          {label && (
            <Label htmlFor={name} className={cn('flex items-center gap-1', labelClassName)}>
              {label}
              {required && <span className="text-destructive" aria-hidden="true">*</span>}
            </Label>
          )}
          <DatePicker
            date={field.value ? new Date(field.value) : undefined}
            onSelect={(date) => field.onChange(date?.toISOString())}
            placeholder={placeholder}
            disabled={disabled || readOnly}
            className={cn(
              'w-full',
              error && 'border-destructive',
              inputClassName
            )}
            minDate={minDate}
            maxDate={maxDate}
            showTimePicker={showTimePicker}
          />
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Radio Group FormField
export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FormRadioGroupProps<T extends FieldValues> extends FormFieldProps<T> {
  options: RadioOption[];
  orientation?: 'horizontal' | 'vertical';
}

export function FormRadioGroup<T extends FieldValues>({
  name,
  label,
  required = false,
  disabled = false,
  readOnly = false,
  helperText,
  errorMessage,
  className = '',
  labelClassName = '',
  inputClassName = '',
  containerClassName = '',
  options,
  orientation = 'vertical',
}: FormRadioGroupProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();
  const error = errors[name];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', containerClassName)}>
          {label && (
            <Label htmlFor={name} className={cn('flex items-center gap-1', labelClassName)}>
              {label}
              {required && <span className="text-destructive" aria-hidden="true">*</span>}
            </Label>
          )}
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled || readOnly}
            orientation={orientation}
            className={cn(
              error && 'border-destructive',
              inputClassName
            )}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
          >
            {options.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <RadioGroupItem
                  value={option.value}
                  id={`${name}-${option.value}`}
                  disabled={option.disabled}
                />
                <Label htmlFor={`${name}-${option.value}`} className="cursor-pointer">
                  {option.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {error && (
            <p
              id={`${name}-error`}
              className="text-sm text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorMessage || String(error.message)}
            </p>
          )}
          {helperText && !error && (
            <p id={`${name}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      )}
    />
  );
}

// Export all form field components
export {
  FormInput,
  FormTextarea,
  FormSelect,
  FormCheckbox,
  FormSwitch,
  FormDatePicker,
  FormRadioGroup,
};
