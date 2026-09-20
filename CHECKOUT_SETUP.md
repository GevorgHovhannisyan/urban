# Checkout implementation

The checkout now:

- validates all required customer fields
- submits orders to `POST /api/orders`
- validates product, size, color, and quantity on the server
- recalculates totals on the server
- stores orders in `data/orders.json`
- shows loading, errors, and an order confirmation number
- clears the cart only after a successful response

Cash on delivery has been removed. Every supported payment method (card,
PayPal, Idram, Telcell) is an online payment flow; the server rejects a
legacy `paymentMethod: "cash"` request.

## Run in development

```bash
npm install
npm run dev
```

The Vite development server includes the order API middleware.

## Run the production build

```bash
npm run build
npm start
```

The Node server serves the `dist` folder and the order API.

## Online payments

Card, PayPal, Idram, and Telcell selections create an order with `payment_pending`.
They do not charge money until provider credentials and secure provider-specific
server integrations are added. Never place secret API keys in frontend files.
