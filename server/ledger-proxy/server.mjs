/**
 * سرویس واسط امن دفتر ثبت ارسال مؤدیان (فاز ۲۳)
 *
 * - اعتبار WordPress (Application Password) فقط در متغیر محیطی این سرویس است.
 * - کلاینت عمومی فقط با API Key اختصاصی احراز می‌شود؛ رمز مدیر به اپ نمی‌رود.
 * - فقط عملیات دفتر ثبت (reserve / get / transition / list) پروکسی می‌شود.
 * - هیچ payload صورتحساب ذخیره یا به سازمان امور مالیاتی ارسال نمی‌شود.
 * - ارسال واقعی به سامانه مؤدیان عمداً پیاده‌سازی نشده است.
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const BIND = process.env.BIND || '127.0.0.1';
const WP_BASE_URL = (process.env.WP_BASE_URL || '').replace(/\/+$/, '');
const WP_USER = process.env.WP_APP_USER || '';
const WP_PASS = process.env.WP_APP_PASSWORD || '';
const CLIENT_API_KEY = process.env.CLIENT_API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const WP_PREFIX = '/wp-json/anbarin/v1';

function log(level, msg, extra) {
  const line = { t: new Date().toISOString(), level, msg, ...(extra || {}) };
  // فقط متادیتای امن؛ بدون body و بدون رمز
  console.log(JSON.stringify(line));
}

function requireConfig() {
  const missing = [];
  if (!WP_BASE_URL.startsWith('https://')) missing.push('WP_BASE_URL (https)');
  if (!WP_USER) missing.push('WP_APP_USER');
  if (!WP_PASS) missing.push('WP_APP_PASSWORD');
  if (!CLIENT_API_KEY || CLIENT_API_KEY.length < 24) missing.push('CLIENT_API_KEY (>=24 chars)');
  return missing;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Api-Key';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS';
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function clientAuthorized(req) {
  const keyHeader = req.headers['x-api-key'];
  const auth = req.headers.authorization || '';
  let provided = typeof keyHeader === 'string' ? keyHeader.trim() : '';
  if (!provided && auth.toLowerCase().startsWith('bearer ')) {
    provided = auth.slice(7).trim();
  }
  return timingSafeEqual(provided, CLIENT_API_KEY);
}

function wpAuthHeader() {
  const token = Buffer.from(`${WP_USER}:${WP_PASS}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function proxyToWp(method, pathWithQuery, bodyText) {
  const url = `${WP_BASE_URL}${WP_PREFIX}${pathWithQuery}`;
  const headers = {
    Authorization: wpAuthHeader(),
    Accept: 'application/json',
  };
  if (bodyText !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: bodyText,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: 'پاسخ نامعتبر از دفتر ثبت سرور' };
  }
  return { status: res.status, json };
}

/** فقط فیلدهای مجاز دفتر ثبت؛ payload و اسرار حذف می‌شوند. */
function sanitizeReserveBody(raw) {
  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    return { error: { code: 'invalid_json', message: 'بدنه JSON معتبر نیست.' } };
  }
  if (!data || typeof data !== 'object') {
    return { error: { code: 'invalid_body', message: 'بدنه درخواست معتبر نیست.' } };
  }
  const id = typeof data.id === 'string' ? data.id.trim().slice(0, 64) : '';
  const invoiceReference = typeof data.invoiceReference === 'string' ? data.invoiceReference.trim().slice(0, 191) : '';
  const idempotencyKey = typeof data.idempotencyKey === 'string' ? data.idempotencyKey.trim() : '';
  const environment = data.environment === 'production' ? 'production' : data.environment === 'sandbox' ? 'sandbox' : '';
  if (!id || !invoiceReference || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey) || !environment) {
    return { error: { code: 'invalid_ledger_identity', message: 'شناسه، مرجع فاکتور، کلید یکتایی یا محیط معتبر نیست.' } };
  }
  return {
    body: JSON.stringify({ id, invoiceReference, idempotencyKey, environment }),
  };
}

function sanitizeTransitionBody(raw) {
  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    return { error: { code: 'invalid_json', message: 'بدنه JSON معتبر نیست.' } };
  }
  if (!data || typeof data !== 'object') {
    return { error: { code: 'invalid_body', message: 'بدنه درخواست معتبر نیست.' } };
  }
  const environment = data.environment === 'production' ? 'production' : data.environment === 'sandbox' ? 'sandbox' : '';
  const idempotencyKey = typeof data.idempotencyKey === 'string' ? data.idempotencyKey.trim() : '';
  const state = typeof data.state === 'string' ? data.state.trim() : '';
  const allowedStates = ['ready', 'submitting', 'accepted', 'rejected', 'unknown'];
  if (!environment || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey) || !allowedStates.includes(state)) {
    return { error: { code: 'invalid_transition', message: 'محیط، کلید یکتایی یا وضعیت مقصد معتبر نیست.' } };
  }
  const out = {
    environment,
    idempotencyKey,
    state,
    trackingId: typeof data.trackingId === 'string' ? data.trackingId.trim().slice(0, 160) || null : null,
    message: typeof data.message === 'string' ? data.message.trim().slice(0, 240) || null : null,
    statusChecked: !!data.statusChecked,
  };
  return { body: JSON.stringify(out) };
}

const missing = requireConfig();
if (missing.length) {
  console.error(JSON.stringify({
    level: 'fatal',
    msg: 'پیکربندی ناقص سرویس واسط',
    missing,
    hint: 'WP_BASE_URL, WP_APP_USER, WP_APP_PASSWORD, CLIENT_API_KEY را تنظیم کنید.',
  }));
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    send(res, 204, {}, origin);
    return;
  }

  if (url.pathname === '/health') {
    send(res, 200, {
      ok: true,
      service: 'anbarin-ledger-proxy',
      submissionDisabled: true,
      wpConfigured: true,
    }, origin);
    return;
  }

  if (!clientAuthorized(req)) {
    log('warn', 'unauthorized', { path: url.pathname, method: req.method });
    send(res, 401, { code: 'unauthorized', message: 'کلید API معتبر نیست.' }, origin);
    return;
  }

  try {
    // مسیرهای سازگار با فاز ۲۲ (/wp-json/anbarin/v1/taxpayer/...) و مسیر کوتاه /v1/...
    const path = url.pathname;
    const isSubmissions =
      path === '/v1/submissions' ||
      path === '/wp-json/anbarin/v1/taxpayer/submissions';
    const isList =
      path === '/v1/submissions/list' ||
      path === '/wp-json/anbarin/v1/taxpayer/submissions/list';

    // POST — رزرو
    if (req.method === 'POST' && isSubmissions) {
      const raw = await readBody(req);
      const cleaned = sanitizeReserveBody(raw);
      if (cleaned.error) {
        send(res, 400, cleaned.error, origin);
        return;
      }
      const upstream = await proxyToWp('POST', '/taxpayer/submissions', cleaned.body);
      log('info', 'reserve', { status: upstream.status, created: upstream.json?.created });
      send(res, upstream.status, { ...upstream.json, submissionDisabled: true }, origin);
      return;
    }

    // GET وضعیت
    if (req.method === 'GET' && isSubmissions) {
      const environment = url.searchParams.get('environment') || '';
      const idempotencyKey = url.searchParams.get('idempotencyKey') || '';
      if (!['sandbox', 'production'].includes(environment) || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
        send(res, 400, { code: 'invalid_query', message: 'environment یا idempotencyKey معتبر نیست.' }, origin);
        return;
      }
      const qs = `?environment=${encodeURIComponent(environment)}&idempotencyKey=${encodeURIComponent(idempotencyKey)}`;
      const upstream = await proxyToWp('GET', `/taxpayer/submissions${qs}`);
      log('info', 'get_status', { status: upstream.status });
      send(res, upstream.status, { ...upstream.json, submissionDisabled: true }, origin);
      return;
    }

    // PATCH — انتقال وضعیت
    if (req.method === 'PATCH' && isSubmissions) {
      const raw = await readBody(req);
      const cleaned = sanitizeTransitionBody(raw);
      if (cleaned.error) {
        send(res, 400, cleaned.error, origin);
        return;
      }
      const upstream = await proxyToWp('PATCH', '/taxpayer/submissions', cleaned.body);
      log('info', 'transition', { status: upstream.status, state: JSON.parse(cleaned.body).state });
      send(res, upstream.status, { ...upstream.json, submissionDisabled: true }, origin);
      return;
    }

    // GET list
    if (req.method === 'GET' && isList) {
      const limit = url.searchParams.get('limit') || '30';
      const environment = url.searchParams.get('environment') || '';
      const state = url.searchParams.get('state') || '';
      const qs = new URLSearchParams();
      qs.set('limit', limit);
      if (environment) qs.set('environment', environment);
      if (state) qs.set('state', state);
      const upstream = await proxyToWp('GET', `/taxpayer/submissions/list?${qs}`);
      log('info', 'list', { status: upstream.status });
      send(res, upstream.status, { ...upstream.json, submissionDisabled: true }, origin);
      return;
    }

    send(res, 404, { code: 'not_found', message: 'مسیر موجود نیست. فقط عملیات دفتر ثبت پشتیبانی می‌شود.' }, origin);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    log('error', 'proxy_error', { message: err && err.message ? err.message : 'unknown' });
    send(res, status, {
      code: status === 413 ? 'body_too_large' : 'proxy_failed',
      message: status === 413 ? 'حجم درخواست بیش از حد مجاز است.' : 'ارتباط با دفتر ثبت سرور ناموفق بود.',
      submissionDisabled: true,
    }, origin);
  }
});

server.listen(PORT, BIND, () => {
  log('info', 'ledger_proxy_listening', {
    bind: BIND,
    port: PORT,
    wp: WP_BASE_URL,
    submissionDisabled: true,
  });
});
