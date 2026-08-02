export type SiteBridgeDispatch = (detail: Record<string, unknown>) => void;

export interface SiteHandler {
  matches(hostname: string): boolean;
  shouldIgnoreMedia?(media: HTMLMediaElement): boolean;
  seek?(media: HTMLMediaElement, seconds: number, dispatch: SiteBridgeDispatch): boolean;
  ownsPlainTheaterKey?: boolean;
}

const youtubeHandler: SiteHandler = {
  matches(hostname) {
    if (hostname === 'music.youtube.com') return false;
    return hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtube-nocookie.com' ||
      hostname.endsWith('.youtube-nocookie.com');
  },
  ownsPlainTheaterKey: true,
  shouldIgnoreMedia(media) {
    return media.classList.contains('video-thumbnail') ||
      Boolean(media.closest('.ytp-ad-player-overlay'));
  },
};

const netflixHandler: SiteHandler = {
  matches: (hostname) => hostname === 'www.netflix.com',
  shouldIgnoreMedia(media) {
    return media.classList.contains('preview-video') || Boolean(media.closest('.billboard-row'));
  },
  seek(_media, seconds, dispatch) {
    dispatch({ action: 'netflixSeek', seconds });
    return true;
  },
};

const SITE_HANDLERS: readonly SiteHandler[] = [youtubeHandler, netflixHandler];

export function handlerFor(hostname: string): SiteHandler | null {
  const normalized = hostname.trim().toLowerCase();
  return SITE_HANDLERS.find((handler) => handler.matches(normalized)) ?? null;
}
