# VideoExpert

**English** · [Türkçe](README.md)

**Stable release:** `2.0.0` · [Changelog](CHANGELOG.md) ·
[GitHub Releases](https://github.com/csmutlu/videoexpert/releases)

A lightweight browser extension that calculates the total and remaining length of
YouTube playlists, and lets you drive video and audio speed from the keyboard on
the sites you allow.

Developed Brave-first; also compatible with Chrome, Edge, Opera, Firefox and Zen
Browser. Calculation and media control happen on your device. No analytics, ads
or third-party tracking services are used.

![VideoExpert playlist view](docs/screenshots/playlist-overview.png)

## Contents

- [What can it do?](#what-can-it-do)
- [Quick start](#quick-start)
- [Using it on YouTube playlists](#using-it-on-youtube-playlists)
- [Speed control on every site](#speed-control-on-every-site)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Popup and settings](#popup-and-settings)
- [Downloading video](#downloading-video)
- [Supported browsers and sites](#supported-browsers-and-sites)
- [Troubleshooting](#troubleshooting)
- [Privacy and permissions](#privacy-and-permissions)
- [Development and testing](#development-and-testing)

## What can it do?

### YouTube playlist assistant

- Calculates a whole playlist at `1x`, `1.25x`, `1.5x`, `1.75x`, `2x` and custom speeds.
- Shows total, watched and remaining time; video count and progress percentage.
- On a playlist page it always presents the **total length** as the headline number.
- On a watch page it combines the remaining part of the current video with the
  next unwatched videos.
- Calculates a specific range by picking a start and an end video.
- Shows a "from this video onwards" calculation, average/shortest/longest video
  information and the time saved by playing faster.
- Estimates a finish date from your daily goal and active days.
- Counts a video as finished automatically at 90%. The threshold is configurable.
- Manual watched selections take priority over automatic detection.
- Stores recently opened playlists, their progress and where you left off in the
  **My playlists** screen.
- Searches playlist titles accent-insensitively; filters by watched state, length,
  and availability; sorts by playlist order, title, shortest, or longest.
- Marks a result as "partial" when a list loads incompletely; unknown durations
  are never counted as zero.
- Can complete public playlists with an optional YouTube Data API key.

### Audio Master

- One `0%–600%` popup slider controls the complete sound of the active tab.
- Bass boost and voice clarity are applied locally with Web Audio filters.
- The popup lists tabs playing audio and switches to any listed tab with one click.
- Chromium capture works independently of the page player and continues after the
  popup closes. Firefox/Zen applies the same controls to supported HTML5 media
  because Gecko does not expose an equivalent complete-tab audio capture API.

### Universal media control

- Works with standard HTML5 `<video>` and `<audio>` players.
- Changes speed between `0.07x–16x` from the keyboard, the popup, or the small
  badge over the video.
- Remembers the per-site speed, the last used speed and your preferred global speed.
- Treats the playing or most recently interacted media on a page as the active player.
- Supports players inside iframes and open/closed Shadow DOM.
- An optional **speed lock** holds your speed when a player keeps resetting to `1x`.
- Tries to change speed on live streams; does not force seeking or marking when
  seeking is unsupported.
- `T` spreads the video across the tab's content area without entering real fullscreen.
- Keeps the original pitch at high speeds, reapplying the flag whenever the site
  clears it.
- Loops a section with an A→B loop, and steps a paused video frame by frame.
- Sends the active video to picture-in-picture.
- The speed badge is draggable; its size, opacity and visibility are configurable.
- Every shortcut can be changed, and extra shortcuts can be added.

![VideoExpert detailed view](docs/screenshots/playlist-details.png)

## Quick start

### Brave, Chrome, Edge and Opera

Requirements: an up-to-date Node.js and npm.

1. Clone the repository and create a production bundle:

   ```bash
   git clone https://github.com/csmutlu/videoexpert.git
   cd videoexpert
   npm install
   npm run build
   ```

2. Open your browser's extensions page:

   | Browser | Address |
   | --- | --- |
   | Brave | `brave://extensions` |
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Opera | `opera://extensions` |

3. Turn on **Developer mode**.
4. Press **Load unpacked**.
5. Select the project's `.output/chrome-mv3` folder.
6. Pin VideoExpert to the toolbar and refresh any video tabs that were
   already open.

When the extension is updated, run `npm run build` again, press **Reload** on the
extensions page, and refresh open tabs.

### Firefox and Zen Browser

1. Create the Firefox bundle:

   ```bash
   npm install
   npm run build:firefox
   ```

2. Open `about:debugging#/runtime/this-firefox`.
3. Press **Load Temporary Add-on**.
4. Select `.output/firefox-mv2/manifest.json`.
5. If Firefox/Zen shows a permission summary, approve all-site access.
6. Refresh any video tabs that were already open.

A temporary installation lasts until Firefox or Zen is closed. A permanent
Firefox distribution requires a Mozilla signature.

Because broad site permission requested after the fact is not reliably preserved
across reloads in Gecko's temporary MV2 add-ons, this bundle grants `http/https`
access once during installation. The universal controller is still off by
default; it does not activate on pages until you turn the switch on in the popup.

To create ready-made ZIPs:

```bash
npm run zip
npm run zip:firefox
```

Files are written to the `.output` folder.

## Using it on YouTube playlists

### Seeing the total length

1. Open a playlist page on YouTube:
   `https://www.youtube.com/playlist?list=...`
2. The VideoExpert panel appears under the playlist info card.
3. In its collapsed view it shows the total length, video count and selected speed.
4. Click the panel to expand the details. The `1x`, `1.25x`, `1.5x`, `1.75x` and
   `2x` equivalents are listed one under the other.

On a playlist page the primary value is the total length. The compact panel on a
watch page is based on the remaining part of the current video plus the next
unwatched videos.

### Watched and remaining time

- The extension stores the playback position locally.
- A video counts as watched once it reaches the configured completion threshold.
- If you mark a video manually, that choice takes priority over automatic detection.
- **Reset progress** clears only the stored watched state for that playlist.

### Calculating a video range

Expand the panel and pick a range using the start/end fields. The calculation
includes the videos at both ends. The "from this video onwards" option treats
the current video on the watch page as the start.

### Incomplete or very long playlists

YouTube may not add every item of a long list to the DOM on first load. In that
case the panel says, for example, `46/120 videos — partial result`.

- **Load all videos** scrolls in a controlled way, and only when you start it.
- You can cancel the operation; the previous scroll position is restored.
- An optional YouTube Data API key can be used for public playlists.
- For Watch Later, Liked Videos, private, deleted or hidden videos, results show
  as much as the accessible data allows.

### Study plan

Choose your daily goal, active days and watching speed. The panel calculates the
total number of sessions, the time saved by speeding up, the estimated finish
time and the finish date.

## Speed control on every site

Universal control is off by default. In the Chromium bundle, broad site
permission is requested only when the feature is turned on. In the Firefox/Zen
bundle the permission is granted once during installation; no media control
happens until the feature is enabled.

1. Open the VideoExpert popup from the toolbar.
2. Turn on **Enable on all sites**.
3. Approve the site access request shown in Chromium. On Firefox/Zen this
   permission was already granted during installation.
4. Refresh any video tab that was already open.
5. Click the video and change the speed with `S`/`D`.

The feature can be turned off again from the popup. On Chromium the dynamic
script registration and optional access are removed. On Firefox/Zen the
installation permission stays in the manifest but the controller stops; the
YouTube playlist calculation features keep working.

### How is the active player chosen?

A page may contain a video, an ad, a trailer and iframes at the same time. The
extension uses this order:

1. The media currently playing
2. The most recently clicked or interacted media
3. The largest visible video on screen
4. The first suitable media

To control a specific video, click it once first. A speed change applies only to
the active player. On pages with nested iframes only the active player's badge is
shown; speeding up all three videos at once is not the goal.

### Speed badge

The badge sits at the top-left of the video at low opacity and becomes prominent
when the speed changes.

- Drag the badge to reposition it.
- Use the mouse wheel over the badge to raise and lower the speed.
- Double-click the badge to toggle between `1x` and your preferred speed.
- `V` pins or hides the badge.
- Size and opacity are configurable from the popup.

### Theater mode inside the tab

Click the active video and press `T`. The video fills the tab's content area
while the browser's address bar and tabs stay visible. Pressing `T` again returns
the player to its previous place, size and styles.

This feature is designed for regular players as well as players inside iframes
and Shadow DOM. It is independent of the site's own fullscreen button.

On YouTube, a plain `T` is left to YouTube's own theater mode. If you want to use
VideoExpert's in-tab theater mode on YouTube too, assign this action to `Y`,
`Shift+T` or another key from the shortcut editor in the popup. The default `T`
behavior on other sites does not change.

### A→B loop

Assign the **A→B loop** action to a key from the **Extra shortcuts** section.

1. The first press marks the loop start (`A`).
2. The second press marks the end (`B`) and the section starts repeating.
3. The third press removes the loop.

Marking a point before `A` re-arms the start instead of creating an inverted
range. The loop is released automatically when the media leaves the page.

### Frame-by-frame stepping

Assign the **Previous frame** / **Next frame** actions to keys. Each press pauses
the video and moves it by a single frame. The shortcut's value field sets the
frame rate (default `30`, i.e. a `1/30` second step). Holding the key repeats the
step.

### Picture-in-picture

Assign the **Picture-in-picture** action to a key to send the active video to the
floating window or bring it back. If the browser or the player blocks
picture-in-picture, the badge shows `!`.

### Migrating from Video Speed Controller

You do not have to rebuild your shortcuts and site rules by hand.

1. Open Video Speed Controller's options page and use **Export settings** to
   download `videospeed-settings.json`.
2. Turn on universal speed control in the VideoExpert popup.
3. Choose the same file under **Import controller settings**. It is detected
   automatically.

What carries over: speed step, rewind/forward durations, preferred speed
(`fast`), shortcut keys including modifier chords, indicator opacity and size,
custom CSS, audio support, the key-capture preference, and both `siteRules` and
`blacklist` entries.

The `slower`, `faster`, `rewind`, `advance`, `reset`, `fast`, `display`, `mark`
and `jump` actions map one to one. Any action we do not recognise is skipped.
All-site permission is never taken from a file; only the popup switch grants it.

### Sites that force the speed back

Some live stream and platform players reset the speed to `1x`.

1. Open the current site from the popup.
2. Choose the site speed you want.
3. Enable the **speed lock**.

While the lock is off, a speed change made from the site's own player is accepted
and saved. While it is on, your chosen speed is reapplied only on a genuine reset
attempt; no continuously running control loop is used.

## Keyboard shortcuts

| Key | Default action |
| --- | --- |
| `S` | Decrease speed by `0.1x` |
| `D` | Increase speed by `0.1x` |
| `R` | Return to `1x` |
| `G` | Toggle between `1x` and the preferred speed |
| `Z` | Rewind 10 seconds |
| `X` | Forward 10 seconds |
| `M` | Mark the current position |
| `J` | Jump to the marked position |
| `T` | Toggle in-tab theater mode; on YouTube left to the site's own `T` |
| `V` | Show/hide the speed badge |

Actions such as play/pause, mute, volume up/down, A→B loop, frame stepping and
picture-in-picture can be added from the shortcut editor. These extra actions
have no default key, so your existing shortcuts do not change. Each shortcut can
be given its own speed, step, seek, volume or frame-rate value.

### Working alongside the site's own speed control

You can keep using YouTube's speed menu or its `<` / `>` shortcuts. The extension
accepts the change, shows the correct speed on the badge, and later `S`/`D`
presses continue from there. The site's speed is saved to the per-site memory too.

Shortcuts match on `event.code`, so they are layout independent. On a Turkish Mac
keyboard `Shift+ö` and `Shift+ç` are the same physical keys as `Shift+,` and
`Shift+.` on a US layout, and work on YouTube as expected. Modifiers must match
exactly, so binding frame stepping to plain `,` and `.` does not collide with them.

Even with the **speed lock** on, a change *you* make from the site's own player is
accepted; the lock only undoes silent resets that no user input preceded.

Shortcuts do not fire while a text field, search box, select menu or
`contenteditable` area has focus. Combinations with `Ctrl`, `Cmd` and `Alt` are
ignored unless you define them explicitly.

## Popup and settings

### Universal control settings

- Enable on all sites, or remove access entirely
- Disable the current site
- Global, per-site and last used speed
- Speed lock
- Speed step and rewind/forward duration
- Preset speeds and custom speed entry
- Keeping the original pitch at high speeds
- Shortcut editor and reset to defaults
- Badge size, opacity and custom CSS
- Domain, wildcard and regex based site rules
- Import/export universal settings as JSON

The priority order for the site speed is:

1. A matching site rule
2. The site's last used speed
3. The global default speed

At most 200 domains are remembered. Only the hostname and the playback setting
are stored; page titles, full URLs and browsing history are not.

### Playlist settings

- Interface language or automatic language detection
- Light/dark/auto theme matching YouTube
- Default and custom playback speed
- Showing seconds
- Automatic completion percentage
- Optional YouTube Data API key
- Resetting playlist progress
- Import/export settings and progress as JSON

Supported interface languages: Turkish, English, Spanish, French, Arabic, German,
Portuguese, Russian, Hindi, Indonesian, Japanese, Korean and Chinese.

## Downloading video

The download action in the popup is only for `http/https` MP4, WebM and similar
HTML5 media files that the page serves directly. The browser asks for the
`downloads` permission on first use.

The following are not downloaded and no attempt is made to bypass them:

- DRM-protected streams such as Netflix and HBO Max
- `blob:` addresses
- Segmented HLS/DASH streams
- A site's access or copy protection

If the download button does not appear or the action is refused, the player most
likely does not expose a directly downloadable media address.

## Supported browsers and sites

| Environment | Support |
| --- | --- |
| Brave | Primary development and real-browser testing |
| Chrome, Edge, Opera | Chromium MV3 bundle |
| Firefox, Zen Browser | Firefox MV2 bundle; real Firefox and Zen tests |
| YouTube | Playlist panel and universal media control |
| Standard HTML5 video/audio | Full universal control |
| Iframe and Shadow DOM players | Supported as far as they are reachable |
| Netflix, HBO Max, Kick and similar platforms | As far as the player allows `playbackRate` changes |
| Live streams | Speed control if speed is supported; seeking off when unavailable |

It is technically impossible to run on the browser's system pages, on the
extension store, or in a player that blocks speed changes. The use of DRM alone
does not always block speed control; the final decision belongs to the site's
player.

## Troubleshooting

### The YouTube panel does not appear

- Check that the address is a playlist or a watch page that contains a playlist.
- Reload VideoExpert from the extensions page.
- Fully refresh the YouTube tab.
- If an older copy of the same extension is installed, disable it.

### Shortcuts do not work

- Make sure universal speed control is on in the popup.
- Check that no rule disables the site.
- Click the video you want to control first.
- Check that the cursor is not in a search or text field.
- Reset custom shortcuts to defaults to rule out a conflict.

### There are several videos but only one speeds up

This is expected. Only the active player is controlled so that ads, background
videos or other iframes are not sped up by accident. Click another video and use
`S` or `D` to change the target.

### Several speed badges are visible

Build the current production bundle and reload both the extension and the page.
In nested iframes only the active player's badge should be visible.

### The site keeps resetting the speed to `1x`

Turn on the **speed lock** for the current site. If the player technically
refuses your speed, the extension does not retry forever; in that case the speed
cannot be changed for that site.

### Rewind/forward does not work

A live stream or media without a duration may not accept seeking. In that case
the `Z`, `X`, `M` and `J` actions are safely disabled. Frame stepping and the A→B
loop are disabled for the same reason.

### The playlist result is incomplete

Start **Load all videos** in the panel, or add an API key for a public playlist.
Results may be unavailable for private, Watch Later and Liked Videos lists.

### I want to clear the settings

Use the reset options in the popup. If you export to JSON first, you can restore
your settings and playlist progress later.

If the problem persists, report it on
[GitHub Issues](https://github.com/csmutlu/videoexpert/issues) with your
browser, extension version, site address and reproduction steps. Do not share
accounts, passwords, API keys or personal data.

## Privacy and permissions

Required permissions:

- `storage`: settings and playlist progress
- `scripting`: applying the universal controller to the open tab
- `tabs`: showing the title and state of tabs that are playing audio
- Chromium `activeTab`, `tabCapture`, and `offscreen`: processing the active tab’s
  audio locally, only after the user changes an Audio Master control in the popup
- `youtube.com`: playlist panel and YouTube player integration
- On Firefox/Zen, `http://*/*`, `https://*/*` and `file:///*`: persistent and
  reliable universal control after a refresh in Gecko's temporary MV2 add-ons

Permissions requested only when the relevant feature is used:

- `http://*/*` and `https://*/*` on Chromium: speed control on all sites
- `googleapis.com`: completing an incomplete playlist through the YouTube Data API
- `downloads`: downloading a direct media file
- Local file access on Chromium: only if you additionally allow it in the
  browser's extension settings

The extension makes no analytics, telemetry or ad connections. An API key is kept
only in local extension storage and is never logged. For details see the
[Privacy Policy](PRIVACY.md).

## Performance approach

- No continuous `setInterval`, DOM polling or background network usage.
- Playlist changes are tracked with events and a narrowly scoped `MutationObserver`.
- New DOM nodes are processed in batches; the whole page is not rescanned repeatedly.
- The first analysis of large playlists is split into chunks during the browser's
  idle time.
- Universal control is a separate, small script that loads neither Preact nor the
  playlist bundle.
- Optional visual work is stopped in a hidden tab.
- The service worker wakes only for messages or maintenance.
- Settings are written to storage in batches, and only when they actually change.

Production budgets:

- YouTube content script: under `120 KB` compressed
- Universal content script: under `35 KB` compressed
- MAIN-world compatibility bridge: under `5 KB` compressed
- No extension-caused long task above `50 ms` on a 1,000-media fixture

## Development and testing

Development server:

```bash
npm run dev
```

Type check, unit tests and a production build:

```bash
npm run check
```

Firefox build verification:

```bash
npm run check:firefox
```

Real Brave, Zen and Firefox scenarios:

```bash
npm run test:brave
npm run test:gecko
npm run test:tabii
npm run test:stress
```

- `test:brave` verifies the playlist panel, `S`/`D`, `T` mode in iframe/Shadow DOM,
  text-field protection, dynamic media and the My playlists screen in an isolated
  Brave profile.
- `test:gecko` verifies enabling, disabling, settings persistence after a refresh,
  the `D` shortcut, per-site speed memory, text-field protection and a real
  46-video YouTube playlist calculation on real Zen and Firefox binaries.
- `test:tabii` tests the speed lock on the Tabii TRT 1 live player.
- `test:stress` measures bundle size, long tasks and idle CPU budgets on 1,000
  media items.

Tests use temporary profiles; they never touch personal browser profiles or data.

## Contributing and security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
- Report a vulnerability using the method in [SECURITY.md](SECURITY.md) rather
  than a public issue.
- See [STORE_LISTING.md](STORE_LISTING.md) for the store description.
- Version history is in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
