// «إصدارات المركز»: the center's books (center_publications with a book kind) and the library of their files.
// Owner & admin only. Each book has an automatic folder (kind = book) in the library; files are stored under center/….
// NOTE: all modules share one scope in the bundle — internal names here start with "bk".
import { icon } from './icons.js';
import {
  S, h, displayOf, linkedIds, openRecord, renderShell, chipClass, isBook, lsGet, lsSet,
} from './app.js';
import { PUB_KINDS, CENTER_LIBRARY } from './schema.js';
import { filesTab, bookThumb } from './files.js';

const BK_KINDS = ['authored_book', 'translated_book', 'extracted_book'];
const BK_TABS = [['books', 'الكتب', 'book'], ['files', 'الملفات', 'folder']];
export const booksNavVisible = () => ['owner', 'admin'].includes(S.me?.role);

const bkPeople = (r, via) => linkedIds({ via, self: 'research_id', other: 'person_id' }, r.id).map((id) => displayOf('persons', id));
const bkTopics = (r) => linkedIds({ via: 'research_topics', self: 'research_id', other: 'topic_id' }, r.id);
const bkBooks = () => (S.data.researches || []).filter(isBook);

function bkNew(kind) {
  // the research window has every section a book needs: kind, bibliographic data, translators,
  // original title & language (shown for translations), topics; the book folder is created by the database
  openRecord('researches', null, 'title', { pub: { kind: BK_KINDS.includes(kind) ? kind : 'authored_book' } });
}

function bkList(main) {
  const kind = lsGet('tajdid_bk_kind', 'all');
  const q = (S.bkSearch || '').trim().toLowerCase();
  const all = bkBooks();
  const rows = all.filter((r) => (kind === 'all' || r.pub.kind === kind)
    && (!q || [r.title, ...bkPeople(r, 'research_researchers'), ...bkPeople(r, 'research_translators'), r.bib?.isbn].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'ar'));
  const search = h('input', { type: 'search', placeholder: 'بحث في العنوان أو المؤلف أو ISBN…', value: S.bkSearch || '' });
  search.addEventListener('input', () => { S.bkSearch = search.value; const pos = search.selectionStart; renderShell(); const el = document.querySelector('.bk-page .search input'); el?.focus(); el?.setSelectionRange(pos, pos); });
  const count = (k) => (k === 'all' ? all.length : all.filter((r) => r.pub.kind === k).length);
  const people = (r) => {
    const authors = bkPeople(r, 'research_researchers'); const trs = bkPeople(r, 'research_translators');
    return [authors.length ? authors.join('، ') : null, trs.length ? `ترجمة: ${trs.join('، ')}` : null].filter(Boolean);
  };
  return h('div', { class: 'journal-page bk-page' },
    h('div', { class: 'section-head' },
      h('nav', { class: 'sb-subtabs', 'aria-label': 'نوع الكتاب' }, [['all', 'الكل'], ...BK_KINDS.map((k) => [k, PUB_KINDS[k]])].map(([k, label]) => h('button', {
        type: 'button', class: `view-tab ${k === kind ? 'on' : ''}`, onclick: () => { lsSet('tajdid_bk_kind', k); renderShell(); },
      }, label, h('small', { class: 'cnt' }, count(k))))),
      h('button', { class: 'btn primary', onclick: () => bkNew(kind) }, icon('plus', 16), 'كتاب جديد')),
    h('label', { class: 'search' }, icon('search', 16), search),
    rows.length ? h('div', { class: 'grid-wrap flat' }, h('table', { class: 'grid simple bk-table' },
      h('thead', {}, h('tr', {}, ['', 'العنوان', 'النوع', 'المؤلف / المترجم', 'السنة', 'ISBN', 'المواضيع'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: 'clickable', onclick: () => openRecord('researches', S.byId.researches.get(r.id) || r) },
        h('td', { class: 'bk-cover' }, bookThumb(r, h('span', { class: 'bk-ph' }, icon('book', 18)))),
        h('td', {}, h('b', {}, r.title)),
        h('td', {}, h('span', { class: 'chip center' }, PUB_KINDS[r.pub.kind])),
        h('td', {}, people(r).length ? people(r).map((p) => h('div', {}, p)) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'num' }, r.year ?? '—'),
        h('td', { class: 'ltr muted' }, r.bib?.isbn || '—'),
        h('td', {}, bkTopics(r).map((id) => h('span', { class: chipClass('topics', id) }, displayOf('topics', id)))))))))
      : h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, all.length ? 'لا توجد كتب مطابقة.' : 'لا توجد كتب في إصدارات المركز بعد.')));
}

export function renderBooks(main) {
  const tab = S.bkTab || 'books';
  const header = h('div', { class: 'toolbar journal-bar' },
    h('h1', {}, icon('book', 22), h('span', { class: 'chip center big' }, CENTER_LIBRARY)),
    h('nav', { class: 'tabs', role: 'tablist' }, BK_TABS.map(([k, label, ic]) => h('button', {
      class: `tab ${tab === k ? 'on' : ''}`, role: 'tab', onclick: () => { S.bkTab = k; renderShell(); },
    }, icon(ic, 16), label))));
  // the library is the files component with no journal (journal_id = null, storage under center/…)
  const body = tab === 'files' ? filesTab({ id: null, name: CENTER_LIBRARY }) : bkList(main);
  main.replaceChildren(header, h('div', { class: 'journal-scroll' }, body));
}
