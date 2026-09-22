import React, { useCallback, useImperativeHandle, forwardRef } from 'react';
import { useForm, UseFormReturn, FormProvider as RhfFormProvider, SubmitHandler } from 'react-hook-form';

export interface FormProps<T extends Record<string, unknown>> {
  children: React.ReactNode;
  onSubmit: SubmitHandler<T>;
  defaultValues?: Partial<T>;
  className?: string;
  id?: string;
}

// Type for the form methods we want to expose
export interface FormMethods<T extends Record<string, unknown>> {
  reset: () => void;
  setValue: (name: keyof T, value: unknown) => void;
  getValues: () => T;
  trigger: (name?: keyof T) => Promise<boolean>;
  clearErrors: (name?: keyof T) => void;
  setError: (name: keyof T, error: { type: string; message: string }) => void;
}

const Form = forwardRef<FormMethods<Record<string, unknown>>, FormProps<Record<string, unknown>>>(
  ({ children, onSubmit, defaultValues, className = '', id }, ref) => {
    const methods = useForm<Record<string, unknown>>({
      defaultValues,
    });

    const { handleSubmit, reset, setValue, getValues, trigger, clearErrors, setError } = methods;

    // Expose form methods to parent via ref
    useImperativeHandle(ref, () => ({
      reset: () => reset(defaultValues),
      setValue: (name: string, value: unknown) => setValue(name, value),
      getValues: () => getValues(),
      trigger: (name?: string) => trigger(name),
      clearErrors: (name?: string) => clearErrors(name),
      setError: (name: string, error: { type: string; message: string }) => setError(name, error),
    }));

    return (
      <RhfFormProvider {...methods}>
        <form
          id={id}
          onSubmit={handleSubmit(onSubmit)}
          className={`space-y-4 ${className}`}
          noValidate
        >
          {children}
        </form>
      </RhfFormProvider>
    );
  }
);

Form.displayName = 'Form';

// Type-safe Form component with generic type
export function createForm<T extends Record<string, unknown>>(
  props: FormProps<T> & { ref?: React.Ref<FormMethods<T>> }
): React.ReactElement {
  return React.createElement(Form, props as FormProps<Record<string, unknown>>);
}

export default Form;
