import { describe, expect, it } from 'vitest';
import { buildDailyPlan } from '../lib/planner';

describe('daily planner', () => {
  it('respects playback speed and selected weekdays', () => {
    const monday = new Date(2026, 6, 27, 12);
    const result = buildDailyPlan({
      remainingSeconds: 6 * 3_600,
      speed: 2,
      dailyMinutes: 60,
      activeWeekdays: [1, 3, 5],
      startDate: monday,
    });

    expect(result.activeDayCount).toBe(3);
    expect(result.sessions.map((session) => session.date.getDay())).toEqual([1, 3, 5]);
    expect(result.finishDate?.getDate()).toBe(31);
  });

  it('returns no plan for invalid capacity', () => {
    const result = buildDailyPlan({
      remainingSeconds: 3_600,
      speed: 1,
      dailyMinutes: 0,
      activeWeekdays: [1],
      startDate: new Date(),
    });
    expect(result.finishDate).toBeNull();
    expect(result.sessions).toEqual([]);
  });
});
