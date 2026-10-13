# Malagueta

Adult website viewer for LG webOS TVs. Opens the popular tube sites full screen,
**with their ads and pop-ups blocked**, lets you **sign in to your accounts, browse
and search**, and makes mouse-first websites usable with the TV remote.

<p align="center"><img src="assets/icons/largeIcon.png" width="130" alt="Malagueta icon: a red and a green malagueta pepper"></p>

Sites on the home screen: **Pornhub, Pornhub Premium, xHamster, FapHouse, RedTube,
XVideos, XVideos RED, XNXX, YouPorn, SpankBang, Eporner**, plus any site you add
yourself (Edit sites → + Add a site).

For adults only. Malagueta is an independent viewer; it is not affiliated with,
or endorsed by, any of these sites. Respect each site's terms and your local laws.

## Using it

| Remote | What it does |
| --- | --- |
| Arrows, OK | Move between links and buttons, open them. Age gates and cookie banners are reachable first. The Magic Remote pointer works too. |
| Back | Close the menu → leave full screen → previous page → home screen |
| 🔴 Red | Malagueta menu: Home, Back/Forward/Reload, search, zoom, ad blocking on/off, hide an element, clear site data, exit |
| 🟢 Green | Search the current site |
| 🟡 Yellow | Full screen for the video on the page |
| 🔵 Blue | Hide an element: point at an ad the lists missed (or use ▲/▼ to pick a bigger/smaller area), OK hides it on that site for good |
| ▶ ⏸ ◀◀ ▶▶ | Play, pause, jump 30 s. In full screen, ◀ ▶ jump 10 s and OK pauses |
| CH + / CH − | Scroll a page up or down |

On the home screen, type in the search box and pick which site to search with
the chips under it. **Edit sites** hides sites you don't use and edits your own.
**Settings** can set a 4-digit PIN asked when Malagueta opens (a curtain for a
shared TV, not encryption).

Signing in works as in a browser: use the site's own sign-in page. Each site keeps
its own sign-in. To sign out use the site's own Log out (the menu's **Clear site
data** removes what a page can reach, but not cookies a site locks away).

## How it works

Sites open **at their real addresses**, in the app's own window, exactly as the
TV's browser engine would show them. Players, sign-ins and captchas therefore
behave like in a browser.

webOS's web app manager injects `webOSUserScripts/userScript.js` from an app's
folder into every page that app shows, before the page's own scripts run (it is
how [youtube-webos](https://github.com/webosbrew/youtube-webos) blocks ads).
Malagueta's user script (`src/userscript`) adds, on every site:

- **Ad blocking** (`block.js`): requests to ad networks (fetch, XHR, beacons,
  `<script>`, `<iframe>`, `<img>`, ad frames built from inline HTML) get an empty
  answer or never load; ad scripts in the page's HTML are stopped before they run;
  known ad slots are hidden with CSS. Lists: `src/shared/blocklist.json` (shared)
  and `cosmetic` in `src/shared/sites.json` (per site). Video players are left
  alone.
- **Pop-up blocking**: `window.open` only opens the site's own pages, in the same
  window; pop-unders and "new tab" ads never open.
- **Remote control**: D-pad navigation over links and buttons (`src/shared/spatial.js`),
  which keeps to whatever dialog is on top; media keys; the menu (`menu.js`);
  the element picker (`picker.js`).

The home screen (`src/home`) is the app's own page. Back from a site's first page
returns to it, and the menu's Home jumps back to it through the history.

The app identifies itself to sites as desktop Chrome on Linux
(`vendorExtension.userAgent` in `appinfo.json`), so sites serve their full
desktop pages rather than their own "Smart TV" versions.

### Known limits

- **First TV run pending.** Everything above was checked against the real sites
  in desktop Chromium with the script injected the way webOS does it (D-pad, age
  gates, menu, search, Home, ad blocking). Video decoding can't be checked there
  (no H.264), so playback still needs confirming on the TV.
- **The desktop User-Agent** says Chrome 87 (webOS 22). If your TV is older and a
  site misbehaves, set its real Chrome version there, or remove
  `vendorExtension` to get the sites' own TV versions.
- **Cloudflare checks** (SpankBang) show a "Verify you are human" box inside a
  frame the D-pad can't reach: tick it with the Magic Remote pointer.
- **Ad lists need tuning.** Sites change their markup often. For leftovers, use
  🔵 Blue → hide, or add selectors to `src/shared/sites.json`. Search URLs for
  each site are there too.

## Building

Requirements: Node 20+ (see `.nvmrc`). The webOS CLI tools come with `npm install`.

```sh
npm install
npm run build          # dist/: home screen, webOSUserScripts/userScript.js, icons
npm test               # search URL and site list checks
npm run package        # out/org.malagueta.app_<version>_all.ipk + Homebrew manifest
npm run icons          # regenerate icon.png, largeIcon.png, splash.png from the SVG
```

### Trying it on a computer

```sh
npm run watch          # rebuilds dist/ on every change, including dist/malagueta.user.js
```

- Home screen: open `dist/index.html` in Chrome.
- Sites: install `dist/malagueta.user.js` in Tampermonkey or Violentmonkey and
  open a site. Escape = Back, F9–F12 = the red, green, yellow and blue buttons.

### Installing on the TV

With Developer Mode or a rooted TV, register it once with `npx ares-setup-device`
(name it `tv`), then:

```sh
npm run tv:deploy      # package, install, launch
npm run tv:inspect     # DevTools for the app (home screen and sites)
```

The package targets webOS 4.0 and newer (Chromium 53 and up).

## Project layout

```
appinfo.json, index.html     webOS app manifest and home screen page
src/home/                    home screen
src/userscript/              the script webOS injects into every site
src/shared/                  sites.json, blocklist.json, search, spatial navigation
assets/icons/                launcher icons and splash; source/malagueta.svg is the original
scripts/                     icons, TV helpers, Homebrew manifest
test/                        tests
```

## License

GPL-3.0. The pepper icon was drawn for this project and is under the same license.
