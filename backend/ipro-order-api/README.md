# iPro Order API v2

Backend for TeleSyriana / iPro Operations order lookup.

This version is for Shopify apps created in the Shopify Dev Dashboard. It obtains short-lived Admin API access tokens automatically using the client credentials flow.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Fill environment variables locally or set them on your deployment platform.

## Test

```bash
curl http://localhost:3000/health
curl -H "x-api-key: YOUR_API_SECRET_KEY" "http://localhost:3000/api/search-orders?q=1001"
```
