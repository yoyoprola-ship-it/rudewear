# Rudewear

Strong style menswear — subdomain of [lafayettelamarket.com](https://lafayettelamarket.com).

## Status

Coming Soon page.

Emails captured land in Firestore collection `rudewear_signups` (shared Firebase project with Lafayette Market for infrastructure efficiency).

## Stack

- Next.js 16 · App Router · TypeScript
- Tailwind CSS
- Firebase (shared project: `lafayette-market-d64ff`)
- Deploy: Firebase App Hosting

## Development

```bash
npm install
# Copy Firebase env vars from lafayette-market/.env.local into .env.local:
#   NEXT_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, etc.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Auto-deploys from `main` via Firebase App Hosting.

## License

Private.
