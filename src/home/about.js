/**
 * What the About dialog needs: the project's links, QR codes for them and a
 * way to open them in the TV's own web browser.
 *
 * A TV has no way to "click" a link into another app, so each link is shown
 * three ways: as a QR code to scan with a phone, as a short address to type,
 * and (on webOS) as a button that opens it in the TV's browser.
 */
import qrcode from 'qrcode-generator';

/** The links shown in About. */
export const LINKS = [
  {
    id: 'github',
    label: 'Source code and updates',
    button: 'Open GitHub',
    url: 'https://github.com/pustal/Malagueta',
  },
  {
    id: 'kofi',
    label: 'Support Malagueta',
    button: 'Open Ko-fi',
    url: 'https://ko-fi.com/pustal',
  },
];

/** The address without "https://", for showing on screen. */
export function shortUrl(url) {
  return url.replace(/^https?:\/\//, '');
}

/**
 * A QR code for `text` as SVG markup: dark modules on a light background with
 * a quiet zone, which phones read reliably off a TV screen.
 * @param {string} text
 * @returns {string}
 */
export function qrSvg(text) {
  const qr = qrcode(0, 'M'); // 0 = smallest version that fits; M = ~15% error correction
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}

/** True on a webOS TV, where apps can be launched over the luna service bus. */
export function canOpenBrowser() {
  return typeof window.PalmServiceBridge !== 'undefined';
}

/**
 * Opens `url` in the TV's web browser through webOS's application manager.
 * Malagueta keeps running in the background; the Back or Home key returns.
 * @param {string} url
 * @returns {Promise<void>} rejects with the system's error text
 */
export function openInTvBrowser(url) {
  return new Promise((resolve, reject) => {
    const bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = (msg) => {
      let res = {};
      try { res = JSON.parse(msg); } catch (e) { /* treated as a failure below */ }
      if (res.returnValue) resolve();
      else reject(new Error(res.errorText || 'the browser could not be opened'));
    };
    bridge.call('luna://com.webos.applicationManager/launch',
      JSON.stringify({ id: 'com.webos.app.browser', params: { target: url } }));
  });
}
