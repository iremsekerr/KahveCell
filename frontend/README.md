# KahveCell Frontend

React 19, Vite, React Router, and Leaflet are used for the web application.

## Run locally

From this directory:

```powershell
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The FastAPI
backend should be available at `http://localhost:8000`.

The API base URL defaults to `http://localhost:8000/api/v1`. To override it,
copy `.env.example` to `.env` and set `VITE_API_BASE_URL`.

## Routes

- `/` — nearby shop cards and map; requests browser location and falls back to Ankara Kızılay
- `/login` and `/register` — phone/OTP authentication; registration completes the profile after OTP verification
- `/shops` — nearby shop cards and map
- `/shops/:shopId` — shop details, working hours, and menu grouped by category
- `/orders/new` — customize an order and review subscription credits
- `/qr/:orderId` — QR code with order status delivered in real time over SSE
- `/history` — orders sorted newest first
- `/subscription` — active subscription, cancellation, and plan purchase
- `/shop-owner` — owner-only order queue and QR camera scanning (the browser needs camera permission; localhost or HTTPS is required)
- `/admin` — admin-only shop ownership, order status, subscription, and payment management

The app uses shared loading, retryable error, and empty states. Success and
action errors appear as dismissible notifications in the top-right corner.
