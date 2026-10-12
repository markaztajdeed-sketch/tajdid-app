// «الاستلام»: the submissions workflow of a journal — stage board (kanban), rejected archive, admin tables.
// Moving a stage goes through the database function move_submission (note, rejection reason, publication).
// NOTE: all modules share one scope in the bundle — internal names here start with "sb".
import { icon } from './icons.js';
import * as api from './api.js';
import {
  S, h, toast, openModal, displayOf, linkedIds, openRecord, renderShell, reloadResearch, linkPicker, userName, lsGet, lsSet,
} from './app.js';
import { TABLES, STAGES, managesJournal, issueWhen } from './schema.js';
import { flUploadToCode, flFilesForResearches, flOpenFile } from './files.js';

// Board columns, in workflow order (published & rejected are end states)
export const SB_FLOW = ['received', 'initial_review', 'under_review', 'revisions', 'accepted', 'proofreading', 'proofread', 'final'];
const SB_ORDER = [...SB_FLOW, 'published'];
export const sbNextStage = (stage) => {
  const i = SB_ORDER.indexOf(stage);
  return i >= 0 && i < SB_ORDER.length - 1 ? SB_ORDER[i + 1] : null;
};

const sbFmt = (d) => (d ? new Date(d).toLocaleDateString('ar-LB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const sbISO = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const sbPeople = (r, via) => linkedIds({ via, self: 'research_id', other: 'person_id' }, r.id).map((id) => displayOf('persons', id)).join('، ');
const sbJournalRows = (jid) => (S.data.researches || []).filter((r) => r.sub && r.sub.journal_id === jid);
// The rows shown on a card / in the tables; the empty parts are dropped
const sbSet = (el, ...parts) => el.replaceChildren(...parts.flat(Infinity).filter((x) => x != null && x !== false));

// ---------- events (per journal, cached) ----------
const sbEvents = { jid: null, list: [], loading: null };
export function sbInvalidate() { sbEvents.jid = null; }
function sbEnsureEvents(jid, redraw) {
  if (sbEvents.jid === jid && !sbEvents.loading) return true;
  if (!sbEvents.loading) {
    const ids = sbJournalRows(jid).map((r) => r.sub.id);
    sbEvents.loading = (ids.length ? api.select('submission_events', `submission_id=in.(${ids.join(',')})&order=happened_at,id`) : Promise.resolve([]))
      .then((list) => { Object.assign(sbEvents, { jid, list }); })
      .catch((e) => { Object.assign(sbEvents, { jid, list: [] }); toast(e.message, 'err'); })
      .finally(() => { sbEvents.loading = null; redraw(); });
  }
  return false;
}
// When the submission entered its current stage (last matching event, else the reception date)
function sbStageSince(sub) {
  const ev = sbEvents.list.filter((e) => e.submission_id === sub.id && e.stage === sub.stage).pop();
  return ev?.happened_at || sub.received_at;
}
function sbDays(since) {
  if (!since) return '';
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'منذ يوم';
  if (days === 2) return 'منذ يومين';
  return days <= 10 ? `منذ ${days} أيام` : `منذ ${days} يوماً`;
}

// ---------- timeline of one submission ----------
export function sbTimeline(subId) {
  const box = h('div', { class: 'timeline' }, h('small', { class: 'muted' }, 'جارٍ تحميل تسلسل المراحل…'));
  api.select('submission_events', `submission_id=eq.${subId}&order=happened_at,id`).then((events) => {
    sbSet(box, h('div', { class: 'tl-title' }, 'تسلسل المراحل'),
      events.length ? h('ol', {}, events.map((e) => h('li', { class: `tl-${e.stage}` },
        h('b', {}, STAGES[e.stage] ?? e.stage),
        h('small', { class: 'muted' }, [sbFmt(e.happened_at), e.created_by ? userName(e.created_by) : null].filter(Boolean).join(' · ')),
        e.note ? h('span', { class: 'tl-note' }, e.note) : null)))
        : h('small', { class: 'muted' }, 'لا توجد مراحل مسجّلة.'));
  }).catch((e) => sbSet(box, h('small', { class: 'form-err' }, e.message)));
  return box;
}

// ---------- moving a stage ----------
const sbCanMove = (r) => !!r?.sub && managesJournal(S.me.role, r.sub.journal_id);

// Dialog for moving to a stage: optional note; reason for «مرفوض»; issue/pages/order for «منشور»
export function sbMoveDialog(r, target, done) {
  const sub = r.sub;
  const note = h('textarea', { rows: 2, dir: 'auto', placeholder: 'ملاحظة (اختيارية)' });
  const reason = h('input', { type: 'text', dir: 'auto', placeholder: 'سبب الرفض' });
  const issues = (S.data.issues || []).filter((i) => i.journal_id === sub.journal_id).sort((a, b) => b.number - a.number);
  const issueSel = h('select', {}, h('option', { value: '' }, 'اختر العدد…'),
    issues.map((i) => h('option', { value: i.id }, `العدد ${i.number}${issueWhen(i) ? ` · ${issueWhen(i)}` : ''}${i.title ? ` · ${i.title}` : ''}`)));
  const start = h('input', { type: 'number', min: 1 }); const end = h('input', { type: 'number', min: 1 }); const order = h('input', { type: 'number', min: 1 });
  issueSel.addEventListener('change', () => {
    const n = (S.data.researches || []).filter((x) => x.pub?.kind === 'article' && x.pub.issue_id === Number(issueSel.value)).length;
    order.value = issueSel.value ? n + 1 : '';
  });
  if (r.pub?.kind === 'article') { issueSel.value = r.pub.issue_id; start.value = r.pub.start_page ?? ''; end.value = r.pub.end_page ?? ''; order.value = r.pub.issue_order ?? ''; }
  const err = h('div', { class: 'form-err' });
  const field = (label, el) => h('label', { class: 'f' }, h('span', {}, label), el);
  const body = h('div', { class: 'sb-move' },
    h('p', { class: 'muted' }, `من «${STAGES[sub.stage]}» إلى «${STAGES[target]}»`),
    target === 'rejected' ? field('سبب الرفض *', reason) : null,
    target === 'published' ? h('div', { class: 'form-rows two' }, field('العدد *', issueSel), field('ترتيبها في العدد', order), field('من صفحة', start), field('إلى صفحة', end)) : null,
    target !== 'rejected' ? field('ملاحظة', note) : null,
    err);
  const ok = h('button', {
    class: `btn ${target === 'rejected' ? 'danger' : 'primary'}`,
    onclick: async () => {
      err.textContent = '';
      if (target === 'rejected' && !reason.value.trim()) { err.textContent = 'اكتب سبب الرفض'; reason.focus(); return; }
      if (target === 'published' && !issueSel.value) { err.textContent = 'اختر العدد الذي نُشرت فيه المقالة'; return; }
      if (start.value && end.value && Number(end.value) < Number(start.value)) { err.textContent = 'صفحة النهاية يجب ألا تكون قبل صفحة البداية'; return; }
      ok.disabled = true;
      try {
        await api.rpc('move_submission', {
          p_submission_id: sub.id, p_stage: target,
          p_note: target !== 'rejected' ? (note.value.trim() || null) : null,
          p_reason: target === 'rejected' ? reason.value.trim() : null,
          p_issue_id: target === 'published' ? Number(issueSel.value) : null,
          p_start_page: target === 'published' && start.value ? Number(start.value) : null,
          p_end_page: target === 'published' && end.value ? Number(end.value) : null,
          p_issue_order: target === 'published' && order.value ? Number(order.value) : null,
        });
        const fresh = await reloadResearch(r.id);
        sbInvalidate();
        close(true);
        toast(target === 'rejected' ? 'سُجّل الرفض' : `نُقل إلى «${STAGES[target]}»`);
        done?.(fresh);
      } catch (e) { err.textContent = e.message; ok.disabled = false; }
    },
  }, target === 'rejected' ? 'رفض' : (target === 'published' ? 'نشر في العدد' : 'نقل'));
  const close = openModal(`«${r.title}»`, body, [ok, h('button', { class: 'btn ghost', onclick: () => close(true) }, 'إلغاء')]);
  document.querySelector('.modal-wrap:last-child .modal')?.classList.add('small');
  setTimeout(() => (target === 'rejected' ? reason : (target === 'published' ? issueSel : note)).focus(), 0);
}

// Stage controls: current stage + time in it, «المرحلة التالية», any stage, «رفض»
export function sbStageControls(r, done, { compact = false } = {}) {
  const sub = r.sub;
  const can = sbCanMove(r);
  const next = sbNextStage(sub.stage);
  const ended = sub.stage === 'published' || sub.stage === 'rejected';
  const pick = h('select', {
    class: 'sb-pick', title: 'نقل إلى مرحلة', 'aria-label': 'نقل إلى مرحلة',
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) sbMoveDialog(r, v, done); },
  }, h('option', { value: '' }, compact ? '…' : 'نقل إلى…'),
  Object.entries(STAGES).filter(([k]) => k !== sub.stage).map(([k, label]) => h('option', { value: k }, label)));
  return h('div', { class: `sb-controls ${compact ? 'compact' : ''}` },
    compact ? null : h('span', { class: `chip enum st-${sub.stage === 'rejected' ? 'rejected' : (sub.stage === 'published' ? 'published' : 'wip')}` }, STAGES[sub.stage]),
    compact ? null : h('small', { class: 'muted' }, sbDays(sbStageSince(sub))),
    can && next && !ended ? h('button', { type: 'button', class: 'btn sm primary', onclick: (e) => { e.stopPropagation(); sbMoveDialog(r, next, done); } }, `${compact ? '' : 'المرحلة التالية: '}${STAGES[next]}`, icon('arrowLeft', 13)) : null,
    can ? pick : null,
    can && !ended ? h('button', { type: 'button', class: 'btn sm ghost danger', onclick: (e) => { e.stopPropagation(); sbMoveDialog(r, 'rejected', done); } }, 'رفض') : null);
}

// ---------- new submission ----------
export function sbNewSubmission(j, done) {
  const F = (k) => TABLES.researches.fields.find((f) => f.key === k);
  const researchers = []; const translators = [];
  const title = h('input', { type: 'text', dir: 'auto' });
  const lang = h('select', {}, h('option', { value: '' }, '—'), (S.data.languages || []).map((l) => h('option', { value: l.id }, l.name)));
  const received = h('input', { type: 'date', value: sbISO(new Date()) });
  const err = h('div', { class: 'form-err' });
  const field = (label, el, full) => h('div', { class: `field ${full ? 'full' : ''}` }, h('label', {}, label), el);
  const body = h('div', { class: 'record' }, h('section', { class: 'form-section' },
    h('div', { class: 'record-grid' },
      field('عنوان البحث *', title, true),
      field('الباحثون', linkPicker(F('researchers'), researchers, () => {}, true), true),
      field('المترجمون (إن وُجد)', linkPicker(F('translators'), translators, () => {}, true), true),
      field('اللغة', lang),
      field('تاريخ الاستلام', received)),
    h('small', { class: 'hint' }, `يُسجَّل الاستلام لمجلة «${j.name}» بمرحلة «${STAGES.received}».`)), err);
  const ok = h('button', {
    class: 'btn primary',
    onclick: async () => {
      err.textContent = '';
      if (!title.value.trim()) { err.textContent = 'عنوان البحث إلزامي'; title.focus(); return; }
      ok.disabled = true;
      try {
        const r = await api.insertRow('researches', { title: title.value.trim(), language_id: lang.value ? Number(lang.value) : null });
        S.data.researches.push(r);
        for (const [via, ids] of [['research_researchers', researchers], ['research_translators', translators]]) {
          for (const pid of ids) S.data[via].push(await api.insertRow(via, { research_id: r.id, person_id: pid }));
        }
        await api.upsertExtension('submissions', r.id, { journal_id: j.id, received_at: received.value || sbISO(new Date()), stage: 'received' });
        const fresh = await reloadResearch(r.id);
        sbInvalidate();
        close(true);
        toast('سُجّل الاستلام');
        done?.(fresh);
        sbOfferUpload(j, fresh);
      } catch (e) { err.textContent = e.message; ok.disabled = false; }
    },
  }, 'تسجيل الاستلام');
  const close = openModal(`استلام جديد · ${j.name}`, body, [ok, h('button', { class: 'btn ghost', onclick: () => close(true) }, 'إلغاء')]);
  setTimeout(() => title.focus(), 0);
}

// After a new submission: offer to upload the article file into «2.1 الأبحاث غير المنشورة»
export function sbOfferUpload(j, r) {
  const input = h('input', { type: 'file', multiple: true });
  const status = h('small', { class: 'muted' });
  const ok = h('button', {
    class: 'btn primary',
    onclick: async () => {
      if (!input.files.length) { status.textContent = 'اختر ملفاً أولاً'; return; }
      ok.disabled = true;
      try {
        const res = await flUploadToCode(j.id, '2.1', r, input.files, (f, p) => { status.textContent = `${f.name}: ${Math.round(p * 100)}%`; });
        toast(res.length === 1 ? 'رُفع ملف المقالة' : `رُفع ${res.length} ملفات`);
        close(true);
      } catch (e) { status.textContent = e.message; ok.disabled = false; }
    },
  }, icon('upload', 15), 'رفع');
  const close = openModal('رفع ملف المقالة', h('div', { class: 'sb-upload' },
    h('p', {}, `يُحفظ في «2.1 الأبحاث غير المنشورة» لمجلة ${j.name} مرتبطاً بالبحث «${r.title}». النسخة اللاحقة بالاسم نفسه (بعد التدقيق مثلاً) تُحفظ نسخة جديدة.`),
    input, status), [ok, h('button', { class: 'btn ghost', onclick: () => close(true) }, 'لاحقاً')]);
  document.querySelector('.modal-wrap:last-child .modal')?.classList.add('small');
}

// ---------- board ----------
function sbCard(r, done) {
  const sub = r.sub;
  const card = h('article', {
    class: 'sb-card', draggable: sbCanMove(r) ? 'true' : null, 'data-id': r.id,
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', String(r.id)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); },
    ondragend: () => card.classList.remove('dragging'),
  },
  h('button', { type: 'button', class: 'sb-title link-btn', onclick: () => openRecord('researches', S.byId.researches.get(r.id) || r) }, r.title),
  sbPeople(r, 'research_researchers') ? h('small', { class: 'sb-meta' }, icon('user', 12), sbPeople(r, 'research_researchers')) : null,
  h('small', { class: 'sb-meta muted' }, `استُلم ${sbFmt(sub.received_at)}`, ' · ', h('b', {}, sbDays(sbStageSince(sub)))),
  sub.stage === 'published' && r.pub?.issue_id ? h('small', { class: 'sb-meta muted' }, displayOf('issues', r.pub.issue_id)) : null,
  sbStageControls(r, done, { compact: true }));
  return card;
}

function sbBoard(j, redraw) {
  const rows = sbJournalRows(j.id);
  const byStage = (st) => rows.filter((r) => r.sub.stage === st)
    .sort((a, b) => String(sbStageSince(a.sub)).localeCompare(String(sbStageSince(b.sub))));
  const can = managesJournal(S.me.role, j.id);
  const dropTo = (stage) => ({
    ondragover: (e) => { if (can) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('drop'),
    ondrop: (e) => {
      e.preventDefault(); e.currentTarget.classList.remove('drop');
      const r = S.byId.researches.get(Number(e.dataTransfer.getData('text/plain')));
      if (r?.sub && r.sub.stage !== stage) sbMoveDialog(r, stage, redraw);
    },
  });
  const column = (stage, list, extra = '') => h('section', { class: `sb-col st-col-${stage} ${extra}`, ...dropTo(stage) },
    h('header', {}, h('b', {}, STAGES[stage]), h('small', { class: 'cnt' }, list.length)),
    h('div', { class: 'sb-cards' }, list.length ? list.map((r) => sbCard(r, redraw)) : h('small', { class: 'muted sb-empty' }, can ? 'اسحب بطاقة إلى هنا' : '—')));
  const published = byStage('published');
  const rejected = byStage('rejected');
  // wide screens: columns; phones: list with a stage filter
  const board = h('div', { class: 'sb-board' },
    SB_FLOW.map((st) => column(st, byStage(st))),
    column('published', published.slice(-10), 'end'),
    h('section', { class: 'sb-col st-col-rejected end narrow', ...dropTo('rejected') },
      h('header', {}, h('b', {}, STAGES.rejected), h('small', { class: 'cnt' }, rejected.length)),
      h('div', { class: 'sb-cards' }, h('small', { class: 'muted sb-empty' }, 'أفلت هنا للرفض.'),
        h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { S.sbView = 'archive'; redraw(); } }, 'أرشيف المرفوضات'))));
  const filter = lsGet('tajdid_sb_stage', 'active');
  const listRows = filter === 'active' ? rows.filter((r) => SB_FLOW.includes(r.sub.stage)) : rows.filter((r) => r.sub.stage === filter);
  const list = h('div', { class: 'sb-list' },
    h('select', { class: 'sb-filter', onchange: (e) => { lsSet('tajdid_sb_stage', e.target.value); redraw(); } },
      h('option', { value: 'active', selected: filter === 'active' }, `قيد العمل (${rows.filter((r) => SB_FLOW.includes(r.sub.stage)).length})`),
      [...SB_ORDER, 'rejected'].map((st) => h('option', { value: st, selected: filter === st }, `${STAGES[st]} (${byStage(st).length})`))),
    listRows.length ? listRows.map((r) => h('div', { class: 'sb-list-item' }, h('span', { class: 'chip enum st-wip' }, STAGES[r.sub.stage]), sbCard(r, redraw)))
      : h('p', { class: 'muted' }, 'لا توجد استلامات في هذه المرحلة.'));
  return [board, list];
}

// ---------- rejected archive ----------
const sbArchiveFiles = { key: '', list: [], loading: false };
function sbArchive(j, redraw) {
  const all = sbJournalRows(j.id).filter((r) => r.sub.stage === 'rejected')
    .sort((a, b) => String(b.sub.decided_at || '').localeCompare(String(a.sub.decided_at || '')));
  const years = [...new Set(all.map((r) => (r.sub.decided_at || r.sub.received_at || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const q = (S.sbArchiveQ || '').trim().toLowerCase();
  const year = S.sbArchiveYear || '';
  const rows = all.filter((r) => (!year || (r.sub.decided_at || r.sub.received_at || '').startsWith(year))
    && (!q || [r.title, r.sub.rejection_reason, sbPeople(r, 'research_researchers')].join(' ').toLowerCase().includes(q)));
  // files linked to the rejected researches (loaded once per set)
  const key = all.map((r) => r.id).join(',');
  if (sbArchiveFiles.key !== key && !sbArchiveFiles.loading) {
    sbArchiveFiles.loading = true;
    flFilesForResearches(all.map((r) => r.id)).then((list) => { Object.assign(sbArchiveFiles, { key, list }); })
      .catch(() => { Object.assign(sbArchiveFiles, { key, list: [] }); })
      .finally(() => { sbArchiveFiles.loading = false; redraw(); });
  }
  const filesOf = (rid) => sbArchiveFiles.list.filter((f) => f.research_id === rid);
  const search = h('input', { type: 'search', placeholder: 'بحث في العنوان أو السبب أو الباحث…', value: S.sbArchiveQ || '' });
  search.addEventListener('change', () => { S.sbArchiveQ = search.value; redraw(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { S.sbArchiveQ = search.value; redraw(); } });
  return h('div', { class: 'sb-archive' },
    h('div', { class: 'files-tools' },
      h('label', { class: 'search' }, icon('search', 16), search),
      h('select', { onchange: (e) => { S.sbArchiveYear = e.target.value; redraw(); } },
        h('option', { value: '' }, 'كل السنوات'), years.map((y) => h('option', { value: y, selected: y === year }, y))),
      h('small', { class: 'muted' }, `${rows.length} من ${all.length}`)),
    rows.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple' },
      h('thead', {}, h('tr', {}, ['العنوان', 'الباحثون', 'تاريخ الاستلام', 'تاريخ القرار', 'السبب', 'الملفات'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => openRecord('researches', r) }, r.title)),
        h('td', {}, sbPeople(r, 'research_researchers') || h('span', { class: 'muted' }, '—')),
        h('td', { class: 'muted' }, sbFmt(r.sub.received_at)),
        h('td', { class: 'muted' }, sbFmt(r.sub.decided_at)),
        h('td', {}, r.sub.rejection_reason || '—'),
        h('td', {}, sbArchiveFiles.loading && sbArchiveFiles.key !== key ? h('small', { class: 'muted' }, '…')
          : (filesOf(r.id).length ? filesOf(r.id).map((f) => h('button', { type: 'button', class: 'chip file-chip', title: 'فتح', onclick: () => flOpenFile(f) }, icon('file', 12), f.name)) : h('span', { class: 'muted' }, '—'))))))))
      : h('p', { class: 'muted' }, all.length ? 'لا توجد نتائج مطابقة.' : 'لا توجد مرفوضات في هذه المجلة.'));
}

// ---------- admin tables (decision 7) ----------
const SB_REPORTS = [
  ['received', 'المستلمة', 'تاريخ الاستلام'],
  ['under_review', 'المرسلة للمحكمين', 'تاريخ الإرسال'],
  ['proofread', 'المدققة', 'تاريخ التدقيق'],
  ['final', 'النهائية', 'تاريخ الاعتماد'],
];
function sbReportRows(j, kind, from, to) {
  const rows = sbJournalRows(j.id);
  const inRange = (d) => d && (!from || sbISO(d) >= from) && (!to || sbISO(d) <= to);
  if (kind === 'received') {
    return rows.filter((r) => inRange(r.sub.received_at)).map((r) => ({ r, date: r.sub.received_at, note: '' }));
  }
  const out = [];
  for (const e of sbEvents.list) {
    if (e.stage !== kind || !inRange(e.happened_at)) continue;
    const r = rows.find((x) => x.sub.id === e.submission_id);
    if (r) out.push({ r, date: e.happened_at, note: e.note || '' });
  }
  return out;
}
function sbCsv(name, header, lines) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...lines].map((l) => l.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function sbReports(j, redraw) {
  const kind = S.sbReport || 'received';
  const y = new Date().getFullYear();
  const from = S.sbFrom ?? `${y}-01-01`; const to = S.sbTo ?? `${y}-12-31`;
  const [, title, dateLabel] = SB_REPORTS.find((x) => x[0] === kind);
  const rows = sbReportRows(j, kind, from, to).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const quick = (label, f, t) => h('button', { type: 'button', class: `btn sm ${from === f && to === t ? 'active' : ''}`, onclick: () => { S.sbFrom = f; S.sbTo = t; redraw(); } }, label);
  const q = Math.floor(new Date().getMonth() / 3);
  const qFrom = sbISO(new Date(y, q * 3, 1, 12)); const qTo = sbISO(new Date(y, q * 3 + 3, 0, 12));
  const header = ['#', 'العنوان', 'الباحثون', 'المترجمون', dateLabel, 'المرحلة الحالية', 'ملاحظة'];
  const lines = rows.map(({ r, date, note }, i) => [i + 1, r.title, sbPeople(r, 'research_researchers'), sbPeople(r, 'research_translators'), sbISO(date), STAGES[r.sub.stage], note]);
  return h('div', { class: 'sb-reports' },
    h('nav', { class: 'sb-subtabs' }, SB_REPORTS.map(([k, label]) => h('button', { type: 'button', class: `view-tab ${k === kind ? 'on' : ''}`, onclick: () => { S.sbReport = k; redraw(); } }, label))),
    h('div', { class: 'files-tools sb-period' },
      h('label', { class: 'f inline' }, h('span', {}, 'من'), h('input', { type: 'date', value: from, onchange: (e) => { S.sbFrom = e.target.value; redraw(); } })),
      h('label', { class: 'f inline' }, h('span', {}, 'إلى'), h('input', { type: 'date', value: to, onchange: (e) => { S.sbTo = e.target.value; redraw(); } })),
      quick('هذا الفصل', qFrom, qTo), quick('هذا العام', `${y}-01-01`, `${y}-12-31`), quick('العام الماضي', `${y - 1}-01-01`, `${y - 1}-12-31`), quick('الكل', '', ''),
      h('button', { type: 'button', class: 'btn primary sm', disabled: !rows.length, onclick: () => sbCsv(`${j.name}-${title}-${from || 'all'}-${to || 'all'}.csv`, header, lines) }, icon('download', 14), 'تصدير CSV')),
    h('p', { class: 'muted' }, `${title} في ${j.name}: ${rows.length}`),
    rows.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple' },
      h('thead', {}, h('tr', {}, header.map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map(({ r, date, note }, i) => h('tr', { class: 'clickable', onclick: () => openRecord('researches', r) },
        h('td', { class: 'num' }, i + 1), h('td', {}, h('b', {}, r.title)),
        h('td', {}, sbPeople(r, 'research_researchers') || '—'), h('td', {}, sbPeople(r, 'research_translators') || '—'),
        h('td', { class: 'muted' }, sbFmt(date)), h('td', {}, STAGES[r.sub.stage]), h('td', { class: 'muted' }, note || ''))))))
      : h('p', { class: 'muted' }, 'لا شيء في هذه الفترة.'));
}

// ---------- the tab ----------
const SB_VIEWS = [['board', 'لوحة المراحل'], ['archive', 'أرشيف المرفوضات'], ['reports', 'الجداول الإدارية']];
export function submissionsTab(j) {
  const box = h('div', { class: 'journal-page sb-page' });
  const redraw = () => {
    if (!sbEnsureEvents(j.id, redraw) && sbEvents.jid !== j.id) { sbSet(box, h('p', { class: 'muted' }, 'جارٍ تحميل الاستلامات…')); return; }
    const view = S.sbView || 'board';
    const can = managesJournal(S.me.role, j.id);
    const total = sbJournalRows(j.id).filter((r) => SB_FLOW.includes(r.sub.stage)).length;
    sbSet(box,
      h('div', { class: 'section-head' },
        h('nav', { class: 'sb-subtabs' }, SB_VIEWS.map(([k, label]) => h('button', { type: 'button', class: `view-tab ${k === view ? 'on' : ''}`, onclick: () => { S.sbView = k; redraw(); } }, label))),
        can ? h('button', { class: 'btn primary', onclick: () => sbNewSubmission(j, () => renderShell()) }, icon('plus', 16), 'استلام جديد') : null),
      view === 'board' ? [h('p', { class: 'muted' }, `${total} استلام قيد العمل. اسحب البطاقة إلى عمود لنقلها، أو استعمل «المرحلة التالية».`), sbBoard(j, redraw)] : null,
      view === 'archive' ? sbArchive(j, redraw) : null,
      view === 'reports' ? sbReports(j, redraw) : null);
  };
  redraw();
  return box;
}
