// Table & field definitions: database names (English) ↔ interface labels (Arabic).
// Field types: text | longtext | number | url | fk | link | contacts | user | date | derived | publication

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
    fields: [
      { key: 'title', label: 'عنوان البحث', type: 'text', required: true, width: 320 },
      { key: 'researchers', label: 'الباحثون', type: 'link', via: 'research_researchers', self: 'research_id', other: 'person_id', ref: 'persons', width: 200 },
      { key: 'translators', label: 'المترجمون', type: 'link', via: 'research_translators', self: 'research_id', other: 'person_id', ref: 'persons', width: 180 },
      { key: 'publication', label: 'النشر في مجلاتنا', type: 'publication', readonly: true, width: 210 },
      { key: 'topics', label: 'المواضيع', type: 'link', via: 'research_topics', self: 'research_id', other: 'topic_id', ref: 'topics', width: 170 },
      { key: 'publishers', label: 'الناشرون', type: 'link', via: 'research_publishers', self: 'research_id', other: 'publisher_id', ref: 'publishers', width: 200 },
      { key: 'year', label: 'السنة', type: 'number', width: 80 },
      { key: 'research_type_id', label: 'النوع', type: 'fk', ref: 'research_types', width: 100 },
      { key: 'language_id', label: 'اللغة', type: 'fk', ref: 'languages', width: 110 },
      { key: 'issue_id', label: 'العدد', type: 'fk', ref: 'issues', width: 170, hidden: true },
      { key: 'issue_order', label: 'ترتيبها في العدد', type: 'number', width: 90, hidden: true },
      { key: 'start_page', label: 'من صفحة', type: 'number', width: 80, hidden: true },
      { key: 'end_page', label: 'إلى صفحة', type: 'number', width: 80, hidden: true },
      { key: 'journal_id', label: 'المجلة (للكتب والمترجمات)', type: 'fk', ref: 'journals', width: 150, hidden: true },
      { key: 'tags', label: 'الوسوم', type: 'link', via: 'research_tags', self: 'research_id', other: 'tag_id', ref: 'tags', width: 160, hidden: true },
      { key: 'isbn', label: 'ISBN', type: 'text', width: 150, ltr: true },
      { key: 'doi', label: 'DOI', type: 'text', width: 150, ltr: true, hidden: true },
      { key: 'pages', label: 'عدد الصفحات', type: 'number', width: 100 },
      { key: 'url', label: 'رابط البحث', type: 'url', width: 160 },
      { key: 'summary', label: 'الملخص', type: 'longtext', width: 260 },
      { key: 'notes', label: 'ملاحظات', type: 'longtext', width: 220, hidden: true },
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
  researches: [
    ['المعلومات الأساسية', ['title', 'year', 'research_type_id', 'language_id', 'pages']],
    ['الأشخاص', ['researchers', 'translators']],
    ['النشر في مجلاتنا', ['issue_id', 'issue_order', 'start_page', 'end_page', 'journal_id']],
    ['النشر والتصنيف', ['topics', 'publishers', 'tags']],
    ['المعرّفات والرابط', ['isbn', 'doi', 'url']],
    ['المحتوى', ['summary', 'notes']],
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
export const fieldsFor = (role, table) => TABLES[table].fields.filter((f) => !f.staffOnly || role === 'owner' || role === 'admin');
