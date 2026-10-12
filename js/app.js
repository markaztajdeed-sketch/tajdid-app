import * as api from './api.js';
import {
  TABLES, AUX_TABLES, ROLE_LABELS, FORM_LAYOUT, FULL_WIDTH, JOURNAL_COLORS, isTableVisible, fieldsFor, setManagedJournals, canInsert, canEditRow, canEditField, canDelete,
  ENUMS, PUB_KINDS, STAGES, CENTER_LIBRARY, RESEARCH_VIEWS, seesSubmissions, issueWhen,
} from './schema.js';
import { researchExtSections } from './research.js';
import { renderStats } from './stats.js';
import { icon } from './icons.js';
import { renderUsers } from './users.js';
import { renderProfile } from './profile.js';
import { renderJournal, journalNavVisible } from './journal.js';
import { renderTrash, linkedFilesSection } from './files.js';

// ============ state ============
export const S = {
  data: {},          // table -> rows
  byId: {},          // table -> Map(id -> row)
  me: null,          // profile row
  view: 'researches',
  ui: {},            // per-table: { search, sort:{key,dir}, filters:[], hidden:Set }
};
const app = document.getElementById('app');

// ============ helpers ============
export function h(tag, attrs = {}, ...children) {
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

export function toast(msg, kind = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message || String(e), 'err'); throw e; }
}

export const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export function displayOf(table, id) {
  const row = S.byId[table]?.get(Number(id)) ?? S.byId[table]?.get(id);
  if (!row) return '—';
  return row[TABLES[table]?.display || 'name'] ?? `#${id}`;
}
// Short context shown next to a linked record (e.g. a person's nationality and roles)
export function subtitleOf(table, id) {
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
export function chipClass(ref, id) {
  if (ref !== 'journals') return `chip ${ref}`;
  const name = norm(displayOf('journals', id));
  const key = Object.keys(JOURNAL_COLORS).find((k) => norm(k) === name);
  return `chip journals${key ? ` jc-${JOURNAL_COLORS[key]}` : ''}`;
}
export function avatarEl(p, size = 32) {
  const name = (p?.full_name || p?.email || '?').trim();
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return p?.avatar_url
    ? h('img', { class: 'avatar', src: p.avatar_url, alt: '', style: `width:${size}px;height:${size}px` })
    : h('span', { class: 'avatar initials', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px` }, initials);
}
export function userName(id) {
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
export function valueOf(row, f) {
  if (f.ext) return row?.[f.ext]?.[f.col] ?? null;
  return row?.[f.key] ?? null;
}
const enumLabel = (f, v) => (v == null ? '' : (ENUMS[f.options]?.[v] ?? v));
export const isArticle = (r) => r?.pub?.kind === 'article';
export const isBook = (r) => !!r?.pub && r.pub.kind !== 'article';
// The journal an article is published in (through its issue). Books belong to no journal.
export function researchJournal(r) {
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
export function researchStatus(r) {
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

export function linkedIds(field, rowId) {
  return (S.data[field.via] || []).filter((l) => l[field.self] === rowId).map((l) => l[field.other]);
}
function contactsOf(field, rowId) {
  return (S.data[field.table] || []).filter((c) => c[field.self] === rowId);
}

// Journals a person/publisher is related to through their researches → Map(journalId → number of researches)
export function derivedCounts(f, rowId) {
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
export function productionOf(personId) {
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
export async function reloadResearch(id) {
  const [fresh] = await api.select('researches', `id=eq.${id}`, TABLES.researches.select);
  const list = S.data.researches;
  const i = list.findIndex((r) => r.id === id);
  if (fresh) { if (i >= 0) list[i] = fresh; else list.push(fresh); } else if (i >= 0) list.splice(i, 1);
  index('researches');
  return fresh;
}
export async function loadAll() {
  await Promise.all([...Object.keys(TABLES), ...AUX_TABLES].map(loadTable));
  index('issues');
  if (S.me) setManagedJournals((S.data.journal_editors || []).filter((j) => j.user_id === S.me.id).map((j) => j.journal_id));
}

// ============ theme ============
export const THEMES = [['light', 'أبيض', 'sun'], ['dark', 'كحلي', 'moon'], ['auto', 'تلقائي', 'monitor']];
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export function currentTheme() { return lsGet('tajdid_theme', 'light'); }
export function applyTheme(mode = currentTheme()) {
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

export function renderShell() {
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
export function viewsFor(table) {
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
export function openModal(title, body, footer, opts = {}) {
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

export function linkPicker(field, selected, onChange, editable) {
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

export function openRecord(table, row, focusKey, defaults = null) {
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

boot();
