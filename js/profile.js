import { icon } from './icons.js';
import * as api from './api.js';
import {
  S, h, toast, renderShell, avatarEl, displayOf, chipClass, openRecord, THEMES, currentTheme, applyTheme, lsSet,
} from './app.js';
import { ROLE_LABELS } from './schema.js';

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
  const rids = new Set(R.map((r) => r.id));
  const byJournal = new Map();
  for (const l of S.data.research_journals || []) if (rids.has(l.research_id)) byJournal.set(l.journal_id, (byJournal.get(l.journal_id) || 0) + 1);

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
    byJournal.size ? [h('h4', { class: 'sub' }, 'أبحاثي حسب المجلة'),
      h('div', { class: 'ro-chips' }, [...byJournal].sort((a, b) => b[1] - a[1]).map(([id, n]) => h('span', { class: chipClass('journals', id) }, displayOf('journals', id), h('small', { class: 'chip-count' }, n))))] : null,
    h('h4', { class: 'sub' }, 'آخر ما أدخلته'),
    recent.length
      ? h('ul', { class: 'recent' }, recent.map((r) => h('li', {},
        h('button', { class: 'link-btn', onclick: () => openRecord('researches', r) }, r.title),
        h('small', { class: 'muted' }, r.created_at ? new Date(r.created_at).toLocaleDateString('ar-LB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''))))
      : h('p', { class: 'muted' }, 'لم تُدخل أي بحث من الواجهة بعد. (الأبحاث المُدخلة سابقاً من NocoDB لا تُحتسب هنا.)'));
}

export function renderProfile(main) {
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('user', 22), 'حسابي')),
    h('div', { class: 'profile' },
      h('div', { class: 'profile-col' }, identityCard(), themeCard(), passwordCard()),
      h('div', { class: 'profile-col wide' }, statsCard())));
}
