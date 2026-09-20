# Added customer-facing logic

## Customer comments
- Product pages load reviews from `GET /api/reviews?productId=...`.
- Customers can publish a name, email, star rating and comment through `POST /api/reviews`.
- Server-side validation is included.
- Public reviews are stored in `data/reviews.json`.
- Customer email is never returned to the browser.

## United States regional pricing
- The browser attempts IP-country detection with `ipapi.co`.
- If that request is unavailable, a locale and timezone fallback is used.
- US visitors receive a 15% regional price multiplier.
- The selected country is cached in `localStorage` as `up_visitor_country`.
- Checkout sends the detected region and the server recalculates the same multiplier.

For testing, run this in the browser console and reload:
`localStorage.setItem('up_visitor_country', 'US')`

To reset:
`localStorage.removeItem('up_visitor_country')`

## Privacy popup
- Opens for first-time visitors.
- Supports “Accept all” and “Essential only”.
- Saves the choice in `localStorage` under `up_privacy_choice`.
- Includes a link to the privacy policy page.
