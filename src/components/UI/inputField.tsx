import * as React from "react";
import { clsx } from "clsx";

export type InputFieldProps = {
  label?: string;
  id?: string;
  name?: string;
  type?: React.HTMLInputTypeAttribute;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
  inputClassName?: string;
  error?: string;
  description?: string;
};

const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  (
    {
      label,
      id,
      name,
      type = "text",
      value,
      onChange,
      placeholder,
      required,
      disabled,
      autoComplete,
      className,
      inputClassName,
      error,
      description,
    },
    ref
  ) => {
    const reactId = React.useId();
    const inputId = id ?? reactId;

    return (
      <div className={clsx("w-full space-y-1.5", className)}>
        {label && (
          <label
            htmlFor={inputId}
            className={clsx(
              "block text-sm font-medium",
              error ? "text-red-600" : "text-slate-700"
            )}
          >
            {label} {required ? <span className="text-red-600">*</span> : null}
          </label>
        )}

        <input
          id={inputId}
          name={name}
          ref={ref}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={description ? `${inputId}-desc` : undefined}
          className={clsx(
            "w-full rounded-lg border px-3 py-2 text-sm text-slate-900",
            "border-slate-300 placeholder:text-slate-400",
            "focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500",
            "disabled:bg-slate-100 disabled:text-slate-500",
            error && "border-red-500 focus:ring-red-500 focus:border-red-500",
            inputClassName
          )}
        />

        {description && (
          <p id={`${inputId}-desc`} className="text-xs text-slate-500">
            {description}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

InputField.displayName = "InputField";
export default InputField;
