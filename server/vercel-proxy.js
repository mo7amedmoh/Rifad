const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const hopByHopHeaders = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto'
]);

function getApiOrigin(value, requestHost) {
  if (!value) {
    const error = new Error('RIFAD_API_ORIGIN is not configured.');
    error.status = 503;
    throw error;
  }

  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('RIFAD_API_ORIGIN must be a valid origin URL.');
  }
  if (
    (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:') ||
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('RIFAD_API_ORIGIN must be an HTTPS origin without credentials or a path.');
  }
  if (requestHost && origin.host.toLowerCase() === requestHost.toLowerCase()) {
    throw new Error('RIFAD_API_ORIGIN must point to the separate Node.js API service.');
  }
  return origin;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function getRequestUrl(req) {
  const requestUrl = new URL(req.url, 'https://vercel.invalid');
  if (requestUrl.pathname !== '/api/[...path]') return requestUrl;

  const routePath = req.query?.path;
  if (!routePath) return requestUrl;
  const segments = (Array.isArray(routePath) ? routePath : [routePath])
    .flatMap((segment) => String(segment).split('/'))
    .filter(Boolean);
  if (!segments.length) return requestUrl;

  requestUrl.pathname = `/api/${segments.map(encodeURIComponent).join('/')}`;
  requestUrl.searchParams.delete('path');
  return requestUrl;
}

function createVercelApiProxy() {
  return async function vercelApiProxy(req, res) {
    try {
      const requestUrl = getRequestUrl(req);
      if (requestUrl.origin !== 'https://vercel.invalid' || !requestUrl.pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'المسار غير موجود.' });
      }

      const apiOrigin = getApiOrigin(process.env.RIFAD_API_ORIGIN, req.headers.host);
      const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
      const headers = new Headers();
      const connectionTokens = new Set(
        String(req.headers.connection || '').split(',').map((header) => header.trim().toLowerCase()).filter(Boolean)
      );
      for (const [name, value] of Object.entries(req.headers)) {
        const normalizedName = name.toLowerCase();
        if (!value || hopByHopHeaders.has(normalizedName) || connectionTokens.has(normalizedName)) continue;
        headers.set(normalizedName, Array.isArray(value) ? value.join(', ') : value);
      }

      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: hasBody ? req : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(55_000)
      });

      res.statusCode = upstream.status;
      upstream.headers.forEach((value, name) => {
        if (
          name !== 'set-cookie' &&
          name !== 'content-encoding' &&
          !hopByHopHeaders.has(name.toLowerCase())
        ) res.setHeader(name, value);
      });
      const setCookies = upstream.headers.getSetCookie?.() || [];
      if (setCookies.length) res.setHeader('set-cookie', setCookies);
      res.setHeader('cache-control', 'no-store');

      if (!upstream.body) return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      console.error('Vercel API proxy request failed:', error.message);
      if (res.headersSent) return res.destroy(error);
      const status = error.status || 502;
      return sendJson(res, status, {
        error: status === 503
          ? 'لم يتم ربط خدمة API بعد. أضف RIFAD_API_ORIGIN إلى متغيرات Vercel.'
          : 'تعذر الاتصال بخدمة التطبيق. تحقق من إعدادات النشر وحاول مجددًا.'
      });
    }
  };
}

module.exports = { createVercelApiProxy, getRequestUrl };
