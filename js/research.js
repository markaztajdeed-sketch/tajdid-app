// Conditional sections of the research window, each backed by a 1:1 extension table:
//   «النشر في المركز» → center_publications   «البيانات الببليوغرافية» → bibliographic_details
//   «بيانات الأصل»   → translation_details     «الاستلام» → submissions (+ submission_events)
// A row is created when any of its fields is filled, and removed when all are emptied.
// NOTE: all modules share one scope in the bundle — internal names here start with "rx".
import { icon } from './icons.js';
import * as api from './api.js';
import { S, h, displayOf, userName } from './app.js';
import { PUB_KINDS, STAGES, CENTER_LIBRARY, managesJournal, pubKindsFor, seesSubmissions } from './schema.js';
import { sbStageControls, sbTimeline, sbOfferUpload } from './submissions.js';

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
const rxSet = (el, ...parts) => el.replaceChildren(...parts.flat(Infinity).filter((x) => x != null && x !== false));
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

export function researchExtSections({ row, isNew, pubDefaults, canEditBase, translators, onChange }) {
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
  // with a translator, or for a translated book (so its original title can be entered first)
  const transVisible = () => translators().length > 0 || st.pub?.kind === 'translated_book';

  // ---- «الاستلام» ----
  const subBody = h('div', {});
  const subSec = h('section', { class: 'form-section ext', 'data-ext': 'sub' }, h('h4', {}, 'الاستلام'), subBody);
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
    const existing = !!row?.sub;
    const rejected = s.stage === 'rejected';
    const journalOpts = (existing && !myJournals.some((j) => j.id === s.journal_id) ? [...myJournals, { id: s.journal_id, name: displayOf('journals', s.journal_id) }] : myJournals).map((j) => [j.id, j.name]);
    rxSet(subBody, h('div', { class: 'record-grid' },
      rxField('المجلة', rxSelect(journalOpts, s.journal_id, (v) => { s.journal_id = rxNum(v); changed(); }, !can)),
      rxField('تاريخ الاستلام', rxInput('date', s.received_at, (v) => { s.received_at = v || null; changed(); }, !can)),
      // a new submission starts at a chosen stage; an existing one moves through the stage controls
      existing ? null : rxField('المرحلة', rxSelect(Object.entries(STAGES).filter(([k]) => k !== 'rejected' && k !== 'published'), s.stage, (v) => { s.stage = v || 'received'; changed(); }, !can, null))),
    existing ? h('div', { class: 'field full' }, h('label', {}, 'المرحلة'), sbStageControls(row, (fresh) => {
      if (!fresh) return;
      row.sub = fresh.sub; row.pub = fresh.pub;
      st.sub = fresh.sub ? { ...fresh.sub } : null; st.pub = fresh.pub ? { ...fresh.pub } : st.pub;
      timeline = sbTimeline(fresh.sub.id);
      drawAll();
    })) : null,
    existing && can ? h('div', { class: 'ext-actions start' }, h('button', {
      type: 'button', class: 'btn sm', title: 'يُحفظ في «2.1 الأبحاث غير المنشورة»؛ الملف بالاسم نفسه يصير نسخة جديدة',
      onclick: () => sbOfferUpload(S.byId.journals.get(row.sub.journal_id), S.byId.researches.get(row.id) || row),
    }, icon('upload', 14), 'رفع ملف المقالة')) : null,
    existing && rejected && row.sub.rejection_reason ? h('p', { class: 'hint' }, `سبب الرفض: ${row.sub.rejection_reason}`) : null,
    row?.sub?.decided_at ? h('small', { class: 'hint' }, `تاريخ القرار: ${rxFmt(row.sub.decided_at)}`) : null,
    existing ? timeline : null,
    S.me.role === 'owner' && existing ? h('div', { class: 'ext-actions' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.sub = null; changed(); drawAll(); } }, icon('x', 14), 'حذف الاستلام')) : null,
    !existing && can ? h('div', { class: 'ext-actions' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.sub = null; changed(); drawAll(); } }, icon('x', 14), 'إلغاء')) : null);
  }
  let timeline = row?.sub?.id && subVisible ? sbTimeline(row.sub.id) : null;

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
        const want = s && s.journal_id ? (row?.sub
          ? { journal_id: s.journal_id, received_at: s.received_at || row.sub.received_at }
          : { journal_id: s.journal_id, received_at: s.received_at || new Date().toISOString().slice(0, 10), stage: s.stage || 'received' }) : null;
        if (want && (!row?.sub || !rxSame(want, row.sub, Object.keys(want)))) await api.upsertExtension('submissions', rid, want);
        else if (!want && row?.sub) await api.deleteExtension('submissions', rid);
      }
    },
  };
}
