-- =====================================================================
-- مركز تجديد — حذف النسخة الاحتياطية لإعادة الهيكلة (2026-10-12)
-- لا يُشغَّل إلا بعد أسبوع من العمل بلا مشاكل بعد cleanup_restructure_20261012.sql.
-- يحذف schema backup_20261012 وكل ما فيه (نسخ researches وجداول الربط والأعداد والمجلات
-- والمجلدات والملفات والقالب، ونتائج الـ views قبل التغيير). لا يمكن التراجع عنه.
-- Supabase ← SQL Editor ← New query ← الصق ← Run
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'backup_20261012') then
    raise notice 'لا توجد نسخة احتياطية باسم backup_20261012، لا شيء للحذف.';
  else
    raise notice 'جداول النسخة الاحتياطية التي ستُحذف: %',
      (select string_agg(tablename, '، ' order by tablename) from pg_tables where schemaname = 'backup_20261012');
  end if;
end $$;

drop schema if exists backup_20261012 cascade;

commit;
