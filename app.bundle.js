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

async function selectAll(table, order = 'id') {
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

return { SUPABASE_URL, SUPABASE_KEY, getSession, ApiError, signIn, signUp, recoverPassword, updatePassword, signOut, consumeUrlSession, selectAll, insertRow, updateRows, deleteRows };
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
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
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
// Field types: text | longtext | number | url | fk | link | contacts | user | date

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
    fields: [
      { key: 'title', label: 'عنوان البحث', type: 'text', required: true, width: 320 },
      { key: 'researchers', label: 'الباحثون', type: 'link', via: 'research_researchers', self: 'research_id', other: 'person_id', ref: 'persons', width: 200 },
      { key: 'translators', label: 'المترجمون', type: 'link', via: 'research_translators', self: 'research_id', other: 'person_id', ref: 'persons', width: 180 },
      { key: 'journals', label: 'المجلات', type: 'link', via: 'research_journals', self: 'research_id', other: 'journal_id', ref: 'journals', width: 180 },
      { key: 'publishers', label: 'الناشرون', type: 'link', via: 'research_publishers', self: 'research_id', other: 'publisher_id', ref: 'publishers', width: 200 },
      { key: 'year', label: 'السنة', type: 'number', width: 80 },
      { key: 'research_type_id', label: 'النوع', type: 'fk', ref: 'research_types', width: 100 },
      { key: 'language_id', label: 'اللغة', type: 'fk', ref: 'languages', width: 110 },
      { key: 'topics', label: 'المواضيع', type: 'link', via: 'research_topics', self: 'research_id', other: 'topic_id', ref: 'topics', width: 160 },
      { key: 'tags', label: 'الوسوم', type: 'link', via: 'research_tags', self: 'research_id', other: 'tag_id', ref: 'tags', width: 160, hidden: true },
      { key: 'isbn', label: 'ISBN', type: 'text', width: 150, ltr: true },
      { key: 'doi', label: 'DOI', type: 'text', width: 150, ltr: true, hidden: true },
      { key: 'pages', label: 'عدد الصفحات', type: 'number', width: 100 },
      { key: 'url', label: 'رابط البحث', type: 'url', width: 160 },
      { key: 'summary', label: 'الملخص', type: 'longtext', width: 260 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220, hidden: true },
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
        sources: [{ via: 'research_researchers', self: 'person_id' }, { via: 'research_translators', self: 'person_id' }] },
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
        sources: [{ via: 'research_publishers', self: 'publisher_id' }] },
      { key: 'description', label: 'تعريف', type: 'longtext', width: 260 },
      { key: 'contacts', label: 'وسائل التواصل', type: 'contacts', table: 'publishers_contacts', self: 'publisher_id', width: 240 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220 },
      ...meta,
    ],
  },
  journals: refTable('المجلات', 'journal', [
    { key: 'researches', label: 'الأبحاث', type: 'link', via: 'research_journals', self: 'journal_id', other: 'research_id', ref: 'researches', width: 420 },
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
};
TABLES.journals.single = 'مجلة';

// Tables loaded but not shown in the sidebar
const AUX_TABLES = [
  'research_researchers', 'research_translators', 'research_journals', 'research_publishers',
  'research_topics', 'research_tags', 'person_role_assignments', 'persons_contacts',
  'publishers_contacts', 'profiles', 'journal_editors',
];

const ROLE_LABELS = {
  owner: 'مالك', admin: 'إدارة', editor: 'مدير تحرير', data_entry: 'مدخل بيانات',
};

// ---- permissions (mirrors the RLS policies; the database is the real gatekeeper) ----
const ADMIN_LISTS = ['countries', 'languages', 'research_types', 'contact_types', 'person_roles', 'journals'];
const SHARED = ['persons', 'publishers', 'topics', 'tags'];

function canInsert(role, table) {
  if (role === 'owner' || role === 'admin') return true;
  if (role === 'data_entry') return table === 'researches' || SHARED.includes(table);
  return false;
}

function canEditRow(role, uid, table, row) {
  if (role === 'owner' || role === 'admin') return true;
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
  researches: [
    ['المعلومات الأساسية', ['title', 'year', 'research_type_id', 'language_id', 'pages']],
    ['الأشخاص', ['researchers', 'translators']],
    ['النشر والتصنيف', ['journals', 'publishers', 'topics', 'tags']],
    ['المعرّفات والرابط', ['isbn', 'doi', 'url']],
    ['المحتوى', ['summary', 'notes']],
  ],
  persons: [
    ['البيانات', ['name', 'nationality_id', 'roles']],
    ['الأعمال', ['related_journals', 'as_researcher', 'as_translator']],
    ['التواصل والملاحظات', ['contacts', 'notes']],
  ],
  publishers: [
    ['البيانات', ['name', 'country_id', 'description']],
    ['الأبحاث', ['related_journals', 'researches']],
    ['التواصل والملاحظات', ['contacts', 'notes']],
  ],
};
const FULL_WIDTH = new Set(['related_journals', 'title', 'name', 'summary', 'notes', 'description', 'contacts', 'as_researcher', 'as_translator', 'researches']);

// Journal chip colours, taken from each journal's cover and issue badge on tajdid-c.com
const JOURNAL_COLORS = {
  'قرآنيات': 'olive', // #AFA518 (gold/olive cover)
  'أخلاق': 'blue', // #11359B (royal-blue cover)
  'سميراميس': 'maroon', // #7C0E2F (maroon cover)
};

// Tables hidden from the sidebar per role (still usable inside record forms and filters)
const HIDDEN_TABLES = {
  data_entry: ['journals', 'countries', 'languages', 'research_types', 'contact_types', 'person_roles'],
};
const isTableVisible = (role, table) => !(HIDDEN_TABLES[role] || []).includes(table);

// Fields a role may see (record info is for owner & admin only)
const fieldsFor = (role, table) => TABLES[table].fields.filter((f) => !f.staffOnly || role === 'owner' || role === 'admin');






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
    const n = (S.data.research_journals || []).filter((l) => l.journal_id === id).length;
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
function userName(id) {
  if (!id) return 'NocoDB / قبل الواجهة';
  const p = S.byId.profiles?.get(id);
  return p ? (p.full_name || p.email) : 'مستخدم';
}
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('ar-LB', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function index(table) {
  S.byId[table] = new Map((S.data[table] || []).map((r) => [r.id, r]));
}

function linkedIds(field, rowId) {
  return (S.data[field.via] || []).filter((l) => l[field.self] === rowId).map((l) => l[field.other]);
}
function contactsOf(field, rowId) {
  return (S.data[field.table] || []).filter((c) => c[field.self] === rowId);
}

// Journals a person/publisher is related to through their researches → Map(journalId → number of researches)
function derivedCounts(f, rowId) {
  const rids = new Set();
  for (const src of f.sources) for (const l of S.data[src.via] || []) if (l[src.self] === rowId) rids.add(l.research_id);
  const m = new Map();
  for (const l of S.data.research_journals || []) if (rids.has(l.research_id)) m.set(l.journal_id, (m.get(l.journal_id) || 0) + 1);
  return new Map([...m].sort((a, b) => b[1] - a[1]));
}
const derivedIds = (f, rowId) => [...derivedCounts(f, rowId).keys()];

// value used for search / sort / filter
function plainValue(table, row, f) {
  switch (f.type) {
    case 'fk': return row[f.key] ? displayOf(f.ref, row[f.key]) : '';
    case 'link': return linkedIds(f, row.id).map((id) => displayOf(f.ref, id)).join('، ');
    case 'derived': return derivedIds(f, row.id).map((id) => displayOf(f.ref, id)).join('، ');
    case 'contacts': return contactsOf(f, row.id).map((c) => c.value).join(' ');
    case 'user': return f.key === 'created_by' && !row[f.key] ? '' : userName(row[f.key]);
    default: return row[f.key] ?? '';
  }
}

// ============ data loading ============
const SELECT_ORDER = { profiles: 'created_at', journal_editors: null, person_role_assignments: null };
const LINK_TABLES = new Set(['research_researchers', 'research_translators', 'research_journals',
  'research_publishers', 'research_topics', 'research_tags', 'person_role_assignments', 'journal_editors']);

async function loadTable(t) {
  const order = t in SELECT_ORDER ? SELECT_ORDER[t] : (LINK_TABLES.has(t) ? null : 'id');
  S.data[t] = await api.selectAll(t, order);
  index(t);
}
async function loadAll() {
  await Promise.all([...Object.keys(TABLES), ...AUX_TABLES].map(loadTable));
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
    if ((!TABLES[S.view] && !['stats', 'users'].includes(S.view)) || (TABLES[S.view] && !isTableVisible(S.me.role, S.view))) S.view = 'researches';
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
  for (const [k, t] of Object.entries(TABLES)) if (isTableVisible(role, k)) groups[t.group].push(navItem(k, t.icon, t.label, S.data[k]?.length));
  const pendingUsers = (S.data.profiles || []).filter((p) => !p.active).length;

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('img', { class: 'logo-img', src: 'assets/logo-white.png', alt: 'شعار مركز تجديد' }),
      h('div', {}, h('img', { class: 'callig', src: 'assets/calligraphy-light.png', alt: 'مركز تجديد للفكر والثقافة' }), h('small', {}, 'قاعدة بيانات الأبحاث'))),
    h('nav', {},
      h('div', { class: 'nav-title' }, 'الجداول'), groups.main,
      ['owner', 'admin', 'editor'].includes(role) ? [h('div', { class: 'nav-title' }, 'المتابعة'), navItem('stats', 'chart', 'الإحصائيات')] : null,
      h('div', { class: 'nav-title' }, 'القوائم'), groups.lists,
      role === 'owner' ? [h('div', { class: 'nav-title' }, 'الإدارة'), navItem('users', 'users', 'المستخدمون', pendingUsers ? `${pendingUsers} جديد` : null)] : null),
    themeSwitch(),
    h('div', { class: 'me' },
      h('div', {}, h('b', {}, S.me.full_name || S.me.email), h('small', {}, ROLE_LABELS[role])),
      h('button', { class: 'btn ghost sm icon-btn', title: 'تسجيل الخروج', 'aria-label': 'تسجيل الخروج', onclick: async () => { await api.signOut(); renderLogin(); } }, icon('logout', 18))));

  const main = h('main', { class: 'main' });
  app.replaceChildren(h('div', { class: 'shell' },
    h('button', { class: 'nav-toggle', onclick: () => document.body.classList.toggle('nav-open'), 'aria-label': 'القائمة' }, icon('menu', 20)),
    h('div', { class: 'backdrop', onclick: closeSidebar }),
    sidebar, main));

  if (S.view === 'stats') renderStats(main);
  else if (S.view === 'users') renderUsers(main);
  else renderGrid(main, S.view);
}

// ============ grid ============
function uiFor(table) {
  if (!S.ui[table]) {
    const hiddenSaved = lsGet(`tajdid_hidden_${table}`, null);
    S.ui[table] = {
      search: '', sort: null, filters: [],
      hidden: new Set(hiddenSaved ?? fieldsFor(S.me.role, table).filter((f) => f.hidden).map((f) => f.key)),
    };
  }
  return S.ui[table];
}

function visibleRows(table) {
  const ui = uiFor(table);
  const fields = fieldsFor(S.me.role, table);
  let rows = [...(S.data[table] || [])];
  const q = ui.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => fields.some((f) => String(plainValue(table, r, f)).toLowerCase().includes(q)));
  for (const flt of ui.filters) {
    const f = fields.find((x) => x.key === flt.key);
    if (!f || flt.value === '' || flt.value == null) continue;
    if (f.type === 'fk') rows = rows.filter((r) => String(r[f.key] ?? '') === String(flt.value));
    else if (f.type === 'derived') rows = rows.filter((r) => flt.value === '__none' ? !derivedIds(f, r.id).length : derivedIds(f, r.id).map(String).includes(String(flt.value)));
    else if (f.type === 'link') rows = rows.filter((r) => flt.value === '__none' ? !linkedIds(f, r.id).length : linkedIds(f, r.id).map(String).includes(String(flt.value)));
    else if (f.type === 'user') rows = rows.filter((r) => String(r[f.key] ?? '') === String(flt.value === '__none' ? '' : flt.value));
    else if (flt.value === '__empty') rows = rows.filter((r) => !String(plainValue(table, r, f)).trim());
    else rows = rows.filter((r) => String(plainValue(table, r, f)).toLowerCase().includes(String(flt.value).toLowerCase()));
  }
  if (ui.sort) {
    const f = fields.find((x) => x.key === ui.sort.key);
    const dir = ui.sort.dir;
    rows.sort((a, b) => {
      const va = plainValue(table, a, f); const vb = plainValue(table, b, f);
      if (va === '' && vb !== '') return 1;
      if (vb === '' && va !== '') return -1;
      const c = (f.type === 'number') ? (Number(va) - Number(vb)) : String(va).localeCompare(String(vb), 'ar');
      return c * dir;
    });
  }
  return rows;
}

function renderCell(table, row, f) {
  const v = row[f.key];
  switch (f.type) {
    case 'fk': return v ? h('span', { class: 'chip' }, displayOf(f.ref, v)) : '';
    case 'link': return linkedIds(f, row.id).map((id) => h('span', { class: chipClass(f.ref, id) }, displayOf(f.ref, id)));
    case 'derived': return [...derivedCounts(f, row.id)].map(([id, n]) => h('span', { class: chipClass(f.ref, id), title: `${n} بحث` }, displayOf(f.ref, id), h('small', { class: 'chip-count' }, n)));
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
  const fields = fieldsFor(role, table).filter((f) => !ui.hidden.has(f.key));
  const rows = visibleRows(table);

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
    count.textContent = `${list.length} من ${S.data[table].length} سجل`;
  }
  drawBody();

  main.replaceChildren(toolbar, filtersBar || '',
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
  if (['link', 'longtext', 'contacts'].includes(f.type)) return openRecord(table, row, f.key);
  if (td.querySelector('input,select')) return;
  let input;
  if (f.type === 'fk') {
    input = h('select', {}, h('option', { value: '' }, '—'),
      S.data[f.ref].map((o) => h('option', { value: o.id, selected: String(o.id) === String(row[f.key]) }, o[TABLES[f.ref].display])));
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
  if (f.type === 'fk') input.addEventListener('change', () => finish(true));
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
  const ui = uiFor(table);
  const n = ui.hidden.size;
  const defaults = fieldsFor(S.me.role, table).filter((f) => f.hidden).map((f) => f.key);
  const custom = n !== defaults.length || defaults.some((k) => !ui.hidden.has(k));
  return h('button', {
    class: `btn ${custom ? 'active' : ''}`,
    onclick: (e) => popover(e.currentTarget, h('div', { class: 'menu' },
      h('div', { class: 'menu-title' }, 'إظهار / إخفاء الحقول'),
      fieldsFor(S.me.role, table).map((f) => h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: !ui.hidden.has(f.key),
          onchange: (ev) => {
            if (ev.target.checked) ui.hidden.delete(f.key); else ui.hidden.add(f.key);
            lsSet(`tajdid_hidden_${table}`, [...ui.hidden]);
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
  if (f.type === 'fk' || f.type === 'link' || f.type === 'derived') {
    valueEl = h('select', { onchange: (e) => { flt.value = e.target.value; renderShell(); } },
      h('option', { value: '' }, 'اختر…'),
      f.type !== 'fk' ? h('option', { value: '__none', selected: flt.value === '__none' }, '(فارغ)') : null,
      S.data[f.ref].map((o) => h('option', { value: o.id, selected: String(o.id) === String(flt.value) }, o[TABLES[f.ref].display])));
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

function openRecord(table, row, focusKey) {
  const T = TABLES[table];
  const role = S.me.role; const uid = S.me.id;
  const isNew = !row;
  const draft = { ...(row || {}) };
  const links = {}; const contacts = {};
  let dirty = false;
  const form = h('div', { class: 'record' });
  const fieldEls = {};

  for (const f of fieldsFor(role, table)) {
    if (isNew && f.readonly) continue;
    const editable = isNew ? (!f.readonly && (!f.adminOnly || ['owner', 'admin'].includes(role)) && !(f.type === 'link' && f.ref === 'researches' && !['owner', 'admin'].includes(role)))
      : canEditField(role, uid, table, row, f);
    let control;
    switch (f.type) {
      case 'link':
        links[f.key] = isNew ? [] : linkedIds(f, row.id);
        control = linkPicker(f, links[f.key], () => { dirty = true; }, editable);
        break;
      case 'contacts':
        contacts[f.key] = isNew ? [] : contactsOf(f, row.id).map((c) => ({ ...c }));
        control = contactsEditor(f, contacts[f.key], editable);
        break;
      case 'fk':
        control = h('select', { disabled: !editable, onchange: (e) => { draft[f.key] = e.target.value ? Number(e.target.value) : null; } },
          h('option', { value: '' }, '—'),
          S.data[f.ref].map((o) => h('option', { value: o.id, selected: String(o.id) === String(draft[f.key]) }, o[TABLES[f.ref].display])));
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
      h('label', {}, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), control);
  }
  const layout = FORM_LAYOUT[table];
  const used = new Set();
  const section = (title, keys, cls = '') => {
    const els = keys.filter((k) => fieldEls[k] && !used.has(k)).map((k) => { used.add(k); return fieldEls[k]; });
    if (els.length) form.append(h('section', { class: `form-section ${cls}` }, title ? h('h4', {}, title) : null, h('div', { class: 'record-grid' }, els)));
  };
  if (layout) layout.forEach(([title, keys]) => section(title, keys));
  const metaKeys = fieldsFor(role, table).filter((f) => f.type === 'user' || f.type === 'date').map((f) => f.key);
  section(layout ? 'حقول أخرى' : '', fieldsFor(role, table).map((f) => f.key).filter((k) => !metaKeys.includes(k)));
  section('معلومات السجل', metaKeys, 'meta');

  const rowEditable = isNew ? canInsert(role, table) : canEditRow(role, uid, table, row);
  const anyLinkEditable = !isNew && T.fields.some((f) => f.type === 'link' && canEditField(role, uid, table, row, f));
  const saveBtn = h('button', { class: 'btn primary', onclick: () => save() }, isNew ? 'إضافة' : 'حفظ التعديلات');
  const footer = [
    (rowEditable || anyLinkEditable) ? saveBtn : h('span', { class: 'muted' }, 'للعرض فقط'),
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
      const values = {};
      for (const f of T.fields) {
        if (['link', 'contacts', 'user', 'date'].includes(f.type) || f.readonly) continue;
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
  const jr = links('research_journals', 'research_id', 'journal_id');
  const pub = links('research_publishers', 'research_id', 'publisher_id');
  const researchers = new Set(S.data.research_researchers.map((l) => l.person_id));
  const translators = new Set(S.data.research_translators.map((l) => l.person_id));
  const translated = new Set(S.data.research_translators.map((l) => l.research_id));
  const noResearcher = R.filter((r) => !S.data.research_researchers.some((l) => l.research_id === r.id)).length;
  const noJournal = R.filter((r) => !jr(r.id).length).length;
  const noSummary = R.filter((r) => !String(r.summary || '').trim()).length;

  const tile = (label, n, sub) => h('div', { class: 'tile' }, h('span', { class: 'tile-n' }, n), h('span', { class: 'tile-l' }, label), sub ? h('small', {}, sub) : null);
  const scope = S.me.role === 'editor' ? h('p', { class: 'muted' }, 'تظهر هنا إحصائيات الأبحاث المرتبطة بمجلاتك فقط.') : null;

  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('chart', 22), 'الإحصائيات')),
    h('div', { class: 'stats' },
      scope,
      h('div', { class: 'tiles' },
        tile('بحث', R.length, `${translated.size} منها مترجم`),
        tile('باحث', researchers.size),
        tile('مترجم', translators.size),
        tile('ناشر', S.data.publishers.length),
        tile('مجلة', S.data.journals.length)),
      h('div', { class: 'cards' },
        barCard('الأبحاث حسب المجلة', countBy(R, (r) => jr(r.id)), { labelFn: (k) => displayOf('journals', k) }),
        barCard('الأبحاث حسب سنة النشر', countBy(R, (r) => r.year ?? '__none'), { sortByLabel: true }),
        barCard('الأبحاث حسب الناشر', countBy(R, (r) => pub(r.id)), { labelFn: (k) => displayOf('publishers', k) }),
        barCard('الأبحاث حسب اللغة', countBy(R, (r) => r.language_id ?? '__none'), { labelFn: (k) => displayOf('languages', k) }),
        barCard('الأبحاث حسب النوع', countBy(R, (r) => r.research_type_id ?? '__none'), { labelFn: (k) => displayOf('research_types', k) }),
        S.me.role !== 'editor' ? barCard('الأبحاث حسب مُدخل البيانات', countBy(R, (r) => r.created_by || 'nocodb'), { labelFn: (k) => (k === 'nocodb' ? 'NocoDB / قبل الواجهة' : userName(k)) }) : null,
        h('section', { class: 'card' }, h('h3', {}, 'اكتمال البيانات'),
          h('ul', { class: 'gaps' },
            h('li', {}, h('b', {}, noResearcher), ' بحث بدون باحث'),
            h('li', {}, h('b', {}, noJournal), ' بحث غير مرتبط بمجلة'),
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
        h('p', { class: 'muted' }, 'الصلاحيات: المالك يرى ويعدّل ويحذف كل شيء، ويدير المستخدمين. الإدارة تعدّل كل البيانات وترى الإحصائيات. مدير التحرير يرى أبحاث مجلاته فقط. مدخل البيانات يضيف الأبحاث ويعدّل ما أدخله هو فقط، ويضيف ويعدّل الأشخاص والناشرين.')),
      h('div', { class: 'grid-wrap' }, h('table', { class: 'grid users-table' },
        h('thead', {}, h('tr', {}, ['الاسم', 'البريد الإلكتروني', 'الدور', 'المجلات (لمدير التحرير)', 'الحالة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, users.map((p) => {
          const self = p.id === S.me.id;
          return h('tr', { class: p.active ? '' : 'pending' },
            h('td', {}, h('input', { class: 'inline', value: p.full_name || '', onchange: (e) => update(p, { full_name: e.target.value.trim() || null }) })),
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

boot();
})();