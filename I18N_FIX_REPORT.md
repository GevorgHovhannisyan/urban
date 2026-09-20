# Language selector and translation fix

Completed:

- Normalized language values to `en`, `hy`, and `ru`.
- The selected language now immediately updates in both desktop and mobile selectors.
- The selected language is persisted in `localStorage`.
- Added a document-level translation pass for remaining static UI text and accessibility labels.
- Added missing Armenian and Russian translations for product, cart, checkout, account,
  privacy, information, reviews, size guide, footer, and limited-edition sections.
- Language switching works in both directions, including returning to English.
