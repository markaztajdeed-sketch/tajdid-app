// Journal files: folder tree, upload with progress, temporary links, rename, trash.
// NOTE: all modules share one scope in the bundle — internal names here start with "fl".
import { icon } from './icons.js';
import * as api from './api.js';
import { S, h, toast, openModal, userName } from './app.js';
import { managesJournal } from './schema.js';

const FL_BUCKET = 'journal-files';
const flCache = { jid: null, folders: [], files: [], loading: null, error: null };

// ---------- data ----------
async function flLoad(jid) {
  const [folders, files] = await Promise.all([
    api.select('folders', `journal_id=eq.${jid}&deleted_at=is.null&order=sort,id`),
    api.select('files', `journal_id=eq.${jid}&deleted_at=is.null&order=name`, '*,file_versions(id,version,size,mime,path,created_at,created_by)'),
  ]);
  for (const f of files) {
    const vs = (f.file_versions || []).sort((a, b) => b.version - a.version);
    f.versions = vs; f.latest = vs[0] || null; f.size = f.latest?.size ?? null; delete f.file_versions;
  }
  Object.assign(flCache, { jid, folders, files, error: null });
}
export function flEnsure(jid, redraw) {
  if (flCache.jid === jid && !flCache.loading) return true;
  if (!flCache.loading) {
    flCache.loading = flLoad(jid)
      .catch((e) => { flCache.jid = jid; flCache.folders = []; flCache.files = []; flCache.error = e.message; })
      .finally(() => { flCache.loading = null; redraw(); });
  }
  return false;
}
export function flReset() { flCache.jid = null; }

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
export const flFolderLabel = (f) => (f.code ? `${f.code} ${f.name}` : f.name);
export const flIssueFolder = (issueId) => flCache.folders.find((f) => f.issue_id === issueId && f.kind === 'issue');

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
    await flLoad(flCache.jid); toast('نُقل إلى السلة'); redraw();
  } catch (e) { toast(e.message, 'err'); }
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
      h('td', {}, h('span', { class: 'f-name' }, icon('file', 17), f.name, f.current_version > 1 ? h('small', { class: 'chip ver' }, `نسخة ${f.current_version}`) : null)),
      h('td', { class: 'muted' }, flSize(f.size)),
      h('td', { class: 'muted' }, flDate(f.updated_at || f.created_at)),
      h('td', { class: 'muted' }, userName(f.updated_by || f.created_by) || ''),
      h('td', { class: 'f-act' },
        act('eye', 'فتح', () => flOpen(f)), act('download', 'تنزيل', () => flOpen(f, true)),
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
