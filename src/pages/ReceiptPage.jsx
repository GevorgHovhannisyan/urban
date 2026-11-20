import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';

// Electronic cash register (ՀԴՄ) receipt for an order. Opened from the
// receipt email's secret link (/receipt/<orderNumber>?t=…) or by the signed-in
// customer who owns the order. The server decides access; this page only
// renders what it returns.
const amd = (value) => `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ֏`;
const PAYMENT_LABELS = { card: 'Bank card (ArCa)', idram: 'Idram' };

export default function ReceiptPage() {
  const { pageData, user } = useApp();
  const orderNumber = pageData?.orderNumber || '';
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    if (!orderNumber) {
      setState({ loading: false, error: 'Receipt not found.', data: null });
      return undefined;
    }
    let cancelled = false;
    const token = new URLSearchParams(window.location.search).get('t') || '';
    fetch(`/api/receipts/${encodeURIComponent(orderNumber)}${token ? `?t=${encodeURIComponent(token)}` : ''}`, {
      headers: user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {},
    })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        setState(ok ? { loading: false, error: '', data: body } : { loading: false, error: body.error || 'Receipt not found.', data: null });
      })
      .catch(() => !cancelled && setState({ loading: false, error: 'Could not load the receipt. Please try again.', data: null }));
    return () => { cancelled = true; };
  }, [orderNumber, user?.sessionToken]);

  const receipt = state.data?.receipt;
  const [downloading, setDownloading] = useState(false);

  // PDF invoice from the server (same access rule as this page: the
  // emailed secret link or the signed-in owner).
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const token = new URLSearchParams(window.location.search).get('t') || '';
      const res = await fetch(`/api/receipts/${encodeURIComponent(orderNumber)}/invoice.pdf${token ? `?t=${encodeURIComponent(token)}` : ''}`, {
        headers: user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {},
      });
      if (!res.ok) throw new Error('download failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `UrbanPhoenix-invoice-${orderNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert('Could not download the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="pt-[var(--site-header-h,68px)] min-h-screen">
      <section className="max-w-xl mx-auto px-6 py-20">
        <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-4 receipt-no-print">Invoice · ՀԴՄ կտրոն</p>
        <div className="flex items-end justify-between gap-4 mb-8">
          <h1 className="font-display font-black text-5xl uppercase">Receipt</h1>
          {receipt && (
            <div className="receipt-no-print flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={downloadPdf} disabled={downloading} className="text-[11px] font-mono uppercase tracking-widest bg-accent text-white px-4 py-2.5 disabled:opacity-60">
                {downloading ? 'Preparing…' : 'Download PDF'}
              </button>
              <button type="button" onClick={() => window.print()} className="text-[11px] font-mono uppercase tracking-widest border border-border px-4 py-2.5 hover:border-fg">
                Print
              </button>
            </div>
          )}
        </div>

        {state.loading && <p className="text-muted">Loading…</p>}
        {!state.loading && state.error && <div className="border border-border p-7"><p>{state.error}</p></div>}

        {!state.loading && state.data && !receipt && (
          <div className="border border-border p-7">
            <p className="text-xs text-muted uppercase tracking-widest">Order #{state.data.orderNumber}</p>
            <p className="mt-3">Your receipt is being registered with the State Revenue Committee. We'll email it to you as soon as it's ready.</p>
          </div>
        )}

        {receipt && (
          <article className="receipt-print border border-border p-7 font-mono text-sm">
            <div className="text-center mb-6">
              {receipt.taxpayer && <p className="font-bold">{receipt.taxpayer}</p>}
              {receipt.address && <p className="text-muted text-xs mt-1">{receipt.address}</p>}
              {receipt.tin && <p className="text-xs mt-1">ՀՎՀՀ / TIN {receipt.tin}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
              <dt className="text-muted">Order</dt><dd className="text-right">{state.data.orderNumber}</dd>
              <dt className="text-muted">Fiscal number</dt><dd className="text-right">{receipt.fiscal || '—'}</dd>
              <dt className="text-muted">Receipt number</dt><dd className="text-right">{receipt.receiptId}</dd>
              <dt className="text-muted">Register (CRN)</dt><dd className="text-right">{receipt.crn}</dd>
              {receipt.sn && (<><dt className="text-muted">Serial (SN)</dt><dd className="text-right">{receipt.sn}</dd></>)}
              <dt className="text-muted">Date</dt>
              <dd className="text-right">{receipt.time ? new Date(receipt.time).toLocaleString('en-GB', { timeZone: 'Asia/Yerevan' }) : '—'}</dd>
            </dl>
            <div className="border-t border-dashed border-border my-5" />
            <ul className="space-y-2">
              {receipt.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-4 text-xs">
                  <span className="min-w-0">{item.name}<span className="text-muted"> · {item.quantity} {item.unit} × {amd(item.price)}</span>{item.discount > 0 && <span className="text-muted"> − {amd(item.discount)}</span>}</span>
                  <span className="shrink-0">{amd(item.price * item.quantity - (item.discount || 0))}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-dashed border-border my-5" />
            <div className="flex justify-between font-bold"><span>Total</span><span>{amd(receipt.total)}</span></div>
            {receipt.cardAmount != null && <div className="flex justify-between text-xs text-muted mt-1"><span>{PAYMENT_LABELS[state.data.paymentMethod] || 'Non-cash'}</span><span>{amd(receipt.cardAmount)}</span></div>}
            {receipt.qrImage && (
              <div className="mt-7 flex justify-center">
                <img src={receipt.qrImage} alt="Receipt QR code" width="180" height="180" className="bg-white p-2" />
              </div>
            )}
          </article>
        )}
      </section>
    </main>
  );
}
