import { parseDurationText } from './duration';
import type { PlaylistVideo, VideoAvailability } from './types';

export const ROW_SELECTOR = [
  'yt-lockup-view-model',
  'ytd-playlist-video-renderer',
  'ytd-playlist-panel-video-renderer',
].join(',');

const DURATION_SELECTORS = [
  'ytd-thumbnail-overlay-time-status-renderer #text',
  '.yt-badge-shape__text',
  'span.ytd-thumbnail-overlay-time-status-renderer',
  'a.ytLockupViewModelContentImage',
  '#overlays #text',
];

const TITLE_SELECTORS = [
  'a.ytLockupMetadataViewModelTitle',
  'a#video-title',
  '#video-title',
  'h3 a',
];

export interface ExtractedRow {
  element: HTMLElement;
  video: PlaylistVideo;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function availabilityFromText(text: string, hasDuration: boolean): VideoAvailability {
  const normalized = text.toLocaleLowerCase();
  if (/(deleted|private|unavailable|removed|silinmiş|gizli|kullanılamıyor)/i.test(normalized)) {
    return 'unavailable';
  }
  if (/(live|canlı|premiere|prömiyer)/i.test(normalized) && !hasDuration) return 'live';
  return hasDuration ? 'available' : 'unknown';
}

function durationFromRow(row: Element): number | null {
  for (const selector of DURATION_SELECTORS) {
    for (const candidate of row.querySelectorAll(selector)) {
      const text = normalizeText(candidate.textContent);
      const exact = text.match(/\b\d{1,4}:\d{2}(?::\d{2})?\b/)?.[0];
      if (!exact) continue;
      const parsed = parseDurationText(exact);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function titleFromRow(row: Element): string {
  for (const selector of TITLE_SELECTORS) {
    const text = normalizeText(row.querySelector(selector)?.textContent);
    if (text) return text;
  }
  return '';
}

export function extractVideoFromRow(
  row: HTMLElement,
  playlistId: string,
): PlaylistVideo | null {
  const anchors = row.querySelectorAll<HTMLAnchorElement>('a[href*="/watch?"]');
  let url: URL | null = null;
  for (const anchor of anchors) {
    try {
      const candidate = new URL(anchor.href, location.origin);
      if (
        candidate.searchParams.get('list') === playlistId &&
        candidate.searchParams.get('v') &&
        candidate.searchParams.get('index')
      ) {
        url = candidate;
        break;
      }
    } catch {
      // Ignore malformed YouTube links.
    }
  }
  if (!url) return null;

  const videoId = url.searchParams.get('v');
  const index = Number(url.searchParams.get('index'));
  if (!videoId || !Number.isInteger(index) || index < 1) return null;

  const durationSeconds = durationFromRow(row);
  const text = normalizeText(row.textContent);
  return {
    videoId,
    index,
    title: titleFromRow(row),
    durationSeconds,
    availability: availabilityFromText(text, durationSeconds !== null),
    source: 'dom',
  };
}

export function rowsWithin(root: ParentNode, playlistId: string): ExtractedRow[] {
  const candidates: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(ROW_SELECTOR)) candidates.push(root);
  candidates.push(...root.querySelectorAll<HTMLElement>(ROW_SELECTOR));

  const seen = new Set<string>();
  const output: ExtractedRow[] = [];
  for (const element of candidates) {
    const video = extractVideoFromRow(element, playlistId);
    if (!video) continue;
    const key = `${video.index}:${video.videoId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ element, video });
  }
  return output;
}

export function getPlaylistId(url = location.href): string | null {
  try {
    return new URL(url).searchParams.get('list');
  } catch {
    return null;
  }
}

export function getCurrentVideo(url = location.href): { videoId: string; index: number } | null {
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get('v');
    const index = Number(parsed.searchParams.get('index'));
    return videoId && Number.isInteger(index) && index > 0 ? { videoId, index } : null;
  } catch {
    return null;
  }
}

function parseCountText(text: string): number | null {
  const denominator = text.match(/\b\d+\s*\/\s*([\d.,]+)\b/)?.[1];
  const videoCount = text.match(/([\d.,]+)\s*(?:video|videos)\b/i)?.[1];
  const raw = denominator ?? videoCount;
  if (!raw) return null;
  const value = Number(raw.replace(/[.,](?=\d{3}\b)/g, ''));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function expectedVideoCount(): number | null {
  const selectors = [
    'yt-page-header-renderer',
    'yt-page-header-view-model',
    'ytd-playlist-header-renderer',
    'ytd-playlist-panel-renderer #header-description',
    'ytd-playlist-panel-renderer #header',
  ];
  for (const selector of selectors) {
    const element = findRenderedElement(selector);
    if (!element) continue;
    const parsed = parseCountText(normalizeText(element.textContent));
    if (parsed !== null) return parsed;
  }
  return null;
}

export function findVideoListContainer(): HTMLElement | null {
  const selectors = [
    'ytd-playlist-panel-renderer #items',
    'ytd-playlist-panel-renderer #contents',
    'ytd-two-column-browse-results-renderer yt-item-section-renderer #contents',
    'ytd-two-column-browse-results-renderer ytd-playlist-video-list-renderer #contents',
    'ytd-two-column-browse-results-renderer #contents',
  ];
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && element.querySelector(ROW_SELECTOR)) return element;
  }
  return document.querySelector<HTMLElement>(ROW_SELECTOR)?.parentElement ?? null;
}

function isHiddenInTree(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden) return true;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    current = current.parentElement;
  }
  return false;
}

function findRenderedElement(selector: string): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>(selector)];
  const visibleCandidates = candidates.filter((element) => !isHiddenInTree(element));
  return (
    visibleCandidates.find((element) => element.getClientRects().length > 0) ??
    visibleCandidates[0] ??
    candidates[0] ??
    null
  );
}

export function findPanelAnchor(): HTMLElement | null {
  if (location.pathname === '/watch') {
    return (
      findRenderedElement('ytd-playlist-panel-renderer #header-description') ??
      findRenderedElement('ytd-playlist-panel-renderer #header')
    );
  }
  return (
    findRenderedElement('yt-page-header-view-model .ytPageHeaderViewModelHeadlineInfo') ??
    findRenderedElement('yt-page-header-renderer') ??
    findRenderedElement('ytd-playlist-header-renderer .metadata-wrapper') ??
    findRenderedElement('ytd-playlist-header-renderer')
  );
}
