
export interface ClassPickerOption {
  id: string;
  name: string;
  status: string;
}

export interface ClassPickerProps {
  id?: string;
  classes: ClassPickerOption[];
  value: string;
  onChange: (classId: string) => void;
  emptyLabel: string;
  className?: string;
}

export function ClassPicker({ id, classes, value, onChange, emptyLabel, className }: ClassPickerProps) {
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {classes
        .filter((c) => c.status === 'active')
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </select>
  );
}
