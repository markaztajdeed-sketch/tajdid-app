// Table & field definitions: database names (English) ↔ interface labels (Arabic).
// Field types: text | longtext | number | url | fk | enum | link | contacts | user | date | derived | publication | computed
// ext: the 1:1 extension object on the research row (pub | bib | trans | sub), col: its column

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

export const TABLES = {
  researches: {
    label: 'الأبحاث', single: 'بحث', icon: 'book', display: 'title', group: 'main',
    // Columns read from the database (the old publication columns of researches are no longer used),
    // with the 1:1 extension tables embedded: pub, bib, trans, sub
    select: 'id,title,summary,year,language_id,research_type_id,url,notes,created_at,created_by,updated_at,updated_by,'
      + 'pub:center_publications(*),bib:bibliographic_details(*),trans:translation_details(*),sub:submissions(*)',
    fields: [
      { key: 'title', label: 'عنوان البحث', type: 'text', required: true, width: 320 },
      { key: 'researchers', label: 'الباحثون', type: 'link', via: 'research_researchers', self: 'research_id', other: 'person_id', ref: 'persons', width: 200 },
      { key: 'translators', label: 'المترجمون', type: 'link', via: 'research_translators', self: 'research_id', other: 'person_id', ref: 'persons', width: 180 },
      { key: 'status', label: 'الوضع', type: 'computed', readonly: true, width: 220 },
      { key: 'publication', label: 'النشر في مجلاتنا', type: 'publication', readonly: true, width: 210 },
      { key: 'year', label: 'السنة', type: 'number', width: 80 },
      { key: 'research_type_id', label: 'النوع', type: 'fk', ref: 'research_types', width: 100 },
      { key: 'language_id', label: 'اللغة', type: 'fk', ref: 'languages', width: 110 },
      { key: 'topics', label: 'المواضيع', type: 'link', via: 'research_topics', self: 'research_id', other: 'topic_id', ref: 'topics', width: 170 },
      { key: 'publishers', label: 'الناشرون', type: 'link', via: 'research_publishers', self: 'research_id', other: 'publisher_id', ref: 'publishers', width: 200 },
      { key: 'tags', label: 'الوسوم', type: 'link', via: 'research_tags', self: 'research_id', other: 'tag_id', ref: 'tags', width: 160 },
      // ---- center_publications (pub) ----
      { key: 'pub_kind', label: 'نوع النشر', type: 'enum', options: 'PUB_KINDS', ext: 'pub', col: 'kind', width: 120 },
      { key: 'pub_journal', label: 'المجلة', type: 'computed', readonly: true, width: 130 },
      { key: 'issue_id', label: 'العدد', type: 'fk', ref: 'issues', ext: 'pub', col: 'issue_id', width: 170 },
      { key: 'issue_order', label: 'ترتيبها في العدد', type: 'number', ext: 'pub', col: 'issue_order', width: 90 },
      { key: 'pub_pages', label: 'الصفحات', type: 'computed', readonly: true, width: 100 },
      { key: 'start_page', label: 'من صفحة', type: 'number', ext: 'pub', col: 'start_page', width: 80 },
      { key: 'end_page', label: 'إلى صفحة', type: 'number', ext: 'pub', col: 'end_page', width: 80 },
      // ---- submissions (sub) — not visible to data entry ----
      { key: 'sub_journal', label: 'مجلة الاستلام', type: 'fk', ref: 'journals', ext: 'sub', col: 'journal_id', width: 130, subOnly: true },
      { key: 'stage', label: 'المرحلة', type: 'enum', options: 'STAGES', ext: 'sub', col: 'stage', width: 130, subOnly: true },
      { key: 'received_at', label: 'تاريخ الاستلام', type: 'date', ext: 'sub', col: 'received_at', width: 120, subOnly: true },
      { key: 'decided_at', label: 'تاريخ القرار', type: 'date', ext: 'sub', col: 'decided_at', width: 120, subOnly: true },
      { key: 'rejection_reason', label: 'سبب الرفض', type: 'text', ext: 'sub', col: 'rejection_reason', width: 240, subOnly: true },
      // ---- bibliographic_details (bib) ----
      { key: 'isbn', label: 'ISBN', type: 'text', ext: 'bib', col: 'isbn', width: 150, ltr: true },
      { key: 'doi', label: 'DOI', type: 'text', ext: 'bib', col: 'doi', width: 150, ltr: true },
      { key: 'pages', label: 'عدد الصفحات', type: 'number', ext: 'bib', col: 'pages', width: 100 },
      // ---- translation_details (trans) ----
      { key: 'original_title', label: 'العنوان الأصلي', type: 'text', ext: 'trans', col: 'original_title', width: 240 },
      { key: 'original_language_id', label: 'اللغة الأصلية', type: 'fk', ref: 'languages', ext: 'trans', col: 'original_language_id', width: 110 },
      { key: 'url', label: 'رابط البحث', type: 'url', width: 160 },
      { key: 'summary', label: 'الملخص', type: 'longtext', width: 260 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220 },
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
        compute: 'journals_via_researches', sources: [{ via: 'research_researchers', self: 'person_id' }, { via: 'research_translators', self: 'person_id' }] },
      { key: 'production', label: 'إنتاجه في مجلاتنا', type: 'production', readonly: true, hidden: true, width: 300 },
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
        compute: 'journals_via_researches', sources: [{ via: 'research_publishers', self: 'publisher_id' }] },
      { key: 'description', label: 'تعريف', type: 'longtext', width: 260 },
      { key: 'contacts', label: 'وسائل التواصل', type: 'contacts', table: 'publishers_contacts', self: 'publisher_id', width: 240 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220 },
      ...meta,
    ],
  },
  journals: refTable('المجلات', 'journal', [
    { key: 'frequency', label: 'الدورية', type: 'enum', options: 'FREQUENCIES', width: 120 },
    { key: 'researches', label: 'المنشور فيها', type: 'derived', compute: 'journal_researches', ref: 'researches', readonly: true, width: 520 },
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
  // Issues are loaded for pickers and labels; their own pages come with «مجلتي»
  issues: {
    label: 'الأعداد', single: 'عدد', icon: 'journal', display: 'label', group: 'none',
    fields: [
      { key: 'journal_id', label: 'المجلة', type: 'fk', ref: 'journals', required: true },
      { key: 'number', label: 'رقم العدد', type: 'number', required: true },
      { key: 'year', label: 'السنة', type: 'number' },
      { key: 'title', label: 'عنوان العدد', type: 'text' },
      { key: 'period', label: 'الفترة أو الفصل', type: 'text' },
      { key: 'isbn', label: 'ISBN العدد', type: 'text', ltr: true },
      { key: 'notes', label: 'ملاحظات', type: 'longtext' },
    ],
  },
};
TABLES.journals.single = 'مجلة';

// Tables loaded but not shown in the sidebar
export const AUX_TABLES = [
  'research_researchers', 'research_translators', 'research_publishers',
  'research_topics', 'research_tags', 'person_role_assignments', 'persons_contacts',
  'publishers_contacts', 'profiles', 'journal_editors',
];

export const ROLE_LABELS = {
  owner: 'مالك', admin: 'إدارة', editor: 'مدير مجلة', data_entry: 'مدخل بيانات',
};

// ---- center publications & submissions ----
export const PUB_KINDS = {
  article: 'مقالة', authored_book: 'كتاب مؤلَّف', extracted_book: 'كتاب مستَل', translated_book: 'كتاب مترجَم',
};
export const STAGES = {
  received: 'مستلَم', initial_review: 'مراجعة أولية', under_review: 'عند المحكّمين', revisions: 'معاد للتعديل',
  accepted: 'مقبول', proofreading: 'قيد التدقيق', proofread: 'مدقَّق', final: 'نهائي', published: 'منشور', rejected: 'مرفوض',
};
export const FREQUENCIES = { annual: 'سنوية', semiannual: 'نصف سنوية', quarterly: 'فصلية' };
export const ENUMS = { PUB_KINDS, STAGES, FREQUENCIES };
// Issue periods in order, by journal frequency (annual journals have none)
export const PERIODS = {
  quarterly: ['شتاء', 'ربيع', 'صيف', 'خريف'],
  semiannual: ['النصف الأول', 'النصف الثاني'],
};
// Period of a date: quarterly → season (winter = Dec–Feb), semiannual → half of the year
export function periodOfDate(freq, d = new Date()) {
  const m = d.getMonth();
  if (freq === 'quarterly') return PERIODS.quarterly[Math.floor(((m + 1) % 12) / 3)];
  if (freq === 'semiannual') return PERIODS.semiannual[m < 6 ? 0 : 1];
  return null;
}
// Text shown for an issue's time: «ربيع 2026», or just the year
export const issueWhen = (i) => [i?.period, i?.year].filter(Boolean).join(' ');
export const CENTER_LIBRARY = 'إصدارات المركز';
// Who may see submissions (data entry does not)
export const seesSubmissions = (role) => ['owner', 'admin', 'editor'].includes(role);
// Kinds a role may save in center_publications (books: owner & admin only)
export const pubKindsFor = (role) => (['owner', 'admin'].includes(role) ? Object.keys(PUB_KINDS) : ['article']);

// Ready-made views above the researches grid: columns + row filter (filter is applied in app.js by key)
export const RESEARCH_VIEWS = [
  { key: 'all', label: 'الكل', cols: ['title', 'researchers', 'translators', 'year', 'language_id', 'status'] },
  { key: 'center', label: 'منشورات المركز', cols: ['title', 'pub_kind', 'pub_journal', 'issue_id', 'pub_pages'] },
  { key: 'wip', label: 'قيد العمل', cols: ['title', 'sub_journal', 'stage', 'received_at'], subOnly: true },
  { key: 'rejected', label: 'المرفوضة', cols: ['title', 'sub_journal', 'decided_at', 'rejection_reason'], subOnly: true },
  { key: 'external', label: 'الأبحاث الخارجية', cols: ['title', 'isbn', 'doi', 'publishers', 'topics'] },
];

// ---- permissions (mirrors the RLS policies; the database is the real gatekeeper) ----
const ADMIN_LISTS = ['countries', 'languages', 'research_types', 'contact_types', 'person_roles', 'journals'];
const SHARED = ['persons', 'publishers', 'topics', 'tags'];
// A journal manager adds researches, people and publishers, and edits only what they created
const EDITOR_TABLES = ['researches', 'persons', 'publishers'];
// Journals the signed-in editor manages (set by the app after loading journal_editors)
let managed = new Set();
export function setManagedJournals(ids) { managed = new Set(ids); }
export const managesJournal = (role, jid) => role === 'owner' || role === 'admin' || (role === 'editor' && managed.has(jid));

export function canInsert(role, table) {
  if (role === 'owner' || role === 'admin') return true;
  if (table === 'issues') return role === 'editor' && managed.size > 0;
  if (role === 'data_entry') return table === 'researches' || SHARED.includes(table);
  if (role === 'editor') return EDITOR_TABLES.includes(table);
  return false;
}

export function canEditRow(role, uid, table, row) {
  if (role === 'owner' || role === 'admin') return true;
  if (table === 'issues') return role === 'editor' && (!row || managed.has(row.journal_id));
  if (role === 'editor') return EDITOR_TABLES.includes(table) && (!row || row.created_by === uid);
  if (role !== 'data_entry') return false;
  if (table === 'researches') return !row || row.created_by === uid;
  return SHARED.includes(table);
}

export function canEditField(role, uid, table, row, field) {
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

export function canDelete(role, table) {
  if (role === 'owner') return true;
  if (role === 'admin') return ADMIN_LISTS.includes(table) || table === 'topics' || table === 'tags';
  return false;
}

// Sections for the record window (fields not listed go to the last section)
export const FORM_LAYOUT = {
  // '@ext' marks where the conditional sections (center publication, submission, bibliographic, original) go
  researches: [
    ['المعلومات الأساسية', ['title', 'year', 'research_type_id', 'language_id']],
    ['الأشخاص', ['researchers', 'translators']],
    ['@ext', []],
    ['التصنيف والناشرون', ['topics', 'publishers', 'tags']],
    ['الرابط والمحتوى', ['url', 'summary', 'notes']],
  ],
  persons: [
    ['البيانات', ['name', 'nationality_id', 'roles']],
    ['إنتاجه في مجلاتنا', ['production']],
    ['كل أعماله', ['related_journals', 'as_researcher', 'as_translator']],
    ['التواصل والملاحظات', ['contacts', 'notes']],
  ],
  publishers: [
    ['البيانات', ['name', 'country_id', 'description']],
    ['الأبحاث', ['related_journals', 'researches']],
    ['التواصل والملاحظات', ['contacts', 'notes']],
  ],
};
export const FULL_WIDTH = new Set(['production', 'related_journals', 'title', 'name', 'summary', 'notes', 'description', 'contacts', 'as_researcher', 'as_translator', 'researches']);

// Journal chip colours, taken from each journal's cover and issue badge on tajdid-c.com
export const JOURNAL_COLORS = {
  'قرآنيات': 'olive', // #AFA518 (gold/olive cover)
  'أخلاق': 'blue', // #11359B (royal-blue cover)
  'سميراميس': 'maroon', // #7C0E2F (maroon cover)
};

// Tables hidden from the sidebar per role (still usable inside record forms and filters)
export const HIDDEN_TABLES = {
  data_entry: ['journals', 'countries', 'languages', 'research_types', 'contact_types', 'person_roles'],
  editor: ['journals', 'topics', 'tags', 'countries', 'languages', 'research_types', 'contact_types', 'person_roles'],
};
export const isTableVisible = (role, table) => !(HIDDEN_TABLES[role] || []).includes(table);

// Fields a role may see (record info is for owner & admin only)
export const fieldsFor = (role, table) => TABLES[table].fields.filter((f) => (!f.staffOnly || role === 'owner' || role === 'admin')
  && (!f.subOnly || seesSubmissions(role)));
