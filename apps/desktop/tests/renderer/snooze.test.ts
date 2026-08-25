import { describe, expect, it } from 'vitest';

import {
  parseCustomWake,
  snoozePresets,
  toDatetimeLocal,
} from '../../src/renderer/src/features/conversations/snooze';

// A fixed Wednesday morning and evening, local time.
const wednesdayMorning = new Date(2026, 7, 26, 10, 0, 0); // Wed 2026-08-26 10:00
const wednesdayNight = new Date(2026, 7, 26, 21, 30, 0);

describe('snoozePresets', () => {
  it('offers hour, evening, tomorrow, and next week in the morning', () => {
    const presets = snoozePresets(wednesdayMorning);
    expect(presets.map((p) => p.id)).toEqual(['hour', 'evening', 'tomorrow', 'next-week']);
    expect(presets[0]?.wakeAt).toBe(wednesdayMorning.getTime() + 3_600_000);
    expect(new Date(presets[1]?.wakeAt ?? 0).getHours()).toBe(18);
    const tomorrow = new Date(presets[2]?.wakeAt ?? 0);
    expect(tomorrow.getDate()).toBe(27);
    expect(tomorrow.getHours()).toBe(9);
  });

  it('drops the evening preset after 18:00', () => {
    const presets = snoozePresets(wednesdayNight);
    expect(presets.map((p) => p.id)).toEqual(['hour', 'tomorrow', 'next-week']);
  });

  it('next week lands on the following Monday at 9:00', () => {
    const monday = new Date(snoozePresets(wednesdayMorning)[3]?.wakeAt ?? 0);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(9);
    expect(monday.getTime()).toBeGreaterThan(wednesdayMorning.getTime());
  });

  it('every preset is strictly in the future', () => {
    for (const now of [wednesdayMorning, wednesdayNight]) {
      for (const preset of snoozePresets(now)) {
        expect(preset.wakeAt).toBeGreaterThan(now.getTime());
      }
    }
  });
});

describe('custom wake parsing', () => {
  it('round-trips through the datetime-local format', () => {
    const ms = new Date(2026, 7, 27, 14, 5).getTime();
    expect(toDatetimeLocal(ms)).toBe('2026-08-27T14:05');
    expect(parseCustomWake('2026-08-27T14:05', wednesdayMorning)).toBe(ms);
  });

  it('rejects the empty value, the past, and garbage', () => {
    expect(parseCustomWake('', wednesdayMorning)).toBeNull();
    expect(parseCustomWake('2020-01-01T09:00', wednesdayMorning)).toBeNull();
    expect(parseCustomWake('not-a-date', wednesdayMorning)).toBeNull();
  });
});
