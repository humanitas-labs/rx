// Snooze choices (plan step 8, spec/v0.md §4.5): quick presets plus a
// custom local date and time. Pure — the picker supplies `now`.

export interface SnoozePreset {
  id: string;
  label: string;
  wakeAt: number;
}

/** Quick snooze choices from `now`, all strictly in the future. */
export function snoozePresets(now: Date): SnoozePreset[] {
  const at = (base: Date, hour: number, addDays = 0): number => {
    const d = new Date(base);
    d.setDate(d.getDate() + addDays);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const presets: SnoozePreset[] = [
    { id: 'hour', label: 'In 1 hour', wakeAt: now.getTime() + 3_600_000 },
  ];
  const evening = at(now, 18);
  if (evening > now.getTime()) {
    presets.push({ id: 'evening', label: 'This evening (18:00)', wakeAt: evening });
  }
  presets.push({ id: 'tomorrow', label: 'Tomorrow morning (9:00)', wakeAt: at(now, 9, 1) });
  // Next Monday 9:00 — always at least a day away.
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  presets.push({ id: 'next-week', label: 'Next week (Mon 9:00)', wakeAt: at(now, 9, daysToMonday) });
  return presets;
}

/** Value for a `datetime-local` input, in the local timezone. */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a `datetime-local` value; null when absent or not in the future. */
export function parseCustomWake(value: string, now: Date): number | null {
  if (value.length === 0) {
    return null;
  }
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms) || ms <= now.getTime()) {
    return null;
  }
  return ms;
}
