import { icon } from './icons.js';
import { S, h, displayOf, userName, researchJournal, isBook, researchStatus } from './app.js';
import { CENTER_LIBRARY, PUB_KINDS, STAGES, seesSubmissions } from './schema.js';

// Where a research is published: its journal, or the center library for books
const placeOf = (r) => (isBook(r) ? '__center' : researchJournal(r));
const placeLabel = (k) => (k === '__center' ? CENTER_LIBRARY : displayOf('journals', k));

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

export function renderStats(main) {
  const R = S.data.researches;
  const links = (via, self, other) => (rid) => S.data[via].filter((l) => l[self] === rid).map((l) => l[other]);
  const topicsOf = links('research_topics', 'research_id', 'topic_id');
  const pub = links('research_publishers', 'research_id', 'publisher_id');
  const researchers = new Set(S.data.research_researchers.map((l) => l.person_id));
  const translators = new Set(S.data.research_translators.map((l) => l.person_id));
  const translated = new Set(S.data.research_translators.map((l) => l.research_id));
  const noResearcher = R.filter((r) => !S.data.research_researchers.some((l) => l.research_id === r.id)).length;
  const noTopic = R.filter((r) => !topicsOf(r.id).length).length;
  const published = R.filter((r) => r.pub).length;
  const books = R.filter((r) => isBook(r)).length;
  const subs = R.filter((r) => r.sub);
  const inProgress = subs.filter((r) => researchStatus(r).kind === 'wip').length;
  const rejected = subs.filter((r) => r.sub.stage === 'rejected').length;
  const noSummary = R.filter((r) => !String(r.summary || '').trim()).length;

  const tile = (label, n, sub) => h('div', { class: 'tile' }, h('span', { class: 'tile-n' }, n), h('span', { class: 'tile-l' }, label), sub ? h('small', {}, sub) : null);
  const scope = S.me.role === 'editor' ? h('p', { class: 'muted' }, 'تظهر هنا إحصائيات الأبحاث المرتبطة بمجلاتك فقط.') : null;

  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('chart', 22), 'الإحصائيات')),
    h('div', { class: 'stats' },
      scope,
      h('div', { class: 'tiles' },
        tile('بحث', R.length, `${translated.size} منها مترجم · ${published} من منشورات المركز`),
        tile('باحث', researchers.size),
        tile('مترجم', translators.size),
        tile('ناشر', S.data.publishers.length),
        tile('عدد', (S.data.issues || []).length, `في ${S.data.journals.length} مجلات`),
        tile('كتاب', books, CENTER_LIBRARY),
        seesSubmissions(S.me.role) ? tile('استلام قيد العمل', inProgress, `${rejected} مرفوض`) : null),
      h('div', { class: 'cards' },
        barCard('منشورات المركز', countBy(R.filter((r) => r.pub), placeOf), { labelFn: placeLabel }),
        books ? barCard('الكتب حسب النوع', countBy(R.filter((r) => isBook(r)), (r) => r.pub.kind), { labelFn: (k) => PUB_KINDS[k] }) : null,
        seesSubmissions(S.me.role) && subs.length ? barCard('الاستلامات حسب المرحلة', countBy(subs, (r) => r.sub.stage), { labelFn: (k) => STAGES[k] }) : null,
        barCard('الأبحاث حسب الموضوع', countBy(R, (r) => topicsOf(r.id)), { labelFn: (k) => displayOf('topics', k) }),
        barCard('الأبحاث حسب سنة النشر', countBy(R, (r) => r.year ?? '__none'), { sortByLabel: true }),
        barCard('الأبحاث حسب الناشر', countBy(R, (r) => pub(r.id)), { labelFn: (k) => displayOf('publishers', k) }),
        barCard('الأبحاث حسب اللغة', countBy(R, (r) => r.language_id ?? '__none'), { labelFn: (k) => displayOf('languages', k) }),
        barCard('الأبحاث حسب النوع', countBy(R, (r) => r.research_type_id ?? '__none'), { labelFn: (k) => displayOf('research_types', k) }),
        S.me.role !== 'editor' ? barCard('الأبحاث حسب مُدخل البيانات', countBy(R, (r) => r.created_by || 'nocodb'), { labelFn: (k) => (k === 'nocodb' ? 'NocoDB / قبل الواجهة' : userName(k)) }) : null,
        h('section', { class: 'card' }, h('h3', {}, 'اكتمال البيانات'),
          h('ul', { class: 'gaps' },
            h('li', {}, h('b', {}, noResearcher), ' بحث بدون باحث'),
            h('li', {}, h('b', {}, noTopic), ' بحث بلا موضوع'),
            h('li', {}, h('b', {}, noSummary), ' بحث بدون ملخص'),
            h('li', {}, h('b', {}, S.data.persons.filter((p) => !p.nationality_id).length), ' شخص بدون جنسية'),
            h('li', {}, h('b', {}, S.data.publishers.filter((p) => !p.country_id).length), ' ناشر بدون دولة'))))));
}
