/**
 * Launcher: the page webOS opens when the app starts (index.html).
 *
 * Starts the app's JS service (services/proxy) over the luna bus, then
 * replaces itself with the home screen the service serves. From then on the
 * whole app runs on the proxy's local origins; this page isn't used again.
 */
const SERVICE = 'luna://org.malagueta.app.service/start';
const DEV_URL = 'http://127.0.0.1:47100/';

const status = document.getElementById('status');
const retry = document.getElementById('retry');

function fail(text) {
  status.textContent = text;
  retry.style.display = 'inline-block';
  retry.focus();
}

/** Calls a luna method and resolves with its parsed response. */
function luna(uri, params) {
  return new Promise((resolve, reject) => {
    const bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = (msg) => {
      let res;
      try { res = JSON.parse(msg); } catch (e) { reject(new Error('Bad response')); return; }
      if (res.returnValue) resolve(res);
      else reject(new Error(res.errorText || res.errorCode || 'The service refused to start'));
    };
    bridge.call(uri, JSON.stringify(params || {}));
  });
}

function start() {
  retry.style.display = 'none';
  status.textContent = 'Starting…';

  if (typeof window.PalmServiceBridge === 'undefined') {
    // On a computer: the proxy is started by `npm run dev`.
    status.innerHTML = 'Not running on a webOS TV.<br>Run <b>npm run dev</b> and open <b>' + DEV_URL + '</b>.';
    return;
  }

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('The service did not answer.')), 15000));
  Promise.race([luna(SERVICE), timeout])
    .then((res) => { location.replace(res.url); })
    .catch((err) => fail('Malagueta could not start: ' + err.message));
}

retry.addEventListener('click', start);
document.addEventListener('keydown', (e) => {
  if (e.keyCode === 461) window.close(); // Back leaves the app from here
});
start();
