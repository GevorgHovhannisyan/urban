# Multilingual & Limited Edition update

## Languages
The header language selector switches the storefront between English, Armenian and Russian.
The translator covers navigation, product, cart, checkout, privacy and common validation/action labels.

## Limited Edition
Each product has 100 serialized pieces (`001`–`100`).
The customer must choose one unique edition number per requested item.
Sold numbers are returned by `GET /api/editions?productId=...` and rendered as disabled `Sold out`.
On order creation the server checks and claims the selected numbers atomically before saving the order.
State is stored in `data/editions.json`.

Run:
```bash
npm install
npm run dev
```
Production:
```bash
npm run build
npm start
```
