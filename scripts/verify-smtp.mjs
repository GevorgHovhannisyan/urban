// One-off manual check that the configured SMTP credentials actually
// authenticate with the provider (Zoho or otherwise) — does not send any
// email, just calls transporter.verify(). Never exposed over HTTP; run
// locally with your real .env in place:
//
//   node --env-file=.env scripts/verify-smtp.mjs
//
import { describeSmtpConfig, verifySmtpConnection } from '../server/mailer.mjs';

const config = describeSmtpConfig();
console.log(`SMTP config: ${config.message}`);

if (config.status !== 'configured') {
  console.log('Skipping connection check — SMTP is not fully configured.');
  process.exit(config.status === 'unconfigured' ? 0 : 1);
}

const result = await verifySmtpConnection();
if (result.ok) {
  console.log('SMTP connection verified — credentials authenticate successfully.');
  process.exit(0);
} else {
  console.error(`SMTP connection failed (${result.reason}): ${result.message || 'no further detail'}`);
  process.exit(1);
}
