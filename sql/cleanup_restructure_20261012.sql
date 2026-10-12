-- =====================================================================
-- مركز تجديد — تنظيف إعادة الهيكلة (2026-10-12)
-- يُشغَّل مرة واحدة من Supabase ← SQL Editor ← New query ← الصق ← Run
-- كل شيء داخل معاملة واحدة: إن توقّف أي فحص، لا يتغيّر شيء.
-- النسخة الاحتياطية في schema backup_20261012 تبقى (يُحذف لاحقاً بملف drop_backup_20261012.sql).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) إعادة نقل نهائية لأي بيانات أُدخلت في الأعمدة القديمة بعد التحويل
-- ---------------------------------------------------------------------
-- المقالات: بحث له عدد
insert into public.center_publications (research_id, kind, issue_id, start_page, end_page, issue_order, created_by)
select r.id, 'article', r.issue_id, r.start_page, r.end_page, r.issue_order, r.created_by
from public.researches r
where r.issue_id is not null
on conflict (research_id) do nothing;

-- الكتب: مجلة بلا عدد (مترجَم إن كان له مترجم، وإلا مؤلَّف)
insert into public.center_publications (research_id, kind, created_by)
select r.id,
       case when exists (select 1 from public.research_translators t where t.research_id = r.id) then 'translated_book' else 'authored_book' end,
       r.created_by
from public.researches r
where r.journal_id is not null and r.issue_id is null
on conflict (research_id) do nothing;

-- البيانات الببليوغرافية: غير المقالات إن كان فيها isbn أو doi أو pages، والمقالات إن كان فيها isbn أو doi
insert into public.bibliographic_details (research_id, isbn, doi, pages, created_by)
select r.id, r.isbn, r.doi, r.pages, r.created_by
from public.researches r
where (r.issue_id is null and (r.isbn is not null or r.doi is not null or r.pages is not null))
   or (r.issue_id is not null and (r.isbn is not null or r.doi is not null))
on conflict (research_id) do nothing;

-- ---------------------------------------------------------------------
-- 2) فحص: يتوقف التنفيذ إن وُجد بحث بقيمة قديمة بلا صف مطابق بالقيم نفسها
-- ---------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(format('#%s «%s»: %s', id, title, problem), E'\n' order by id) into bad from (
    -- مقالة: يجب صف article بالعدد والصفحات والترتيب نفسها
    select r.id, r.title, 'العدد/الصفحات/الترتيب لا تطابق center_publications' as problem
    from public.researches r left join public.center_publications cp on cp.research_id = r.id
    where r.issue_id is not null
      and (cp.research_id is null or cp.kind <> 'article' or cp.issue_id is distinct from r.issue_id
           or cp.start_page is distinct from r.start_page or cp.end_page is distinct from r.end_page
           or cp.issue_order is distinct from r.issue_order)
    union all
    -- كتاب قديم (مجلة بلا عدد): يجب صف بنوع كتاب
    select r.id, r.title, 'له journal_id قديم بلا صف كتاب في center_publications'
    from public.researches r left join public.center_publications cp on cp.research_id = r.id
    where r.journal_id is not null and r.issue_id is null and (cp.research_id is null or cp.kind = 'article')
    union all
    -- بيانات ببليوغرافية: يجب صف بالقيم نفسها
    select r.id, r.title, 'isbn/doi/pages لا تطابق bibliographic_details'
    from public.researches r left join public.bibliographic_details b on b.research_id = r.id
    where (r.isbn is not null or r.doi is not null or r.pages is not null)
      and not (r.issue_id is not null and r.isbn is null and r.doi is null)   -- مقالة فيها pages فقط: انظر الحالة التالية
      and (b.research_id is null or b.isbn is distinct from r.isbn or b.doi is distinct from r.doi or b.pages is distinct from r.pages)
    union all
    -- مقالة فيها «عدد الصفحات» فقط: لا يُنقل (المقالة لها صفحاتها في العدد)، فسيضيع عند الحذف
    select r.id, r.title, 'مقالة لها pages قديم لن يُنقل (راجعه يدوياً)'
    from public.researches r
    where r.issue_id is not null and r.isbn is null and r.doi is null and r.pages is not null
  ) x;
  if bad is not null then
    raise exception E'توقّف التنظيف: أبحاث بيانات قديمة بلا مقابل في الجداول الجديدة:\n%', bad;
  end if;
  raise notice 'الفحص ناجح: كل القيم القديمة لها صفوف مطابقة.';
end $$;

-- ---------------------------------------------------------------------
-- 3) حذف القيد القديم ثم الأعمدة القديمة وفهارسها
-- ---------------------------------------------------------------------
-- القيد الذي يمنع ملء issue_id وjournal_id معاً
alter table public.researches drop constraint if exists researches_issue_or_journal_chk;

-- سياستا الإضافة والتعديل كانتا تفحصان العدد والمجلة على الأعمدة القديمة.
-- هذا الفحص صار في سياسات center_publications وsubmissions، فتبقى هنا صلاحية الدور فقط
-- (ولا يمكن حذف الأعمدة وهي مستعملة في سياسة).
alter policy "write" on public.researches
  with check (private.has_role('owner', 'admin', 'data_entry', 'editor'));
alter policy "update" on public.researches
  using (private.can_edit_research(id))
  with check (private.has_role('owner', 'admin', 'data_entry', 'editor'));

-- الفهارس المرتبطة (تُحذف تلقائياً مع الأعمدة أيضاً؛ تُذكر هنا للوضوح)
drop index if exists public.idx_researches_issue;
drop index if exists public.researches_issue_id_idx;
drop index if exists public.idx_researches_journal;

-- ملاحظة: القيد unique_research = UNIQUE (title, year, isbn, doi) يُحذف تلقائياً مع isbn وdoi.
-- ISBN وDOI يبقيان فريدين في bibliographic_details. إن أردت منع تكرار العنوان والسنة، أزل -- من السطر التالي:
-- alter table public.researches add constraint researches_title_year_key unique nulls not distinct (title, year);

alter table public.researches
  drop column issue_id,
  drop column journal_id,
  drop column start_page,
  drop column end_page,
  drop column issue_order,
  drop column isbn,
  drop column doi,
  drop column pages;

-- الدالة القديمة لسياسة القراءة (كانت تقرأ issue_id وjournal_id)، لم تعد مستعملة
drop function if exists private.can_see_research_row(uuid, bigint, bigint);

-- ---------------------------------------------------------------------
-- 4) حذف «2.3 كتب ومؤلفات المجلة» وفروعه (الكتب صارت في «إصدارات المركز»)
-- ---------------------------------------------------------------------
do $$
declare bad text; n_folders int;
begin
  -- كل المجلدات تحت 2.3 في المجلات (بما فيها المجلدات الفرعية والمحذوفة إلى السلة)
  create temp table cleanup_23 on commit drop as
  with recursive t as (
    select id from public.folders where code = '2.3' and kind = 'fixed' and journal_id is not null
    union all
    select f.id from public.folders f join t on f.parent_id = t.id)
  select id from t;

  select string_agg(format('%s · %s › %s', coalesce(j.name, '—'), fo.name, fi.name), E'\n' order by j.name, fo.name, fi.name) into bad
  from public.files fi
  join public.folders fo on fo.id = fi.folder_id
  left join public.journals j on j.id = fi.journal_id
  where fi.folder_id in (select id from cleanup_23);
  if bad is not null then
    raise exception E'توقّف التنظيف: في مجلدات «2.3» ملفات، انقلها أولاً إلى «إصدارات المركز»:\n%', bad;
  end if;

  delete from public.folders where id in (select id from cleanup_23);
  get diagnostics n_folders = row_count;
  delete from private.folder_template where code = '2.3' or code like '2.3.%';
  raise notice 'حُذف % مجلداً من «2.3» في المجلات، وحُذف «2.3» وفروعه من القالب.', n_folders;
end $$;

commit;
