import type { DailyPlanInput, DailyPlanResult } from './types';
import { speedAdjustedSeconds } from './duration';

const MAX_PLAN_DAYS = 3_660;

export function buildDailyPlan(input: DailyPlanInput): DailyPlanResult {
  const active = new Set(input.activeWeekdays.filter((day) => day >= 0 && day <= 6));
  const capacitySeconds = Math.max(0, input.dailyMinutes * 60);
  let remaining = speedAdjustedSeconds(input.remainingSeconds, input.speed);
  if (remaining <= 0 || capacitySeconds <= 0 || active.size === 0) {
    return { sessions: [], finishDate: null, activeDayCount: 0 };
  }

  const cursor = new Date(input.startDate);
  cursor.setHours(12, 0, 0, 0);
  const sessions = [];

  for (let checked = 0; checked < MAX_PLAN_DAYS && remaining > 0; checked += 1) {
    if (active.has(cursor.getDay())) {
      const seconds = Math.min(capacitySeconds, remaining);
      sessions.push({ date: new Date(cursor), seconds });
      remaining -= seconds;
    }
    if (remaining > 0) cursor.setDate(cursor.getDate() + 1);
  }

  return {
    sessions,
    finishDate: remaining === 0 ? sessions.at(-1)?.date ?? null : null,
    activeDayCount: sessions.length,
  };
}
