# Bundles the ES modules into one classic script so the app also opens from file://
import re, pathlib
SRC = pathlib.Path('/home/claude/tajdid-app/js')
def strip(code):
    code = re.sub(r'^import .*?;\s*$', '', code, flags=re.M | re.S)
    code = re.sub(r'^export (async function|function|const|class|let)', r'\1', code, flags=re.M)
    return code
api = strip((SRC / 'api.js').read_text())
api_names = re.findall(r'^(?:async function|function|const|class) (\w+)', api, flags=re.M)
exported = [n for n in api_names if re.search(rf'^export (?:async function|function|const|class) {n}\b', (SRC / 'api.js').read_text(), re.M)]
app = strip((SRC / 'app.js').read_text()).replace('\nboot();\n', '\n')
out = ['/* مركز تجديد — ملف مُجمَّع تلقائياً، لا تعدّله مباشرة */', '(function () {', "'use strict';",
       'const api = (function () {', api, f'return {{ {", ".join(exported)} }};', '})();',
       strip((SRC / 'icons.js').read_text()), strip((SRC / 'schema.js').read_text()), app,
       strip((SRC / 'stats.js').read_text()), strip((SRC / 'users.js').read_text()),
       'boot();', '})();']
(SRC.parent / 'app.bundle.js').write_text('\n'.join(out))
print('exported api:', exported)
