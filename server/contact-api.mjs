import { sendContactNotificationEmail, sendContactConfirmationEmail } from './mailer.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);

const ALLOWED_TOPICS = new Set(['Order support', 'Sizing', 'Collaboration', 'Wholesale']);

// Every field is trimmed/length-capped and single-line fields strip newlines
// before ever reaching mailer.mjs's sendMail() calls — this is what stands
// between a malicious visitor and injecting arbitrary extra SMTP headers
// (e.g. a "name" of `Evil\nBcc: someone@else.com`) into the outgoing message.
function stripNewlines(value) {
  return value.replace(/[\r\n]+/g, ' ');
}

export async function submitContactForm({ name, email, topic, message }) {
  const cleanName = stripNewlines(clean(name, 120));
  const cleanEmail = stripNewlines(clean(email, 160)).toLowerCase();
  const cleanTopic = stripNewlines(clean(topic, 60)) || 'General enquiry';
  const cleanMessage = clean(message, 5000);

  if (!cleanName) return { status: 400, body: { error: 'Please enter your name.' } };
  if (!emailPattern.test(cleanEmail)) return { status: 400, body: { error: 'Please enter a valid email address.' } };
  if (!cleanMessage || cleanMessage.length < 5) return { status: 400, body: { error: 'Please enter a message.' } };
  if (!ALLOWED_TOPICS.has(cleanTopic)) return { status: 400, body: { error: 'Please choose a valid topic.' } };

  // Both sends are logged (not thrown) inside mailer.mjs on failure — the
  // visitor's submission was validated and accepted, so a downstream SMTP
  // failure must never surface as a failed submission or leak provider
  // error details to the response.
  await sendContactNotificationEmail({ name: cleanName, email: cleanEmail, topic: cleanTopic, message: cleanMessage });
  sendContactConfirmationEmail({ name: cleanName, email: cleanEmail, topic: cleanTopic }).catch(() => {});

  return { status: 200, body: { message: 'Thanks — your message has been received.' } };
}
