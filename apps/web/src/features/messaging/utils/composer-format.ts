export function boldSelection(
  text: string,
  start: number,
  end: number,
): string {
  const selected = text.slice(start, end);
  const wrapped =
    selected.startsWith("**") && selected.endsWith("**") && selected.length > 4;
  return wrapped ? selected.slice(2, -2) : `**${selected}**`;
}

export function linkSelection(
  text: string,
  start: number,
  end: number,
  input: string,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const selected = text.slice(start, end);
  return selected ? `[${selected}](${url})` : `[${url}](${url})`;
}
