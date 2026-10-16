// SPDX-License-Identifier: Apache-2.0
/**
 * The viewer: the organisation chart of the service it is served from - or, where there is no service (a page of
 * its own, `#example`), the example organisation.
 *
 * Signing in is a key (a keeper's, or a system's): it is kept only in this tab (sessionStorage) and sent only to the
 * service this page came from. A keeper may also move departments by dragging them, and take the structure out as data.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import OrgChart from '../packages/chart/src/index.js';
import '../packages/chart/src/style.css';
import './viewer.css';

const KEY = 'open-orgchart:key';
const WORDS = {
  fa: {
    'Organisation chart': 'نمودار سازمانی', 'Sign in': 'ورود', 'Sign out': 'خروج', 'A key': 'کلید',
    'The example organisation': 'سازمان نمونه', 'Look at the example': 'دیدن نمونه', 'Reading…': 'در حال خواندن…',
    'That key opens nothing here.': 'این کلید اینجا چیزی را باز نمی‌کند.', 'Move {a} under {b}?': '{a} به زیر {b} منتقل شود؟',
    'A keeper key, or the key of a system this organisation shares with.': 'کلید یک نگهدارنده، یا کلید سامانه‌ای که سازمان با آن به اشتراک گذاشته است.',
    'Everything here is made up.': 'همه چیز اینجا ساختگی است.',
  },
};

function useWords(language) {
  return React.useCallback((key, vars) => {
    let said = (WORDS[language] && WORDS[language][key]) || key;
    for (const [k, v] of Object.entries(vars || {})) said = said.replace(`{${k}}`, v);
    return said;
  }, [language]);
}

const readKey = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const keepKey = (key) => { try { if (key) sessionStorage.setItem(KEY, key); else sessionStorage.removeItem(KEY); } catch { /* this tab only */ } };

async function api(path, key, init = {}) {
  const r = await fetch(path, { ...init, headers: { 'X-Org-Key': key, ...(init.headers || {}) } });
  if (!r.ok) {
    let said = '';
    try { said = (await r.json()).error || ''; } catch { /* not JSON */ }
    throw Object.assign(new Error(said || `HTTP ${r.status}`), { status: r.status });
  }
  return r;
}

function App() {
  const [language, setLanguage] = React.useState(() => (navigator.language || 'en').toLowerCase().startsWith('fa') ? 'fa' : 'en');
  const t = useWords(language);
  const [example, setExample] = React.useState(() => location.hash === '#example');
  const [key, setKey] = React.useState(readKey);
  const [draft, setDraft] = React.useState('');
  const [data, setData] = React.useState(null);
  const [keeps, setKeeps] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState(null);

  // a page with no service behind it shows the example
  React.useEffect(() => {
    if (example) return;
    fetch('healthz').then((r) => (r.ok ? r.json() : null)).then((got) => { if (!got || got.service !== 'open-orgchart') setExample(true); }, () => setExample(true));
  }, [example]);

  const load = React.useCallback(async () => {
    setError('');
    if (example) {
      const got = await (await fetch('example.json')).json();
      setData({ departments: got.tree.departments, reporting: got.reporting });
      setKeeps(false);
      return;
    }
    if (!key) { setData(null); return; }
    try {
      const [tree, reporting, index] = await Promise.all([
        api('api/org/v1/tree', key).then((r) => r.json()), api('api/org/v1/reporting', key).then((r) => r.json()), api('api/org/v1/', key).then((r) => r.json())]);
      setData({ departments: tree.departments, reporting });
      setKeeps(index.you && index.you.kind === 'keeper');
    } catch (err) {
      if (err.status === 401) { keepKey(''); setKey(''); }
      setError(err.status === 401 ? t('That key opens nothing here.') : err.message);
      setData(null);
    }
  }, [example, key, t]);
  React.useEffect(() => { load(); }, [load]);

  const signIn = (e) => { e.preventDefault(); const k = draft.trim(); if (!k) return; keepKey(k); setKey(k); setDraft(''); };
  const signOut = () => { keepKey(''); setKey(''); setData(null); };
  const names = React.useMemo(() => new Map((data?.departments || []).map((d) => [String(d.id), d.name])), [data]);
  const onMove = keeps ? async (id, parent) => {
    if (!window.confirm(t('Move {a} under {b}?', { a: names.get(String(id)) || id, b: names.get(String(parent)) || parent }))) return;
    try {
      await api(`api/org/pillar/departments/${encodeURIComponent(id)}`, key, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent }) });
      await load();
    } catch (err) { setError(err.message); }
  } : undefined;
  const exportData = keeps ? async (kind) => (await api(`api/org/pillar/export?format=${kind}`, key)).blob() : undefined;
  const rtl = language === 'fa';

  return (
    <div className="page" dir={rtl ? 'rtl' : 'ltr'} lang={language}>
      <header className="bar">
        <div className="brand"><span className="mark" aria-hidden="true" />{t('Organisation chart')}</div>
        {example && <span className="note">{t('The example organisation')} · {t('Everything here is made up.')}</span>}
        <div className="end">
          <button type="button" className="ghost" onClick={() => setLanguage(rtl ? 'en' : 'fa')} aria-label={rtl ? 'English' : 'فارسی'}>{rtl ? 'English' : 'فارسی'}</button>
          {!example && key && <button type="button" className="ghost" onClick={signOut}>{t('Sign out')}</button>}
          <a className="ghost" href="https://github.com/RAHIAFT/open-orgchart" target="_blank" rel="noreferrer noopener">GitHub</a>
        </div>
      </header>
      <main className="main">
        {error && <div className="error" role="alert">{error}</div>}
        {!example && !key ? (
          <form className="signin" onSubmit={signIn}>
            <h1>{t('Sign in')}</h1>
            <p>{t('A keeper key, or the key of a system this organisation shares with.')}</p>
            <input type="password" autoComplete="off" spellCheck="false" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('A key')} aria-label={t('A key')} />
            <div className="row">
              <button type="submit" className="primary">{t('Sign in')}</button>
              <a href="#example" onClick={() => setExample(true)}>{t('Look at the example')}</a>
            </div>
          </form>
        ) : data ? (
          <OrgChart departments={data.departments} reporting={data.reporting} language={language} selectedId={selected} onSelect={setSelected}
                    onMove={onMove} exportData={exportData} tableFormats={['csv', 'json']} onNotice={(n) => setError(n.text)} />
        ) : <div className="wait">{t('Reading…')}</div>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
