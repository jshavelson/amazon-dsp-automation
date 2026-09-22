import React, { forwardRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';

interface SelectProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

const SelectContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export const Select: React.FC<SelectProps> = ({
  value,
  onValueChange,
  placeholder,
  disabled = false,
  className,
  children,
  ...props
}) => {
  const [open, setOpen] = useState(false);

  return (
    <SelectContext.Provider value={{ value, onValueChange, disabled, open, setOpen }}>
      <div
        className={clsx('relative w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SelectContext.Provider>
  );
};

Select.displayName = 'Select';

interface SelectTriggerProps extends React.HTMLAttributes<HTMLButtonElement> {}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { value, placeholder, disabled, open, setOpen } = React.useContext(SelectContext);

    return (
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={clsx(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      >
        {children || (
          <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
            {value || placeholder || 'Select...'}
          </span>
        )}
        {open ? <ChevronUp className="h-4 w-4 opacity-50" /> : <ChevronDown className="h-4 w-4 opacity-50" />}
      </button>
    );
  }
);

SelectTrigger.displayName = 'SelectTrigger';

interface SelectValueProps extends React.HTMLAttributes<HTMLSpanElement> { placeholder?: string }

export const SelectValue: React.FC<SelectValueProps> = ({ className, placeholder, ...props }) => {
  const { value } = React.useContext(SelectContext);

  return (
    <span className={clsx('', className)} {...props}>
      {value || placeholder}
    </span>
  );
};

SelectValue.displayName = 'SelectValue';

interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const SelectContent: React.FC<SelectContentProps> = ({ className, children, ...props }) => {
  const { open, setOpen } = React.useContext(SelectContext);

  if (!open) return null;

  return (
    <div
      className={clsx(
        'absolute z-50 min-w-[8rem] bg-popover text-popover-foreground shadow-md rounded-md border border-input p-1',
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
};

SelectContent.displayName = 'SelectContent';

interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  disabled?: boolean;
}

export const SelectItem: React.FC<SelectItemProps> = ({ value, className, children, ...props }) => {
  const { onValueChange, setOpen } = React.useContext(SelectContext);

  return (
    <div
      className={clsx(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        className
      )}
      onClick={() => {
        onValueChange?.(value);
        setOpen(false);
      }}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <Check className="h-4 w-4 invisible data-[selected=true]:visible" />
      </span>
      <span className="ml-8">{children}</span>
    </div>
  );
};

SelectItem.displayName = 'SelectItem';
