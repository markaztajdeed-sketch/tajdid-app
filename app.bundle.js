/* مركز تجديد — ملف مُجمَّع تلقائياً، لا تعدّله مباشرة */
(function () {
'use strict';
const api = (function () {
// Thin Supabase client (Auth + PostgREST) — no external dependencies.
const SUPABASE_URL = 'https://eewfgudrudeiaoiazxap.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0sagFk33_z9rKVdp1dF3fg_qxDTUFrf';

const SESSION_KEY = 'tajdid_session';
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }

function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}

function getSession() { return session; }

// ---------- error translation ----------
class ApiError extends Error {}

function translateError(body, status) {
  const msg = (body && (body.message || body.msg || body.error_description || body.error)) || '';
  const code = body && body.code;
  if (/Invalid login credentials/i.test(msg)) return 'البريد الإلكتروني أو كلمة السر غير صحيحة';
  if (/Email not confirmed/i.test(msg)) return 'لم يتم تأكيد البريد الإلكتروني بعد. افتح الرسالة التي وصلتك واضغط على رابط التأكيد';
  if (/User already registered/i.test(msg)) return 'هذا البريد مسجّل مسبقاً';
  if (/Password should be at least/i.test(msg)) return 'كلمة السر قصيرة جداً (6 أحرف على الأقل)';
  if (/rate limit/i.test(msg)) return 'محاولات كثيرة، يرجى الانتظار قليلاً ثم إعادة المحاولة';
  if (code === '42501' || /row-level security/i.test(msg)) {
    if (/center_publications/.test(msg)) return 'لا يمكنك حفظ هذا النشر: الكتب يضيفها المالك والإدارة فقط، والمقالة تُضاف لبحث أدخلته أنت وفي عدد من مجلاتك.';
    if (/submissions/.test(msg)) return 'لا يمكنك حفظ هذا الاستلام: تستطيع إدارة استلامات مجلاتك فقط.';
    if (/bibliographic_details|translation_details/.test(msg)) return 'لا يمكنك تعديل بيانات هذا البحث لأنك لم تُدخله.';
    return 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
  }
  if (code === '23503') return 'لا يمكن تنفيذ العملية لأن هذا السجل مرتبط بسجلات أخرى';
  if (code === '23505' && /isbn/i.test(msg)) return 'رقم ISBN هذا مستخدم لسجل آخر';
  if (code === '23505' && /doi/i.test(msg)) return 'رقم DOI هذا مستخدم لسجل آخر';
  if (code === '23505' && /issues/.test(msg)) return 'هذا العدد موجود مسبقاً في هذه المجلة. تجده في «المجلات والأعداد» بعد اختيار المجلة من الأعلى.';
  if (code === '23505' && /submissions/.test(msg)) return 'لهذا البحث استلام مسجّل مسبقاً (يُقدَّم البحث مرة واحدة)';
  if (code === '23505') return 'هذه القيمة موجودة مسبقاً (لا يُسمح بالتكرار)';
  if (code === '23514' && /center_pub_article_issue/.test(msg)) return 'المقالة تحتاج عدداً، والكتاب لا يُربط بعدد ولا بصفحات';
  if (code === '23514' && /pages_order/.test(msg)) return 'صفحة النهاية يجب ألا تكون قبل صفحة البداية';
  if (code === '23514' && /rejection_reason/.test(msg)) return 'سبب الرفض يُكتب فقط عندما تكون المرحلة «مرفوض»';
  if (code === '23514') return 'قيمة غير صالحة (تحقق من السنة أو عدد الصفحات)';
  if (code === '23502') return 'يوجد حقل إلزامي فارغ';
  if (code === 'P0001') return msg;
  if (status === 401) return 'انتهت الجلسة، يرجى تسجيل الدخول من جديد';
  return msg || 'حدث خطأ غير متوقع';
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(translateError(body, res.status));
  return body;
}

// ---------- auth ----------
async function authFetch(path, body, method = 'POST', withUser = false) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (withUser && session) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return parse(res);
}

function storeAuth(data) {
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user,
  });
  return session;
}

async function signIn(email, password) {
  return storeAuth(await authFetch('token?grant_type=password', { email, password }));
}

async function signUp(email, password, fullName) {
  return authFetch('signup', {
    email, password, data: { full_name: fullName },
  });
}

async function recoverPassword(email) {
  return authFetch(`recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email });
}

async function updatePassword(password) {
  return authFetch('user', { password }, 'PUT', true);
}

async function signOut() {
  try { await authFetch('logout', null, 'POST', true); } catch { /* ignore */ }
  saveSession(null);
}

let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) throw new ApiError('انتهت الجلسة، يرجى تسجيل الدخول من جديد');
  if (!refreshing) {
    refreshing = authFetch('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then(storeAuth)
      .catch((e) => { saveSession(null); throw e; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// Session from URL hash (email confirmation / password recovery links)
async function consumeUrlSession() {
  if (!location.hash.includes('access_token')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const access_token = p.get('access_token');
  const type = p.get('type');
  history.replaceState(null, '', location.pathname + location.search);
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${access_token}` },
  }).then(parse);
  storeAuth({
    access_token, refresh_token: p.get('refresh_token'),
    expires_in: Number(p.get('expires_in') || 3600), user,
  });
  return type;
}

// ---------- REST ----------
async function rest(path, { method = 'GET', body, headers = {} } = {}, retry = true) {
  if (session && session.expires_at - 60 < Date.now() / 1000) await refresh();
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
  if (session) h.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry && session) {
    await refresh();
    return rest(path, { method, body, headers }, false);
  }
  return parse(res);
}

const enc = (v) => encodeURIComponent(v);
const filterQs = (match) =>
  Object.entries(match).map(([k, v]) => `${enc(k)}=eq.${enc(v)}`).join('&');

// cols: PostgREST select list, including embedded relations, e.g. '*,pub:center_publications(*)'
async function selectAll(table, order = 'id', cols = '*') {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const page = await rest(`${enc(table)}?select=${cols}${order ? `&order=${order}` : ''}`, {
      headers: { Range: `${from}-${from + size - 1}`, 'Range-Unit': 'items' },
    });
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

async function insertRow(table, values) {
  const rows = await rest(enc(table), {
    method: 'POST', body: values, headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لتنفيذ هذا الإجراء');
  return rows[0];
}

async function updateRows(table, match, values) {
  const rows = await rest(`${enc(table)}?${filterQs(match)}`, {
    method: 'PATCH', body: values, headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لتعديل هذا السجل');
  return rows[0];
}

async function deleteRows(table, match) {
  const rows = await rest(`${enc(table)}?${filterQs(match)}`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لحذف هذا السجل');
  return rows;
}

// ---------- 1:1 extension tables (keyed by research_id) ----------
// Insert or update the row of an extension table for one research
async function upsertExtension(table, researchId, values) {
  const rows = await rest(`${enc(table)}?on_conflict=research_id`, {
    method: 'POST', body: { ...values, research_id: researchId },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لتنفيذ هذا الإجراء');
  return rows[0];
}
// Remove the row of an extension table for one research
async function deleteExtension(table, researchId) {
  return deleteRows(table, { research_id: researchId });
}

// Filtered select, e.g. select('folders', 'journal_id=eq.2&order=sort')
async function select(table, query = '', cols = '*') {
  return rest(`${enc(table)}?select=${cols}${query ? `&${query}` : ''}`);
}

// Call a database function (public schema)
async function rpc(fn, args = {}) {
  return rest(`rpc/${enc(fn)}`, { method: 'POST', body: args });
}

// ---------- Storage ----------
const MAX_FILE = 50 * 1024 * 1024;
const MAX_FILE_MB = 50;

async function freshToken() {
  if (!session) throw new ApiError('انتهت الجلسة، يرجى تسجيل الدخول من جديد');
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session.access_token;
}

// Upload to a private bucket with progress (0..1). Never overwrites an existing object.
async function uploadPrivate(bucket, path, file, onProgress) {
  if (file.size > MAX_FILE) throw new ApiError(`حجم الملف أكبر من ${MAX_FILE_MB} ميغابايت`);
  const token = await freshToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(1); resolve(path); return; }
      let msg = 'تعذّر رفع الملف';
      try {
        const b = JSON.parse(xhr.responseText); const m = `${b.message || ''} ${b.error || ''}`;
        if (xhr.status === 413 || /size|large/i.test(m)) msg = `حجم الملف أكبر من ${MAX_FILE_MB} ميغابايت`;
        else if (/row-level|unauthorized|403/i.test(m) || xhr.status === 403) msg = 'ليس لديك صلاحية للرفع إلى هذه المجلة';
      } catch { /* ignore */ }
      reject(new ApiError(msg));
    };
    xhr.onerror = () => reject(new ApiError('انقطع الاتصال أثناء الرفع'));
    xhr.send(file);
  });
}

// Delete objects from storage (owner only by policy)
async function storageRemove(bucket, paths) {
  const token = await freshToken();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  return parse(res);
}

// Temporary link (default 10 minutes). download = file name to force download.
async function signedUrl(bucket, path, { expiresIn = 600, download = null } = {}) {
  const token = await freshToken();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  const b = await parse(res).catch(() => { throw new ApiError('تعذّر فتح الملف (ليس لديك صلاحية أو الملف غير موجود)'); });
  const url = `${SUPABASE_URL}/storage/v1${b.signedURL || b.signedUrl}`;
  return download ? `${url}&download=${encodeURIComponent(download)}` : url;
}
async function uploadPublic(bucket, path, blob, retry = true) {
  if (session && session.expires_at - 60 < Date.now() / 1000) await refresh();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`,
      'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '3600',
    },
    body: blob,
  });
  if (res.status === 401 && retry) { await refresh(); return uploadPublic(bucket, path, blob, false); }
  if (!res.ok) {
    let msg = 'تعذّر رفع الصورة';
    try { const b = await res.json(); if (/size/i.test(b.message || b.error || '')) msg = 'حجم الصورة كبير جداً'; } catch { /* ignore */ }
    throw new ApiError(msg);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}?v=${Date.now()}`;
}

// Verify a password without changing the current session
async function checkPassword(email, password) {
  try { await authFetch('token?grant_type=password', { email, password }); return true; } catch { return false; }
}

return { SUPABASE_URL, SUPABASE_KEY, getSession, ApiError, signIn, signUp, recoverPassword, updatePassword, signOut, consumeUrlSession, selectAll, insertRow, updateRows, deleteRows, upsertExtension, deleteExtension, select, rpc, MAX_FILE_MB, uploadPrivate, storageRemove, signedUrl, uploadPublic, checkPassword };
})();
// Line icons (Lucide-style, 24×24, stroke = currentColor).
const PATHS = {
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21v-7h6v7"/><path d="M12 3 3 8h18z"/>',
  journal: '<path d="M4 21h15a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2"/><path d="M10 7h7v4h-7z"/><path d="M10 15h7"/><path d="M10 18h4"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  hash: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="m16 3-2 18"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10A15 15 0 0 1 12 2z"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  idcard: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 9h3"/><path d="M15 13h3"/><path d="M6 16.5a3 3 0 0 1 6 0"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-4"/><path d="M13 17V9"/><path d="M18 17V6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  columns: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  logout: '<path d="M15 21h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4"/><path d="m8 17-5-5 5-5"/><path d="M3 12h12"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  link: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
  chevron: '<path d="m15 18-6-6 6-6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
};

function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return span;
}

// Table & field definitions: database names (English) ↔ interface labels (Arabic).
// Field types: text | longtext | number | url | fk | enum | link | contacts | user | date | derived | publication | computed
// ext: the 1:1 extension object on the research row (pub | bib | trans | sub), col: its column

// Record info (who entered/edited and when) — visible to owner & admin only
const meta = [
  { key: 'created_by', label: 'أُدخل بواسطة', type: 'user', readonly: true, hidden: true, staffOnly: true },
  { key: 'created_at', label: 'تاريخ الإدخال', type: 'date', readonly: true, hidden: true, staffOnly: true },
  { key: 'updated_by', label: 'آخر تعديل بواسطة', type: 'user', readonly: true, hidden: true, staffOnly: true },
  { key: 'updated_at', label: 'تاريخ آخر تعديل', type: 'date', readonly: true, hidden: true, staffOnly: true },
];

const refTable = (label, icon, extra = []) => ({
  label, icon, display: 'name', group: 'lists',
  fields: [{ key: 'name', label: 'الاسم', type: 'text', required: true, width: 260 }, ...extra],
});

const TABLES = {
  researches: {
    label: 'الأبحاث', single: 'بحث', icon: 'book', display: 'title', group: 'main',
    // Columns read from the database (the old publication columns of researches are no longer used),
    // with the 1:1 extension tables embedded: pub, bib, trans, sub
    select: 'id,title,summary,year,language_id,research_type_id,url,notes,created_at,created_by,updated_at,updated_by,'
      + 'pub:center_publications(*),bib:bibliographic_details(*),trans:translation_details(*),sub:submissions(*)',
    fields: [
      { key: 'title', label: 'عنوان البحث', type: 'text', required: true, width: 320 },
      { key: 'researchers', label: 'الباحثون', type: 'link', via: 'research_researchers', self: 'research_id', other: 'person_id', ref: 'persons', width: 200 },
      { key: 'translators', label: 'المترجمون', type: 'link', via: 'research_translators', self: 'research_id', other: 'person_id', ref: 'persons', width: 180 },
      { key: 'status', label: 'الوضع', type: 'computed', readonly: true, width: 220 },
      { key: 'publication', label: 'النشر في مجلاتنا', type: 'publication', readonly: true, width: 210 },
      { key: 'year', label: 'السنة', type: 'number', width: 80 },
      { key: 'research_type_id', label: 'النوع', type: 'fk', ref: 'research_types', width: 100 },
      { key: 'language_id', label: 'اللغة', type: 'fk', ref: 'languages', width: 110 },
      { key: 'topics', label: 'المواضيع', type: 'link', via: 'research_topics', self: 'research_id', other: 'topic_id', ref: 'topics', width: 170 },
      { key: 'publishers', label: 'الناشرون', type: 'link', via: 'research_publishers', self: 'research_id', other: 'publisher_id', ref: 'publishers', width: 200 },
      { key: 'tags', label: 'الوسوم', type: 'link', via: 'research_tags', self: 'research_id', other: 'tag_id', ref: 'tags', width: 160 },
      // ---- center_publications (pub) ----
      { key: 'pub_kind', label: 'نوع النشر', type: 'enum', options: 'PUB_KINDS', ext: 'pub', col: 'kind', width: 120 },
      { key: 'pub_journal', label: 'المجلة', type: 'computed', readonly: true, width: 130 },
      { key: 'issue_id', label: 'العدد', type: 'fk', ref: 'issues', ext: 'pub', col: 'issue_id', width: 170 },
      { key: 'issue_order', label: 'ترتيبها في العدد', type: 'number', ext: 'pub', col: 'issue_order', width: 90 },
      { key: 'pub_pages', label: 'الصفحات', type: 'computed', readonly: true, width: 100 },
      { key: 'start_page', label: 'من صفحة', type: 'number', ext: 'pub', col: 'start_page', width: 80 },
      { key: 'end_page', label: 'إلى صفحة', type: 'number', ext: 'pub', col: 'end_page', width: 80 },
      // ---- submissions (sub) — not visible to data entry ----
      { key: 'sub_journal', label: 'مجلة الاستلام', type: 'fk', ref: 'journals', ext: 'sub', col: 'journal_id', width: 130, subOnly: true },
      { key: 'stage', label: 'المرحلة', type: 'enum', options: 'STAGES', ext: 'sub', col: 'stage', width: 130, subOnly: true },
      { key: 'received_at', label: 'تاريخ الاستلام', type: 'date', ext: 'sub', col: 'received_at', width: 120, subOnly: true },
      { key: 'decided_at', label: 'تاريخ القرار', type: 'date', ext: 'sub', col: 'decided_at', width: 120, subOnly: true },
      { key: 'rejection_reason', label: 'سبب الرفض', type: 'text', ext: 'sub', col: 'rejection_reason', width: 240, subOnly: true },
      // ---- bibliographic_details (bib) ----
      { key: 'isbn', label: 'ISBN', type: 'text', ext: 'bib', col: 'isbn', width: 150, ltr: true },
      { key: 'doi', label: 'DOI', type: 'text', ext: 'bib', col: 'doi', width: 150, ltr: true },
      { key: 'pages', label: 'عدد الصفحات', type: 'number', ext: 'bib', col: 'pages', width: 100 },
      // ---- translation_details (trans) ----
      { key: 'original_title', label: 'العنوان الأصلي', type: 'text', ext: 'trans', col: 'original_title', width: 240 },
      { key: 'original_language_id', label: 'اللغة الأصلية', type: 'fk', ref: 'languages', ext: 'trans', col: 'original_language_id', width: 110 },
      { key: 'url', label: 'رابط البحث', type: 'url', width: 160 },
      { key: 'summary', label: 'الملخص', type: 'longtext', width: 260 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220 },
      ...meta,
    ],
  },
  persons: {
    label: 'الأشخاص', single: 'شخص', icon: 'user', display: 'name', group: 'main',
    fields: [
      { key: 'name', label: 'الاسم', type: 'text', required: true, width: 220 },
      { key: 'roles', label: 'الدور', type: 'link', via: 'person_role_assignments', self: 'person_id', other: 'role_id', ref: 'person_roles', width: 140, adminOnly: true },
      { key: 'nationality_id', label: 'الجنسية', type: 'fk', ref: 'countries', width: 120 },
      { key: 'as_researcher', label: 'أبحاثه', type: 'link', via: 'research_researchers', self: 'person_id', other: 'research_id', ref: 'researches', width: 260 },
      { key: 'as_translator', label: 'ترجماته', type: 'link', via: 'research_translators', self: 'person_id', other: 'research_id', ref: 'researches', width: 260 },
      { key: 'related_journals', label: 'المجلات المرتبطة', type: 'derived', ref: 'journals', readonly: true, width: 220,
        compute: 'journals_via_researches', sources: [{ via: 'research_researchers', self: 'person_id' }, { via: 'research_translators', self: 'person_id' }] },
      { key: 'production', label: 'إنتاجه في مجلاتنا', type: 'production', readonly: true, hidden: true, width: 300 },
      { key: 'contacts', label: 'وسائل التواصل', type: 'contacts', table: 'persons_contacts', self: 'person_id', width: 240 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220 },
      ...meta,
    ],
  },
  publishers: {
    label: 'الناشرون', single: 'ناشر', icon: 'building', display: 'name', group: 'main',
    fields: [
      { key: 'name', label: 'الاسم', type: 'text', required: true, width: 240 },
      { key: 'country_id', label: 'الدولة', type: 'fk', ref: 'countries', width: 120 },
      { key: 'researches', label: 'الأبحاث', type: 'link', via: 'research_publishers', self: 'publisher_id', other: 'research_id', ref: 'researches', width: 280 },
      { key: 'related_journals', label: 'المجلات المرتبطة', type: 'derived', ref: 'journals', readonly: true, width: 220,
        compute: 'journals_via_researches', sources: [{ via: 'research_publishers', self: 'publisher_id' }] },
      { key: 'description', label: 'تعريف', type: 'longtext', width: 260 },
      { key: 'contacts', label: 'وسائل التواصل', type: 'contacts', table: 'publishers_contacts', self: 'publisher_id', width: 240 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220 },
      ...meta,
    ],
  },
  journals: refTable('المجلات', 'journal', [
    { key: 'frequency', label: 'الدورية', type: 'enum', options: 'FREQUENCIES', width: 120 },
    { key: 'researches', label: 'المنشور فيها', type: 'derived', compute: 'journal_researches', ref: 'researches', readonly: true, width: 520 },
  ]),
  topics: refTable('المواضيع', 'tag', [
    { key: 'researches', label: 'الأبحاث', type: 'link', via: 'research_topics', self: 'topic_id', other: 'research_id', ref: 'researches', width: 420 },
  ]),
  tags: refTable('الوسوم', 'hash', [
    { key: 'researches', label: 'الأبحاث', type: 'link', via: 'research_tags', self: 'tag_id', other: 'research_id', ref: 'researches', width: 420 },
  ]),
  countries: refTable('الدول', 'globe'),
  languages: refTable('اللغات', 'languages'),
  research_types: refTable('أنواع الأبحاث', 'layers'),
  contact_types: refTable('أنواع التواصل', 'phone'),
  person_roles: refTable('أدوار الأشخاص', 'idcard'),
  // Issues are loaded for pickers and labels; their own pages come with «مجلتي»
  issues: {
    label: 'الأعداد', single: 'عدد', icon: 'journal', display: 'label', group: 'none',
    fields: [
      { key: 'journal_id', label: 'المجلة', type: 'fk', ref: 'journals', required: true },
      { key: 'number', label: 'رقم العدد', type: 'number', required: true },
      { key: 'year', label: 'السنة', type: 'number' },
      { key: 'title', label: 'عنوان العدد', type: 'text' },
      { key: 'period', label: 'الفترة أو الفصل', type: 'text' },
      { key: 'isbn', label: 'ISBN العدد', type: 'text', ltr: true },
      { key: 'notes', label: 'ملاحظات', type: 'longtext' },
    ],
  },
};
TABLES.journals.single = 'مجلة';

// Tables loaded but not shown in the sidebar
const AUX_TABLES = [
  'research_researchers', 'research_translators', 'research_publishers',
  'research_topics', 'research_tags', 'person_role_assignments', 'persons_contacts',
  'publishers_contacts', 'profiles', 'journal_editors',
];

const ROLE_LABELS = {
  owner: 'مالك', admin: 'إدارة', editor: 'مدير مجلة', data_entry: 'مدخل بيانات',
};

// ---- center publications & submissions ----
const PUB_KINDS = {
  article: 'مقالة', authored_book: 'كتاب مؤلَّف', extracted_book: 'كتاب مستَل', translated_book: 'كتاب مترجَم',
};
const STAGES = {
  received: 'مستلَم', initial_review: 'مراجعة أولية', under_review: 'عند المحكّمين', revisions: 'معاد للتعديل',
  accepted: 'مقبول', proofreading: 'قيد التدقيق', proofread: 'مدقَّق', final: 'نهائي', published: 'منشور', rejected: 'مرفوض',
};
const FREQUENCIES = { annual: 'سنوية', semiannual: 'نصف سنوية', quarterly: 'فصلية' };
const ENUMS = { PUB_KINDS, STAGES, FREQUENCIES };
// Issue periods in order, by journal frequency (annual journals have none)
const PERIODS = {
  quarterly: ['شتاء', 'ربيع', 'صيف', 'خريف'],
  semiannual: ['النصف الأول', 'النصف الثاني'],
};
// Period of a date: quarterly → season (winter = Dec–Feb), semiannual → half of the year
function periodOfDate(freq, d = new Date()) {
  const m = d.getMonth();
  if (freq === 'quarterly') return PERIODS.quarterly[Math.floor(((m + 1) % 12) / 3)];
  if (freq === 'semiannual') return PERIODS.semiannual[m < 6 ? 0 : 1];
  return null;
}
// Text shown for an issue's time: «ربيع 2026», or just the year
const issueWhen = (i) => [i?.period, i?.year].filter(Boolean).join(' ');
const CENTER_LIBRARY = 'إصدارات المركز';
// Who may see submissions (data entry does not)
const seesSubmissions = (role) => ['owner', 'admin', 'editor'].includes(role);
// Kinds a role may save in center_publications (books: owner & admin only)
const pubKindsFor = (role) => (['owner', 'admin'].includes(role) ? Object.keys(PUB_KINDS) : ['article']);

// Ready-made views above the researches grid: columns + row filter (filter is applied in app.js by key)
const RESEARCH_VIEWS = [
  { key: 'all', label: 'الكل', cols: ['title', 'researchers', 'translators', 'year', 'language_id', 'status'] },
  { key: 'center', label: 'منشورات المركز', cols: ['title', 'pub_kind', 'pub_journal', 'issue_id', 'pub_pages'] },
  { key: 'wip', label: 'قيد العمل', cols: ['title', 'sub_journal', 'stage', 'received_at'], subOnly: true },
  { key: 'rejected', label: 'المرفوضة', cols: ['title', 'sub_journal', 'decided_at', 'rejection_reason'], subOnly: true },
  { key: 'external', label: 'الأبحاث الخارجية', cols: ['title', 'isbn', 'doi', 'publishers', 'topics'] },
];

// ---- permissions (mirrors the RLS policies; the database is the real gatekeeper) ----
const ADMIN_LISTS = ['countries', 'languages', 'research_types', 'contact_types', 'person_roles', 'journals'];
const SHARED = ['persons', 'publishers', 'topics', 'tags'];
// A journal manager adds researches, people and publishers, and edits only what they created
const EDITOR_TABLES = ['researches', 'persons', 'publishers'];
// Journals the signed-in editor manages (set by the app after loading journal_editors)
let managed = new Set();
function setManagedJournals(ids) { managed = new Set(ids); }
const managesJournal = (role, jid) => role === 'owner' || role === 'admin' || (role === 'editor' && managed.has(jid));

function canInsert(role, table) {
  if (role === 'owner' || role === 'admin') return true;
  if (table === 'issues') return role === 'editor' && managed.size > 0;
  if (role === 'data_entry') return table === 'researches' || SHARED.includes(table);
  if (role === 'editor') return EDITOR_TABLES.includes(table);
  return false;
}

function canEditRow(role, uid, table, row) {
  if (role === 'owner' || role === 'admin') return true;
  if (table === 'issues') return role === 'editor' && (!row || managed.has(row.journal_id));
  if (role === 'editor') return EDITOR_TABLES.includes(table) && (!row || row.created_by === uid);
  if (role !== 'data_entry') return false;
  if (table === 'researches') return !row || row.created_by === uid;
  return SHARED.includes(table);
}

function canEditField(role, uid, table, row, field) {
  if (field.readonly) return false;
  if (field.adminOnly && !(role === 'owner' || role === 'admin')) return false;
  if (field.type === 'link') {
    // editing a link = editing the research it belongs to
    if (table === 'researches') return canEditRow(role, uid, table, row);
    if (field.ref === 'researches') return role === 'owner' || role === 'admin';
    return canEditRow(role, uid, table, row);
  }
  return canEditRow(role, uid, table, row);
}

function canDelete(role, table) {
  if (role === 'owner') return true;
  if (role === 'admin') return ADMIN_LISTS.includes(table) || table === 'topics' || table === 'tags';
  return false;
}

// Sections for the record window (fields not listed go to the last section)
const FORM_LAYOUT = {
  // '@ext' marks where the conditional sections (center publication, submission, bibliographic, original) go
  researches: [
    ['المعلومات الأساسية', ['title', 'year', 'research_type_id', 'language_id']],
    ['الأشخاص', ['researchers', 'translators']],
    ['@ext', []],
    ['التصنيف والناشرون', ['topics', 'publishers', 'tags']],
    ['الرابط والمحتوى', ['url', 'summary', 'notes']],
  ],
  persons: [
    ['البيانات', ['name', 'nationality_id', 'roles']],
    ['إنتاجه في مجلاتنا', ['production']],
    ['كل أعماله', ['related_journals', 'as_researcher', 'as_translator']],
    ['التواصل والملاحظات', ['contacts', 'notes']],
  ],
  publishers: [
    ['البيانات', ['name', 'country_id', 'description']],
    ['الأبحاث', ['related_journals', 'researches']],
    ['التواصل والملاحظات', ['contacts', 'notes']],
  ],
};
const FULL_WIDTH = new Set(['production', 'related_journals', 'title', 'name', 'summary', 'notes', 'description', 'contacts', 'as_researcher', 'as_translator', 'researches']);

// Journal chip colours, taken from each journal's cover and issue badge on tajdid-c.com
const JOURNAL_COLORS = {
  'قرآنيات': 'olive', // #AFA518 (gold/olive cover)
  'أخلاق': 'blue', // #11359B (royal-blue cover)
  'سميراميس': 'maroon', // #7C0E2F (maroon cover)
};

// Tables hidden from the sidebar per role (still usable inside record forms and filters)
const HIDDEN_TABLES = {
  data_entry: ['journals', 'countries', 'languages', 'research_types', 'contact_types', 'person_roles'],
  editor: ['journals', 'topics', 'tags', 'countries', 'languages', 'research_types', 'contact_types', 'person_roles'],
};
const isTableVisible = (role, table) => !(HIDDEN_TABLES[role] || []).includes(table);

// Fields a role may see (record info is for owner & admin only)
const fieldsFor = (role, table) => TABLES[table].fields.filter((f) => (!f.staffOnly || role === 'owner' || role === 'admin')
  && (!f.subOnly || seesSubmissions(role)));










// ============ state ============
const S = {
  data: {},          // table -> rows
  byId: {},          // table -> Map(id -> row)
  me: null,          // profile row
  view: 'researches',
  ui: {},            // per-table: { search, sort:{key,dir}, filters:[], hidden:Set }
};
const app = document.getElementById('app');

// ============ helpers ============
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, kind = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message || String(e), 'err'); throw e; }
}

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function displayOf(table, id) {
  const row = S.byId[table]?.get(Number(id)) ?? S.byId[table]?.get(id);
  if (!row) return '—';
  return row[TABLES[table]?.display || 'name'] ?? `#${id}`;
}
// Short context shown next to a linked record (e.g. a person's nationality and roles)
function subtitleOf(table, id) {
  const r = S.byId[table]?.get(id);
  if (!r) return '';
  const parts = [];
  if (table === 'persons') {
    if (r.nationality_id) parts.push(displayOf('countries', r.nationality_id));
    const roles = (S.data.person_role_assignments || []).filter((a) => a.person_id === id).map((a) => displayOf('person_roles', a.role_id));
    if (roles.length) parts.push(roles.join('، '));
  } else if (table === 'publishers') {
    if (r.country_id) parts.push(displayOf('countries', r.country_id));
  } else if (table === 'researches') {
    if (r.year) parts.push(r.year);
    const pub = (S.data.research_publishers || []).find((l) => l.research_id === id);
    if (pub) parts.push(displayOf('publishers', pub.publisher_id));
  } else if (table === 'journals') {
    const n = (S.data.researches || []).filter((x) => researchJournal(x) === id).length;
    if (n) parts.push(`${n} بحث`);
  }
  return parts.join(' · ');
}
function chipClass(ref, id) {
  if (ref !== 'journals') return `chip ${ref}`;
  const name = norm(displayOf('journals', id));
  const key = Object.keys(JOURNAL_COLORS).find((k) => norm(k) === name);
  return `chip journals${key ? ` jc-${JOURNAL_COLORS[key]}` : ''}`;
}
function avatarEl(p, size = 32) {
  const name = (p?.full_name || p?.email || '?').trim();
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return p?.avatar_url
    ? h('img', { class: 'avatar', src: p.avatar_url, alt: '', style: `width:${size}px;height:${size}px` })
    : h('span', { class: 'avatar initials', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px` }, initials);
}
function userName(id) {
  if (!id) return 'NocoDB / قبل الواجهة';
  const p = S.byId.profiles?.get(id);
  return p ? (p.full_name || p.email) : 'مستخدم';
}
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('ar-LB', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function index(table) {
  if (table === 'issues') for (const r of S.data.issues || []) r.label = issueLabel(r);
  S.byId[table] = new Map((S.data[table] || []).map((r) => [r.id, r]));
}
function issueLabel(i) {
  return `${displayOf('journals', i.journal_id)} · العدد ${i.number}${issueWhen(i) ? ` (${issueWhen(i)})` : ''}`;
}
// ---- research publication helpers (read the 1:1 extension objects: pub, bib, trans, sub) ----
// Value of a field on a row — extension fields live in row[f.ext][f.col]
function valueOf(row, f) {
  if (f.ext) return row?.[f.ext]?.[f.col] ?? null;
  return row?.[f.key] ?? null;
}
const enumLabel = (f, v) => (v == null ? '' : (ENUMS[f.options]?.[v] ?? v));
const isArticle = (r) => r?.pub?.kind === 'article';
const isBook = (r) => !!r?.pub && r.pub.kind !== 'article';
// The journal an article is published in (through its issue). Books belong to no journal.
function researchJournal(r) {
  if (!isArticle(r)) return null;
  return S.byId.issues?.get(r.pub.issue_id)?.journal_id ?? null;
}
const pagesText = (p) => (p?.start_page ? `${p.start_page}${p.end_page ? `–${p.end_page}` : ''}` : '');
function publicationText(r) {
  if (isBook(r)) return `${CENTER_LIBRARY} · ${PUB_KINDS[r.pub.kind]}`;
  const j = researchJournal(r);
  if (!j) return '';
  const i = S.byId.issues?.get(r.pub.issue_id);
  const pages = pagesText(r.pub);
  return `${displayOf('journals', j)} · العدد ${i?.number ?? ''}${pages ? ` · ص ${pages}` : ''}`;
}
// external | wip (with stage) | rejected | published (journal & issue, or book kind)
function researchStatus(r) {
  if (r?.pub) return { kind: 'published', text: `منشور · ${publicationText(r)}`, journal: researchJournal(r) };
  if (r?.sub?.stage === 'rejected') return { kind: 'rejected', text: `مرفوض · ${displayOf('journals', r.sub.journal_id)}` };
  if (r?.sub) return { kind: 'wip', text: `قيد العمل · ${STAGES[r.sub.stage] ?? r.sub.stage}`, journal: r.sub.journal_id };
  return { kind: 'external', text: 'خارجي' };
}
// Computed (read-only) research columns
function computedText(row, f) {
  if (f.key === 'status') return researchStatus(row).text;
  if (f.key === 'pub_journal') return isBook(row) ? CENTER_LIBRARY : (researchJournal(row) ? displayOf('journals', researchJournal(row)) : '');
  if (f.key === 'pub_pages') return pagesText(row.pub);
  return '';
}
function computedCell(row, f) {
  if (f.key === 'status') {
    const st = researchStatus(row);
    if (st.kind === 'published' && st.journal) {
      return [h('span', { class: chipClass('journals', st.journal) }, displayOf('journals', st.journal)), h('small', { class: 'pub-rest' }, publicationText(row).split(' · ').slice(1).join(' · '))];
    }
    if (st.kind === 'published') return [h('span', { class: 'chip center' }, CENTER_LIBRARY), h('small', { class: 'pub-rest' }, PUB_KINDS[row.pub.kind])];
    if (st.kind === 'wip') return [h('span', { class: 'chip st-wip' }, STAGES[row.sub.stage]), h('small', { class: 'pub-rest' }, displayOf('journals', row.sub.journal_id))];
    if (st.kind === 'rejected') return [h('span', { class: 'chip st-rejected' }, 'مرفوض'), h('small', { class: 'pub-rest' }, displayOf('journals', row.sub.journal_id))];
    return h('span', { class: 'chip st-external' }, 'خارجي');
  }
  if (f.key === 'pub_journal') {
    if (isBook(row)) return h('span', { class: 'chip center' }, CENTER_LIBRARY);
    const j = researchJournal(row);
    return j ? h('span', { class: chipClass('journals', j) }, displayOf('journals', j)) : '';
  }
  return computedText(row, f);
}

function linkedIds(field, rowId) {
  return (S.data[field.via] || []).filter((l) => l[field.self] === rowId).map((l) => l[field.other]);
}
function contactsOf(field, rowId) {
  return (S.data[field.table] || []).filter((c) => c[field.self] === rowId);
}

// Journals a person/publisher is related to through their researches → Map(journalId → number of researches)
function derivedCounts(f, rowId) {
  const m = new Map();
  if (f.compute === 'journal_researches') {
    for (const r of S.data.researches || []) if (researchJournal(r) === rowId) m.set(r.id, 1);
    return m;
  }
  // journals_via_researches: the journals where this person's / publisher's researches were actually published
  const rids = new Set();
  for (const src of f.sources) for (const l of S.data[src.via] || []) if (l[src.self] === rowId) rids.add(l.research_id);
  for (const rid of rids) {
    const j = researchJournal(S.byId.researches?.get(rid));
    if (j) m.set(j, (m.get(j) || 0) + 1);
  }
  return new Map([...m].sort((a, b) => b[1] - a[1]));
}
const derivedIds = (f, rowId) => [...derivedCounts(f, rowId).keys()];

// A person's work in our publications: articles grouped by journal → issue, books under «إصدارات المركز»
function productionOf(personId) {
  const roles = new Map();
  for (const [via, label] of [['research_researchers', 'باحث'], ['research_translators', 'مترجم']]) {
    for (const l of S.data[via] || []) if (l.person_id === personId) roles.set(l.research_id, [...(roles.get(l.research_id) || []), label]);
  }
  const journals = new Map(); const center = { journal: null, issues: new Map(), books: [] };
  for (const [rid, rs] of roles) {
    const r = S.byId.researches?.get(rid);
    if (isBook(r)) { center.books.push({ r, roles: rs }); continue; }
    const j = researchJournal(r);
    if (!j) continue;
    const g = journals.get(j) || { journal: j, issues: new Map(), books: [] };
    const list = g.issues.get(r.pub.issue_id) || [];
    list.push({ r, roles: rs }); g.issues.set(r.pub.issue_id, list);
    journals.set(j, g);
  }
  const out = [...journals.values()].sort((a, b) => displayOf('journals', a.journal).localeCompare(displayOf('journals', b.journal), 'ar'));
  if (center.books.length) out.push(center);
  return out;
}
const groupLabel = (g) => (g.journal ? displayOf('journals', g.journal) : CENTER_LIBRARY);
const groupChip = (g) => (g.journal ? chipClass('journals', g.journal) : 'chip center');
function productionView(personId) {
  const groups = productionOf(personId);
  if (!groups.length) return h('span', { class: 'muted' }, 'لا أعمال منشورة له في مجلاتنا وإصدارات المركز بعد.');
  const item = ({ r, roles }) => h('li', {},
    h('button', { class: 'link-btn', type: 'button', onclick: () => openRecord('researches', r) }, r.title),
    h('small', { class: 'muted' }, [roles.join(' و'), isArticle(r) && pagesText(r.pub) ? `ص ${pagesText(r.pub)}` : null, isBook(r) ? PUB_KINDS[r.pub.kind] : null, isBook(r) && r.year ? r.year : null].filter(Boolean).join(' · ')));
  return h('div', { class: 'production' }, groups.map((g) => {
    const issues = [...g.issues].map(([iid, list]) => [S.byId.issues.get(iid), list]).sort((a, b) => (b[0]?.number || 0) - (a[0]?.number || 0));
    const total = issues.reduce((n, [, l]) => n + l.length, 0) + g.books.length;
    return h('section', { class: 'prod-journal' },
      h('h5', {}, h('span', { class: groupChip(g) }, groupLabel(g)), h('small', { class: 'muted' }, `${total} عمل`)),
      issues.map(([iss, list]) => h('div', { class: 'prod-issue' },
        h('div', { class: 'prod-issue-h' }, `العدد ${iss?.number ?? ''}${iss?.year ? ` (${iss.year})` : ''}${iss?.title ? ` · ${iss.title}` : ''}`),
        h('ul', {}, list.sort((a, b) => (a.r.pub.issue_order ?? 1e9) - (b.r.pub.issue_order ?? 1e9)).map(item)))),
      g.books.length ? h('div', { class: 'prod-issue' }, h('div', { class: 'prod-issue-h' }, 'الكتب'), h('ul', {}, g.books.map(item))) : null);
  }));
}

// value used for search / sort / filter
function plainValue(table, row, f) {
  switch (f.type) {
    case 'fk': return valueOf(row, f) ? displayOf(f.ref, valueOf(row, f)) : '';
    case 'enum': return enumLabel(f, valueOf(row, f));
    case 'computed': return computedText(row, f);
    case 'date': return valueOf(row, f) ?? '';
    case 'link': return linkedIds(f, row.id).map((id) => displayOf(f.ref, id)).join('، ');
    case 'derived': return derivedIds(f, row.id).map((id) => displayOf(f.ref, id)).join('، ');
    case 'publication': return publicationText(row);
    case 'production': return productionOf(row.id).map(groupLabel).join('، ');
    case 'contacts': return contactsOf(f, row.id).map((c) => c.value).join(' ');
    case 'user': return f.key === 'created_by' && !row[f.key] ? '' : userName(row[f.key]);
    default: return valueOf(row, f) ?? '';
  }
}

// ============ data loading ============
const SELECT_ORDER = { profiles: 'created_at', journal_editors: null, person_role_assignments: null };
const LINK_TABLES = new Set(['research_researchers', 'research_translators',
  'research_publishers', 'research_topics', 'research_tags', 'person_role_assignments', 'journal_editors']);

async function loadTable(t) {
  const order = t in SELECT_ORDER ? SELECT_ORDER[t] : (LINK_TABLES.has(t) ? null : 'id');
  S.data[t] = await api.selectAll(t, order, TABLES[t]?.select || '*');
  index(t);
}
// Re-read one research with its extension rows (after saving)
async function reloadResearch(id) {
  const [fresh] = await api.select('researches', `id=eq.${id}`, TABLES.researches.select);
  const list = S.data.researches;
  const i = list.findIndex((r) => r.id === id);
  if (fresh) { if (i >= 0) list[i] = fresh; else list.push(fresh); } else if (i >= 0) list.splice(i, 1);
  index('researches');
  return fresh;
}
async function loadAll() {
  await Promise.all([...Object.keys(TABLES), ...AUX_TABLES].map(loadTable));
  index('issues');
  if (S.me) setManagedJournals((S.data.journal_editors || []).filter((j) => j.user_id === S.me.id).map((j) => j.journal_id));
}

// ============ theme ============
const THEMES = [['light', 'أبيض', 'sun'], ['dark', 'كحلي', 'moon'], ['auto', 'تلقائي', 'monitor']];
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function currentTheme() { return lsGet('tajdid_theme', 'light'); }
function applyTheme(mode = currentTheme()) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle('is-dark', mode === 'dark' || (mode === 'auto' && !!darkQuery?.matches));
}
darkQuery?.addEventListener?.('change', () => applyTheme());
function themeSwitch() {
  const mode = currentTheme();
  return h('div', { class: 'theme-switch', role: 'group', 'aria-label': 'مظهر الواجهة' },
    THEMES.map(([k, label, ic]) => h('button', {
      class: k === mode ? 'on' : '', title: k === 'auto' ? 'حسب إعدادات الجهاز' : `مظهر ${label}`,
      onclick: () => { lsSet('tajdid_theme', k); applyTheme(k); renderShell(); },
    }, icon(ic, 14), label)));
}

// ============ boot ============
async function boot() {
  applyTheme();
  let urlType = null;
  try { urlType = await api.consumeUrlSession(); } catch (e) { toast(e.message, 'err'); }
  if (urlType === 'recovery') return renderSetPassword();
  if (!api.getSession()) return renderLogin();
  try {
    await loadTable('profiles');
    S.me = S.byId.profiles.get(api.getSession().user.id);
    if (!S.me || !S.me.active) return renderPending();
    app.replaceChildren(h('div', { class: 'loading' }, 'جارٍ تحميل البيانات…'));
    await loadAll();
    S.me = S.byId.profiles.get(S.me.id);
    S.view = lsGet('tajdid_view', 'researches');
    if ((!TABLES[S.view] && !['stats', 'users', 'profile', 'journal', 'trash'].includes(S.view)) || (S.view === 'trash' && S.me.role !== 'owner') || (TABLES[S.view] && !isTableVisible(S.me.role, S.view))) S.view = 'researches';
    renderShell();
  } catch (e) {
    toast(e.message, 'err');
    await api.signOut();
    renderLogin();
  }
}

// ============ auth screens ============
function authCard(...content) {
  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'brand big' },
        h('img', { class: 'logo-img', src: 'assets/logo.png', alt: 'شعار مركز تجديد' }),
        h('img', { class: 'callig on-light', src: 'assets/calligraphy-dark.png', alt: 'مركز تجديد للفكر والثقافة' }),
        h('img', { class: 'callig on-dark', src: 'assets/calligraphy-light.png', alt: '' }),
        h('small', {}, 'قاعدة بيانات الأبحاث')),
      ...content));
}

function renderLogin(mode = 'login') {
  const err = h('div', { class: 'form-err' });
  const email = h('input', { type: 'email', placeholder: 'البريد الإلكتروني', dir: 'ltr', required: true, autocomplete: 'email' });
  const pass = h('input', { type: 'password', placeholder: 'كلمة السر', dir: 'ltr', required: true, autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const name = h('input', { type: 'text', placeholder: 'الاسم الكامل', required: true });
  const btn = h('button', { class: 'btn primary wide', type: 'submit' },
    { login: 'دخول', signup: 'طلب حساب', forgot: 'إرسال رابط إعادة التعيين' }[mode]);

  const form = h('form', {
    class: 'auth-form',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = ''; btn.disabled = true;
      try {
        if (mode === 'login') {
          await api.signIn(email.value.trim(), pass.value);
          await boot();
        } else if (mode === 'signup') {
          await api.signUp(email.value.trim(), pass.value, name.value.trim());
          app.replaceChildren(authCard(h('p', { class: 'note' },
            'تم إرسال طلبك بنجاح', h('br'), 'سيقوم مالك القاعدة بتفعيل حسابك وتحديد صلاحياتك، وبعدها يمكنك الدخول.'),
            h('button', { class: 'btn wide', onclick: () => renderLogin() }, 'العودة لتسجيل الدخول')));
        } else {
          await api.recoverPassword(email.value.trim());
          err.className = 'form-ok';
          err.textContent = 'إذا كان البريد مسجّلاً، ستصلك رسالة فيها رابط لتعيين كلمة سر جديدة.';
        }
      } catch (ex) { err.className = 'form-err'; err.textContent = ex.message; }
      btn.disabled = false;
    },
  },
  mode === 'signup' ? name : null, email, mode !== 'forgot' ? pass : null, err, btn);

  const links = h('div', { class: 'auth-links' },
    mode !== 'login' ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderLogin('login'); } }, 'تسجيل الدخول') : null,
    mode !== 'signup' ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderLogin('signup'); } }, 'طلب حساب جديد') : null,
    mode !== 'forgot' ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderLogin('forgot'); } }, 'نسيت كلمة السر؟') : null);
  app.replaceChildren(authCard(form, links));
  (mode === 'signup' ? name : email).focus();
}

function renderSetPassword() {
  const err = h('div', { class: 'form-err' });
  const pass = h('input', { type: 'password', placeholder: 'كلمة السر الجديدة', dir: 'ltr', required: true, minlength: 6 });
  app.replaceChildren(authCard(h('form', {
    class: 'auth-form',
    onsubmit: async (e) => {
      e.preventDefault();
      try { await api.updatePassword(pass.value); toast('تم تغيير كلمة السر'); boot(); } catch (ex) { err.textContent = ex.message; }
    },
  }, h('p', { class: 'note' }, 'اختر كلمة سر جديدة'), pass, err, h('button', { class: 'btn primary wide' }, 'حفظ'))));
}

function renderPending() {
  app.replaceChildren(authCard(
    h('p', { class: 'note' }, 'حسابك بانتظار التفعيل', h('br'), 'سيقوم مالك القاعدة بتفعيل حسابك وتحديد صلاحياتك. حاول مرة أخرى لاحقاً.'),
    h('button', { class: 'btn wide', onclick: () => boot() }, 'إعادة المحاولة'),
    h('button', { class: 'btn ghost wide', onclick: async () => { await api.signOut(); renderLogin(); } }, 'تسجيل الخروج')));
}

// ============ shell ============
function navItem(key, icon_, label, count) {
  return h('button', {
    class: `nav-item ${S.view === key ? 'active' : ''}`,
    onclick: () => { S.view = key; lsSet('tajdid_view', key); renderShell(); closeSidebar(); },
  }, h('span', { class: 'ico' }, typeof icon_ === 'string' ? icon(icon_) : icon_), h('span', { class: 'lbl' }, label), count != null ? h('span', { class: 'cnt' }, count) : null);
}
function closeSidebar() { document.body.classList.remove('nav-open'); }

function renderShell() {
  const role = S.me.role;
  const groups = { main: [], lists: [] };
  for (const [k, t] of Object.entries(TABLES)) if (groups[t.group] && isTableVisible(role, k)) groups[t.group].push(navItem(k, t.icon, t.label, S.data[k]?.length));
  const pendingUsers = (S.data.profiles || []).filter((p) => !p.active).length;

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('img', { class: 'logo-img', src: 'assets/logo-white.png', alt: 'شعار مركز تجديد' }),
      h('div', {}, h('img', { class: 'callig', src: 'assets/calligraphy-light.png', alt: 'مركز تجديد للفكر والثقافة' }), h('small', {}, 'قاعدة بيانات الأبحاث'))),
    h('nav', {},
      h('div', { class: 'nav-title' }, 'الجداول'), groups.main,
      journalNavVisible() ? [h('div', { class: 'nav-title' }, 'مجلتي'), navItem('journal', 'journal', S.me.role === 'editor' ? 'مجلتي' : 'المجلات والأعداد')] : null,
      ['owner', 'admin', 'editor'].includes(role) ? [h('div', { class: 'nav-title' }, 'المتابعة'), navItem('stats', 'chart', 'الإحصائيات')] : null,
      h('div', { class: 'nav-title' }, 'القوائم'), groups.lists,
      role === 'owner' ? [h('div', { class: 'nav-title' }, 'الإدارة'), navItem('users', 'users', 'المستخدمون', pendingUsers ? `${pendingUsers} جديد` : null), navItem('trash', 'trash', 'السلة')] : null),
    themeSwitch(),
    h('div', { class: 'me' },
      h('button', {
        class: `me-link ${S.view === 'profile' ? 'active' : ''}`, title: 'حسابي',
        onclick: () => { S.view = 'profile'; lsSet('tajdid_view', 'profile'); renderShell(); closeSidebar(); },
      }, avatarEl(S.me, 34), h('div', {}, h('b', {}, S.me.full_name || S.me.email), h('small', {}, ROLE_LABELS[role]))),
      h('button', { class: 'btn ghost sm icon-btn', title: 'تسجيل الخروج', 'aria-label': 'تسجيل الخروج', onclick: async () => { await api.signOut(); renderLogin(); } }, icon('logout', 18))));

  const main = h('main', { class: 'main' });
  app.replaceChildren(h('div', { class: 'shell' },
    h('button', { class: 'nav-toggle', onclick: () => document.body.classList.toggle('nav-open'), 'aria-label': 'القائمة' }, icon('menu', 20)),
    h('div', { class: 'backdrop', onclick: closeSidebar }),
    sidebar, main));

  if (S.view === 'profile') renderProfile(main);
  else if (S.view === 'journal') renderJournal(main);
  else if (S.view === 'stats') renderStats(main);
  else if (S.view === 'users') renderUsers(main);
  else if (S.view === 'trash') renderTrash(main);
  else renderGrid(main, S.view);
}

// ============ grid ============
// Ready-made views (researches only). Each view has its own columns and saved show/hide choices.
const VIEW_FILTERS = {
  all: () => true,
  center: (r) => !!r.pub,
  wip: (r) => !!r.sub && !r.pub && r.sub.stage !== 'rejected',
  rejected: (r) => r.sub?.stage === 'rejected',
  external: (r) => !r.pub && !r.sub,
};
function viewsFor(table) {
  if (table !== 'researches') return [];
  return RESEARCH_VIEWS.filter((v) => !v.subOnly || seesSubmissions(S.me.role));
}
function currentView(table) {
  const views = viewsFor(table);
  if (!views.length) return null;
  const ui = uiFor(table);
  return views.find((v) => v.key === ui.view) || views[0];
}
const hiddenKey = (table, view) => `tajdid_hidden_v3_${table}${view ? `_${view.key}` : ''}`;
// The hidden-field set of the current view (manual show/hide is kept per view)
function hiddenSet(table) {
  const ui = uiFor(table);
  const view = currentView(table);
  const k = view?.key || '_';
  if (!ui.hidden[k]) {
    const all = fieldsFor(S.me.role, table);
    const saved = lsGet(hiddenKey(table, view), null);
    const defaults = view ? all.filter((f) => !view.cols.includes(f.key)).map((f) => f.key) : all.filter((f) => f.hidden).map((f) => f.key);
    ui.hidden[k] = new Set(saved ?? defaults);
  }
  return ui.hidden[k];
}
function saveHidden(table) { lsSet(hiddenKey(table, currentView(table)), [...hiddenSet(table)]); }
function defaultHidden(table) {
  const view = currentView(table); const all = fieldsFor(S.me.role, table);
  return view ? all.filter((f) => !view.cols.includes(f.key)).map((f) => f.key) : all.filter((f) => f.hidden).map((f) => f.key);
}
// Visible fields, in the view's column order first
function gridFields(table) {
  const hidden = hiddenSet(table);
  const view = currentView(table);
  const list = fieldsFor(S.me.role, table).filter((f) => !hidden.has(f.key));
  if (!view) return list;
  const pos = (f) => { const i = view.cols.indexOf(f.key); return i < 0 ? 1e3 : i; };
  return list.map((f, i) => [f, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).map(([f]) => f);
}

function uiFor(table) {
  if (!S.ui[table]) {
    S.ui[table] = {
      search: '', sort: null, filters: [], hidden: {},
      view: table === 'researches' ? lsGet('tajdid_research_view', 'all') : null,
    };
  }
  return S.ui[table];
}

function visibleRows(table, viewKey) {
  const ui = uiFor(table);
  const fields = fieldsFor(S.me.role, table);
  let rows = [...(S.data[table] || [])];
  const view = viewKey !== undefined ? viewsFor(table).find((v) => v.key === viewKey) : currentView(table);
  if (view) rows = rows.filter(VIEW_FILTERS[view.key] || (() => true));
  const q = ui.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => fields.some((f) => String(plainValue(table, r, f)).toLowerCase().includes(q)));
  for (const flt of ui.filters) {
    const f = fields.find((x) => x.key === flt.key);
    if (!f || flt.value === '' || flt.value == null) continue;
    if (f.type === 'fk' || f.type === 'enum') rows = rows.filter((r) => (flt.value === '__none' ? valueOf(r, f) == null : String(valueOf(r, f) ?? '') === String(flt.value)));
    else if (f.type === 'publication') {
      rows = rows.filter((r) => {
        if (flt.value === '__none') return !r.pub;
        if (flt.value === '__center') return isBook(r);
        return String(researchJournal(r)) === String(flt.value);
      });
    } else if (f.type === 'derived') rows = rows.filter((r) => flt.value === '__none' ? !derivedIds(f, r.id).length : derivedIds(f, r.id).map(String).includes(String(flt.value)));
    else if (f.type === 'link') rows = rows.filter((r) => flt.value === '__none' ? !linkedIds(f, r.id).length : linkedIds(f, r.id).map(String).includes(String(flt.value)));
    else if (f.type === 'user') rows = rows.filter((r) => String(r[f.key] ?? '') === String(flt.value === '__none' ? '' : flt.value));
    else if (flt.value === '__empty') rows = rows.filter((r) => !String(plainValue(table, r, f)).trim());
    else rows = rows.filter((r) => String(plainValue(table, r, f)).toLowerCase().includes(String(flt.value).toLowerCase()));
  }
  if (ui.sort) {
    const f = fields.find((x) => x.key === ui.sort.key);
    const dir = ui.sort.dir;
    if (f) {
      rows.sort((a, b) => {
        const va = plainValue(table, a, f); const vb = plainValue(table, b, f);
        if (va === '' && vb !== '') return 1;
        if (vb === '' && va !== '') return -1;
        const c = (f.type === 'number') ? (Number(va) - Number(vb)) : String(va).localeCompare(String(vb), 'ar');
        return c * dir;
      });
    }
  }
  return rows;
}

function fkOptions(ref) {
  let rows = [...(S.data[ref] || [])];
  if (ref === 'issues') {
    rows.sort((a, b) => displayOf('journals', a.journal_id).localeCompare(displayOf('journals', b.journal_id), 'ar') || b.number - a.number);
  }
  if (ref === 'journals' && S.me.role === 'editor') {
    const mine = new Set((S.data.journal_editors || []).filter((j) => j.user_id === S.me.id).map((j) => j.journal_id));
    rows = rows.filter((j) => mine.has(j.id));
  }
  return rows;
}

function renderCell(table, row, f) {
  const v = valueOf(row, f);
  switch (f.type) {
    case 'fk': return v ? h('span', { class: f.ref === 'journals' ? chipClass('journals', v) : 'chip' }, displayOf(f.ref, v)) : '';
    case 'enum': return v ? h('span', { class: `chip enum ${f.options === 'STAGES' ? `st-${v === 'rejected' ? 'rejected' : (v === 'published' ? 'published' : 'wip')}` : ''}` }, enumLabel(f, v)) : '';
    case 'computed': return computedCell(row, f);
    case 'production': return productionOf(row.id).map((g) => h('span', { class: groupChip(g) }, groupLabel(g),
      h('small', { class: 'chip-count' }, [...g.issues.values()].reduce((n, l) => n + l.length, 0) + g.books.length)));
    case 'publication': {
      if (isBook(row)) return [h('span', { class: 'chip center' }, CENTER_LIBRARY), h('small', { class: 'pub-rest' }, PUB_KINDS[row.pub.kind])];
      const j = researchJournal(row);
      if (!j) return '';
      return [h('span', { class: chipClass('journals', j) }, displayOf('journals', j)), h('small', { class: 'pub-rest' }, publicationText(row).split(' · ').slice(1).join(' · '))];
    }
    case 'link': return linkedIds(f, row.id).map((id) => h('span', { class: chipClass(f.ref, id) }, displayOf(f.ref, id)));
    case 'derived': return [...derivedCounts(f, row.id)].map(([id, n]) => h('span', { class: chipClass(f.ref, id), title: `${n} بحث` }, displayOf(f.ref, id), f.compute === 'journal_researches' ? null : h('small', { class: 'chip-count' }, n)));
    case 'contacts': return contactsOf(f, row.id).map((c) => h('span', { class: 'chip soft', dir: 'auto' }, `${displayOf('contact_types', c.contact_type_id)}: ${c.value}`));
    case 'url': return v ? h('a', { href: v, target: '_blank', rel: 'noopener', dir: 'ltr', onclick: (e) => e.stopPropagation() }, v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)) : '';
    case 'user': return f.key === 'updated_by' && !v ? '' : userName(v);
    case 'date': return fmtDate(v);
    case 'number': return v ?? '';
    default: return v ?? '';
  }
}

function renderGrid(main, table) {
  const T = TABLES[table];
  const ui = uiFor(table);
  const role = S.me.role; const uid = S.me.id;
  const fields = gridFields(table);
  const views = viewsFor(table);
  const view = currentView(table);

  // toolbar
  const search = h('input', {
    type: 'search', placeholder: 'بحث…', value: ui.search,
    oninput: (e) => { ui.search = e.target.value; drawBody(); },
  });
  const searchBox = h('label', { class: 'search' }, icon('search', 16), search);
  const toolbar = h('div', { class: 'toolbar' },
    h('h1', {}, icon(T.icon, 22), T.label),
    searchBox,
    filterButton(table, () => renderShell()),
    fieldsButton(table, () => renderShell()),
    h('button', { class: 'btn icon-btn', title: 'اختصارات لوحة المفاتيح (?)', 'aria-label': 'اختصارات لوحة المفاتيح', onclick: showShortcuts }, icon('keyboard', 18)),
    canInsert(role, table) ? h('button', { class: 'btn primary', onclick: () => openRecord(table, null) }, icon('plus', 16), `${T.single || 'سجل'} جديد`) : null);

  const filtersBar = ui.filters.length ? h('div', { class: 'filters-bar' }, ui.filters.map((flt, i) => filterRow(table, flt, i))) : null;
  const viewsBar = views.length ? h('nav', { class: 'views-bar', role: 'tablist', 'aria-label': 'العروض' }, views.map((v) => h('button', {
    class: `view-tab ${v.key === view.key ? 'on' : ''}`, role: 'tab', 'aria-selected': String(v.key === view.key),
    onclick: () => { ui.view = v.key; lsSet('tajdid_research_view', v.key); ui.sort = null; renderShell(); },
  }, v.label, h('small', { class: 'cnt' }, visibleRows(table, v.key).length)))) : null;

  // table
  const head = h('tr', {},
    h('th', { class: 'rownum' }, '#'),
    fields.map((f) => h('th', {
      style: `width:${f.width || 150}px;min-width:${f.width || 150}px`,
      class: ui.sort?.key === f.key ? 'sorted' : '',
      title: 'اضغط للترتيب',
      onclick: () => {
        if (ui.sort?.key !== f.key) ui.sort = { key: f.key, dir: 1 };
        else if (ui.sort.dir === 1) ui.sort.dir = -1;
        else ui.sort = null;
        renderShell();
      },
    }, f.label, ui.sort?.key === f.key ? (ui.sort.dir === 1 ? ' ▲' : ' ▼') : '')));
  const tbody = h('tbody');
  const count = h('div', { class: 'footer' });

  function drawBody() {
    const list = visibleRows(table);
    tbody.replaceChildren(...list.map((row, i) => {
      const editable = canEditRow(role, uid, table, row);
      return h('tr', { class: editable ? '' : 'ro' },
        h('td', { class: 'rownum' },
          h('span', { class: 'n' }, i + 1),
          h('button', { class: 'expand', title: 'فتح السجل', 'aria-label': 'فتح السجل', onclick: () => openRecord(table, row) }, icon('expand', 14))),
        fields.map((f) => h('td', {
          class: `t-${f.type}${f.ltr ? ' ltr' : ''}`,
          ondblclick: (e) => startEdit(e.currentTarget, table, row, f),
        }, h('div', { class: 'cell' }, renderCell(table, row, f)))));
    }));
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: fields.length + 1, class: 'empty' }, 'لا توجد سجلات')));
    if (canInsert(role, table)) {
      tbody.append(h('tr', {
        class: 'add-row', tabindex: '0', role: 'button', title: `إضافة ${T.single || 'سجل'} (N)`,
        onclick: () => openRecord(table, null),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecord(table, null); } },
      },
        h('td', { class: 'rownum' }, icon('plus', 16)),
        h('td', { colspan: fields.length }, h('span', { class: 'add-row-label' }, `إضافة ${T.single || 'سجل'}`, h('kbd', {}, 'N')))));
    }
    count.textContent = `${list.length} من ${S.data[table].length} سجل${view ? ` · عرض «${view.label}»` : ''}`;
  }
  drawBody();

  main.replaceChildren(toolbar, viewsBar || '', filtersBar || '',
    h('div', { class: 'grid-wrap' }, h('table', { class: 'grid' }, h('thead', {}, head), tbody)),
    count);
  if (ui.search) { search.focus(); search.setSelectionRange(ui.search.length, ui.search.length); }
}

// ---- inline edit ----
function startEdit(td, table, row, f) {
  const role = S.me.role;
  if (!canEditField(role, S.me.id, table, row, f)) {
    if (!f.readonly) toast('ليس لديك صلاحية لتعديل هذا الحقل', 'warn');
    return;
  }
  // extension fields (publication, submission, bibliographic, original) are edited in the record window
  if (['link', 'longtext', 'contacts'].includes(f.type) || f.ext) return openRecord(table, row, f.key);
  if (td.querySelector('input,select')) return;
  let input;
  if (f.type === 'fk') {
    input = h('select', {}, h('option', { value: '' }, '—'),
      fkOptions(f.ref).map((o) => h('option', { value: o.id, selected: String(o.id) === String(row[f.key]) }, o[TABLES[f.ref].display])));
  } else if (f.type === 'enum') {
    input = h('select', {}, h('option', { value: '' }, '—'),
      Object.entries(ENUMS[f.options]).map(([k, label]) => h('option', { value: k, selected: k === row[f.key] }, label)));
  } else {
    input = h('input', { type: f.type === 'number' ? 'number' : 'text', value: row[f.key] ?? '', dir: f.ltr || f.type === 'url' ? 'ltr' : 'auto' });
  }
  const cell = td.firstChild;
  cell.replaceChildren(input);
  td.classList.add('editing');
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    td.classList.remove('editing');
    if (save) {
      let val = input.value;
      if (f.type === 'number' || f.type === 'fk') val = val === '' ? null : Number(val);
      else if (f.type === 'enum') val = val || null;
      else val = val.trim() === '' ? null : val.trim();
      if (f.required && val == null) { toast('هذا الحقل إلزامي', 'warn'); cell.replaceChildren(...[renderCell(table, row, f)].flat()); return; }
      if (val !== (row[f.key] ?? null)) {
        try {
          const updated = await guard(() => api.updateRows(table, { id: row.id }, { [f.key]: val }));
          Object.assign(row, updated);
          toast('تم الحفظ');
        } catch { /* toast shown */ }
      }
    }
    cell.replaceChildren(...[renderCell(table, row, f)].flat());
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  if (f.type === 'fk' || f.type === 'enum') input.addEventListener('change', () => finish(true));
}

// ---- filter & field menus ----
function popover(anchor, content) {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'popover', style: `top:${r.bottom + 6}px;right:${Math.max(8, innerWidth - r.right)}px` }, content);
  document.body.append(pop);
  setTimeout(() => {
    const close = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  });
  return pop;
}

function fieldsButton(table, rerender) {
  const hidden = hiddenSet(table);
  const n = hidden.size;
  const defaults = defaultHidden(table);
  const custom = n !== defaults.length || defaults.some((k) => !hidden.has(k));
  const view = currentView(table);
  return h('button', {
    class: `btn ${custom ? 'active' : ''}`,
    onclick: (e) => popover(e.currentTarget, h('div', { class: 'menu' },
      h('div', { class: 'menu-title' }, view ? `إظهار / إخفاء الحقول (عرض «${view.label}»)` : 'إظهار / إخفاء الحقول'),
      custom ? h('button', { class: 'btn ghost sm', onclick: () => { uiFor(table).hidden[view?.key || '_'] = new Set(defaults); saveHidden(table); rerender(); } }, 'رجوع لأعمدة العرض') : null,
      fieldsFor(S.me.role, table).map((f) => h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: !hidden.has(f.key),
          onchange: (ev) => {
            if (ev.target.checked) hidden.delete(f.key); else hidden.add(f.key);
            saveHidden(table);
            rerender();
          },
        }), f.label)))),
  }, icon('columns', 16), n ? `الحقول (${n} مخفي)` : 'الحقول');
}

function filterButton(table, rerender) {
  const ui = uiFor(table);
  return h('button', {
    class: `btn ${ui.filters.length ? 'active' : ''}`,
    onclick: () => { ui.filters.push({ key: TABLES[table].fields[0].key, value: '' }); rerender(); },
  }, icon('filter', 16), ui.filters.length ? `فلترة (${ui.filters.length})` : 'فلترة');
}

function filterRow(table, flt, i) {
  const ui = uiFor(table);
  const fields = fieldsFor(S.me.role, table).filter((f) => f.type !== 'date');
  const f = fields.find((x) => x.key === flt.key) || fields[0];
  let valueEl;
  if (f.type === 'fk' || f.type === 'link' || f.type === 'derived' || f.type === 'publication') {
    const ref = f.type === 'publication' ? 'journals' : f.ref;
    valueEl = h('select', { onchange: (e) => { flt.value = e.target.value; renderShell(); } },
      h('option', { value: '' }, 'اختر…'),
      f.type !== 'fk' || f.ext ? h('option', { value: '__none', selected: flt.value === '__none' }, '(فارغ)') : null,
      f.type === 'publication' ? h('option', { value: '__center', selected: flt.value === '__center' }, CENTER_LIBRARY) : null,
      fkOptions(f.ref === 'issues' ? 'issues' : ref).map((o) => h('option', { value: o.id, selected: String(o.id) === String(flt.value) }, o[TABLES[ref].display])));
  } else if (f.type === 'enum') {
    valueEl = h('select', { onchange: (e) => { flt.value = e.target.value; renderShell(); } },
      h('option', { value: '' }, 'اختر…'),
      h('option', { value: '__none', selected: flt.value === '__none' }, '(فارغ)'),
      Object.entries(ENUMS[f.options]).map(([k, label]) => h('option', { value: k, selected: k === flt.value }, label)));
  } else if (f.type === 'user') {
    valueEl = h('select', { onchange: (e) => { flt.value = e.target.value; renderShell(); } },
      h('option', { value: '' }, 'اختر…'),
      h('option', { value: '__none', selected: flt.value === '__none' }, 'NocoDB / قبل الواجهة'),
      S.data.profiles.map((p) => h('option', { value: p.id, selected: p.id === flt.value }, p.full_name || p.email)));
  } else {
    valueEl = h('input', {
      type: 'text', placeholder: 'يحتوي على… (أو اكتب __empty للفارغ)', value: flt.value,
      onchange: (e) => { flt.value = e.target.value; renderShell(); },
    });
  }
  return h('div', { class: 'filter-row' },
    h('span', {}, i === 0 ? 'حيث' : 'و'),
    h('select', { onchange: (e) => { flt.key = e.target.value; flt.value = ''; renderShell(); } },
      fields.map((x) => h('option', { value: x.key, selected: x.key === f.key }, x.label))),
    valueEl,
    h('button', { class: 'btn ghost sm icon-btn', title: 'إزالة', 'aria-label': 'إزالة', onclick: () => { ui.filters.splice(i, 1); renderShell(); } }, icon('x', 16)));
}

// ============ record modal ============
function openModal(title, body, footer, opts = {}) {
  const close = (force = false) => {
    if (force !== true && opts.beforeClose && !opts.beforeClose()) return;
    wrap.remove(); document.removeEventListener('keydown', esc);
  };
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.popover')) close(); };
  document.addEventListener('keydown', esc);
  const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn ghost sm icon-btn', 'aria-label': 'إغلاق', onclick: () => close() }, icon('x', 18))),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null));
  document.body.append(wrap);
  return close;
}

// Arabic-aware normalisation for matching names (ignores tashkeel, hamza forms, ة/ه, ى/ي)
function norm(v) {
  return String(v ?? '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

function linkPicker(field, selected, onChange, editable) {
  const box = h('div', { class: `link-box ${editable ? 'editable' : ''}` });
  const refT = TABLES[field.ref];
  const canCreate = field.ref !== 'researches' && canInsert(S.me.role, field.ref);
  const chips = h('span', { class: 'chips' });
  const input = editable ? h('input', {
    type: 'text', class: 'link-input', dir: 'auto', autocomplete: 'off',
    placeholder: selected.length ? 'أضف…' : 'ابحث أو أضف…',
  }) : null;
  let dd = null; let items = []; let active = 0;

  const drawChips = () => {
    chips.replaceChildren(...selected.map((id) => h('span', { class: chipClass(field.ref, id), title: subtitleOf(field.ref, id) || null }, displayOf(field.ref, id),
      editable ? h('button', {
        class: 'x', title: 'إزالة', type: 'button',
        onclick: () => { selected.splice(selected.indexOf(id), 1); onChange(); drawChips(); input.focus(); },
      }, '×') : null)));
    if (input) input.placeholder = selected.length ? 'أضف…' : 'ابحث أو أضف…';
  };

  const close = () => { dd?.remove(); dd = null; window.removeEventListener('scroll', place, true); };
  function place() {
    if (!dd) return;
    const r = box.getBoundingClientRect();
    const below = innerHeight - r.bottom;
    dd.style.width = `${Math.max(260, r.width)}px`;
    dd.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    if (below < 240 && r.top > below) { dd.style.top = ''; dd.style.bottom = `${innerHeight - r.top + 4}px`; }
    else { dd.style.bottom = ''; dd.style.top = `${r.bottom + 4}px`; }
  }
  const add = (id) => { if (!selected.includes(id)) selected.push(id); onChange(); drawChips(); input.value = ''; close(); input.focus(); };
  const create = async (name) => {
    try {
      const row = await api.insertRow(field.ref, { [refT.display]: name });
      S.data[field.ref].push(row); index(field.ref);
      toast(`أُضيف «${row[refT.display]}» إلى ${refT.label}`);
      add(row.id);
    } catch (e) { toast(e.message, 'err'); }
  };

  const render = () => {
    const raw = input.value.trim(); const q = norm(raw);
    const pool = S.data[field.ref].filter((o) => !selected.includes(o.id));
    let matches = q ? pool.filter((o) => norm(o[refT.display]).includes(q)) : pool;
    matches = matches.sort((a, b) => (norm(a[refT.display]).startsWith(q) ? 0 : 1) - (norm(b[refT.display]).startsWith(q) ? 0 : 1)).slice(0, 8);
    const exact = S.data[field.ref].some((o) => norm(o[refT.display]) === q);
    items = matches.map((o) => ({ kind: 'pick', id: o.id, label: o[refT.display] }));
    if (raw.length >= 2 && canCreate && !exact) items.push({ kind: 'create', label: raw });
    if (active >= items.length) active = 0;
    if (!dd) {
      dd = h('div', { class: 'link-dd', role: 'listbox' });
      document.body.append(dd);
      window.addEventListener('scroll', place, true);
    }
    dd.replaceChildren(
      ...(items.length ? items.map((it, i) => h('div', {
        class: `opt ${it.kind} ${i === active ? 'active' : ''}`, role: 'option',
        onmousedown: (e) => { e.preventDefault(); if (it.kind === 'pick') add(it.id); else create(it.label); },
        onmousemove: () => { if (active !== i) { active = i; render(); } },
      }, it.kind === 'create'
        ? [icon('plus', 14), h('span', {}, 'إنشاء '), h('b', {}, `«${it.label}»`), h('small', {}, ` في ${refT.label}`)]
        : [h('span', { class: 'opt-name' }, field.ref === 'journals' ? h('span', { class: `${chipClass('journals', it.id)} dot-only` }) : null, it.label), subtitleOf(field.ref, it.id) ? h('small', { class: 'opt-sub' }, subtitleOf(field.ref, it.id)) : null]))
        : [h('div', { class: 'opt empty' }, raw ? 'لا يوجد اسم مطابق' : 'لا توجد عناصر أخرى')]));
    place();
  };

  if (input) {
    input.addEventListener('focus', () => { active = 0; render(); });
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const it = items[active];
        if (it && input.value.trim()) { if (it.kind === 'pick') add(it.id); else create(it.label); }
      } else if (e.key === 'Escape' && dd) { e.stopPropagation(); close(); }
      else if (e.key === 'Backspace' && !input.value && selected.length) { selected.pop(); onChange(); drawChips(); render(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box || e.target === chips) { e.preventDefault(); input.focus(); } });
  }
  drawChips();
  box.append(chips, input || (!selected.length ? h('span', { class: 'muted' }, '—') : ''));
  return box;
}

function contactsEditor(field, items, editable) {
  const box = h('div', { class: 'contacts' });
  const draw = () => {
    box.replaceChildren(
      ...items.map((c, i) => h('div', { class: 'contact-row' },
        h('select', { disabled: !editable, onchange: (e) => { c.contact_type_id = Number(e.target.value); } },
          S.data.contact_types.map((t) => h('option', { value: t.id, selected: t.id === c.contact_type_id }, t.name))),
        h('input', { type: 'text', dir: 'auto', value: c.value || '', disabled: !editable, oninput: (e) => { c.value = e.target.value; } }),
        editable ? h('button', { class: 'btn ghost sm icon-btn', 'aria-label': 'حذف', onclick: () => { items.splice(i, 1); draw(); } }, icon('x', 16)) : null)),
      editable ? h('button', { class: 'btn sm add', onclick: () => { items.push({ contact_type_id: S.data.contact_types[0]?.id, value: '' }); draw(); } }, icon('plus', 14), 'وسيلة تواصل') : null);
    if (!items.length && !editable) box.append(h('span', { class: 'muted' }, '—'));
  };
  draw();
  return box;
}

function openRecord(table, row, focusKey, defaults = null) {
  const T = TABLES[table];
  const role = S.me.role; const uid = S.me.id;
  const isNew = !row;
  const { pub: pubDefaults, ...baseDefaults } = defaults || {};
  const draft = { ...(row || baseDefaults) };
  const links = {}; const contacts = {};
  let dirty = false;
  let ext = null; // conditional research sections (research.js)
  const form = h('div', { class: 'record' });
  const fieldEls = {};

  for (const f of fieldsFor(role, table)) {
    if (isNew && f.readonly) continue;
    // extension & computed research fields are handled by the conditional sections
    if (f.ext || f.type === 'computed' || (table === 'researches' && f.type === 'publication')) continue;
    const editable = isNew ? (!f.readonly && (!f.adminOnly || ['owner', 'admin'].includes(role)) && !(f.type === 'link' && f.ref === 'researches' && !['owner', 'admin'].includes(role)))
      : canEditField(role, uid, table, row, f);
    let control;
    switch (f.type) {
      case 'link':
        links[f.key] = isNew ? [] : linkedIds(f, row.id);
        control = linkPicker(f, links[f.key], () => { dirty = true; ext?.refresh(); }, editable);
        break;
      case 'contacts':
        contacts[f.key] = isNew ? [] : contactsOf(f, row.id).map((c) => ({ ...c }));
        control = contactsEditor(f, contacts[f.key], editable);
        break;
      case 'enum':
        control = h('select', { disabled: !editable, onchange: (e) => { draft[f.key] = e.target.value || null; } },
          h('option', { value: '' }, '—'),
          Object.entries(ENUMS[f.options]).map(([k, label]) => h('option', { value: k, selected: k === draft[f.key] }, label)));
        break;
      case 'fk':
        control = h('select', { disabled: !editable, onchange: (e) => { draft[f.key] = e.target.value ? Number(e.target.value) : null; } },
          h('option', { value: '' }, '—'),
          fkOptions(f.ref).map((o) => h('option', { value: o.id, selected: String(o.id) === String(draft[f.key]) }, o[TABLES[f.ref].display])));
        break;
      case 'production':
        control = isNew ? h('span', { class: 'muted' }, 'يظهر بعد ربط الشخص بأعمال منشورة في مجلاتنا.') : productionView(row.id);
        break;
      case 'publication':
        control = h('div', { class: 'ro-chips' }, isNew ? h('span', { class: 'muted' }, 'تُحدَّد من العدد أو المجلة أدناه') : (renderCell(table, row, f) || h('span', { class: 'muted' }, 'غير منشور في مجلاتنا')));
        break;
      case 'longtext':
        control = h('textarea', { rows: f.key === 'summary' ? 6 : 3, disabled: !editable, dir: 'auto', oninput: (e) => { draft[f.key] = e.target.value; } }, draft[f.key] ?? '');
        break;
      case 'derived': {
        const cell = isNew ? [] : renderCell(table, row, f);
        control = h('div', { class: 'ro-chips' }, cell.length ? cell : h('span', { class: 'muted' }, 'تظهر تلقائياً حسب أبحاثه'));
        break;
      }
      case 'user': control = h('div', { class: 'ro-val' }, renderCell(table, draft, f) || '—'); break;
      case 'date': control = h('div', { class: 'ro-val' }, fmtDate(draft[f.key]) || '—'); break;
      default:
        control = h('input', {
          type: f.type === 'number' ? 'number' : (f.type === 'url' ? 'url' : 'text'),
          value: draft[f.key] ?? '', disabled: !editable, dir: f.ltr || f.type === 'url' ? 'ltr' : 'auto',
          oninput: (e) => { draft[f.key] = e.target.value; },
        });
        if (f.type === 'url' && draft[f.key]) control = h('div', { class: 'with-link' }, control, h('a', { href: draft[f.key], target: '_blank', rel: 'noopener', class: 'btn sm' }, icon('link', 14), 'فتح'));
    }
    fieldEls[f.key] = h('div', { class: `field t-${f.type} ${FULL_WIDTH.has(f.key) || f.type === 'longtext' ? 'full' : ''}`, 'data-key': f.key },
      f.type === 'production' ? null : h('label', {}, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), control);
  }
  const layout = FORM_LAYOUT[table];
  const used = new Set();
  const section = (title, keys, cls = '') => {
    const els = keys.filter((k) => fieldEls[k] && !used.has(k)).map((k) => { used.add(k); return fieldEls[k]; });
    if (els.length) form.append(h('section', { class: `form-section ${cls}` }, title ? h('h4', {}, title) : null, h('div', { class: 'record-grid' }, els)));
  };
  if (table === 'researches') {
    ext = researchExtSections({
      row, isNew, pubDefaults,
      canEditBase: isNew ? canInsert(role, table) : canEditRow(role, uid, table, row),
      translators: () => links.translators || [],
      onChange: () => { dirty = true; },
    });
  }
  if (layout) layout.forEach(([title, keys]) => (title === '@ext' ? (ext && form.append(...ext.sections)) : section(title, keys)));
  const metaKeys = fieldsFor(role, table).filter((f) => f.type === 'user' || f.type === 'date').map((f) => f.key);
  section(layout ? 'حقول أخرى' : '', fieldsFor(role, table).map((f) => f.key).filter((k) => !metaKeys.includes(k)));
  if (!isNew) { const lf = linkedFilesSection(table, row); if (lf) form.append(lf); }
  section('معلومات السجل', metaKeys, 'meta');

  const rowEditable = isNew ? canInsert(role, table) : canEditRow(role, uid, table, row);
  const anyLinkEditable = !isNew && T.fields.some((f) => f.type === 'link' && canEditField(role, uid, table, row, f));
  const saveBtn = h('button', { class: 'btn primary', onclick: () => save() }, isNew ? 'إضافة' : 'حفظ التعديلات');
  const footer = [
    (rowEditable || anyLinkEditable || ext?.editable) ? saveBtn : h('span', { class: 'muted' }, 'للعرض فقط'),
    !isNew && canDelete(role, table) ? h('button', { class: 'btn danger', onclick: () => remove() }, icon('trash', 16), 'حذف') : null,
  ];
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  const close = openModal(isNew ? `${T.single || 'سجل'} جديد` : (row[T.display] || `#${row.id}`), form, footer, {
    // eslint-disable-next-line no-alert
    beforeClose: () => !dirty || window.confirm('لديك تعديلات غير محفوظة. هل تريد الإغلاق بدون حفظ؟'),
  });
  const focusEl = focusKey ? form.querySelector(`[data-key="${focusKey}"] input, [data-key="${focusKey}"] textarea, [data-key="${focusKey}"] .link-input, [data-key="${focusKey}"] .add`) : form.querySelector('input:not([disabled]),textarea:not([disabled])');
  focusEl?.focus();
  form.closest('.modal')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.code === 'KeyS')) {
      e.preventDefault();
      if (!saveBtn.disabled && saveBtn.isConnected) save();
    }
  });

  async function save() {
    saveBtn.disabled = true;
    try {
      // 1) scalar fields
      ext?.validate();
      const values = {};
      for (const f of T.fields) {
        if (['link', 'contacts', 'user', 'date', 'computed'].includes(f.type) || f.readonly || f.ext) continue;
        let v = draft[f.key];
        if (f.type === 'number') v = v === '' || v == null ? null : Number(v);
        else if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
        if (f.required && v == null) throw new api.ApiError(`الحقل «${f.label}» إلزامي`);
        if (isNew ? v != null : v !== (row[f.key] ?? null)) values[f.key] = v;
      }
      let saved = row;
      if (isNew) {
        saved = await api.insertRow(table, values);
        S.data[table].push(saved);
      } else if (Object.keys(values).length && rowEditable) {
        Object.assign(row, await api.updateRows(table, { id: row.id }, values));
      }
      index(table);
      // 2) links (diff)
      for (const f of T.fields.filter((x) => x.type === 'link')) {
        const before = isNew ? [] : linkedIds(f, saved.id);
        const after = links[f.key];
        for (const id of after.filter((x) => !before.includes(x))) {
          const link = await api.insertRow(f.via, { [f.self]: saved.id, [f.other]: id });
          S.data[f.via].push(link);
        }
        for (const id of before.filter((x) => !after.includes(x))) {
          await api.deleteRows(f.via, { [f.self]: saved.id, [f.other]: id });
          S.data[f.via] = S.data[f.via].filter((l) => !(l[f.self] === saved.id && l[f.other] === id));
        }
      }
      // 3) contacts
      for (const f of T.fields.filter((x) => x.type === 'contacts')) {
        const before = isNew ? [] : contactsOf(f, saved.id);
        const after = contacts[f.key].filter((c) => String(c.value || '').trim());
        for (const c of before.filter((b) => !after.some((a) => a.id === b.id))) {
          await api.deleteRows(f.table, { id: c.id });
        }
        for (const c of after) {
          const vals = { contact_type_id: c.contact_type_id, value: c.value.trim() };
          if (!c.id) await api.insertRow(f.table, { ...vals, [f.self]: saved.id });
          else {
            const old = before.find((b) => b.id === c.id);
            if (old && (old.value !== vals.value || old.contact_type_id !== vals.contact_type_id)) await api.updateRows(f.table, { id: c.id }, vals);
          }
        }
        await loadTable(f.table);
      }
      // 4) conditional research sections (center publication, submission, bibliographic, original)
      if (ext) {
        await ext.save(saved.id);
        await reloadResearch(saved.id);
      }
      // role assignments are maintained by triggers
      if (['researches', 'persons'].includes(table)) await loadTable('person_role_assignments');
      close(true);
      toast(isNew ? 'تمت الإضافة' : 'تم الحفظ');
      renderShell();
    } catch (e) {
      toast(e.message, 'err');
      saveBtn.disabled = false;
    }
  }

  async function remove() {
    if (!confirmBox()) return;
    try {
      await api.deleteRows(table, { id: row.id });
      await loadAll();
      close(true);
      toast('تم الحذف');
      renderShell();
    } catch (e) { toast(e.message, 'err'); }
  }
  function confirmBox() {
    // eslint-disable-next-line no-alert
    return window.confirm(`هل أنت متأكد من حذف «${row[T.display]}»؟ لا يمكن التراجع عن الحذف.`);
  }
}

// ============ keyboard shortcuts ============
const SHORTCUTS = [
  ['N', 'إضافة سجل جديد في الجدول المفتوح'],
  ['/', 'الانتقال إلى خانة البحث'],
  ['Ctrl + Enter', 'حفظ السجل المفتوح'],
  ['Ctrl + S', 'حفظ السجل المفتوح'],
  ['Esc', 'إغلاق النافذة أو إلغاء التعديل'],
  ['دبل كليك', 'تعديل الخلية مباشرة في الجدول'],
  ['Enter', 'حفظ تعديل الخلية'],
  ['?', 'عرض هذه القائمة'],
];
function showShortcuts() {
  if (document.querySelector('.modal-wrap')) return;
  openModal('اختصارات لوحة المفاتيح', h('table', { class: 'shortcuts' },
    SHORTCUTS.map(([k, d]) => h('tr', {}, h('td', {}, k.split(' + ').map((x, i) => [i ? ' + ' : '', h('kbd', {}, x)])), h('td', {}, d)))),
    h('span', { class: 'muted' }, 'الاختصارات تعمل بالكيبورد العربي والإنكليزي.'));
}
document.addEventListener('keydown', (e) => {
  if (!S.me || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('.modal-wrap, .popover')) return;
  const isTable = !!TABLES[S.view];
  if (e.code === 'KeyN' && isTable && canInsert(S.me.role, S.view)) { e.preventDefault(); openRecord(S.view, null); }
  else if (e.code === 'Slash' && !e.shiftKey && isTable) { e.preventDefault(); document.querySelector('.search input')?.focus(); }
  else if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) { e.preventDefault(); showShortcuts(); }
});


// Conditional sections of the research window, each backed by a 1:1 extension table:
//   «النشر في المركز» → center_publications   «البيانات الببليوغرافية» → bibliographic_details
//   «بيانات الأصل»   → translation_details     «الاستلام» → submissions (+ submission_events)
// A row is created when any of its fields is filled, and removed when all are emptied.
// NOTE: all modules share one scope in the bundle — internal names here start with "rx".




const RX_PUB_COLS = ['kind', 'issue_id', 'start_page', 'end_page', 'issue_order'];
const RX_BIB_COLS = ['isbn', 'doi', 'pages'];
const RX_TRANS_COLS = ['original_title', 'original_language_id'];
const RX_SUB_COLS = ['journal_id', 'received_at', 'stage', 'rejection_reason'];

const rxIsStaff = () => ['owner', 'admin'].includes(S.me.role);
const rxNum = (v) => (v === '' || v == null ? null : Number(v));
const rxText = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const rxPick = (o, cols) => Object.fromEntries(cols.map((c) => [c, o?.[c] ?? null]));
const rxSame = (a, b, cols) => cols.every((c) => String(a?.[c] ?? '') === String(b?.[c] ?? ''));
const rxEmpty = (o, cols) => cols.every((c) => o[c] == null || o[c] === '');
const rxFmt = (d) => (d ? new Date(d).toLocaleDateString('ar-LB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// DOM replaceChildren() turns null into the text "null" — drop empty parts first
const rxSet = (el, ...parts) => el.replaceChildren(...parts.flat().filter((x) => x != null && x !== false));
function rxField(label, control, full = false) {
  return h('div', { class: `field ${full ? 'full' : ''}` }, h('label', {}, label), control);
}
function rxSelect(options, value, onchange, disabled, emptyLabel = '—') {
  return h('select', { disabled, onchange: (e) => onchange(e.target.value) },
    emptyLabel != null ? h('option', { value: '' }, emptyLabel) : null,
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, label)));
}
function rxInput(type, value, oninput, disabled, attrs = {}) {
  return h('input', { type, value: value ?? '', disabled, dir: attrs.ltr ? 'ltr' : 'auto', min: type === 'number' ? 1 : null, oninput: (e) => oninput(e.target.value) });
}

function researchExtSections({ row, isNew, pubDefaults, canEditBase, translators, onChange }) {
  const role = S.me.role;
  const staff = rxIsStaff();
  const st = {
    pub: row?.pub ? { ...row.pub } : (pubDefaults ? { ...pubDefaults } : null),
    bib: { ...rxPick(row?.bib, RX_BIB_COLS) },
    trans: { ...rxPick(row?.trans, RX_TRANS_COLS) },
    sub: row?.sub ? { ...row.sub } : null,
  };
  const changed = () => onChange?.();

  // ---- permissions (mirror the RLS policies) ----
  const kinds = pubKindsFor(role);
  const pubEditable = () => staff || (canEditBase && ['editor', 'data_entry'].includes(role) && (!st.pub || st.pub.kind === 'article' || !st.pub.kind));
  const myJournals = (S.data.journals || []).filter((j) => staff || managesJournal(role, j.id));
  const subVisible = seesSubmissions(role) && (staff || myJournals.length > 0 || !!row?.sub);
  const subEditable = () => staff || (role === 'editor' && (st.sub?.journal_id ? managesJournal(role, Number(st.sub.journal_id)) : myJournals.length > 0));
  const issueOptions = () => [...(S.data.issues || [])]
    .filter((i) => staff || role === 'data_entry' || managesJournal(role, i.journal_id))
    .sort((a, b) => displayOf('journals', a.journal_id).localeCompare(displayOf('journals', b.journal_id), 'ar') || b.number - a.number)
    .map((i) => [i.id, i.label]);

  // ---- «النشر في المركز» ----
  const pubBody = h('div', {});
  const pubSec = h('section', { class: 'form-section ext', 'data-ext': 'pub' }, h('h4', {}, 'النشر في المركز'), pubBody);
  function drawPub() {
    const can = pubEditable();
    pubSec.hidden = !st.pub && !can;
    if (!st.pub) {
      rxSet(pubBody, h('div', { class: 'ext-empty' },
        h('span', { class: 'muted' }, 'غير منشور في مجلات المركز أو إصداراته.'),
        can ? h('button', { type: 'button', class: 'btn sm', onclick: () => { st.pub = { kind: kinds.length === 1 ? 'article' : '' }; changed(); drawAll(); } }, icon('plus', 14), 'إضافة نشر في المركز') : null));
      return;
    }
    const p = st.pub;
    const kindLocked = !can || (!staff && p.kind && p.kind !== 'article');
    const kindOpts = (kindLocked ? Object.keys(PUB_KINDS) : kinds).map((k) => [k, PUB_KINDS[k]]);
    const article = p.kind === 'article';
    rxSet(pubBody, h('div', { class: 'record-grid' },
      rxField('النوع', rxSelect(kindOpts, p.kind, (v) => {
        p.kind = v || '';
        if (p.kind !== 'article') { p.issue_id = null; p.start_page = null; p.end_page = null; p.issue_order = null; }
        changed(); drawAll();
      }, kindLocked, 'اختر…')),
      article ? rxField('العدد', rxSelect(issueOptions(), p.issue_id, (v) => { p.issue_id = rxNum(v); changed(); }, !can)) : null,
      article ? rxField('ترتيبها في العدد', rxInput('number', p.issue_order, (v) => { p.issue_order = rxNum(v); changed(); }, !can)) : null,
      article ? rxField('من صفحة', rxInput('number', p.start_page, (v) => { p.start_page = rxNum(v); changed(); }, !can)) : null,
      article ? rxField('إلى صفحة', rxInput('number', p.end_page, (v) => { p.end_page = rxNum(v); changed(); }, !can)) : null),
    p.kind && !article ? h('small', { class: 'hint' }, `الكتب تُحفظ في «${CENTER_LIBRARY}» ولا ترتبط بمجلة.`) : null,
    !staff && can ? h('small', { class: 'hint' }, 'الكتب يضيفها المالك والإدارة فقط.') : null,
    can ? h('div', { class: 'ext-actions' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.pub = null; changed(); drawAll(); } }, icon('x', 14), 'إزالة النشر')) : null);
  }

  // ---- «البيانات الببليوغرافية» (hidden for articles) ----
  const bibSec = h('section', { class: 'form-section ext', 'data-ext': 'bib' }, h('h4', {}, 'البيانات الببليوغرافية'));
  const bibGrid = h('div', { class: 'record-grid' },
    rxField('ISBN', rxInput('text', st.bib.isbn, (v) => { st.bib.isbn = v; changed(); }, !canEditBase, { ltr: true })),
    rxField('DOI', rxInput('text', st.bib.doi, (v) => { st.bib.doi = v; changed(); }, !canEditBase, { ltr: true })),
    rxField('عدد الصفحات', rxInput('number', st.bib.pages, (v) => { st.bib.pages = v; changed(); }, !canEditBase)));
  bibSec.append(bibGrid, h('small', { class: 'hint' }, 'للكتب والأبحاث الخارجية.'));
  const bibVisible = () => st.pub?.kind !== 'article';

  // ---- «بيانات الأصل» (only with a translator) ----
  const transSec = h('section', { class: 'form-section ext', 'data-ext': 'trans' }, h('h4', {}, 'بيانات الأصل'),
    h('div', { class: 'record-grid' },
      rxField('العنوان الأصلي', rxInput('text', st.trans.original_title, (v) => { st.trans.original_title = v; changed(); }, !canEditBase), true),
      rxField('اللغة الأصلية', rxSelect((S.data.languages || []).map((l) => [l.id, l.name]), st.trans.original_language_id,
        (v) => { st.trans.original_language_id = rxNum(v); changed(); }, !canEditBase))));
  const transVisible = () => translators().length > 0;

  // ---- «الاستلام» ----
  const subBody = h('div', {});
  const subSec = h('section', { class: 'form-section ext', 'data-ext': 'sub' }, h('h4', {}, 'الاستلام'), subBody);
  const timeline = h('div', { class: 'timeline' });
  function drawSub() {
    subSec.hidden = !subVisible;
    if (!subVisible) return;
    const can = subEditable();
    if (!st.sub) {
      rxSet(subBody, h('div', { class: 'ext-empty' },
        h('span', { class: 'muted' }, 'لا يوجد استلام مسجّل لهذا البحث (بحث خارجي أو منشور قبل النظام).'),
        can ? h('button', {
          type: 'button', class: 'btn sm',
          onclick: () => { st.sub = { journal_id: myJournals.length === 1 ? myJournals[0].id : null, received_at: new Date().toISOString().slice(0, 10), stage: 'received', rejection_reason: null }; changed(); drawAll(); },
        }, icon('plus', 14), 'تسجيل استلام') : null));
      return;
    }
    const s = st.sub;
    const rejected = s.stage === 'rejected';
    rxSet(subBody, h('div', { class: 'record-grid' },
      rxField('المجلة', rxSelect((row?.sub && !myJournals.some((j) => j.id === s.journal_id) ? [...myJournals, { id: s.journal_id, name: displayOf('journals', s.journal_id) }] : myJournals).map((j) => [j.id, j.name]),
        s.journal_id, (v) => { s.journal_id = rxNum(v); changed(); }, !can)),
      rxField('تاريخ الاستلام', rxInput('date', s.received_at, (v) => { s.received_at = v || null; changed(); }, !can)),
      rxField('المرحلة', rxSelect(Object.entries(STAGES), s.stage, (v) => { s.stage = v || 'received'; if (s.stage !== 'rejected') s.rejection_reason = null; changed(); drawSub(); }, !can, null)),
      rejected ? rxField('سبب الرفض', rxInput('text', s.rejection_reason, (v) => { s.rejection_reason = v; changed(); }, !can), true) : null),
    row?.sub?.decided_at ? h('small', { class: 'hint' }, `تاريخ القرار: ${rxFmt(row.sub.decided_at)}`) : null,
    row?.sub ? timeline : null,
    S.me.role === 'owner' && row?.sub ? h('div', { class: 'ext-actions' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.sub = null; changed(); drawAll(); } }, icon('x', 14), 'حذف الاستلام')) : null,
    !row?.sub && can ? h('div', { class: 'ext-actions' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.sub = null; changed(); drawAll(); } }, icon('x', 14), 'إلغاء')) : null);
  }
  if (row?.sub?.id && subVisible) {
    timeline.append(h('small', { class: 'muted' }, 'جارٍ تحميل تسلسل المراحل…'));
    api.select('submission_events', `submission_id=eq.${row.sub.id}&order=happened_at,id`).then((events) => {
      rxSet(timeline, h('div', { class: 'tl-title' }, 'تسلسل المراحل'),
        events.length ? h('ol', {}, events.map((e) => h('li', { class: `tl-${e.stage}` },
          h('b', {}, STAGES[e.stage] ?? e.stage), h('small', { class: 'muted' }, [rxFmt(e.happened_at), e.created_by ? userName(e.created_by) : null].filter(Boolean).join(' · ')),
          e.note ? h('span', { class: 'tl-note' }, e.note) : null)))
          : h('small', { class: 'muted' }, 'لا توجد مراحل مسجّلة.'));
    }).catch((e) => { rxSet(timeline, h('small', { class: 'form-err' }, e.message)); });
  }

  function drawAll() {
    drawPub();
    bibSec.hidden = !bibVisible();
    transSec.hidden = !transVisible();
    drawSub();
  }
  drawAll();

  return {
    sections: [transSec, pubSec, subSec, bibSec],
    get editable() { return pubEditable() || canEditBase || (subVisible && subEditable()); },
    refresh: drawAll,
    validate() {
      const p = st.pub;
      if (p && p.kind === 'article' && !p.issue_id) throw new api.ApiError('اختر العدد الذي نُشرت فيه المقالة');
      if (p && p.start_page && p.end_page && Number(p.end_page) < Number(p.start_page)) throw new api.ApiError('صفحة النهاية يجب ألا تكون قبل صفحة البداية');
      if (row?.sub && (!st.sub || !st.sub.journal_id) && S.me.role !== 'owner') throw new api.ApiError('حذف الاستلام للمالك فقط');
      if (st.sub && !st.sub.journal_id && !row?.sub) throw new api.ApiError('اختر المجلة التي استُلم لها البحث');
    },
    async save(rid) {
      // center_publications
      const pubWant = st.pub && st.pub.kind ? rxPick(st.pub, RX_PUB_COLS) : null;
      if (pubEditable() || (row?.pub && staff)) {
        if (pubWant && (!row?.pub || !rxSame(pubWant, row.pub, RX_PUB_COLS))) await api.upsertExtension('center_publications', rid, pubWant);
        else if (!pubWant && row?.pub) await api.deleteExtension('center_publications', rid);
      }
      // bibliographic_details (not for articles)
      if (canEditBase && bibVisible()) {
        const want = { isbn: rxText(st.bib.isbn), doi: rxText(st.bib.doi), pages: rxNum(st.bib.pages) };
        if (!rxEmpty(want, RX_BIB_COLS)) { if (!rxSame(want, row?.bib, RX_BIB_COLS)) await api.upsertExtension('bibliographic_details', rid, want); }
        else if (row?.bib) await api.deleteExtension('bibliographic_details', rid);
      }
      // translation_details (only with a translator)
      if (canEditBase && transVisible()) {
        const want = { original_title: rxText(st.trans.original_title), original_language_id: rxNum(st.trans.original_language_id) };
        if (!rxEmpty(want, RX_TRANS_COLS)) { if (!rxSame(want, row?.trans, RX_TRANS_COLS)) await api.upsertExtension('translation_details', rid, want); }
        else if (row?.trans) await api.deleteExtension('translation_details', rid);
      }
      // submissions
      if (subVisible && (subEditable() || S.me.role === 'owner')) {
        const s = st.sub;
        const want = s && s.journal_id ? {
          journal_id: s.journal_id, received_at: s.received_at || new Date().toISOString().slice(0, 10), stage: s.stage || 'received',
          rejection_reason: s.stage === 'rejected' ? rxText(s.rejection_reason) : null,
        } : null;
        if (want && (!row?.sub || !rxSame(want, row.sub, RX_SUB_COLS))) await api.upsertExtension('submissions', rid, want);
        else if (!want && row?.sub) await api.deleteExtension('submissions', rid);
      }
    },
  };
}




// Where a research is published: its journal, or the center library for books
const placeOf = (r) => (isBook(r) ? '__center' : researchJournal(r));
const placeLabel = (k) => (k === '__center' ? CENTER_LIBRARY : displayOf('journals', k));

function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const keys = [].concat(keyFn(r));
    for (const k of (keys.length ? keys : ['__none'])) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function barCard(title, entries, { sortByLabel = false, labelFn = (k) => k } = {}) {
  let list = [...entries].map(([k, n]) => ({ k, n, label: k === '__none' ? 'غير محدد' : labelFn(k) }));
  if (sortByLabel) list.sort((a, b) => (a.k === '__none') - (b.k === '__none') || Number(b.k) - Number(a.k));
  else list.sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...list.map((x) => x.n));
  return h('section', { class: 'card' },
    h('h3', {}, title),
    list.length ? h('div', { class: 'bars' }, list.map((x) => h('div', { class: `bar-row ${x.k === '__none' ? 'none' : ''}`, title: `${x.label}: ${x.n}` },
      h('span', { class: 'bar-label' }, x.label),
      h('span', { class: 'bar-track' }, h('span', { class: 'bar', style: `width:${(x.n / max) * 100}%` })),
      h('span', { class: 'bar-val' }, x.n))))
      : h('p', { class: 'muted' }, 'لا توجد بيانات'));
}

function renderStats(main) {
  const R = S.data.researches;
  const links = (via, self, other) => (rid) => S.data[via].filter((l) => l[self] === rid).map((l) => l[other]);
  const topicsOf = links('research_topics', 'research_id', 'topic_id');
  const pub = links('research_publishers', 'research_id', 'publisher_id');
  const researchers = new Set(S.data.research_researchers.map((l) => l.person_id));
  const translators = new Set(S.data.research_translators.map((l) => l.person_id));
  const translated = new Set(S.data.research_translators.map((l) => l.research_id));
  const noResearcher = R.filter((r) => !S.data.research_researchers.some((l) => l.research_id === r.id)).length;
  const noTopic = R.filter((r) => !topicsOf(r.id).length).length;
  const published = R.filter((r) => r.pub).length;
  const books = R.filter((r) => isBook(r)).length;
  const subs = R.filter((r) => r.sub);
  const inProgress = subs.filter((r) => researchStatus(r).kind === 'wip').length;
  const rejected = subs.filter((r) => r.sub.stage === 'rejected').length;
  const noSummary = R.filter((r) => !String(r.summary || '').trim()).length;

  const tile = (label, n, sub) => h('div', { class: 'tile' }, h('span', { class: 'tile-n' }, n), h('span', { class: 'tile-l' }, label), sub ? h('small', {}, sub) : null);
  const scope = S.me.role === 'editor' ? h('p', { class: 'muted' }, 'تظهر هنا إحصائيات الأبحاث المرتبطة بمجلاتك فقط.') : null;

  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('chart', 22), 'الإحصائيات')),
    h('div', { class: 'stats' },
      scope,
      h('div', { class: 'tiles' },
        tile('بحث', R.length, `${translated.size} منها مترجم · ${published} من منشورات المركز`),
        tile('باحث', researchers.size),
        tile('مترجم', translators.size),
        tile('ناشر', S.data.publishers.length),
        tile('عدد', (S.data.issues || []).length, `في ${S.data.journals.length} مجلات`),
        tile('كتاب', books, CENTER_LIBRARY),
        seesSubmissions(S.me.role) ? tile('استلام قيد العمل', inProgress, `${rejected} مرفوض`) : null),
      h('div', { class: 'cards' },
        barCard('منشورات المركز', countBy(R.filter((r) => r.pub), placeOf), { labelFn: placeLabel }),
        books ? barCard('الكتب حسب النوع', countBy(R.filter((r) => isBook(r)), (r) => r.pub.kind), { labelFn: (k) => PUB_KINDS[k] }) : null,
        seesSubmissions(S.me.role) && subs.length ? barCard('الاستلامات حسب المرحلة', countBy(subs, (r) => r.sub.stage), { labelFn: (k) => STAGES[k] }) : null,
        barCard('الأبحاث حسب الموضوع', countBy(R, (r) => topicsOf(r.id)), { labelFn: (k) => displayOf('topics', k) }),
        barCard('الأبحاث حسب سنة النشر', countBy(R, (r) => r.year ?? '__none'), { sortByLabel: true }),
        barCard('الأبحاث حسب الناشر', countBy(R, (r) => pub(r.id)), { labelFn: (k) => displayOf('publishers', k) }),
        barCard('الأبحاث حسب اللغة', countBy(R, (r) => r.language_id ?? '__none'), { labelFn: (k) => displayOf('languages', k) }),
        barCard('الأبحاث حسب النوع', countBy(R, (r) => r.research_type_id ?? '__none'), { labelFn: (k) => displayOf('research_types', k) }),
        S.me.role !== 'editor' ? barCard('الأبحاث حسب مُدخل البيانات', countBy(R, (r) => r.created_by || 'nocodb'), { labelFn: (k) => (k === 'nocodb' ? 'NocoDB / قبل الواجهة' : userName(k)) }) : null,
        h('section', { class: 'card' }, h('h3', {}, 'اكتمال البيانات'),
          h('ul', { class: 'gaps' },
            h('li', {}, h('b', {}, noResearcher), ' بحث بدون باحث'),
            h('li', {}, h('b', {}, noTopic), ' بحث بلا موضوع'),
            h('li', {}, h('b', {}, noSummary), ' بحث بدون ملخص'),
            h('li', {}, h('b', {}, S.data.persons.filter((p) => !p.nationality_id).length), ' شخص بدون جنسية'),
            h('li', {}, h('b', {}, S.data.publishers.filter((p) => !p.country_id).length), ' ناشر بدون دولة'))))));
}





async function reloadUsers() {
  S.data.profiles = await api.selectAll('profiles', 'created_at');
  S.byId.profiles = new Map(S.data.profiles.map((r) => [r.id, r]));
  S.data.journal_editors = await api.selectAll('journal_editors', null);
}

function renderUsers(main) {
  const users = [...S.data.profiles].sort((a, b) => (a.active - b.active) || String(a.created_at).localeCompare(String(b.created_at)));

  const update = async (p, values) => {
    try {
      await api.updateRows('profiles', { id: p.id }, values);
      await reloadUsers();
      toast('تم الحفظ');
    } catch (e) { toast(e.message, 'err'); }
    renderShell();
  };

  const journalsCell = (p) => {
    if (p.role !== 'editor') return h('span', { class: 'muted' }, '—');
    const mine = S.data.journal_editors.filter((j) => j.user_id === p.id).map((j) => j.journal_id);
    return h('div', { class: 'journal-checks' }, S.data.journals.map((j) => h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: mine.includes(j.id),
        onchange: async (e) => {
          try {
            if (e.target.checked) await api.insertRow('journal_editors', { user_id: p.id, journal_id: j.id });
            else await api.deleteRows('journal_editors', { user_id: p.id, journal_id: j.id });
            await reloadUsers();
            toast('تم الحفظ');
          } catch (ex) { toast(ex.message, 'err'); renderShell(); }
        },
      }), j.name)));
  };

  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('users', 22), 'المستخدمون')),
    h('div', { class: 'users' },
      h('div', { class: 'help card' },
        h('b', {}, 'كيف أضيف مستخدماً؟'),
        h('p', {}, 'يفتح الشخص رابط الواجهة ويضغط «طلب حساب جديد». يظهر طلبه هنا كـ«بانتظار التفعيل»، فتختار دوره وتضغط «تفعيل».'),
        h('p', { class: 'muted' }, 'الصلاحيات: المالك يرى ويعدّل ويحذف كل شيء، ويدير المستخدمين. الإدارة تعدّل كل البيانات وترى الإحصائيات. مدير المجلة يرى مقالات مجلته وما أدخله، ويضيف الأبحاث والأشخاص والناشرين ويعدّل ما أضافه هو فقط. مدخل البيانات يضيف الأبحاث ويعدّل ما أدخله هو فقط، ويضيف ويعدّل الأشخاص والناشرين.')),
      h('div', { class: 'grid-wrap' }, h('table', { class: 'grid users-table' },
        h('thead', {}, h('tr', {}, ['الاسم', 'البريد الإلكتروني', 'الدور', 'المجلات (لمدير المجلة)', 'الحالة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, users.map((p) => {
          const self = p.id === S.me.id;
          return h('tr', { class: p.active ? '' : 'pending' },
            h('td', {}, h('div', { class: 'user-cell' }, avatarEl(p, 30), h('input', { class: 'inline', value: p.full_name || '', onchange: (e) => update(p, { full_name: e.target.value.trim() || null }) }))),
            h('td', { class: 'ltr' }, p.email),
            h('td', {}, h('select', { disabled: self, onchange: (e) => update(p, { role: e.target.value }) },
              Object.entries(ROLE_LABELS).map(([k, v]) => h('option', { value: k, selected: p.role === k }, v)))),
            h('td', {}, journalsCell(p)),
            h('td', {}, self ? h('span', { class: 'chip' }, 'أنت')
              : p.active
                ? h('button', { class: 'btn sm', onclick: () => update(p, { active: false }) }, 'إيقاف')
                : h('button', { class: 'btn primary sm', onclick: () => update(p, { active: true }) }, 'تفعيل')));
        }))))));
}





const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

// Square-crop and shrink an image file to a small JPEG before upload
async function toAvatarBlob(file, size = 256) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new api.ApiError('تعذّر قراءة الصورة'));
    el.src = URL.createObjectURL(file);
  });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

async function saveProfile(values) {
  const updated = await api.updateRows('profiles', { id: S.me.id }, values);
  Object.assign(S.me, updated);
  S.byId.profiles?.set(S.me.id, S.me);
}

function card(title, ic, ...body) {
  return h('section', { class: 'card' }, h('h3', {}, icon(ic, 18), title), ...body);
}

function identityCard() {
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const status = h('small', { class: 'muted' }, 'JPG أو PNG، وتُقصّ تلقائياً بشكل مربّع.');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('حجم الصورة كبير جداً (الحد 8 ميغابايت)', 'err'); return; }
    status.textContent = 'جارٍ رفع الصورة…';
    try {
      const blob = await toAvatarBlob(file);
      const url = await api.uploadPublic('avatars', `${S.me.id}/avatar.jpg`, blob);
      await saveProfile({ avatar_url: url });
      toast('تم تحديث الصورة');
      renderShell();
    } catch (e) { toast(e.message, 'err'); status.textContent = ''; }
  });

  const name = h('input', { type: 'text', value: S.me.full_name || '', dir: 'auto' });
  const saveName = h('button', {
    class: 'btn primary',
    onclick: async () => {
      const v = name.value.trim();
      if (!v) { toast('الاسم لا يمكن أن يكون فارغاً', 'warn'); return; }
      try { await saveProfile({ full_name: v }); toast('تم حفظ الاسم'); renderShell(); } catch (e) { toast(e.message, 'err'); }
    },
  }, 'حفظ الاسم');
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName.click(); });

  return card('الملف الشخصي', 'user',
    h('div', { class: 'profile-head' },
      h('div', { class: 'avatar-wrap' }, avatarEl(S.me, 88)),
      h('div', { class: 'avatar-actions' },
        h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('camera', 16), S.me.avatar_url ? 'تغيير الصورة' : 'إضافة صورة'),
        S.me.avatar_url ? h('button', {
          class: 'btn ghost', onclick: async () => {
            try { await saveProfile({ avatar_url: null }); toast('أُزيلت الصورة'); renderShell(); } catch (e) { toast(e.message, 'err'); }
          },
        }, 'إزالة') : null,
        status, fileInput)),
    h('div', { class: 'form-rows' },
      h('label', { class: 'f' }, h('span', {}, 'الاسم الظاهر'), h('div', { class: 'with-btn' }, name, saveName)),
      h('div', { class: 'f' }, h('span', {}, 'البريد الإلكتروني'), h('div', { class: 'ro-val ltr' }, S.me.email)),
      h('div', { class: 'f' }, h('span', {}, 'الدور'), h('div', {}, h('span', { class: 'chip' }, ROLE_LABELS[S.me.role])))));
}

function passwordCard() {
  const cur = h('input', { type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const pw1 = h('input', { type: 'password', dir: 'ltr', autocomplete: 'new-password', minlength: 6 });
  const pw2 = h('input', { type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const msg = h('div', { class: 'form-err' });
  const btn = h('button', {
    class: 'btn primary',
    onclick: async () => {
      msg.className = 'form-err'; msg.textContent = '';
      if (pw1.value.length < 6) { msg.textContent = 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل'; return; }
      if (pw1.value !== pw2.value) { msg.textContent = 'كلمتا السر الجديدتان غير متطابقتين'; return; }
      btn.disabled = true;
      try {
        if (!(await api.checkPassword(S.me.email, cur.value))) throw new api.ApiError('كلمة السر الحالية غير صحيحة');
        await api.updatePassword(pw1.value);
        cur.value = ''; pw1.value = ''; pw2.value = '';
        msg.className = 'form-ok'; msg.textContent = 'تم تغيير كلمة السر بنجاح.';
      } catch (e) { msg.textContent = e.message; }
      btn.disabled = false;
    },
  }, 'تغيير كلمة السر');
  return card('كلمة السر', 'lock',
    h('div', { class: 'form-rows' },
      h('label', { class: 'f' }, h('span', {}, 'كلمة السر الحالية'), cur),
      h('label', { class: 'f' }, h('span', {}, 'كلمة السر الجديدة'), pw1),
      h('label', { class: 'f' }, h('span', {}, 'تأكيد كلمة السر الجديدة'), pw2)),
    msg, btn);
}

function themeCard() {
  const mode = currentTheme();
  return card('مظهر الواجهة', 'sun',
    h('div', { class: 'theme-tiles' }, THEMES.map(([k, label, ic]) => h('button', {
      class: `theme-tile t-${k} ${k === mode ? 'on' : ''}`,
      onclick: () => { lsSet('tajdid_theme', k); applyTheme(k); renderShell(); },
    }, h('span', { class: 'preview' }, h('i'), h('i'), h('i')), h('span', { class: 'tl' }, icon(ic, 15), label)))),
    h('small', { class: 'muted' }, '«تلقائي» يتبع إعدادات جهازك. الاختيار يُحفظ على هذا الجهاز.'));
}

function statsCard() {
  const me = S.me.id;
  const mine = (t) => (S.data[t] || []).filter((r) => r.created_by === me);
  const edited = (t) => (S.data[t] || []).filter((r) => r.updated_by === me && r.created_by !== me).length;
  const R = mine('researches'); const P = mine('persons'); const PB = mine('publishers');
  const all = [...R, ...P, ...PB];
  const now = new Date();
  const sameMonth = (d) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const thisMonth = all.filter((r) => r.created_at && sameMonth(new Date(r.created_at))).length;
  const edits = edited('researches') + edited('persons') + edited('publishers');

  // last 6 months
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const n = all.filter((r) => { const c = r.created_at && new Date(r.created_at); return c && c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth(); }).length;
    months.push({ label: MONTHS[d.getMonth()], n });
  }
  const max = Math.max(1, ...months.map((m) => m.n));

  // my researches by journal
  const byJournal = new Map();
  for (const r of R) { const j = isBook(r) ? '__center' : researchJournal(r); if (j) byJournal.set(j, (byJournal.get(j) || 0) + 1); }

  const recent = [...R].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
  const tile = (n, l) => h('div', { class: 'tile' }, h('span', { class: 'tile-n' }, n), h('span', { class: 'tile-l' }, l));

  return card('إحصائيات عملي', 'chart',
    h('div', { class: 'tiles' },
      tile(R.length, 'بحث أدخلته'),
      tile(P.length, 'شخص أضفته'),
      tile(PB.length, 'ناشر أضفته'),
      tile(thisMonth, 'إدخال هذا الشهر'),
      tile(edits, 'تعديل على سجلات أخرى')),
    h('h4', { class: 'sub' }, 'إدخالاتي في آخر 6 أشهر'),
    h('div', { class: 'month-bars' }, months.map((m) => h('div', { class: 'mb', title: `${m.label}: ${m.n}` },
      h('span', { class: 'mb-n' }, m.n || ''),
      h('span', { class: 'mb-track' }, h('span', { class: 'mb-bar', style: `height:${(m.n / max) * 100}%` })),
      h('span', { class: 'mb-l' }, m.label)))),
    byJournal.size ? [h('h4', { class: 'sub' }, 'أبحاثي المنشورة في مجلاتنا وإصدارات المركز'),
      h('div', { class: 'ro-chips' }, [...byJournal].sort((a, b) => b[1] - a[1]).map(([id, n]) => (id === '__center'
        ? h('span', { class: 'chip center' }, CENTER_LIBRARY, h('small', { class: 'chip-count' }, n))
        : h('span', { class: chipClass('journals', id) }, displayOf('journals', id), h('small', { class: 'chip-count' }, n)))))] : null,
    h('h4', { class: 'sub' }, 'آخر ما أدخلته'),
    recent.length
      ? h('ul', { class: 'recent' }, recent.map((r) => h('li', {},
        h('button', { class: 'link-btn', onclick: () => openRecord('researches', r) }, r.title),
        h('small', { class: 'muted' }, r.created_at ? new Date(r.created_at).toLocaleDateString('ar-LB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''))))
      : h('p', { class: 'muted' }, 'لم تُدخل أي بحث من الواجهة بعد. (الأبحاث المُدخلة سابقاً من NocoDB لا تُحتسب هنا.)'));
}

function renderProfile(main) {
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('user', 22), 'حسابي')),
    h('div', { class: 'profile' },
      h('div', { class: 'profile-col' }, identityCard(), themeCard(), passwordCard()),
      h('div', { class: 'profile-col wide' }, statsCard())));
}

// Journal files: folder tree, upload with progress, temporary links, rename, trash.
// NOTE: all modules share one scope in the bundle — internal names here start with "fl".




const FL_BUCKET = 'journal-files';
const flCache = { jid: null, folders: [], files: [], loading: null, error: null };

// ---------- data ----------
async function flLoad(jid) {
  const [folders, files] = await Promise.all([
    api.select('folders', `journal_id=eq.${jid}&deleted_at=is.null&order=sort,id`),
    api.select('files', `journal_id=eq.${jid}&deleted_at=is.null&order=name`, '*,file_versions(id,version,size,mime,path,note,created_at,created_by)'),
  ]);
  for (const f of files) {
    const vs = (f.file_versions || []).sort((a, b) => b.version - a.version);
    f.versions = vs; f.latest = vs[0] || null; f.size = f.latest?.size ?? null; delete f.file_versions;
  }
  Object.assign(flCache, { jid, folders, files, error: null });
}
function flEnsure(jid, redraw) {
  if (flCache.jid === jid && !flCache.loading) return true;
  if (!flCache.loading) {
    flCache.loading = flLoad(jid)
      .catch((e) => { flCache.jid = jid; flCache.folders = []; flCache.files = []; flCache.error = e.message; })
      .finally(() => { flCache.loading = null; redraw(); });
  }
  return false;
}
function flReset() { flCache.jid = null; }

const FL_RANK = { fixed: 0, issue: 1, book: 2, custom: 3 };
const flChildren = (pid) => flCache.folders.filter((f) => (f.parent_id ?? null) === (pid ?? null))
  .sort((a, b) => FL_RANK[a.kind] - FL_RANK[b.kind]
    || (a.kind === 'fixed' ? String(a.code).localeCompare(String(b.code), 'en', { numeric: true })
      : a.kind === 'issue' ? b.sort - a.sort : a.name.localeCompare(b.name, 'ar')));
const flFilesIn = (fid) => flCache.files.filter((f) => f.folder_id === fid).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
const flFolder = (id) => flCache.folders.find((f) => f.id === id);
function flPath(id) {
  const out = [];
  for (let f = flFolder(id); f; f = flFolder(f.parent_id)) out.unshift(f);
  return out;
}
function flCount(id) {
  let n = flFilesIn(id).length;
  for (const c of flChildren(id)) n += flCount(c.id);
  return n;
}
const flFolderLabel = (f) => (f.code ? `${f.code} ${f.name}` : f.name);
const flIssueFolder = (issueId) => flCache.folders.find((f) => f.issue_id === issueId && f.kind === 'issue');

function flSize(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ك.ب`;
  return `${(n / 1024 / 1024).toFixed(1)} م.ب`;
}
const flDate = (d) => (d ? new Date(d).toLocaleDateString('ar-LB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const flCanEditFolder = (j, f) => managesJournal(S.me.role, j.id) && (f.kind === 'custom' || ['owner', 'admin'].includes(S.me.role));

// ---------- small dialogs ----------
function flAsk(title, label, value = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value, dir: 'auto' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(true); resolve(v); };
    const ok = h('button', { class: 'btn primary', onclick: () => { const v = input.value.trim(); if (v) finish(v); else input.focus(); } }, 'حفظ');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    const close = openModal(title, h('label', { class: 'f' }, h('span', {}, label), input),
      [h('button', { class: 'btn ghost', onclick: () => finish(null) }, 'إلغاء'), ok],
      { beforeClose: () => { if (!done) { done = true; resolve(null); } return true; } });
    document.querySelector('.modal-wrap:last-child .modal')?.classList.add('small');
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

// ---------- actions ----------
async function flLatestVersion(file) {
  if (file.latest) return file.latest;
  const rows = await api.select('file_versions', `file_id=eq.${file.id}&order=version.desc&limit=1`);
  if (!rows.length) throw new api.ApiError('لا توجد نسخة مرفوعة لهذا الملف');
  return rows[0];
}
async function flOpen(file, download = false) {
  const w = download ? null : window.open('', '_blank');
  try {
    const v = await flLatestVersion(file);
    const url = await api.signedUrl(FL_BUCKET, v.path, { download: download ? file.name : null });
    if (w) w.location = url;
    else { const a = h('a', { href: url, download: file.name }); document.body.append(a); a.click(); a.remove(); }
  } catch (e) { w?.close(); toast(e.message, 'err'); }
}

function flObjectPath(jid, name) {
  const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
  return `${jid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext.toLowerCase()}` : ''}`;
}

// Uploads go to the folder; a file with the same name becomes a new version of it.
async function flUpload(j, folder, fileList, panel, redraw) {
  const list = [...fileList];
  if (!list.length) return;
  for (const file of list) {
    const bar = h('span', { class: 'up-bar' });
    const status = h('small', { class: 'muted' }, 'في الانتظار…');
    const item = h('div', { class: 'up-item' }, h('span', { class: 'up-name' }, icon('file', 15), file.name), h('span', { class: 'up-track' }, bar), status);
    if (!panel.querySelector('.up-head')) {
      panel.prepend(h('div', { class: 'up-head' }, h('b', {}, 'رفع الملفات'),
        h('button', { class: 'btn ghost sm icon-btn', title: 'إغلاق', 'aria-label': 'إغلاق', onclick: () => { panel.replaceChildren(); panel.hidden = true; } }, icon('x', 14))));
    }
    panel.append(item); panel.hidden = false;
    try {
      if (file.size > api.MAX_FILE_MB * 1024 * 1024) throw new api.ApiError(`أكبر من ${api.MAX_FILE_MB} ميغابايت`);
      status.textContent = 'جارٍ الرفع…';
      const path = flObjectPath(j.id, file.name);
      await api.uploadPrivate(FL_BUCKET, path, file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; status.textContent = `${Math.round(p * 100)}%`; });
      let row = flFilesIn(folder.id).find((f) => f.name === file.name);
      if (!row) {
        row = await api.insertRow('files', { folder_id: folder.id, journal_id: j.id, name: file.name, issue_id: folder.issue_id ?? null });
        flCache.files.push(row);
      }
      const v = await api.insertRow('file_versions', { file_id: row.id, path, size: file.size, mime: file.type || null });
      item.classList.add('done'); status.textContent = v.version > 1 ? `تم · نسخة ${v.version}` : 'تم';
    } catch (e) {
      item.classList.add('fail'); status.textContent = e.message;
    }
  }
  await flLoad(j.id).catch(() => {});
  redraw();
  setTimeout(() => { for (const el of panel.querySelectorAll('.up-item.done')) el.remove(); if (!panel.querySelector('.up-item')) { panel.replaceChildren(); panel.hidden = true; } }, 5000);
}

async function flNewFolder(j, parent, redraw) {
  const name = await flAsk('مجلد جديد', `داخل «${flFolderLabel(parent)}»`);
  if (!name) return;
  try {
    const row = await api.insertRow('folders', { journal_id: j.id, parent_id: parent.id, name });
    flCache.folders.push(row); S.fileFolder = row.id; redraw();
  } catch (e) { toast(e.message, 'err'); }
}

async function flRename(kind, row, redraw) {
  const name = await flAsk(kind === 'file' ? 'إعادة تسمية الملف' : 'إعادة تسمية المجلد', 'الاسم الجديد', row.name);
  if (!name || name === row.name) return;
  try {
    Object.assign(row, await api.updateRows(kind === 'file' ? 'files' : 'folders', { id: row.id }, { name }));
    toast('تمت إعادة التسمية'); redraw();
  } catch (e) { toast(e.message, 'err'); }
}

async function flTrash(kind, row, redraw) {
  const what = kind === 'file' ? `الملف «${row.name}»` : `المجلد «${row.name}» وكل ما بداخله (${flCount(row.id)} ملف)`;
  if (!window.confirm(`نقل ${what} إلى السلة؟\nيمكن للمالك وحده استعادته.`)) return;
  try {
    await api.rpc('move_to_trash', { p_kind: kind, p_id: row.id });
    if (kind === 'folder' && S.fileFolder === row.id) S.fileFolder = row.parent_id;
    flTrashState.data = null;
    await flLoad(flCache.jid); toast('نُقل إلى السلة'); redraw();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- details: links + versions ----------
const flIsImage = (f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name) || /^image\//.test(f.latest?.mime || '');

async function flAddVersion(file, blob, panel, extra = {}) {
  const path = flObjectPath(file.journal_id, file.name);
  await api.uploadPrivate(FL_BUCKET, path, blob, extra.onProgress);
  return api.insertRow('file_versions', { file_id: file.id, path, size: blob.size, mime: blob.type || null, note: extra.note || null });
}

function flDetails(j, file, redraw) {
  const can = managesJournal(S.me.role, j.id);
  const res = (S.data.researches || []).filter((r) => researchJournal(r) === j.id || r.id === file.research_id)
    .sort((a, b) => a.title.localeCompare(b.title, 'ar'));
  const persons = [...(S.data.persons || [])].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const sel = (rows, val, label) => h('select', { disabled: !can },
    h('option', { value: '' }, '—'), rows.map((r) => h('option', { value: r.id, selected: r.id === val }, label(r))));
  const rSel = sel(res, file.research_id, (r) => r.title);
  const pSel = sel(persons, file.person_id, (p) => p.name);
  const status = h('small', { class: 'muted' });
  const vInput = h('input', { type: 'file', hidden: true });
  const verList = h('div', {});

  const drawVersions = () => {
    const vs = file.versions || [];
    verList.replaceChildren(vs.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple files-table' },
      h('thead', {}, h('tr', {}, ['النسخة', 'التاريخ', 'الحجم', 'بواسطة', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, vs.map((v, i) => h('tr', { class: i === 0 ? 'current' : '' },
        h('td', {}, h('b', {}, `نسخة ${v.version}`), i === 0 ? h('small', { class: 'chip ver' }, 'الحالية') : null, v.note ? h('small', { class: 'muted sub' }, v.note) : null),
        h('td', { class: 'muted' }, flDate(v.created_at)),
        h('td', { class: 'muted' }, flSize(v.size)),
        h('td', { class: 'muted' }, v.created_by ? userName(v.created_by) : ''),
        h('td', { class: 'f-act' },
          h('button', { class: 'btn ghost sm icon-btn', title: 'فتح', 'aria-label': 'فتح', onclick: () => flOpenVersion(file, v) }, icon('eye', 15)),
          h('button', { class: 'btn ghost sm icon-btn', title: 'تنزيل', 'aria-label': 'تنزيل', onclick: () => flOpenVersion(file, v, true) }, icon('download', 15)),
          can && i > 0 ? h('button', {
            class: 'btn sm', title: 'جعل هذه النسخة هي الحالية (تُحفظ كنسخة جديدة)',
            onclick: async () => {
              try {
                await api.insertRow('file_versions', { file_id: file.id, path: v.path, size: v.size, mime: v.mime, note: `استرجاع نسخة ${v.version}` });
                await flRefreshFile(file); drawVersions(); redraw(); toast(`استُرجعت نسخة ${v.version}`);
              } catch (e) { toast(e.message, 'err'); }
            },
          }, icon('restore', 14), 'استرجاع') : null))))))
      : h('p', { class: 'muted' }, 'لا توجد نسخ.'));
  };
  vInput.addEventListener('change', async () => {
    const f = vInput.files[0]; vInput.value = '';
    if (!f) return;
    try {
      status.textContent = 'جارٍ الرفع…';
      await flAddVersion(file, f, null, { onProgress: (p) => { status.textContent = `جارٍ الرفع… ${Math.round(p * 100)}%`; }, note: f.name !== file.name ? `من ملف «${f.name}»` : null });
      await flRefreshFile(file); drawVersions(); redraw(); status.textContent = 'رُفعت نسخة جديدة';
    } catch (e) { status.textContent = ''; toast(e.message, 'err'); }
  });
  drawVersions();

  const save = h('button', {
    class: 'btn primary', disabled: !can,
    onclick: async () => {
      try {
        Object.assign(file, await api.updateRows('files', { id: file.id }, { research_id: Number(rSel.value) || null, person_id: Number(pSel.value) || null }));
        toast('تم الحفظ'); close(true); redraw();
      } catch (e) { toast(e.message, 'err'); }
    },
  }, 'حفظ الربط');
  const close = openModal(file.name, h('div', { class: 'file-details' },
    h('section', {}, h('h4', { class: 'sub' }, 'الربط (اختياري)'),
      h('div', { class: 'form-rows two' },
        h('label', { class: 'f' }, h('span', {}, 'البحث أو المقالة'), rSel),
        h('label', { class: 'f' }, h('span', {}, 'الشخص'), pSel))),
    h('section', {}, h('div', { class: 'section-head' }, h('h4', { class: 'sub' }, 'النسخ'),
      can ? h('button', { class: 'btn', onclick: () => vInput.click() }, icon('upload', 15), 'رفع نسخة جديدة') : null, vInput),
      status, verList)),
  [can ? save : null, h('button', { class: 'btn ghost', onclick: () => close(true) }, 'إغلاق')]);
}

async function flOpenVersion(file, v, download = false) {
  const w = download ? null : window.open('', '_blank');
  try {
    const url = await api.signedUrl(FL_BUCKET, v.path, { download: download ? file.name.replace(/(\.[^.]+)?$/, `-v${v.version}$1`) : null });
    if (w) w.location = url;
    else { const a = h('a', { href: url }); document.body.append(a); a.click(); a.remove(); }
  } catch (e) { w?.close(); toast(e.message, 'err'); }
}

async function flRefreshFile(file) {
  const [row] = await api.select('files', `id=eq.${file.id}`, '*,file_versions(id,version,size,mime,path,note,created_at,created_by)');
  if (!row) return;
  const vs = (row.file_versions || []).sort((a, b) => b.version - a.version);
  delete row.file_versions;
  Object.assign(file, row, { versions: vs, latest: vs[0] || null, size: vs[0]?.size ?? null });
}

// ---------- issue page: cover + files ----------
const flUrlCache = new Map();
async function flThumbUrl(v) {
  const c = flUrlCache.get(v.path);
  if (c && c.exp > Date.now()) return c.url;
  const url = await api.signedUrl(FL_BUCKET, v.path, { expiresIn: 3600 });
  flUrlCache.set(v.path, { url, exp: Date.now() + 50 * 60 * 1000 });
  return url;
}
function flDescFolders(id) { return [id, ...flChildren(id).flatMap((c) => flDescFolders(c.id))]; }

async function flSetCover(folder, file) {
  const ids = new Set(flDescFolders(folder.id));
  for (const f of flCache.files.filter((x) => ids.has(x.folder_id) && x.is_issue_cover && x.id !== file.id)) {
    await api.updateRows('files', { id: f.id }, { is_issue_cover: false }); f.is_issue_cover = false;
  }
  Object.assign(file, await api.updateRows('files', { id: file.id }, { is_issue_cover: true }));
}

// Cover element for an issue (image if a cover file exists, else the colored number)
function issueCover(j, issue, fallback) {
  const box = h('div', { class: 'issue-cover' }, fallback);
  if (!managesJournal(S.me.role, j.id)) return box;
  if (!flEnsure(j.id, renderShell)) return box;
  const folder = flIssueFolder(issue.id);
  if (!folder) return box;
  const ids = new Set(flDescFolders(folder.id));
  const cover = flCache.files.find((f) => ids.has(f.folder_id) && f.is_issue_cover && f.latest);
  if (cover) {
    const img = h('img', { class: 'cover-img', alt: `غلاف العدد ${issue.number}` });
    flThumbUrl(cover.latest).then((u) => { img.src = u; }).catch(() => {});
    box.replaceChildren(img);
  }
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files[0]; input.value = '';
    if (!f) return;
    try {
      toast('جارٍ رفع الغلاف…');
      const name = `غلاف العدد ${issue.number}.${(f.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase()}`;
      const path = flObjectPath(j.id, name);
      await api.uploadPrivate(FL_BUCKET, path, f);
      let row = flFilesIn(folder.id).find((x) => x.name === name);
      if (!row) row = await api.insertRow('files', { folder_id: folder.id, journal_id: j.id, name, issue_id: issue.id });
      await api.insertRow('file_versions', { file_id: row.id, path, size: f.size, mime: f.type || null });
      flCache.files.push(row);
      await flSetCover(folder, row);
      await flLoad(j.id); toast('تم تحديث الغلاف'); renderShell();
    } catch (e) { toast(e.message, 'err'); }
  });
  box.append(h('button', { class: 'btn sm cover-btn', onclick: () => input.click() }, icon('camera', 14), cover ? 'تغيير الغلاف' : 'رفع غلاف'), input);
  return box;
}

// Card listing the issue folder's files, with upload
function issueFilesCard(j, issue, go) {
  if (!managesJournal(S.me.role, j.id)) return null;
  const card = h('section', { class: 'card' }, h('h3', {}, 'ملفات العدد'));
  if (!flEnsure(j.id, renderShell)) { card.append(h('p', { class: 'muted' }, 'جارٍ التحميل…')); return card; }
  const folder = flIssueFolder(issue.id);
  if (!folder) { card.append(h('p', { class: 'muted' }, 'لا يوجد مجلد لهذا العدد.')); return card; }
  if (!flPanel) flPanel = h('div', { class: 'upload-panel', hidden: true });
  const ids = new Set(flDescFolders(folder.id));
  const files = flCache.files.filter((f) => ids.has(f.folder_id)).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { flUpload(j, folder, input.files, flPanel, renderShell); input.value = ''; } });
  const act = (ic, label, fn) => h('button', { class: 'btn ghost sm icon-btn', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 15));
  card.append(
    h('div', { class: 'files-tools' },
      h('button', { class: 'btn primary', onclick: () => input.click() }, icon('upload', 16), 'رفع ملفات للعدد'),
      h('button', { class: 'btn', onclick: () => go({ journalTab: 'files', issueId: null, fileFolderIssue: issue.id }) }, icon('folder', 16), 'فتح مجلد العدد'), input),
    files.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple files-table' },
      h('tbody', {}, files.map((f) => h('tr', { class: 'clickable', onclick: () => flOpen(f) },
        h('td', {}, h('span', { class: 'f-name' }, icon('file', 16), f.name,
          f.is_issue_cover ? h('small', { class: 'chip ver' }, 'الغلاف') : null,
          f.current_version > 1 ? h('small', { class: 'chip ver' }, `نسخة ${f.current_version}`) : null),
          f.folder_id !== folder.id ? h('small', { class: 'muted sub' }, flFolder(f.folder_id)?.name) : null),
        h('td', { class: 'muted' }, flSize(f.size)),
        h('td', { class: 'f-act' },
          flIsImage(f) && !f.is_issue_cover ? act('camera', 'تعيين كغلاف للعدد', async () => { try { await flSetCover(folder, f); toast('تم تعيين الغلاف'); renderShell(); } catch (e) { toast(e.message, 'err'); } }) : null,
          act('layers', 'النسخ والتفاصيل', () => flDetails(j, f, renderShell)),
          act('download', 'تنزيل', () => flOpen(f, true))))))))
      : h('p', { class: 'muted' }, 'لا توجد ملفات بعد. اسحبها وأفلتها هنا أو اضغط «رفع ملفات للعدد».'),
    flPanel);
  card.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); card.classList.add('drag'); } });
  card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('drag'); });
  card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('drag'); flUpload(j, folder, e.dataTransfer.files, flPanel, renderShell); });
  return card;
}

// ---------- linked files inside the research / person window ----------
const FL_COLS = '*,file_versions(id,version,size,mime,path,note,created_at,created_by),folder:folders(name,issue_id)';
function flNormalize(f) {
  const vs = (f.file_versions || []).sort((a, b) => b.version - a.version);
  delete f.file_versions;
  return Object.assign(f, { versions: vs, latest: vs[0] || null, size: vs[0]?.size ?? null });
}

function linkedFilesSection(table, row) {
  if (!['owner', 'admin', 'editor'].includes(S.me.role) || !row?.id) return null;
  const col = table === 'researches' ? 'research_id' : table === 'persons' ? 'person_id' : null;
  if (!col) return null;
  const list = h('div', { class: 'linked-files' }, h('p', { class: 'muted' }, 'جارٍ التحميل…'));
  const sec = h('section', { class: 'form-section' }, h('h4', {}, 'الملفات المرتبطة'), list);
  const issue = table === 'researches' && row.pub?.kind === 'article' ? S.byId.issues?.get(row.pub.issue_id) : null;
  const canUpload = issue && managesJournal(S.me.role, issue.journal_id);
  const status = h('small', { class: 'muted' });
  const input = h('input', { type: 'file', multiple: true, hidden: true });
  input.addEventListener('input', (e) => e.stopPropagation());

  const draw = async () => {
    let files = [];
    try { files = (await api.select('files', `${col}=eq.${row.id}&deleted_at=is.null&order=name`, FL_COLS)).map(flNormalize); } catch (e) { list.replaceChildren(h('p', { class: 'form-err' }, e.message)); return; }
    const act = (ic, label, fn) => h('button', { type: 'button', class: 'btn ghost sm icon-btn', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 15));
    list.replaceChildren(
      files.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple files-table' },
        h('tbody', {}, files.map((f) => h('tr', { class: 'clickable', onclick: () => flOpen(f) },
          h('td', {}, h('span', { class: 'f-name' }, icon('file', 16), f.name,
            f.current_version > 1 ? h('small', { class: 'chip ver' }, `نسخة ${f.current_version}`) : null),
            h('small', { class: 'muted sub' }, [displayOf('journals', f.journal_id), f.folder?.name].filter(Boolean).join(' › '))),
          h('td', { class: 'muted' }, flSize(f.size)),
          h('td', { class: 'f-act' }, act('eye', 'فتح', () => flOpen(f)), act('download', 'تنزيل', () => flOpen(f, true))))))))
        : h('p', { class: 'muted' }, canUpload
          ? 'لا توجد ملفات مرتبطة بعد. ارفع ملف المقالة هنا، فيُحفظ في مجلد عددها ويرتبط بها.'
          : 'لا توجد ملفات مرتبطة. يمكن ربط أي ملف من نافذة «النسخ والتفاصيل» في تبويب الملفات.'),
      canUpload ? h('div', { class: 'files-tools' }, h('button', { type: 'button', class: 'btn', onclick: () => input.click() }, icon('upload', 15), 'رفع ملف لهذه المقالة'), status, input) : '');
  };

  input.addEventListener('change', async (e) => {
    e.stopPropagation();
    const chosen = [...input.files]; input.value = '';
    if (!chosen.length) return;
    try {
      const [folder] = await api.select('folders', `issue_id=eq.${issue.id}&kind=eq.issue&deleted_at=is.null`);
      if (!folder) throw new api.ApiError('لا يوجد مجلد لهذا العدد');
      for (const file of chosen) {
        const path = flObjectPath(issue.journal_id, file.name);
        await api.uploadPrivate(FL_BUCKET, path, file, (p) => { status.textContent = `${file.name}: ${Math.round(p * 100)}%`; });
        const [same] = await api.select('files', `folder_id=eq.${folder.id}&name=eq.${encodeURIComponent(file.name)}&deleted_at=is.null`);
        const f = same || await api.insertRow('files', { folder_id: folder.id, journal_id: issue.journal_id, name: file.name, issue_id: issue.id, research_id: row.id });
        if (same && !same.research_id) await api.updateRows('files', { id: same.id }, { research_id: row.id });
        await api.insertRow('file_versions', { file_id: f.id, path, size: file.size, mime: file.type || null });
      }
      status.textContent = 'تم الرفع'; flReset(); draw();
    } catch (e) { status.textContent = ''; toast(e.message, 'err'); }
  });
  draw();
  return sec;
}

// Small cover image for issue cards (falls back to the colored number)
function issueThumb(issue, fallback) {
  if (!managesJournal(S.me.role, issue.journal_id)) return fallback;
  if (!flEnsure(issue.journal_id, renderShell) || flCache.jid !== issue.journal_id) return fallback;
  const folder = flIssueFolder(issue.id);
  if (!folder) return fallback;
  const ids = new Set(flDescFolders(folder.id));
  const cover = flCache.files.find((f) => ids.has(f.folder_id) && f.is_issue_cover && f.latest);
  if (!cover) return fallback;
  const img = h('img', { class: 'issue-thumb', alt: `غلاف العدد ${issue.number}` });
  flThumbUrl(cover.latest).then((u) => { img.src = u; }).catch(() => img.replaceWith(fallback));
  return img;
}

// ---------- owner trash page ----------
const flTrashState = { loading: null, data: null };
async function flLoadTrash() {
  const [folders, files] = await Promise.all([
    api.select('folders', 'order=deleted_at.desc.nullslast'),
    api.select('files', 'deleted_at=not.is.null&order=deleted_at.desc', '*,file_versions(size)'),
  ]);
  flTrashState.data = { folders, files };
}
function renderTrash(main) {
  main.replaceChildren(h('div', { class: 'toolbar' }, h('h1', {}, icon('trash', 22), 'السلة'),
    h('button', { class: 'btn', onclick: () => { flTrashState.data = null; renderShell(); } }, icon('restore', 15), 'تحديث')));
  const body = h('div', { class: 'journal-scroll' });
  main.append(body);
  if (!flTrashState.data) {
    body.append(h('p', { class: 'muted pad' }, 'جارٍ التحميل…'));
    if (!flTrashState.loading) flTrashState.loading = flLoadTrash().catch((e) => toast(e.message, 'err')).finally(() => { flTrashState.loading = null; if (S.view === 'trash') renderShell(); });
    return;
  }
  const { folders, files } = flTrashState.data;
  const byId = new Map(folders.map((f) => [f.id, f]));
  // show only the items that were trashed directly (not those trashed along with their folder)
  const roots = [
    ...folders.filter((f) => f.deleted_at && !(byId.get(f.parent_id)?.deleted_at === f.deleted_at)).map((f) => ({ kind: 'folder', row: f })),
    ...files.filter((f) => !(byId.get(f.folder_id)?.deleted_at === f.deleted_at)).map((f) => ({ kind: 'file', row: f })),
  ].sort((a, b) => String(b.row.deleted_at).localeCompare(String(a.row.deleted_at)));
  const where = (fid) => { const out = []; for (let f = byId.get(fid); f; f = byId.get(f.parent_id)) out.unshift(f.name); return out.join(' › '); };
  const inside = (fid) => {
    const ids = new Set([fid]); let grow = true;
    while (grow) { grow = false; for (const f of folders) if (!ids.has(f.id) && ids.has(f.parent_id)) { ids.add(f.id); grow = true; } }
    return files.filter((f) => ids.has(f.folder_id)).length;
  };
  const reload = async () => { flTrashState.data = null; flReset(); renderShell(); };
  const restore = async (it) => {
    try { await api.rpc('restore_from_trash', { p_kind: it.kind, p_id: it.row.id }); toast('تمت الاستعادة'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const purge = async (it) => {
    if (!window.confirm(`حذف «${it.row.name}» نهائياً${it.kind === 'folder' ? ' مع كل ما بداخله' : ''}؟\nلا يمكن التراجع عن هذا.`)) return;
    try {
      const paths = await api.rpc('trash_paths', { p_kind: it.kind, p_id: it.row.id });
      if (paths?.length) await api.storageRemove(FL_BUCKET, paths);
      await api.rpc('purge_from_trash', { p_kind: it.kind, p_id: it.row.id });
      toast('حُذف نهائياً'); reload();
    } catch (e) { toast(/purge_from_trash/.test(e.message) ? 'دالة الحذف النهائي غير مثبّتة بعد في القاعدة' : e.message, 'err'); }
  };
  body.append(h('div', { class: 'journal-page' },
    h('p', { class: 'muted' }, 'ما ينقله أي مستخدم إلى السلة يظهر هنا لك وحدك. «استعادة» تعيده إلى مكانه، و«حذف نهائي» يمحوه من القاعدة ومن التخزين.'),
    roots.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple files-table' },
      h('thead', {}, h('tr', {}, ['الاسم', 'المجلة', 'المكان', 'حُذف في', 'بواسطة', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, roots.map((it) => h('tr', {},
        h('td', {}, h('span', { class: 'f-name' }, icon(it.kind === 'folder' ? 'folder' : 'file', 16), it.row.name,
          it.kind === 'folder' ? h('small', { class: 'muted' }, ` (${inside(it.row.id)} ملف)`) : null)),
        h('td', {}, h('span', { class: chipClass('journals', it.row.journal_id) }, displayOf('journals', it.row.journal_id))),
        h('td', { class: 'muted' }, where(it.kind === 'folder' ? it.row.parent_id : it.row.folder_id) || '—'),
        h('td', { class: 'muted' }, flDate(it.row.deleted_at)),
        h('td', { class: 'muted' }, it.row.deleted_by ? userName(it.row.deleted_by) : ''),
        h('td', { class: 'f-act' },
          h('button', { class: 'btn sm', onclick: () => restore(it) }, icon('restore', 14), 'استعادة'),
          h('button', { class: 'btn sm danger', onclick: () => purge(it) }, icon('trash', 14), 'حذف نهائي')))))))
      : h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, 'السلة فارغة.'))));
}

// ---------- view ----------
function flTree(j, current, redraw) {
  const open = new Set(flPath(current).map((f) => f.id));
  const node = (f, depth) => {
    const kids = flChildren(f.id);
    const isOpen = open.has(f.id) || depth === 0;
    return h('li', {},
      h('button', {
        class: `tree-item ${f.id === current ? 'on' : ''} k-${f.kind}`, style: `padding-inline-start:${8 + depth * 14}px`,
        onclick: () => { S.fileFolder = f.id; redraw(); },
        ondragover: (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
        ondragleave: (e) => e.currentTarget.classList.remove('drop'),
        ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); S.fileFolder = f.id; flDropTo(j, f, e.dataTransfer.files, redraw); },
      }, kids.length ? h('span', { class: `caret ${isOpen ? 'open' : ''}` }, icon('chevron', 12)) : h('span', { class: 'caret' }),
      icon('folder', 15), h('span', { class: 'tl' }, flFolderLabel(f)),
      flCount(f.id) ? h('small', { class: 'tree-n' }, flCount(f.id)) : null),
      kids.length && isOpen ? h('ul', {}, kids.map((c) => node(c, depth + 1))) : null);
  };
  return h('nav', { class: 'files-tree', 'aria-label': 'المجلدات' }, h('ul', {}, flChildren(null).map((f) => node(f, 0))));
}

let flPanel = null;
function flDropTo(j, folder, files, redraw) {
  if (!managesJournal(S.me.role, j.id)) { toast('ليس لديك صلاحية للرفع إلى هذه المجلة', 'err'); return; }
  flUpload(j, folder, files, flPanel, redraw);
}

function flMain(j, current, redraw) {
  const folder = flFolder(current);
  const can = managesJournal(S.me.role, j.id);
  const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { flDropTo(j, folder, input.files, redraw); input.value = ''; } });
  const crumbs = h('div', { class: 'crumbs' },
    h('button', { class: 'crumb', onclick: () => { S.fileFolder = null; redraw(); } }, `ملفات ${j.name}`),
    flPath(current).map((f) => [h('span', { class: 'sep' }, '›'), h('button', { class: 'crumb', onclick: () => { S.fileFolder = f.id; redraw(); } }, flFolderLabel(f))]));
  const tools = h('div', { class: 'files-tools' },
    can && folder ? h('button', { class: 'btn', onclick: () => flNewFolder(j, folder, redraw) }, icon('folderPlus', 16), 'مجلد جديد') : null,
    can && folder ? h('button', { class: 'btn primary', onclick: () => input.click() }, icon('upload', 16), 'رفع ملفات') : null,
    input);

  const subs = flChildren(current); const files = folder ? flFilesIn(folder.id) : [];
  const act = (ic, label, fn, cls = '') => h('button', { class: `btn ghost sm icon-btn ${cls}`, title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 15));
  const rows = [
    ...subs.map((f) => h('tr', { class: 'clickable', ondblclick: () => { S.fileFolder = f.id; redraw(); }, onclick: () => { S.fileFolder = f.id; redraw(); } },
      h('td', {}, h('span', { class: `f-name k-${f.kind}` }, icon('folder', 17), flFolderLabel(f))),
      h('td', { class: 'muted' }, `${flCount(f.id)} ملف`),
      h('td', {}), h('td', {}),
      h('td', { class: 'f-act' }, flCanEditFolder(j, f) ? [act('pencil', 'إعادة تسمية', () => flRename('folder', f, redraw)), act('trash', 'نقل إلى السلة', () => flTrash('folder', f, redraw), 'danger')] : null))),
    ...files.map((f) => h('tr', { class: 'clickable', onclick: () => flOpen(f) },
      h('td', {}, h('span', { class: 'f-name' }, icon('file', 17), f.name, f.current_version > 1 ? h('small', { class: 'chip ver' }, `نسخة ${f.current_version}`) : null,
        f.research_id ? h('small', { class: 'chip ver link' }, displayOf('researches', f.research_id)) : null,
        f.person_id ? h('small', { class: 'chip ver link' }, displayOf('persons', f.person_id)) : null)),
      h('td', { class: 'muted' }, flSize(f.size)),
      h('td', { class: 'muted' }, flDate(f.updated_at || f.created_at)),
      h('td', { class: 'muted' }, (f.updated_by || f.created_by) ? userName(f.updated_by || f.created_by) : ''),
      h('td', { class: 'f-act' },
        act('eye', 'فتح', () => flOpen(f)), act('download', 'تنزيل', () => flOpen(f, true)),
        act('layers', 'النسخ والتفاصيل', () => flDetails(j, f, redraw)),
        can ? [act('pencil', 'إعادة تسمية', () => flRename('file', f, redraw)), act('trash', 'نقل إلى السلة', () => flTrash('file', f, redraw), 'danger')] : null))),
  ];

  const body = rows.length
    ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple files-table' },
      h('thead', {}, h('tr', {}, ['الاسم', 'الحجم', 'آخر تعديل', 'بواسطة', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows)))
    : h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, folder ? 'هذا المجلد فارغ.' : 'لا توجد مجلدات.'));

  const zone = h('div', { class: 'files-main' }, crumbs, tools, body,
    can && folder ? h('p', { class: 'drop-hint muted' }, icon('upload', 15), `اسحب الملفات وأفلتها هنا للرفع إلى «${folder.name}». الحد ${api.MAX_FILE_MB} ميغابايت للملف. الملف بنفس الاسم يُحفظ نسخة جديدة.`) : null,
    !folder ? h('p', { class: 'muted' }, 'اختر مجلداً لعرض ملفاته أو للرفع إليه.') : null);
  if (can && folder) {
    zone.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); zone.classList.add('drag'); } });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag'); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag'); flDropTo(j, folder, e.dataTransfer.files, redraw); });
  }
  return zone;
}

// Files tab of a journal. Renders into its own container and redraws itself.
function filesTab(j) {
  const box = h('div', { class: 'files-page' });
  if (!flPanel) flPanel = h('div', { class: 'upload-panel', hidden: true });
  const redraw = () => {
    if (!flEnsure(j.id, redraw)) { box.replaceChildren(h('p', { class: 'muted pad' }, 'جارٍ تحميل الملفات…')); return; }
    if (flCache.error) { box.replaceChildren(h('p', { class: 'form-err pad' }, flCache.error)); return; }
    if (S.fileFolderIssue) { S.fileFolder = flIssueFolder(S.fileFolderIssue)?.id ?? S.fileFolder; S.fileFolderIssue = null; }
    if (S.fileFolder != null && !flFolder(S.fileFolder)) S.fileFolder = null;
    box.replaceChildren(flTree(j, S.fileFolder, redraw), flMain(j, S.fileFolder, redraw), flPanel);
  };
  redraw();
  return box;
}

// «مجلتي»: a journal's own space — overview, issues (one page per issue), people, files.
// Articles come from center_publications (kind = article) through their issue. Books are not part of journals.




const TABS = [['overview', 'نظرة عامة', 'chart'], ['issues', 'الأعداد', 'journal'], ['people', 'الأشخاص', 'users'], ['files', 'الملفات', 'folder']];
const PEOPLE_LINKS = [
  { key: 'researchers', label: 'باحث', via: 'research_researchers', self: 'research_id', other: 'person_id' },
  { key: 'translators', label: 'مترجم', via: 'research_translators', self: 'research_id', other: 'person_id' },
];

function myJournals() {
  const role = S.me.role;
  if (role === 'owner' || role === 'admin') return S.data.journals || [];
  const mine = new Set((S.data.journal_editors || []).filter((j) => j.user_id === S.me.id).map((j) => j.journal_id));
  return (S.data.journals || []).filter((j) => mine.has(j.id));
}
const journalNavVisible = () => ['owner', 'admin', 'editor'].includes(S.me.role) && myJournals().length > 0;

function currentJournal() {
  const list = myJournals();
  const saved = lsGet('tajdid_journal', null);
  return list.find((j) => j.id === saved) || list[0] || null;
}

const issuesOf = (jid) => (S.data.issues || []).filter((i) => i.journal_id === jid)
  .sort((a, b) => (b.year || 0) - (a.year || 0) || b.number - a.number);
const articlesOf = (iid) => (S.data.researches || []).filter((r) => isArticle(r) && r.pub.issue_id === iid)
  .sort((a, b) => (a.pub.issue_order ?? 1e9) - (b.pub.issue_order ?? 1e9) || (a.pub.start_page ?? 1e9) - (b.pub.start_page ?? 1e9) || a.title.localeCompare(b.title, 'ar'));
// Articles published in a journal (through its issues)
function researchesOf(jid) {
  const iids = new Set(issuesOf(jid).map((i) => i.id));
  return (S.data.researches || []).filter((r) => isArticle(r) && iids.has(r.pub.issue_id));
}
// Submissions to a journal still in progress (not rejected, not yet published)
const rejectedOf = (jid) => (S.data.researches || []).filter((r) => r.sub && r.sub.journal_id === jid && r.sub.stage === 'rejected');
const inProgressOf = (jid) => (S.data.researches || []).filter((r) => r.sub && r.sub.journal_id === jid && !r.pub && r.sub.stage !== 'rejected');
const names = (ref, ids) => ids.map((id) => displayOf(ref, id)).join('، ');
const personNames = (rid, via) => names('persons', linkedIds({ via, self: 'research_id', other: 'person_id' }, rid));

function go(state) { Object.assign(S, state); renderShell(); }

// ---------- header ----------
function header(j) {
  const list = myJournals();
  // more than one journal → a row of colored journal buttons with their issue counts
  const title = list.length > 1
    ? h('div', { class: 'journal-pills', role: 'tablist', 'aria-label': 'اختيار المجلة' }, list.map((x) => h('button', {
      class: `${chipClass('journals', x.id)} big pill ${x.id === j.id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(x.id === j.id),
      title: `${x.name}: ${issuesOf(x.id).length} عدد`,
      onclick: () => { lsSet('tajdid_journal', x.id); go({ issueId: null }); },
    }, x.name, h('small', { class: 'chip-count' }, issuesOf(x.id).length))))
    : h('span', { class: `${chipClass('journals', j.id)} big` }, j.name);
  const staff = ['owner', 'admin'].includes(S.me.role);
  return h('div', { class: 'toolbar journal-bar' },
    h('h1', {}, icon('journal', 22), title),
    j.frequency ? h('span', { class: 'chip soft freq' }, `دورية ${FREQUENCIES[j.frequency]}`) : null,
    staff ? h('button', { class: 'btn sm', title: 'اسم المجلة ودوريتها', onclick: () => openRecord('journals', j, 'frequency') }, 'بيانات المجلة') : null,
    h('nav', { class: 'tabs', role: 'tablist' }, TABS.filter(([k]) => k !== 'files' || managesJournal(S.me.role, j.id)).map(([k, label, ic]) => h('button', {
      class: `tab ${(S.journalTab || 'overview') === k && !S.issueId ? 'on' : ''}`, role: 'tab',
      onclick: () => go({ journalTab: k, issueId: null }),
    }, icon(ic, 16), label))));
}

// ---------- overview ----------
function overview(j) {
  const issues = issuesOf(j.id); const all = researchesOf(j.id);
  const articles = all;
  const people = (via) => new Set((S.data[via] || []).filter((l) => all.some((r) => r.id === l.research_id)).map((l) => l.person_id)).size;
  const tile = (n, l) => h('div', { class: 'tile' }, h('span', { class: 'tile-n' }, n), h('span', { class: 'tile-l' }, l));
  const latest = issues[0];
  return h('div', { class: 'journal-page' },
    h('div', { class: 'tiles' },
      tile(issues.length, 'عدد'), tile(articles.length, 'مقالة منشورة'),
      tile(people('research_researchers'), 'باحث'), tile(people('research_translators'), 'مترجم'),
      seesSubmissions(S.me.role) ? tile(inProgressOf(j.id).length, 'استلام قيد العمل') : null,
      seesSubmissions(S.me.role) ? tile(rejectedOf(j.id).length, 'مرفوض') : null),
    h('div', { class: 'cards' },
      h('section', { class: 'card' }, h('h3', {}, 'آخر الأعداد'),
        issues.length
          ? h('div', { class: 'issue-list compact' }, issues.slice(0, 5).map((i) => issueCard(i)))
          : emptyIssues(j)),
      latest ? h('section', { class: 'card' }, h('h3', {}, `مقالات ${latest.label}`),
        articleTable(latest, articlesOf(latest.id))) : null));
}

function emptyIssues(j) {
  return h('div', { class: 'empty-state' },
    h('p', { class: 'muted' }, 'لا توجد أعداد بعد.'),
    managesJournal(S.me.role, j.id) ? h('button', { class: 'btn primary', onclick: () => newIssue(j) }, icon('plus', 16), 'إضافة أول عدد') : null);
}

// Suggest the next number, and the next period & year by the journal's frequency
function nextIssueDefaults(j) {
  const list = issuesOf(j.id);
  const last = list.reduce((a, i) => (!a || i.number > a.number ? i : a), null);
  const now = new Date();
  const out = { journal_id: j.id, number: (last?.number || 0) + 1, year: now.getFullYear(), period: null };
  const seq = PERIODS[j.frequency];
  if (!seq) { if (last?.year && last.year > out.year) out.year = last.year; return out; }
  const idx = last ? seq.indexOf(last.period) : -1;
  if (idx >= 0) {
    out.period = seq[(idx + 1) % seq.length];
    out.year = (last.year || out.year) + (idx + 1 === seq.length ? 1 : 0);
  } else out.period = periodOfDate(j.frequency, now);
  return out;
}
function newIssue(j) {
  openRecord('issues', null, 'number', nextIssueDefaults(j));
}

// ---------- issues ----------
function issueCard(i) {
  const n = articlesOf(i.id).length;
  return h('button', { class: 'issue-card', onclick: () => go({ journalTab: 'issues', issueId: i.id }) },
    issueThumb(i, h('span', { class: `issue-num ${chipClass('journals', i.journal_id).replace('chip ', '')}` }, i.number)),
    h('span', { class: 'issue-meta' },
      h('b', {}, `العدد ${i.number}${issueWhen(i) ? ` · ${issueWhen(i)}` : ''}`),
      h('small', { class: 'muted' }, [i.title, `${n} مقالة`].filter(Boolean).join(' · '))));
}

function issuesTab(j) {
  const issues = issuesOf(j.id);
  return h('div', { class: 'journal-page' },
    h('div', { class: 'section-head' },
      h('h2', {}, `أعداد ${j.name}`),
      managesJournal(S.me.role, j.id) ? h('button', { class: 'btn primary', onclick: () => newIssue(j) }, icon('plus', 16), 'عدد جديد') : null),
    issues.length ? h('div', { class: 'issue-list' }, issues.map(issueCard)) : emptyIssues(j));
}

function articleTable(issue, rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'لا توجد مقالات في هذا العدد بعد.');
  return h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple' },
    h('thead', {}, h('tr', {}, ['#', 'عنوان المقالة', 'الباحثون', 'المترجمون', 'الصفحات'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((r, idx) => h('tr', { class: 'clickable', onclick: () => openRecord('researches', r) },
      h('td', { class: 'num' }, r.pub.issue_order ?? idx + 1),
      h('td', {}, h('b', {}, r.title)),
      h('td', {}, personNames(r.id, 'research_researchers') || h('span', { class: 'muted' }, '—')),
      h('td', {}, personNames(r.id, 'research_translators') || h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' }, r.pub.start_page ? `${r.pub.start_page}${r.pub.end_page ? `–${r.pub.end_page}` : ''}` : '—'))))));
}

function issuePage(j, issue) {
  const rows = articlesOf(issue.id);
  const pages = rows.reduce((s, r) => s + (r.pub.end_page && r.pub.start_page ? r.pub.end_page - r.pub.start_page + 1 : 0), 0);
  const canEdit = canEditRow(S.me.role, S.me.id, 'issues', issue);
  return h('div', { class: 'journal-page' },
    h('button', { class: 'btn ghost back', onclick: () => go({ issueId: null, journalTab: 'issues' }) }, '→ كل الأعداد'),
    h('div', { class: 'issue-head card' },
      issueCover(j, issue, h('span', { class: `issue-num big ${chipClass('journals', j.id).replace('chip ', '')}` }, issue.number)),
      h('div', { class: 'issue-info' },
        h('h2', {}, `${j.name} · العدد ${issue.number}${issueWhen(issue) ? ` · ${issueWhen(issue)}` : ''}`),
        issue.title ? h('p', { class: 'issue-title' }, issue.title) : null,
        h('p', { class: 'muted' }, [`${rows.length} مقالة`, pages ? `${pages} صفحة` : null].filter(Boolean).join(' · ')),
        issue.isbn ? h('p', { class: 'issue-isbn' }, 'ISBN ', h('span', { dir: 'ltr' }, issue.isbn)) : null,
        issue.notes ? h('p', {}, issue.notes) : null,
        h('div', { class: 'row-actions' },
          canInsert(S.me.role, 'researches') && managesJournal(S.me.role, j.id)
            ? h('button', { class: 'btn primary', onclick: () => openRecord('researches', null, 'title', { pub: { kind: 'article', issue_id: issue.id, issue_order: rows.length + 1 } }) }, icon('plus', 16), 'مقالة جديدة في هذا العدد') : null,
          canEdit ? h('button', { class: 'btn', onclick: () => openRecord('issues', issue) }, 'تعديل بيانات العدد') : null))),
    h('section', { class: 'card' }, h('h3', {}, 'المقالات حسب ترتيبها في العدد'), articleTable(issue, rows)),
    issueFilesCard(j, issue, go));
}

// ---------- people ----------
function peopleTab(j) {
  const all = researchesOf(j.id); const ids = new Set(all.map((r) => r.id));
  const people = new Map();
  for (const pl of PEOPLE_LINKS) {
    for (const l of S.data[pl.via] || []) {
      if (!ids.has(l.research_id)) continue;
      const p = people.get(l.person_id) || { id: l.person_id, roles: new Set(), works: new Set() };
      p.roles.add(pl.label); p.works.add(l.research_id); people.set(l.person_id, p);
    }
  }
  const rows = [...people.values()].sort((a, b) => b.works.size - a.works.size || displayOf('persons', a.id).localeCompare(displayOf('persons', b.id), 'ar'));
  return h('div', { class: 'journal-page' },
    h('div', { class: 'section-head' }, h('h2', {}, `الباحثون والمترجمون في ${j.name}`)),
    rows.length
      ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple' },
        h('thead', {}, h('tr', {}, ['الاسم', 'الصفة', 'عدد الأعمال', 'الأعداد'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((p) => {
          const issueNums = [...new Set(all.filter((r) => p.works.has(r.id)).map((r) => S.byId.issues.get(r.pub.issue_id)?.number))].sort((a, b) => a - b);
          return h('tr', { class: 'clickable', onclick: () => openRecord('persons', S.byId.persons.get(p.id)) },
            h('td', {}, h('b', {}, displayOf('persons', p.id)), h('small', { class: 'muted sub' }, subtitleOf('persons', p.id))),
            h('td', {}, [...p.roles].join('، ')),
            h('td', { class: 'num' }, p.works.size),
            h('td', {}, issueNums.map((n) => h('span', { class: 'chip' }, `ع ${n}`))));
        }))))
      : h('p', { class: 'muted' }, 'لا يوجد أشخاص مرتبطون بأعمال هذه المجلة بعد.'));
}

function renderJournal(main) {
  const j = currentJournal();
  if (!j) { main.replaceChildren(h('div', { class: 'toolbar' }, h('h1', {}, 'مجلتي')), h('p', { class: 'muted pad' }, 'لم تُربط بأي مجلة بعد. اطلب من المالك ربطك بمجلتك من صفحة المستخدمين.')); return; }
  const issue = S.issueId ? S.byId.issues?.get(S.issueId) : null;
  if (issue && issue.journal_id !== j.id) S.issueId = null;
  const tab = S.journalTab || 'overview';
  let body;
  if (S.issueId && issue) body = issuePage(j, issue);
  else if (tab === 'issues') body = issuesTab(j);
  else if (tab === 'people') body = peopleTab(j);
  else if (tab === 'files' && managesJournal(S.me.role, j.id)) body = filesTab(j);
  else body = overview(j);
  main.replaceChildren(header(j), h('div', { class: 'journal-scroll' }, body));
}


boot();
})();