import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';


const EMPTY_VALUE = '__empty__';

export interface AdminSelectOption {
  value: string;
  label: string;
}

export interface AdminSelectProps {
  id?: string;
  ariaLabel?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: AdminSelectOption[];
  disabled?: boolean;
  className?: string;
}

export function AdminSelect({
  id,
  ariaLabel,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: AdminSelectProps) {
  const items = Object.fromEntries(
    options.map((option) => [option.value === '' ? EMPTY_VALUE : option.value, option.label]),
  );
  return (
    <Select
      items={items}
      value={value === '' ? EMPTY_VALUE : value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next === EMPTY_VALUE ? '' : next);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? 'w-full'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value === '' ? EMPTY_VALUE : option.value}
            value={option.value === '' ? EMPTY_VALUE : option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
