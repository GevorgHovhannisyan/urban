import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

export default function StripePaymentForm({ pendingCheckoutId, total, formatMoney, onSuccess, onError, returnPath = '/checkout' }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    onError('');

    // redirect: 'if_required' keeps the shopper on our own page for the
    // common case (a card that doesn't need 3D Secure); Stripe only
    // redirects away when a payment method genuinely requires it.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${returnPath}?stripe=return&pendingCheckoutId=${encodeURIComponent(pendingCheckoutId)}`,
      },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message || 'Payment failed. Please check your details and try again.');
      setSubmitting(false);
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      onSuccess();
      return;
    }
    onError('Payment could not be completed. Please try again.');
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="btn-primary w-full py-4 uppercase text-xs tracking-[.2em] disabled:opacity-50"
      >
        {submitting ? 'Processing…' : `Pay ${formatMoney(total, { regional: false })}`}
      </button>
    </form>
  );
}
