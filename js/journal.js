// «مجلتي»: a journal's own space — overview, issues (one page per issue), people, files.
// Articles come from center_publications (kind = article) through their issue. Books are not part of journals.
import { icon } from './icons.js';
import {
  S, h, displayOf, chipClass, openRecord, renderShell, lsGet, lsSet, linkedIds, subtitleOf, isArticle,
} from './app.js';
import { canInsert, canEditRow, managesJournal, seesSubmissions } from './schema.js';
import { filesTab, issueCover, issueFilesCard, issueThumb } from './files.js';

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
export const journalNavVisible = () => ['owner', 'admin', 'editor'].includes(S.me.role) && myJournals().length > 0;

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
  return h('div', { class: 'toolbar journal-bar' },
    h('h1', {}, icon('journal', 22), title),
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
      seesSubmissions(S.me.role) ? tile(inProgressOf(j.id).length, 'استلام قيد العمل') : null,
      tile(people('research_researchers'), 'باحث'), tile(people('research_translators'), 'مترجم')),
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

function newIssue(j) {
  const max = Math.max(0, ...issuesOf(j.id).map((i) => i.number));
  openRecord('issues', null, 'number', { journal_id: j.id, number: max + 1, year: new Date().getFullYear() });
}

// ---------- issues ----------
function issueCard(i) {
  const n = articlesOf(i.id).length;
  return h('button', { class: 'issue-card', onclick: () => go({ journalTab: 'issues', issueId: i.id }) },
    issueThumb(i, h('span', { class: `issue-num ${chipClass('journals', i.journal_id).replace('chip ', '')}` }, i.number)),
    h('span', { class: 'issue-meta' },
      h('b', {}, `العدد ${i.number}${i.title ? ` · ${i.title}` : ''}`),
      h('small', { class: 'muted' }, [i.year, `${n} مقالة`].filter(Boolean).join(' · '))));
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
        h('h2', {}, `${j.name} · العدد ${issue.number}`),
        issue.title ? h('p', { class: 'issue-title' }, issue.title) : null,
        h('p', { class: 'muted' }, [issue.year && `سنة ${issue.year}`, `${rows.length} مقالة`, pages ? `${pages} صفحة` : null].filter(Boolean).join(' · ')),
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

export function renderJournal(main) {
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

