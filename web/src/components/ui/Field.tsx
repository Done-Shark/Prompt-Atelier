import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Minus, Plus } from 'lucide-react';
import { clampNumber } from '../../lib/format';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, htmlFor, children, className = '' }: FieldProps) {
  return (
    <div className={`field ${className}`.trim()}>
      {label ? (
        htmlFor ? (
          <label className="field__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="field__label">{label}</span>
        )
      ) : null}
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export function TextInput({ mono, className = '', ...rest }: TextInputProps) {
  return <input className={`input ${mono ? 'input--mono' : ''} ${className}`.trim()} {...rest} />;
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export function TextArea({ mono, className = '', ...rest }: TextAreaProps) {
  return <textarea className={`textarea ${mono ? 'textarea--mono' : ''} ${className}`.trim()} {...rest} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export function Select({ options, className = '', ...rest }: SelectProps) {
  return (
    <select className={`select ${className}`.trim()} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  disabled?: boolean;
}

/** 数字输入：去掉原生步进器，用两侧按钮做精确微调 */
export function NumberField({ value, onChange, min = 0, max = Number.MAX_SAFE_INTEGER, step = 1, id, disabled }: NumberFieldProps) {
  const commit = (next: number) => onChange(clampNumber(next, min, max));
  return (
    <div className="number-field">
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label="减少"
        disabled={disabled}
        onClick={() => commit(value - step)}
      >
        <Minus size={12} />
      </button>
      <input
        id={id}
        className="input input--number"
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) commit(next);
          else onChange(min);
        }}
      />
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label="增加"
        disabled={disabled}
        onClick={() => commit(value + step)}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className="switch" data-on={checked} aria-disabled={disabled}>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__knob" />
      </span>
      <span>{label}</span>
    </label>
  );
}
