// Electronic cash register (ՀԴՄ) admin tool. Run on the server from the app
// folder with the real .env:   node --env-file=.env scripts/hdm.mjs <command>
//
// Read-only (safe any time):
//   status                       configuration (no secrets) + receipt task counts
//   check                        SRC checkConnection — HTTP status + SRC code
//   probe --regime <1|2|3|7>     SRC getGoodList: tells whether the register is
//                                active and departments exist (196 / 201 errors)
//   copy <receiptId>             SRC printCopy of an existing receipt
//   info <receiptId>             SRC getReturnedReceiptInfo: each line's department,
//                                tax regime and VAT as SRC recorded them
//
// State-changing at SRC (one-time administrative steps, need --yes):
//   activate --yes               register status "Ընթացիկ" → "Գործող"
//   configure-departments --departments 1:3[,2:3] --yes
//                                department:taxRegime pairs (regimes: 1 VAT,
//                                2 non-VAT, 3 turnover tax, 7 micro-enterprise)
//
// Receipts:
//   run                          process pending receipts + reconcile unknown ones now
//   enqueue <orderNumber> --yes  create the receipt task for an already-paid order
//                                (e.g. paid before HDM was switched on)
import { describeHdmConfig, getHdmConfig, TAX_REGIMES } from '../server/hdm/config.mjs';

const [command, ...args] = process.argv.slice(2);
const has = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error('Commands: status | check | probe --regime N | copy <receiptId> | info <receiptId> | activate --yes | configure-departments --departments 1:3 --yes | run | enqueue <orderNumber> --yes');
  process.exit(1);
}

function printResult(res) {
  console.log(`HTTP status : ${res.httpStatus ?? '(no HTTP response)'}`);
  console.log(`SRC code    : ${res.code ?? '(none)'}`);
  console.log(`Outcome     : ${res.outcome}`);
  if (res.outcome === 'success') console.log(`Result      : ${typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)}`);
  else console.log(`Error       : ${res.error}`);
  process.exitCode = res.outcome === 'success' ? 0 : 1;
}

const src = await import('../server/hdm/srcClient.mjs');

try {
  switch (command) {
    case 'status': {
      const { initDb } = await import('../server/db.mjs');
      await initDb();
      const { fiscalSummary } = await import('../server/hdm/fiscalService.mjs');
      const config = describeHdmConfig();
      console.log(config.message);
      console.log(JSON.stringify({ ...config, message: undefined }, null, 2));
      console.log('Receipt tasks by status:', JSON.stringify(await fiscalSummary()));
      break;
    }
    case 'check':
      console.log(`checkConnection → ${getHdmConfig().baseUrl} (CRN ${getHdmConfig().crn})`);
      printResult(await src.checkConnection());
      break;
    case 'probe': {
      const regime = Number(opt('--regime') || getHdmConfig().taxRegime);
      if (!TAX_REGIMES[regime]) usage('probe needs --regime 1|2|3|7 (or HDM_TAX_REGIME).');
      const res = await src.getGoodList(regime);
      printResult(res);
      if (res.code === 196) console.log('\n→ The register is not active yet (INACTIVE_CERT_CRM). Run "activate" once the business is ready.');
      if (res.code === 201) console.log('\n→ The register has no departments yet (MISSING_DEPARTMENTS). Run "configure-departments" with the confirmed tax regime.');
      if (res.outcome === 'success') console.log('\n→ The register is active and departments exist.');
      break;
    }
    case 'copy': {
      if (!positional) usage('copy needs a receipt number.');
      printResult(await src.printCopy(positional));
      break;
    }
    case 'info': {
      if (!positional) usage('info needs a receipt number.');
      const res = await src.getReceiptInfo(positional);
      printResult(res);
      if (res.outcome === 'success') {
        const r = res.result || {};
        console.log(`
Receipt ${positional}: total ${r.totalAmount} AMD, card ${r.cardAmount}, cash ${r.cashAmount}, cashier ${r.cashierId}`);
        for (const item of r.items || []) {
          console.log(`  dep ${item.dep} · taxRegime ${item.taxRegime} (${TAX_REGIMES[item.taxRegime] || 'unknown'}) · ADG ${item.adgCode} · ${item.goodName} × ${item.quantity} = ${item.totalWithTaxes} AMD (VAT ${item.vat})`);
        }
      }
      break;
    }
    case 'activate':
      if (!has('--yes')) usage('activate changes the register status at SRC — add --yes to confirm.');
      printResult(await src.activate());
      break;
    case 'configure-departments': {
      const spec = opt('--departments');
      if (!spec) usage('Give --departments dep:taxRegime pairs, e.g. 1:3');
      const departments = spec.split(',').map((pair) => {
        const [dep, taxRegime] = pair.split(':').map((v) => Number(v.trim()));
        if (!Number.isInteger(dep) || dep < 1 || !TAX_REGIMES[taxRegime]) usage(`Invalid pair "${pair}". Use department:regime with regime 1, 2, 3 or 7.`);
        return { dep, taxRegime };
      });
      console.log('Departments to send:', departments.map((d) => `#${d.dep} → ${TAX_REGIMES[d.taxRegime]}`).join('; '));
      if (!has('--yes')) usage('configure-departments changes the register at SRC — add --yes to confirm.');
      const res = await src.configureDepartments(departments);
      printResult(res);
      if (res.code === 202) console.log('\n→ EXISTING_DEPARTMENT: these departments are already configured.');
      break;
    }
    case 'run': {
      const { initDb } = await import('../server/db.mjs');
      await initDb();
      const fiscal = await import('../server/hdm/fiscalService.mjs');
      console.log('Processed:', JSON.stringify(await fiscal.processDueTasks()));
      console.log('Reconciliation:', JSON.stringify(await fiscal.reconcileUnknownTasks()));
      break;
    }
    case 'enqueue': {
      if (!positional) usage('enqueue needs an order number.');
      if (!has('--yes')) usage('enqueue will issue a real fiscal receipt for that order — add --yes to confirm.');
      const { initDb } = await import('../server/db.mjs');
      await initDb();
      const fiscal = await import('../server/hdm/fiscalService.mjs');
      const result = await fiscal.enqueueExistingOrder(positional);
      console.log(result.ok ? (result.existing ? `Already has a receipt task (status: ${result.status}) — reused, nothing new created.` : 'Receipt task created — run "run" or wait for the server worker.') : `Not queued: ${result.error}`);
      if (result.ok && !result.existing) await fiscal.processDueTasks();
      break;
    }
    default:
      usage();
  }
} catch (error) {
  console.error(`Failed: ${error.message}`);
  process.exitCode = 1;
}
setTimeout(() => process.exit(process.exitCode || 0), 100);
