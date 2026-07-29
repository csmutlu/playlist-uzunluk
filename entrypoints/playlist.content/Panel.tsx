import { useEffect, useMemo, useState } from 'preact/hooks';
import { SPEED_PRESETS } from '../../lib/constants';
import type {
  ContentController,
  ControllerSnapshot,
} from '../../lib/content-controller';
import { snapshotTimes } from '../../lib/content-controller';
import {
  clampSpeed,
  formatClock,
  formatDuration,
  speedAdjustedSeconds,
} from '../../lib/duration';
import {
  localeDirection,
  localeTag,
  t,
  weekdayLabels,
  type MessageKey,
} from '../../lib/i18n';
import { buildDailyPlan } from '../../lib/planner';

interface PanelProps {
  controller: ContentController;
}

type CalculationMode = 'all' | 'remaining' | 'range';

const API_ERROR_MESSAGES: Record<string, MessageKey> = {
  missing_permission: 'apiPermissionDenied',
  missing_key: 'apiKeyMissing',
  quota: 'apiQuotaExceeded',
  private: 'apiPrivatePlaylist',
  network: 'apiNetworkError',
  unknown: 'apiUnknownError',
};

function useController(controller: ContentController): ControllerSnapshot {
  const [snapshot, setSnapshot] = useState(controller.snapshot());
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  return snapshot;
}

function localDateValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12);
}

export function Panel({ controller }: PanelProps) {
  const snapshot = useController(controller);
  const { analysis, locale, settings } = snapshot;
  const isWatchPage = location.pathname === '/watch';
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<CalculationMode>(isWatchPage ? 'remaining' : 'all');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [customSpeed, setCustomSpeed] = useState(settings.customSpeed);
  const [dailyMinutes, setDailyMinutes] = useState(60);
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = useState(localDateValue(new Date()));
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);

  useEffect(() => {
    const end = analysis?.expectedCount ?? analysis?.videos.at(-1)?.index ?? 1;
    setRangeEnd((current) => (current <= 1 ? end : Math.min(current, end)));
  }, [analysis?.playlistId, analysis?.expectedCount, analysis?.countedCount]);

  const selectedRange =
    mode === 'range' ? { start: Math.max(1, rangeStart), end: Math.max(rangeStart, rangeEnd) } : undefined;
  const times = useMemo(
    () => snapshotTimes(snapshot, selectedRange),
    [snapshot, selectedRange?.start, selectedRange?.end],
  );
  const baseSeconds =
    mode === 'all' ? analysis?.totalSeconds ?? 0 : times.remainingSeconds;
  const adjustedRemaining = speedAdjustedSeconds(times.remainingSeconds, snapshot.speed);
  const adjustedBase = speedAdjustedSeconds(baseSeconds, snapshot.speed);
  const progressPercent =
    times.selectedTotalSeconds > 0
      ? Math.min(100, (times.watchedSeconds / times.selectedTotalSeconds) * 100)
      : 0;
  const { average, shortest, longest } = useMemo(() => {
    const durations =
      analysis?.videos
        .map((video) => video.durationSeconds)
        .filter((duration): duration is number => duration !== null) ?? [];
    if (durations.length === 0) return { average: 0, shortest: 0, longest: 0 };
    return {
      average: durations.reduce((sum, value) => sum + value, 0) / durations.length,
      shortest: Math.min(...durations),
      longest: Math.max(...durations),
    };
  }, [analysis]);
  const finish = new Date(Date.now() + adjustedRemaining * 1_000);
  const planningRemaining = Math.ceil(times.remainingSeconds / 60) * 60;
  const plan = useMemo(
    () =>
      buildDailyPlan({
        remainingSeconds: planningRemaining,
        speed: snapshot.speed,
        dailyMinutes,
        activeWeekdays: weekdays,
        startDate: parseLocalDate(startDate),
      }),
    [planningRemaining, snapshot.speed, dailyMinutes, weekdays, startDate],
  );

  if (!snapshot.playlistId) return null;

  const countLabel = analysis
    ? `${analysis.countedCount}/${analysis.expectedCount ?? '?'}`
    : '0/?';
  const complete = analysis?.listComplete ?? false;

  const setSpeed = (speed: number) => {
    void controller.setSpeed(clampSpeed(speed));
  };

  const useCurrentRange = () => {
    const current = snapshot.currentVideo?.index;
    if (!current) return;
    setRangeStart(current);
    setRangeEnd(analysis?.expectedCount ?? analysis?.videos.at(-1)?.index ?? current);
    setMode('range');
  };

  const copyDiagnostics = async () => {
    const report = controller.diagnosticReport();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = report;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setDiagnosticCopied(true);
  };

  return (
    <section
      class={`panel ${expanded ? 'is-expanded' : ''}`}
      aria-label="Playlist Zamanı"
      dir={localeDirection(locale)}
      lang={localeTag(locale)}
    >
      <button
        type="button"
        class="summary"
        aria-expanded={expanded}
        title={t(locale, expanded ? 'collapse' : 'expand')}
        onClick={() => setExpanded((value) => !value)}
      >
        <span class="summary-top">
          <span class="brand">
            <span class="brand-mark" aria-hidden="true">◷</span>
            Playlist Zamanı
          </span>
          <span class="summary-actions">
            <span class={`coverage ${complete ? 'complete' : 'partial'}`}>
              {countLabel}
            </span>
            <span class="chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
          </span>
        </span>
        <span class="summary-value">
          <span class="summary-label">{t(locale, 'total')}</span>
          <strong>{formatDuration(analysis?.totalSeconds ?? 0, locale, false)}</strong>
        </span>
        {!isWatchPage && (
          <span class="summary-speed-list">
            {SPEED_PRESETS.map((speed) => (
              <span class="summary-speed-row">
                <span>{speed}x</span>
                <strong>
                  {formatDuration(
                    speedAdjustedSeconds(analysis?.totalSeconds ?? 0, speed),
                    locale,
                    false,
                  )}
                </strong>
              </span>
            ))}
          </span>
        )}
        <span class="summary-footer">
          {isWatchPage ? (
            <>
              <span class="speed-badge">{snapshot.speed}x</span>
              <span>
                {t(locale, 'remaining')}: <strong>{formatDuration(adjustedRemaining, locale, false)}</strong>
              </span>
            </>
          ) : (
            <span />
          )}
          <span class="detail-hint">{expanded ? t(locale, 'collapse') : t(locale, 'expand')}</span>
        </span>
      </button>

      {expanded && (
        <div class="details">
          {!analysis || analysis.countedCount === 0 ? (
            <div class="empty">{t(locale, 'noPlaylist')}</div>
          ) : (
            <>
              <div class="status-row">
                <span class={`status ${complete ? 'complete' : 'partial'}`}>
                  {complete ? t(locale, 'complete') : t(locale, 'partial')}
                </span>
                <span>{countLabel} {t(locale, 'videos')}</span>
                {analysis.unknownDurationCount > 0 && (
                  <span>{analysis.unknownDurationCount} {t(locale, 'unknown')}</span>
                )}
                {analysis.unavailableCount > 0 && (
                  <span>{analysis.unavailableCount} {t(locale, 'unavailable')}</span>
                )}
              </div>

              <div class="mode-tabs" role="group" aria-label={t(locale, 'range')}>
                {([
                  ['all', t(locale, 'allPlaylist')],
                  ...(isWatchPage
                    ? ([['remaining', t(locale, 'remainingMode')]] as const)
                    : []),
                  ['range', t(locale, 'selectedRange')],
                ] as const).map(([value, label]) => (
                  <button
                    type="button"
                    class={mode === value ? 'active' : ''}
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'range' && (
                <div class="range-controls">
                  <label>
                    <span>{t(locale, 'start')}</span>
                    <input
                      type="number"
                      min="1"
                      max={rangeEnd}
                      value={rangeStart}
                      onInput={(event) => setRangeStart(Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>{t(locale, 'end')}</span>
                    <input
                      type="number"
                      min={rangeStart}
                      max={analysis.expectedCount ?? analysis.countedCount}
                      value={rangeEnd}
                      onInput={(event) => setRangeEnd(Number(event.currentTarget.value))}
                    />
                  </label>
                  {snapshot.currentVideo && (
                    <button type="button" class="secondary" onClick={useCurrentRange}>
                      {t(locale, 'fromCurrent')}
                    </button>
                  )}
                </div>
              )}

              <div class="progress-head">
                <span>{t(locale, 'progress')}</span>
                <strong>{Math.round(progressPercent)}%</strong>
              </div>
              <div class="progress-track" aria-label={`${Math.round(progressPercent)}%`}>
                <span style={{ width: `${progressPercent}%` }} />
              </div>

              <div class="metric-grid">
                <article>
                  <span>{t(locale, 'watched')}</span>
                  <strong>{formatDuration(times.watchedSeconds, locale, settings.showSeconds)}</strong>
                </article>
                <article>
                  <span>{t(locale, 'remaining')}</span>
                  <strong>{formatDuration(adjustedBase, locale, settings.showSeconds)}</strong>
                </article>
                <article>
                  <span>{t(locale, 'saved')}</span>
                  <strong>{formatDuration(Math.max(0, baseSeconds - adjustedBase), locale, settings.showSeconds)}</strong>
                </article>
                <article>
                  <span>{t(locale, 'finishAt')}</span>
                  <strong>{formatClock(finish, locale)}</strong>
                </article>
              </div>

              <div class="section-heading">{t(locale, 'speeds')}</div>
              <div class="speed-grid">
                {SPEED_PRESETS.map((speed) => (
                  <button
                    type="button"
                    class={snapshot.speed === speed ? 'active' : ''}
                    aria-pressed={snapshot.speed === speed}
                    onClick={() => setSpeed(speed)}
                  >
                    <span>{speed}x</span>
                    <strong>{formatDuration(speedAdjustedSeconds(baseSeconds, speed), locale, settings.showSeconds)}</strong>
                  </button>
                ))}
              </div>
              <div class="custom-speed">
                <label>
                  <span>{t(locale, 'customSpeed')}</span>
                  <input
                    type="number"
                    min="0.25"
                    max="4"
                    step="0.05"
                    value={customSpeed}
                    onInput={(event) => setCustomSpeed(Number(event.currentTarget.value))}
                    onChange={() => setSpeed(customSpeed)}
                  />
                  <span>x</span>
                </label>
                <button type="button" class="secondary" onClick={() => setSpeed(customSpeed)}>
                  {formatDuration(speedAdjustedSeconds(baseSeconds, customSpeed), locale, settings.showSeconds)}
                </button>
              </div>

              <div class="stat-grid">
                <span><small>{t(locale, 'average')}</small><strong>{formatDuration(average, locale, settings.showSeconds)}</strong></span>
                <span><small>{t(locale, 'shortest')}</small><strong>{formatDuration(shortest, locale, settings.showSeconds)}</strong></span>
                <span><small>{t(locale, 'longest')}</small><strong>{formatDuration(longest, locale, settings.showSeconds)}</strong></span>
              </div>

              <div class="planner">
                <div class="section-heading">{t(locale, 'planner')}</div>
                <div class="planner-inputs">
                  <label>
                    <span>{t(locale, 'dailyMinutes')}</span>
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={dailyMinutes}
                      onInput={(event) => setDailyMinutes(Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>{t(locale, 'start')}</span>
                    <input
                      type="date"
                      value={startDate}
                      onInput={(event) => setStartDate(event.currentTarget.value)}
                    />
                  </label>
                </div>
                <div class="weekday-row">
                  {weekdayLabels(locale).map((label, day) => (
                    <button
                      type="button"
                      class={weekdays.includes(day) ? 'active' : ''}
                      aria-pressed={weekdays.includes(day)}
                      onClick={() =>
                        setWeekdays((current) =>
                          current.includes(day)
                            ? current.filter((value) => value !== day)
                            : [...current, day].sort(),
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div class="plan-result">
                  <span>{t(locale, 'finishDate')}</span>
                  <strong>
                    {plan.finishDate
                      ? new Intl.DateTimeFormat(localeTag(locale), {
                          dateStyle: 'long',
                        }).format(plan.finishDate)
                      : '—'}
                  </strong>
                  <small>{plan.activeDayCount} {t(locale, 'activeDays')}</small>
                </div>
              </div>

              {!complete && (
                <div class="completion-actions">
                  <button
                    type="button"
                    class="primary"
                    disabled={snapshot.busy === 'api'}
                    onClick={() => void controller.loadAllVideos()}
                  >
                    {snapshot.busy === 'scroll' ? t(locale, 'cancel') : t(locale, 'loadAll')}
                  </button>
                  <button
                    type="button"
                    class="secondary"
                    disabled={snapshot.busy !== null}
                    onClick={() => void controller.completeWithApi()}
                  >
                    {snapshot.busy === 'api' ? t(locale, 'loading') : t(locale, 'useApi')}
                  </button>
                </div>
              )}
              {snapshot.error && (
                <div class="error" role="alert">
                  {t(locale, API_ERROR_MESSAGES[snapshot.error] ?? 'apiUnknownError')}
                </div>
              )}
              <button
                type="button"
                class="diagnostics secondary"
                onClick={() => void copyDiagnostics()}
              >
                {t(locale, diagnosticCopied ? 'diagnosticsCopied' : 'copyDiagnostics')}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
