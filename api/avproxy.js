// api/avproxy.js — Full Same-Origin Video & Session Proxy for Vercel
export const config = {
  api: {
    bodyParser: false
  }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  try {
    const TARGET_ORIGIN = 'https://stream.aryavidya.cc';
    const host = req.headers.host || 'adityastudy.site';
    const urlObj = new URL(req.url, `https://${host}`);
    const rawPath = urlObj.searchParams.get('__path') || '/';

    urlObj.searchParams.delete('__path');
    const qs = urlObj.searchParams.toString();
    const cleanPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    const targetUrl = `${TARGET_ORIGIN}${cleanPath}${qs ? '?' + qs : ''}`;

    // Spoof headers so play.php sees a direct top-level browser visit on stream.aryavidya.cc
    const forwardHeaders = {
      'User-Agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Referer': 'https://stream.aryavidya.cc/',
      'Origin': 'https://stream.aryavidya.cc',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1'
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
    if (req.headers['x-requested-with']) {
      forwardHeaders['X-Requested-With'] = req.headers['x-requested-with'];
    }

    const fetchOptions = {
      method: req.method || 'GET',
      headers: forwardHeaders,
      redirect: 'manual'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBuf = await readRawBody(req);
      if (rawBuf && rawBuf.length > 0) {
        fetchOptions.body = rawBuf;
      }
    }

    const upstreamRes = await fetch(targetUrl, fetchOptions);

    // Forward response headers & strip anti-framing headers
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
        const cleanLoc = value.replace(/^https?:\/\/stream\.aryavidya\.cc/i, '');
        res.setHeader('Location', cleanLoc || '/av-app');
        return;
      }
      res.setHeader(key, value);
    });

    // Make all session cookies First-Party so Chrome never blocks them inside the iframe
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

    // Rewrite HTML & JS to neutralize iframe detection inside play.php
    if (contentType.includes('text/html') || contentType.includes('javascript')) {
      let text = await upstreamRes.text();

      // Neutralize anti-iframe checks in play.php and scripts
      text = text
        .replace(/window\.top\s*!==\s*window\.self/g, 'false')
        .replace(/window\.self\s*!==\s*window\.top/g, 'false')
        .replace(/self\s*!==\s*top/g, 'false')
        .replace(/top\s*!==\s*self/g, 'false')
        .replace(/window\.frameElement/g, 'null');

      if (contentType.includes('text/html')) {
        const injectedPatch = `
<style id="aditya-proxy-clean-css">
  /* Hide internal Join Community popup inside iframe */
  [role="dialog"], .swal2-container {
    display: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
</style>
<script>
(function(){
  try {
    Object.defineProperty(document, 'referrer', { get: function(){ return 'https://stream.aryavidya.cc/'; } });
    Object.defineProperty(window, 'frameElement', { get: function(){ return null; } });
  } catch(e){}

  // Rewrite any hardcoded stream.aryavidya.cc fetch/XHR to stay on Same-Origin proxy
  try {
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input, init) {
        if (typeof input === 'string' && input.indexOf('https://stream.aryavidya.cc') === 0) {
          input = input.replace('https://stream.aryavidya.cc', '');
        }
        return origFetch.call(this, input, init);
      };
    }
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (typeof url === 'string' && url.indexOf('https://stream.aryavidya.cc') === 0) {
        arguments[1] = url.replace('https://stream.aryavidya.cc', '');
      }
      return origOpen.apply(this, arguments);
    };
  } catch(e){}

  // Auto-dismiss "Maybe later" popup if rendered
  function dismissPopup() {
    try {
      var els = document.querySelectorAll('button, a, span, div');
      for (var i = 0; i < els.length; i++) {
        if ((els[i].textContent || '').trim().toLowerCase() === 'maybe later') {
          els[i].click();
        }
      }
    } catch(e){}
  }
  setInterval(dismissPopup, 250);
  document.addEventListener('DOMContentLoaded', dismissPopup);
})();
</script>`;

        if (text.includes('<head>')) {
          text = text.replace('<head>', '<head>' + injectedPatch);
        } else {
          text = injectedPatch + text;
        }
      }

      res.status(upstreamRes.status).send(text);
      return;
    }

    const arrayBuf = await upstreamRes.arrayBuffer();
    res.status(upstreamRes.status).send(Buffer.from(arrayBuf));
  } catch (err) {
    res.status(502).send('Stream proxy connecting... Please tap reload.');
  }
}
