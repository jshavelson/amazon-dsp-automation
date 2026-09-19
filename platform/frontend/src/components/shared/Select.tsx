import React, { forwardRef, useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronUp, Check, X, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  success?: string;
  hint?: string;
  required?: boolean;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  creatable?: boolean;
  fullWidth?: boolean;
  onChange?: (value: string) => void;
  value?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      success,
      hint,
      required = false,
      options,
      placeholder = 'Select an option',
      searchable = false,
      creatable = false,
      fullWidth = true,
      onChange,
      value,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [newOption, setNewOption] = useState('');
    const selectRef = useRef<HTMLDivElement>(null);
    const inputId = id || `select-${Math.random().toString(36).substr(2, 9)}`;

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
          setIsOpen(false);
          setSearchQuery('');
          setNewOption('');
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Handle keyboard navigation
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
          setSearchQuery('');
          setNewOption('');
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Get selected option label
    const getSelectedLabel = () => {
      const selectedOption = options.find((opt) => opt.value === value);
      return selectedOption?.label || placeholder;
    };

    // Filter options based on search query
    const filteredOptions = options.filter((option) =>
      option.label.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Handle option selection
    const handleSelect = (optionValue: string) => {
      if (onChange) {
        onChange(optionValue);
      }
      setIsOpen(false);
      setSearchQuery('');
      setNewOption('');
    };

    // Handle create new option
    const handleCreateOption = () => {
      if (newOption.trim() && creatable && onChange) {
        onChange(newOption.trim());
        setIsOpen(false);
        setSearchQuery('');
        setNewOption('');
      }
    };

    // Toggle dropdown
    const toggleDropdown = () => {
      if (!disabled) {
        setIsOpen(!isOpen);
        if (!isOpen) {
          setSearchQuery('');
          setNewOption('');
        }
      }
    };

    // Get state icon
    const getStateIcon = () => {
      if (error) {
        return <X size={18} className="text-danger-500" />;
      }
      if (success) {
        return <Check size={18} className="text-success-500" />;
      }
      return <ChevronDown size={18} className="text-gray-400" />;
    };

    return (
      <div
        ref={selectRef}
        className={clsx('flex flex-col relative', { 'w-full': fullWidth })}
      >
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

        {/* Select trigger */}
        <button
          type="button"
          id={inputId}
          onClick={toggleDropdown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${inputId}-error` :
            success ? `${inputId}-success` :
            hint ? `${inputId}-hint` :
            undefined
          }
          className={clsx(
            'w-full flex items-center justify-between px-4 py-2 border rounded-lg bg-white text-gray-900',
            'transition-colors duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:outline-none',
            {
              'border-danger-500 focus:border-danger-500 focus:ring-danger-500': error,
              'border-success-500 focus:border-success-500 focus:ring-success-500': success,
              'border-gray-300': !error && !success,
              'bg-gray-50 cursor-not-allowed': disabled,
              'text-gray-400': !value && placeholder,
            },
            className
          )}
        >
          <span className="truncate">{getSelectedLabel()}</span>
          {!isOpen ? (
            getStateIcon()
          ) : (
            <ChevronUp size={18} className="text-gray-400" />
          )}
        </button>

        {/* Dropdown */}
        <AnimatePresence>
          {isOpen && !disabled && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
            >
              {/* Search input */}
              {searchable && (
                <div className="p-2 border-b border-gray-100">
                  <div className="relative">
                    <Search
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {/* Options list */}
              <div className="max-h-60 overflow-y-auto">
                {filteredOptions.length === 0 && searchable && (
                  <div className="px-4 py-8 text-center text-gray-500">
                    <p>No options found</p>
                    {creatable && (
                      <div className="mt-4">
                        <p className="text-sm text-gray-500 mb-2">Create new option:</p>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            value={newOption}
                            onChange={(e) => setNewOption(e.target.value)}
                            placeholder="Enter new option"
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                          />
                          <button
                            onClick={handleCreateOption}
                            disabled={!newOption.trim()}
                            className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            Create
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    disabled={option.disabled}
                    className={clsx(
                      'w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center',
                      {
                        'bg-primary-50 text-primary-700': value === option.value,
                        'text-gray-400 cursor-not-allowed': option.disabled,
                        'text-gray-900': !option.disabled && value !== option.value,
                      }
                    )}
                  >
                    {option.label}
                    {value === option.value && (
                      <Check size={16} className="ml-auto text-primary-600" />
                    )}
                  </button>
                ))}

                {creatable && searchable && filteredOptions.length > 0 && (
                  <div className="px-4 py-2 border-t border-gray-100">
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={newOption}
                        onChange={(e) => setNewOption(e.target.value)}
                        placeholder="Create new option"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                      />
                      <button
                        onClick={handleCreateOption}
                        disabled={!newOption.trim()}
                        className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

// Multi-select component
interface MultiSelectProps {
  label?: string;
  error?: string;
  success?: string;
  hint?: string;
  required?: boolean;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  fullWidth?: boolean;
  onChange?: (values: string[]) => void;
  value?: string[];
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  error,
  success,
  hint,
  required = false,
  options,
  placeholder = 'Select options',
  searchable = false,
  fullWidth = true,
  onChange,
  value = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const selectRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options based on search query
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle option toggle
  const handleToggle = (optionValue: string) => {
    const newValues = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    
    if (onChange) {
      onChange(newValues);
    }
  };

  // Get selected labels
  const getSelectedLabels = () => {
    const selectedOptions = options.filter((opt) => value.includes(opt.value));
    if (selectedOptions.length === 0) {
      return placeholder;
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0].label;
    }
    return `${selectedOptions.length} selected`;
  };

  // Toggle dropdown
  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setSearchQuery('');
    }
  };

  return (
    <div
      ref={selectRef}
      className={clsx('flex flex-col relative', { 'w-full': fullWidth })}
    >
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
          {required && <span className="text-danger-500 ml-1">*</span>}
        </label>
      )}

      {/* Select trigger */}
      <button
        type="button"
        onClick={toggleDropdown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-invalid={!!error}
        className={clsx(
          'w-full flex items-center justify-between px-4 py-2 border rounded-lg bg-white text-gray-900',
          'transition-colors duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:outline-none',
          {
            'border-danger-500 focus:border-danger-500 focus:ring-danger-500': error,
            'border-success-500 focus:border-success-500 focus:ring-success-500': success,
            'border-gray-300': !error && !success,
            'text-gray-400': value.length === 0 && placeholder,
          }
        )}
      >
        <span className="truncate">{getSelectedLabels()}</span>
        {!isOpen ? (
          <ChevronDown size={18} className="text-gray-400" />
        ) : (
          <ChevronUp size={18} className="text-gray-400" />
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
          >
            {/* Search input */}
            {searchable && (
              <div className="p-2 border-b border-gray-100">
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* Options list */}
            <div className="max-h-60 overflow-y-auto">
              {filteredOptions.length === 0 && searchable && (
                <div className="px-4 py-8 text-center text-gray-500">
                  <p>No options found</p>
                </div>
              )}

              {filteredOptions.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <button
                    key={option.value}
                    onClick={() => handleToggle(option.value)}
                    disabled={option.disabled}
                    className={clsx(
                      'w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center',
                      {
                        'bg-primary-50 text-primary-700': isSelected,
                        'text-gray-400 cursor-not-allowed': option.disabled,
                        'text-gray-900': !option.disabled && !isSelected,
                      }
                    )}
                  >
                    <div className="w-4 h-4 mr-3 border-2 border-gray-300 rounded flex items-center justify-center">
                      {isSelected && <Check size={12} className="text-primary-600" />}
                    </div>
                    {option.label}
                  </button>
                );
              })}
            </div>

            {/* Selected items preview */}
            {value.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-500 mb-1">Selected:</p>
                <div className="flex flex-wrap gap-1">
                  {value.map((v) => {
                    const option = options.find((opt) => opt.value === v);
                    return (
                      <span
                        key={v}
                        className="inline-flex items-center px-2 py-0.5 bg-primary-100 text-primary-800 text-xs rounded-full"
                      >
                        {option?.label || v}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(v);
                          }}
                          className="ml-1 hover:bg-primary-200 rounded-full p-0.5"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      {error && (
        <p className="mt-1 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

      {/* Success message */}
      {success && (
        <p className="mt-1 text-sm text-success-500">{success}</p>
      )}

      {/* Hint message */}
      {hint && !error && !success && (
        <p className="mt-1 text-sm text-gray-500">{hint}</p>
      )}
    </div>
  );
};

// Export components
Select.displayName = 'Select';
MultiSelect.displayName = 'MultiSelect';

export { Select, MultiSelect };
