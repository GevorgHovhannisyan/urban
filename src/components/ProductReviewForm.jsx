import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import Icon from './Icon';

const initialForm = { rating: 5, body: '' };

// Gate block reused for both "sign in" and "purchase required" states —
// same visual language (.review-login-gate), just different copy and an
// optional CTA. Server-enforced eligibility (see /api/reviews/eligibility)
// is what actually decides which of these renders; this component never
// makes that call itself, it only reflects what the server already said.
function GateBlock({ eyebrow, title, body, cta, onCta }) {
  return (
    <section className="review-login-gate">
      <div>
        <p className="review-login-gate__eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      {cta && <button type="button" onClick={onCta}>{cta}</button>}
    </section>
  );
}

export default function ProductReviewForm({ productId, onCreated, onUpdated, onDeleted }) {
  const { user, navigate } = useApp();
  const [eligibility, setEligibility] = useState(null);
  const [eligLoading, setEligLoading] = useState(true);
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadEligibility = () => {
    setEligLoading(true);
    const headers = user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {};
    fetch(`/api/reviews/eligibility?productId=${encodeURIComponent(productId)}`, { headers })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setEligibility(data))
      .catch(() => setEligibility(null))
      .finally(() => setEligLoading(false));
  };

  useEffect(() => {
    loadEligibility();
    setForm(initialForm);
    setEditing(false);
    setStatus({ type: '', message: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, user?.sessionToken]);

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: name === 'rating' ? Number(value) : value }));
    setStatus({ type: '', message: '' });
  };

  const startEdit = () => {
    const existing = eligibility?.review;
    setForm({ rating: existing?.rating || 5, body: existing?.body || '' });
    setEditing(true);
    setStatus({ type: '', message: '' });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!user) {
      navigate('login');
      return;
    }
    const body = form.body.trim();
    if (!body) {
      setStatus({ type: 'error', message: 'Please write a comment.' });
      return;
    }
    if (body.length < 10) {
      setStatus({ type: 'error', message: 'Your comment must contain at least 10 characters.' });
      return;
    }

    const isEditing = editing && eligibility?.review;
    setSubmitting(true);
    try {
      const response = await fetch(isEditing ? `/api/reviews/${eligibility.review.id}` : '/api/reviews', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.sessionToken}` },
        body: JSON.stringify({ productId, rating: form.rating, body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your comment could not be submitted.');

      setForm(initialForm);
      setEditing(false);
      setStatus({ type: 'success', message: isEditing ? 'Your review has been updated.' : 'Thank you. Your review is now visible.' });
      if (isEditing) onUpdated?.(data.review); else onCreated?.(data.review);
      loadEligibility();
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Your comment could not be submitted.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!eligibility?.review || !user) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/reviews/${eligibility.review.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.sessionToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your review could not be deleted.');
      onDeleted?.(eligibility.review.id);
      loadEligibility();
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Your review could not be deleted.' });
    } finally {
      setDeleting(false);
    }
  };

  if (eligLoading || !eligibility) return null;

  if (eligibility.reason === 'not_authenticated') {
    return (
      <GateBlock
        eyebrow="Members only"
        title="Sign in to leave a review."
        body="Your review helps other customers choose with confidence."
        cta="Sign in"
        onCta={() => navigate('login')}
      />
    );
  }

  if (eligibility.reason === 'not_purchased') {
    return (
      <GateBlock
        eyebrow="Verified purchasers only"
        title="Only customers who purchased this product can leave a review."
        body="Once your order for this piece is confirmed, you'll be able to share your experience here."
      />
    );
  }

  if (eligibility.reason === 'already_reviewed' && !editing) {
    const review = eligibility.review;
    return (
      <section className="product-review-form product-review-form--own">
        <div className="product-review-form__heading">
          <div>
            <p className="product-review-form__eyebrow">Your review</p>
            <h3>You already reviewed this piece</h3>
          </div>
          <span className="product-review-own__badge">
            <Icon name="shieldCheck" size={14} strokeWidth={1.6} aria-hidden="true" />
            Verified Purchase
          </span>
        </div>
        <p className="text-sm font-body font-light text-muted leading-relaxed mb-5">{review.body}</p>
        {status.message && (
          <p className={`product-review-form__status is-${status.type}`} role="status">{status.message}</p>
        )}
        <div className="flex gap-4 mt-2">
          <button type="button" onClick={startEdit} className="product-review-own__action" aria-label="Edit your review">
            Edit review
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="product-review-own__action product-review-own__action--danger"
            aria-label="Delete your review"
          >
            {deleting ? 'Deleting…' : 'Delete review'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="product-review-form" onSubmit={submit} noValidate>
      <div className="product-review-form__heading">
        <div>
          <p className="product-review-form__eyebrow">{editing ? 'Editing your review' : 'Join the conversation'}</p>
          <h3>{editing ? 'Update your comment' : 'Write a comment'}</h3>
        </div>
        <label className="product-review-form__rating">
          <span>Rating</span>
          <select name="rating" value={form.rating} onChange={update}>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>{value} / 5</option>
            ))}
          </select>
        </label>
      </div>

      <label className="product-review-form__comment">
        <span>Comment</span>
        <textarea name="body" value={form.body} onChange={update} rows="5" maxLength="800" />
      </label>

      {status.message && (
        <p className={`product-review-form__status is-${status.type}`} role="status">
          {status.message}
        </p>
      )}

      <div className="flex gap-4 items-center">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Publishing…' : (editing ? 'Save changes' : 'Publish comment')}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => { setEditing(false); setForm(initialForm); setStatus({ type: '', message: '' }); }}
            className="product-review-own__action"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
