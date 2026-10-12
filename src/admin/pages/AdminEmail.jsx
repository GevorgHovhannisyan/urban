import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button, Input } from '../components/AdminLayout';

// Email diagnostics — shows whether SMTP is configured and can log in, and
// sends a real sample of each transactional email (server/email-test.mjs) so
// delivery can be confirmed in an actual inbox on the live server.
export default function AdminEmail({ onNavigate }) {
  const { adminFetch, email: adminEmail } = useAdminAuth();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [to, setTo] = useState(adminEmail || '');
  const [results, setResults] = useState({}); // type -> { state, detail }

  const check = () => {
    setChecking(true);
    adminFetch('/email/status')
      .then(setStatus)
      .catch((err) => toast(err.message, true))
      .finally(() => setChecking(false));
  };
  useEffect(check, []); // eslint-disable-line react-hooks/exhaustive-deps

  // adminFetch throws on non-2xx, which hides the server's diagnostic body —
  // the test endpoint's error text is exactly what's needed here.
  const send = async (type) => {
    setResults((r) => ({ ...r, [type]: { state: 'sending' } }));
    try {
      const data = await adminFetch('/email/test', { method: 'POST', body: JSON.stringify({ type, to }) });
      setResults((r) => ({ ...r, [type]: { state: 'ok', detail: `Accepted by mail server${data.from ? ` · from ${data.from}` : ''}` } }));
    } catch (err) {
      setResults((r) => ({ ...r, [type]: { state: 'error', detail: err.message } }));
    }
  };

  const sendAll = async () => {
    for (const t of status?.types || []) {
      // eslint-disable-next-line no-await-in-loop
      await send(t.id);
    }
  };

  const configured = status?.config?.status === 'configured';
  const connected = status?.connection?.ok;

  return (
    <AdminLayout section="email" onNavigate={onNavigate} title="Email" subtitle="Check email delivery and send test emails">
      <div className="space-y-6 max-w-3xl">
        <div className="border border-white/8">
          <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
            <p className="text-sm font-medium">Email service status</p>
            <Button variant="secondary" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</Button>
          </div>
          {!status ? (
            <p className="px-5 py-4 text-sm text-white/40">Checking…</p>
          ) : (
            <div className="px-5 py-4 space-y-2 text-sm">
              <StatusRow ok={configured} label="SMTP settings" detail={status.config.message} />
              <StatusRow ok={connected} label="Mail server login" detail={connected ? 'Logged in successfully.' : `Failed${status.connection.message ? ` — ${status.connection.message}` : ''}`} />
              <StatusRow ok={!status.publicUrlLooksLocal} label="Website address in emails" detail={status.publicUrlLooksLocal
                ? `PUBLIC_URL is ${status.publicUrl} — links and images in emails won't work for customers. Set PUBLIC_URL to your real domain in the server's .env.`
                : status.publicUrl} />
              <p className="text-white/50 pt-2">
                Sends as: {Object.entries(status.senders).map(([k, v]) => `${k} <${v.email}>`).join(' · ')}<br />
                New-order alerts go to: <span className="text-white/80">{status.adminRecipient || '—'}</span>
              </p>
            </div>
          )}
        </div>

        <div className="border border-white/8">
          <div className="px-5 py-4 border-b border-white/8">
            <p className="text-sm font-medium">Send test emails</p>
            <p className="text-xs text-white/40 mt-0.5">Each test uses the real template and is clearly marked as a test. Check the inbox (and spam folder) of the address below.</p>
          </div>
          <div className="px-5 py-4 flex flex-wrap items-end gap-3 border-b border-white/8">
            <div className="flex-1 min-w-[240px]"><Input label="Send to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" /></div>
            <Button variant="primary" onClick={sendAll} disabled={!to || !status}>Send all</Button>
          </div>
          <ul>
            {(status?.types || []).map((t) => {
              const r = results[t.id];
              return (
                <li key={t.id} className="px-5 py-3 border-b border-white/5 last:border-b-0 flex flex-wrap items-center gap-3">
                  <span className="text-sm flex-1 min-w-[220px]">{t.label}</span>
                  {r && (
                    <span className={`text-xs ${r.state === 'ok' ? 'text-emerald-400' : r.state === 'error' ? 'text-[#e5484d]' : 'text-white/40'}`}>
                      {r.state === 'sending' ? 'Sending…' : r.state === 'ok' ? `✓ ${r.detail}` : `✕ ${r.detail}`}
                    </span>
                  )}
                  <Button variant="secondary" onClick={() => send(t.id)} disabled={!to || r?.state === 'sending'}>Send test</Button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </AdminLayout>
  );
}

function StatusRow({ ok, label, detail }) {
  return (
    <div className="flex gap-3">
      <span className={`mt-0.5 w-4 shrink-0 ${ok ? 'text-emerald-400' : 'text-[#e5484d]'}`}>{ok ? '✓' : '✕'}</span>
      <span><span className="text-white/85">{label}:</span> <span className="text-white/55">{detail}</span></span>
    </div>
  );
}
