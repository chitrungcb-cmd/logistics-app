This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Run the automated quality checks before every commit:

```bash
npm test
npm run lint
npx tsc --noEmit
npx prisma validate
npm run build
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Production storage and Gmail sync

Production attachments are stored in a private Supabase Storage bucket instead of `public/uploads`.

1. Create a private bucket named `logistics-attachments` in the Supabase project. Set its file-size
   limit to 20 MB and allow PDF, Excel, Word, PNG/JPEG, and XML MIME types.
2. Add every variable listed in `.env.example` to the Hostinger environment. `AUTH_SECRET`,
   `TOKEN_ENCRYPTION_KEY`, `INITIAL_SETUP_SECRET`, and `CRON_SECRET` must be separate random values
   of at least 32 bytes. Never prefix a server secret with `NEXT_PUBLIC_`.
3. Validate the hosting configuration with `npm run check:production-env`. `npm start` runs this
   check automatically and refuses to start with an unsafe configuration.
4. In Google Cloud Console, configure `GOOGLE_REDIRECT_URI` so it exactly equals
   `APP_URL + /api/gmail/callback`.
5. In Hostinger hPanel, create a custom cron job that runs every five minutes:

```bash
curl --fail --silent --show-error --output /dev/null --request POST --header "Authorization: Bearer YOUR_CRON_SECRET" "https://your-domain.example/api/gmail/sync"
```

Use the exact same secret in the header and the hosting environment. Browser polling is deliberately
disabled; administrators can still use **Đồng bộ ngay** for troubleshooting.

Local development falls back to `public/uploads` when Supabase Storage is not configured. Production
fails closed instead of writing sensitive files to local application storage. Existing `/uploads/*`
records are ignored by Git and must be migrated before deploying from GitHub. Audit first, then run
the resumable migration; the local recovery copy is retained:

```bash
npm run storage:audit
npm run storage:migrate
npm run storage:audit
```

The final audit must report `0` legacy files. Do not delete `public/uploads` until production file
previews have been verified and an external backup exists.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
