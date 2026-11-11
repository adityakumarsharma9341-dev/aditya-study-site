// api/avproxy.js — Vercel Serverless Reverse Proxy for Stream & Video Verification
export default async function handler(req, res) {
  try {
    const TARGET_ORIGIN = 'https://stream.aryavidya.cc';
    const urlObj = new URL(req.url, `https://${req.headers.host || 'adityastudy.site'}`);
    const rawPath = urlObj.searchParams.get('__path') || '/';

    // Build clean upstream query string without internal __path param
    urlObj.searchParams.delete('__path');
    const qs = urlObj.searchParams.toString();
    const targetUrl = `${TARGET_ORIGIN}${rawPath.startsWith('/') ? rawPath : '/' + rawPath}${qs ? '?' + qs : ''}`;

    // Forward headers while spoofing Referer & Origin to pass play.php verification
    const forwardHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Referer': 'https://stream.aryavidya.cc/',
      'Origin': 'https://stream.aryavidya.cc'
    };

    if (req.headers['cookie']) {
      forwardHeaders['Cookie'] = req.headers['cookie'];
    }
    if (req.headers['content-type']) {
      forwardHeaders['Content-Type'] = req.headers['content-type'];
    }
    if (req.headers['range']) {
      forwardHeaders['Range'] = req.headers['range'];
    }

    const fetchOptions = {
      method: req.method || 'GET',
      headers: forwardHeaders,
      redirect: 'manual'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const upstreamRes = await fetch(targetUrl, fetchOptions);

    // Copy safe headers & rewrite cookies to first-party domain
    upstreamRes.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (
        k === 'x-frame-options' ||
        k === 'content-security-policy' ||
        k === 'content-security-policy-report-only' ||
        k === 'content-encoding' ||
        k === 'transfer-encoding' ||
        k === 'content-length'
      ) {
        return;
      }
      if (k === 'location') {
        const cleanLoc = value.replace('https://stream.aryavidya.cc', '');
        res.setHeader('Location', cleanLoc || '/av-app');
        return;
      }
      res.setHeader(key, value);
    });

    // Rewrite Set-Cookie so session tokens work inside the iframe
    if (typeof upstreamRes.headers.getSetCookie === 'function') {
      const cookies = upstreamRes.headers.getSetCookie();
      if (cookies && cookies.length) {
        const rewritten = cookies.map((c) =>
          c
            .replace(/;\s*Domain=[^;]+/gi, '')
            .replace(/;\s*SameSite=[^;]+/gi, '; SameSite=Lax')
        );
        res.setHeader('Set-Cookie', rewritten);
      }
    }

    const contentType = String(upstreamRes.headers.get('content-type') || '').toLowerCase();

    // If HTML response (main app or play.php), inject anti-popup & verification helper
    if (contentType.includes('text/html')) {
      let html = await upstreamRes.text();

      const injectedPatch = `
<style id="aditya-proxy-clean-css">
  /* Hide internal Join Community popup & notification dropdown inside iframe */
  [role="dialog"], .swal2-container, .modal-backdrop, .popup-overlay {
    display: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
</style>
<script>
(function(){
  try {
    // Spoof referrer & top window check for play.php verification
    Object.defineProperty(document, 'referrer', { get: function(){ return 'https://stream.aryavidya.cc/'; } });
  } catch(e){}

  // Auto-click "Maybe later" or close button on any internal community popup
  function killInternalPopups() {
    try {
      var btns = document.querySelectorAll('button, a, div, span');
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '').trim().toLowerCase();
        if (t === 'maybe later') {
          btns[i].click();
          var card = btns[i].closest('div[style*="fixed"], div[class*="fixed"], div[class*="modal"], div[class*="popup"]');
          if (card) card.style.display = 'none';
        }
      }
    } catch(e){}
  }
  setInterval(killInternalPopups, 250);
  document.addEventListener('DOMContentLoaded', killInternalPopups);
})();
</script>`;

      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + injectedPatch);
      } else {
        html = injectedPatch + html;
      }

      res.status(upstreamRes.status).send(html);
      return;
    }

    const arrayBuf = await upstreamRes.arrayBuffer();
    res.status(upstreamRes.status).send(Buffer.from(arrayBuf));
  } catch (err) {
    res.status(502).send(' Gateway Proxy Syncing... Please refresh.');
  }
}
