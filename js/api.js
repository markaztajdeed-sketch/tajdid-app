// Thin Supabase client (Auth + PostgREST) — no external dependencies.
export const SUPABASE_URL = 'https://eewfgudrudeiaoiazxap.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_0sagFk33_z9rKVdp1dF3fg_qxDTUFrf';

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

export function getSession() { return session; }

// ---------- error translation ----------
export class ApiError extends Error {}

function translateError(body, status) {
  const msg = (body && (body.message || body.msg || body.error_description || body.error)) || '';
  const code = body && body.code;
  if (/Invalid login credentials/i.test(msg)) return 'البريد الإلكتروني أو كلمة السر غير صحيحة';
  if (/Email not confirmed/i.test(msg)) return 'لم يتم تأكيد البريد الإلكتروني بعد. افتح الرسالة التي وصلتك واضغط على رابط التأكيد';
  if (/User already registered/i.test(msg)) return 'هذا البريد مسجّل مسبقاً';
  if (/Password should be at least/i.test(msg)) return 'كلمة السر قصيرة جداً (6 أحرف على الأقل)';
  if (/rate limit/i.test(msg)) return 'محاولات كثيرة، يرجى الانتظار قليلاً ثم إعادة المحاولة';
  if (code === '42501' || /row-level security/i.test(msg)) return 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
  if (code === '23503') return 'لا يمكن تنفيذ العملية لأن هذا السجل مرتبط بسجلات أخرى';
  if (code === '23505') return 'هذه القيمة موجودة مسبقاً (لا يُسمح بالتكرار)';
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

export async function signIn(email, password) {
  return storeAuth(await authFetch('token?grant_type=password', { email, password }));
}

export async function signUp(email, password, fullName) {
  return authFetch('signup', {
    email, password, data: { full_name: fullName },
  });
}

export async function recoverPassword(email) {
  return authFetch(`recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email });
}

export async function updatePassword(password) {
  return authFetch('user', { password }, 'PUT', true);
}

export async function signOut() {
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
export async function consumeUrlSession() {
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

export async function selectAll(table, order = 'id') {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const page = await rest(`${enc(table)}?select=*${order ? `&order=${order}` : ''}`, {
      headers: { Range: `${from}-${from + size - 1}`, 'Range-Unit': 'items' },
    });
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

export async function insertRow(table, values) {
  const rows = await rest(enc(table), {
    method: 'POST', body: values, headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لتنفيذ هذا الإجراء');
  return rows[0];
}

export async function updateRows(table, match, values) {
  const rows = await rest(`${enc(table)}?${filterQs(match)}`, {
    method: 'PATCH', body: values, headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لتعديل هذا السجل');
  return rows[0];
}

export async function deleteRows(table, match) {
  const rows = await rest(`${enc(table)}?${filterQs(match)}`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!rows || !rows.length) throw new ApiError('ليس لديك صلاحية لحذف هذا السجل');
  return rows;
}

// ---------- Storage ----------
export async function uploadPublic(bucket, path, blob, retry = true) {
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
export async function checkPassword(email, password) {
  try { await authFetch('token?grant_type=password', { email, password }); return true; } catch { return false; }
}
