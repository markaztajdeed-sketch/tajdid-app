// Journal files: folder tree, upload with progress, temporary links, rename, trash.
// NOTE: all modules share one scope in the bundle — internal names here start with "fl".
import { icon } from './icons.js';
import * as api from './api.js';
import { S, h, toast, openModal, userName, displayOf, researchJournal, renderShell, chipClass, isBook } from './app.js';
import { managesJournal, STAGES, CENTER_LIBRARY } from './schema.js';

const FL_BUCKET = 'journal-files';
// jid = a journal id, or null for the «إصدارات المركز» library (folders and files without a journal)
const flCache = { key: undefined, jid: null, folders: [], files: [], loading: null, error: null };
const flKey = (jid) => (jid == null ? 'center' : String(jid));
const flScopeQs = (jid) => (jid == null ? 'journal_id=is.null' : `journal_id=eq.${jid}`);

// ---------- data ----------
async function flLoad(jid) {
  const [folders, files] = await Promise.all([
    api.select('folders', `${flScopeQs(jid)}&deleted_at=is.null&order=sort,id`),
    api.select('files', `${flScopeQs(jid)}&deleted_at=is.null&order=name`, '*,file_versions(id,version,size,mime,path,note,created_at,created_by)'),
  ]);
  for (const f of files) {
    const vs = (f.file_versions || []).sort((a, b) => b.version - a.version);
    f.versions = vs; f.latest = vs[0] || null; f.size = f.latest?.size ?? null; delete f.file_versions;
  }
  Object.assign(flCache, { key: flKey(jid), jid, folders, files, error: null });
}
export function flEnsure(jid, redraw) {
  if (flCache.key === flKey(jid) && !flCache.loading) return true;
  if (!flCache.loading) {
    flCache.loading = flLoad(jid)
      .catch((e) => { Object.assign(flCache, { key: flKey(jid), jid, folders: [], files: [], error: e.message }); })
      .finally(() => { flCache.loading = null; redraw(); });
  }
  return false;
}
export function flReset() { flCache.key = undefined; }

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
// Mind-map numbering is shown for journal folders only (the library uses internal codes C, C.1…)
export const flFolderLabel = (f) => (f.code && /^\d/.test(f.code) ? `${f.code} ${f.name}` : f.name);
export const flIssueFolder = (issueId) => flCache.folders.find((f) => f.issue_id === issueId && f.kind === 'issue');

function flSize(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ك.ب`;
  return `${(n / 1024 / 1024).toFixed(1)} م.ب`;
}
const flDate = (d) => (d ? new Date(d).toLocaleDateString('ar-LB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const flCanEditFolder = (j, f) => managesJournal(S.me.role, j.id) && (f.kind === 'custom' || ['owner', 'admin'].includes(S.me.role));

// Version note = the current submission stage of the linked research («مستلَم»، «قيد التدقيق»، «مدقَّق»…),
// so the file before and after proofreading are two versions of the same file
export function flStageNote(researchId) {
  const r = researchId ? S.byId.researches?.get(researchId) : null;
  return r?.sub ? (STAGES[r.sub.stage] ?? null) : null;
}

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

// Storage path: {journal_id}/… for journals, center/… for the library
function flObjectPath(jid, name) {
  const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
  return `${jid == null ? 'center' : jid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext.toLowerCase()}` : ''}`;
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
        row = await api.insertRow('files', { folder_id: folder.id, journal_id: j.id, name: file.name, issue_id: folder.issue_id ?? null, research_id: folder.research_id ?? null });
        flCache.files.push(row);
      }
      const v = await api.insertRow('file_versions', { file_id: row.id, path, size: file.size, mime: file.type || null, note: flStageNote(row.research_id) });
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
  return api.insertRow('file_versions', { file_id: file.id, path, size: blob.size, mime: blob.type || null, note: extra.note || flStageNote(file.research_id) });
}

function flDetails(j, file, redraw) {
  const can = managesJournal(S.me.role, j.id);
  const res = (S.data.researches || []).filter((r) => (j.id == null ? isBook(r) : researchJournal(r) === j.id) || r.id === file.research_id)
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
      await flAddVersion(file, f, null, { onProgress: (p) => { status.textContent = `جارٍ الرفع… ${Math.round(p * 100)}%`; }, note: [flStageNote(file.research_id), f.name !== file.name ? `من ملف «${f.name}»` : null].filter(Boolean).join(' · ') || null });
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
export function issueCover(j, issue, fallback) {
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
export function issueFilesCard(j, issue, go) {
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

export function linkedFilesSection(table, row) {
  if (!['owner', 'admin', 'editor'].includes(S.me.role) || !row?.id) return null;
  const col = table === 'researches' ? 'research_id' : table === 'persons' ? 'person_id' : null;
  if (!col) return null;
  const list = h('div', { class: 'linked-files' }, h('p', { class: 'muted' }, 'جارٍ التحميل…'));
  const sec = h('section', { class: 'form-section' }, h('h4', {}, 'الملفات المرتبطة'), list);
  // Where uploads go: an article → its issue folder; a book → its folder in «إصدارات المركز» (owner & admin)
  const issue = table === 'researches' && row.pub?.kind === 'article' ? S.byId.issues?.get(row.pub.issue_id) : null;
  const book = table === 'researches' && isBook(row);
  const target = issue && managesJournal(S.me.role, issue.journal_id)
    ? { jid: issue.journal_id, qs: `issue_id=eq.${issue.id}&kind=eq.issue&deleted_at=is.null`, extra: { issue_id: issue.id }, label: 'رفع ملف لهذه المقالة', empty: 'لا توجد ملفات مرتبطة بعد. ارفع ملف المقالة هنا، فيُحفظ في مجلد عددها ويرتبط بها.' }
    : (book && ['owner', 'admin'].includes(S.me.role)
      ? { jid: null, qs: `research_id=eq.${row.id}&kind=eq.book&deleted_at=is.null`, extra: {}, label: 'رفع ملف للكتاب', empty: `لا توجد ملفات بعد. ما يُرفع هنا يُحفظ في مجلد الكتاب في «${CENTER_LIBRARY}».` }
      : null);
  const status = h('small', { class: 'muted' });
  const input = h('input', { type: 'file', multiple: true, hidden: true });
  const coverInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  for (const el of [input, coverInput]) el.addEventListener('input', (e) => e.stopPropagation());
  let files = [];

  const findFolder = async () => {
    const [folder] = await api.select('folders', target.qs);
    if (!folder) throw new api.ApiError(book ? 'لا يوجد مجلد لهذا الكتاب بعد. احفظ نوع النشر أولاً.' : 'لا يوجد مجلد لهذا العدد');
    return folder;
  };
  const uploadOne = async (folder, file, name = file.name) => {
    const path = flObjectPath(target.jid, name);
    await api.uploadPrivate(FL_BUCKET, path, file, (p) => { status.textContent = `${name}: ${Math.round(p * 100)}%`; });
    const [same] = await api.select('files', `folder_id=eq.${folder.id}&name=eq.${encodeURIComponent(name)}&deleted_at=is.null`);
    const f = same || await api.insertRow('files', { folder_id: folder.id, journal_id: target.jid, name, research_id: row.id, ...target.extra });
    if (same && !same.research_id) await api.updateRows('files', { id: same.id }, { research_id: row.id });
    await api.insertRow('file_versions', { file_id: f.id, path, size: file.size, mime: file.type || null, note: flStageNote(row.id) });
    return f;
  };
  // book cover: one image in the book folder flagged is_issue_cover (same flag as issue covers)
  const setCover = async (f) => {
    for (const o of files.filter((x) => x.is_issue_cover && x.id !== f.id && x.folder_id === f.folder_id)) await api.updateRows('files', { id: o.id }, { is_issue_cover: false });
    await api.updateRows('files', { id: f.id }, { is_issue_cover: true });
  };

  const draw = async () => {
    try { files = (await api.select('files', `${col}=eq.${row.id}&deleted_at=is.null&order=name`, FL_COLS)).map(flNormalize); } catch (e) { list.replaceChildren(h('p', { class: 'form-err' }, e.message)); return; }
    const act = (ic, label, fn) => h('button', { type: 'button', class: 'btn ghost sm icon-btn', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 15));
    const where = (f) => [f.journal_id == null ? CENTER_LIBRARY : displayOf('journals', f.journal_id), f.folder?.name].filter(Boolean).join(' › ');
    const isImg = (f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name) || /^image\//.test(f.latest?.mime || '');
    const parts = [
      files.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple files-table' },
        h('tbody', {}, files.map((f) => h('tr', { class: 'clickable', onclick: () => flOpen(f) },
          h('td', {}, h('span', { class: 'f-name' }, icon('file', 16), f.name,
            f.is_issue_cover ? h('small', { class: 'chip ver' }, 'الغلاف') : null,
            f.current_version > 1 ? h('small', { class: 'chip ver' }, `نسخة ${f.current_version}`) : null),
            h('small', { class: 'muted sub' }, where(f))),
          h('td', { class: 'muted' }, flSize(f.size)),
          h('td', { class: 'f-act' },
            book && target && isImg(f) && !f.is_issue_cover ? act('camera', 'تعيين غلافاً للكتاب', async () => { try { await setCover(f); toast('تم تعيين الغلاف'); flReset(); draw(); } catch (e) { toast(e.message, 'err'); } }) : null,
            act('eye', 'فتح', () => flOpen(f)), act('download', 'تنزيل', () => flOpen(f, true))))))))
        : h('p', { class: 'muted' }, target ? target.empty : 'لا توجد ملفات مرتبطة. يمكن ربط أي ملف من نافذة «النسخ والتفاصيل» في تبويب الملفات.'),
      target ? h('div', { class: 'files-tools' },
        h('button', { type: 'button', class: 'btn', onclick: () => input.click() }, icon('upload', 15), target.label),
        book ? h('button', { type: 'button', class: 'btn', onclick: () => coverInput.click() }, icon('camera', 15), files.some((f) => f.is_issue_cover) ? 'تغيير الغلاف' : 'رفع غلاف') : null,
        status, input, coverInput) : null,
    ];
    list.replaceChildren(...parts.filter(Boolean));
  };

  input.addEventListener('change', async (e) => {
    e.stopPropagation();
    const chosen = [...input.files]; input.value = '';
    if (!chosen.length) return;
    try {
      const folder = await findFolder();
      for (const file of chosen) await uploadOne(folder, file);
      status.textContent = 'تم الرفع'; flReset(); draw();
    } catch (e) { status.textContent = ''; toast(e.message, 'err'); }
  });
  coverInput.addEventListener('change', async (e) => {
    e.stopPropagation();
    const file = coverInput.files[0]; coverInput.value = '';
    if (!file) return;
    try {
      const folder = await findFolder();
      const ext = (file.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
      const f = await uploadOne(folder, file, `غلاف الكتاب.${ext}`);
      files = (await api.select('files', `${col}=eq.${row.id}&deleted_at=is.null`, FL_COLS)).map(flNormalize);
      await setCover(f);
      status.textContent = 'تم تحديث الغلاف'; flReset(); draw();
    } catch (err) { status.textContent = ''; toast(err.message, 'err'); }
  });
  draw();
  return sec;
}

// Small cover image of a book (from its folder in the library), or the fallback
export function bookThumb(r, fallback) {
  if (!['owner', 'admin'].includes(S.me.role)) return fallback;
  if (!flEnsure(null, renderShell) || flCache.key !== flKey(null)) return fallback;
  const folder = flCache.folders.find((f) => f.kind === 'book' && f.research_id === r.id);
  if (!folder) return fallback;
  const ids = new Set(flDescFolders(folder.id));
  const cover = flCache.files.find((f) => ids.has(f.folder_id) && f.is_issue_cover && f.latest);
  if (!cover) return fallback;
  const img = h('img', { class: 'book-thumb', alt: '', title: `غلاف «${r.title}»` });
  flThumbUrl(cover.latest).then((u) => { img.src = u; }).catch(() => img.replaceWith(fallback));
  return img;
}

// Upload files for a research into a fixed folder of its journal (e.g. '2.1' الأبحاث غير المنشورة).
// A file with the same name in that folder becomes a new version; the version note is the submission stage.
export async function flUploadToCode(jid, code, research, fileList, onProgress) {
  const [folder] = await api.select('folders', `journal_id=eq.${jid}&code=eq.${encodeURIComponent(code)}&kind=eq.fixed&deleted_at=is.null`);
  if (!folder) throw new api.ApiError('لم يُعثر على المجلد في هذه المجلة');
  const out = [];
  for (const file of [...fileList]) {
    if (file.size > api.MAX_FILE_MB * 1024 * 1024) throw new api.ApiError(`«${file.name}» أكبر من ${api.MAX_FILE_MB} ميغابايت`);
    const path = flObjectPath(jid, file.name);
    await api.uploadPrivate(FL_BUCKET, path, file, (p) => onProgress?.(file, p));
    const [same] = await api.select('files', `folder_id=eq.${folder.id}&name=eq.${encodeURIComponent(file.name)}&deleted_at=is.null`);
    const f = same || await api.insertRow('files', { folder_id: folder.id, journal_id: jid, name: file.name, research_id: research.id });
    if (same && !same.research_id) await api.updateRows('files', { id: same.id }, { research_id: research.id });
    const v = await api.insertRow('file_versions', { file_id: f.id, path, size: file.size, mime: file.type || null, note: flStageNote(research.id) });
    out.push({ file: f, version: v.version });
  }
  flReset();
  return out;
}
// Files linked to several researches (for the rejected archive)
export async function flFilesForResearches(ids) {
  if (!ids.length) return [];
  return (await api.select('files', `research_id=in.(${ids.join(',')})&deleted_at=is.null&order=name`, FL_COLS)).map(flNormalize);
}
export const flOpenFile = (f, download = false) => flOpen(f, download);

// Small cover image for issue cards (falls back to the colored number)
export function issueThumb(issue, fallback) {
  if (!managesJournal(S.me.role, issue.journal_id)) return fallback;
  if (!flEnsure(issue.journal_id, renderShell) || flCache.key !== flKey(issue.journal_id)) return fallback;
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
export function renderTrash(main) {
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
        h('td', {}, it.row.journal_id == null ? h('span', { class: 'chip center' }, CENTER_LIBRARY) : h('span', { class: chipClass('journals', it.row.journal_id) }, displayOf('journals', it.row.journal_id))),
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
  if (!managesJournal(S.me.role, j.id)) { toast(j.id == null ? 'مكتبة إصدارات المركز للمالك والإدارة فقط' : 'ليس لديك صلاحية للرفع إلى هذه المجلة', 'err'); return; }
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
export function filesTab(j) {
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
