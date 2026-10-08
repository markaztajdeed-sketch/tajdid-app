import { icon } from './icons.js';
import * as api from './api.js';
import { S, h, toast, renderShell } from './app.js';
import { ROLE_LABELS } from './schema.js';

async function reloadUsers() {
  S.data.profiles = await api.selectAll('profiles', 'created_at');
  S.byId.profiles = new Map(S.data.profiles.map((r) => [r.id, r]));
  S.data.journal_editors = await api.selectAll('journal_editors', null);
}

export function renderUsers(main) {
  const users = [...S.data.profiles].sort((a, b) => (a.active - b.active) || String(a.created_at).localeCompare(String(b.created_at)));

  const update = async (p, values) => {
    try {
      await api.updateRows('profiles', { id: p.id }, values);
      await reloadUsers();
      toast('تم الحفظ');
    } catch (e) { toast(e.message, 'err'); }
    renderShell();
  };

  const journalsCell = (p) => {
    if (p.role !== 'editor') return h('span', { class: 'muted' }, '—');
    const mine = S.data.journal_editors.filter((j) => j.user_id === p.id).map((j) => j.journal_id);
    return h('div', { class: 'journal-checks' }, S.data.journals.map((j) => h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: mine.includes(j.id),
        onchange: async (e) => {
          try {
            if (e.target.checked) await api.insertRow('journal_editors', { user_id: p.id, journal_id: j.id });
            else await api.deleteRows('journal_editors', { user_id: p.id, journal_id: j.id });
            await reloadUsers();
            toast('تم الحفظ');
          } catch (ex) { toast(ex.message, 'err'); renderShell(); }
        },
      }), j.name)));
  };

  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h1', {}, icon('users', 22), 'المستخدمون')),
    h('div', { class: 'users' },
      h('div', { class: 'help card' },
        h('b', {}, 'كيف أضيف مستخدماً؟'),
        h('p', {}, 'يفتح الشخص رابط الواجهة ويضغط «طلب حساب جديد». يظهر طلبه هنا كـ«بانتظار التفعيل»، فتختار دوره وتضغط «تفعيل».'),
        h('p', { class: 'muted' }, 'الصلاحيات: المالك يرى ويعدّل ويحذف كل شيء، ويدير المستخدمين. الإدارة تعدّل كل البيانات وترى الإحصائيات. مدير التحرير يرى أبحاث مجلاته فقط. مدخل البيانات يضيف الأبحاث ويعدّل ما أدخله هو فقط، ويضيف ويعدّل الأشخاص والناشرين.')),
      h('div', { class: 'grid-wrap' }, h('table', { class: 'grid users-table' },
        h('thead', {}, h('tr', {}, ['الاسم', 'البريد الإلكتروني', 'الدور', 'المجلات (لمدير التحرير)', 'الحالة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, users.map((p) => {
          const self = p.id === S.me.id;
          return h('tr', { class: p.active ? '' : 'pending' },
            h('td', {}, h('input', { class: 'inline', value: p.full_name || '', onchange: (e) => update(p, { full_name: e.target.value.trim() || null }) })),
            h('td', { class: 'ltr' }, p.email),
            h('td', {}, h('select', { disabled: self, onchange: (e) => update(p, { role: e.target.value }) },
              Object.entries(ROLE_LABELS).map(([k, v]) => h('option', { value: k, selected: p.role === k }, v)))),
            h('td', {}, journalsCell(p)),
            h('td', {}, self ? h('span', { class: 'chip' }, 'أنت')
              : p.active
                ? h('button', { class: 'btn sm', onclick: () => update(p, { active: false }) }, 'إيقاف')
                : h('button', { class: 'btn primary sm', onclick: () => update(p, { active: true }) }, 'تفعيل')));
        }))))));
}
