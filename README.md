# Apricity — Petal Palettes Seasonal Color Analysis

AI-powered 12-season color analysis web app. Upload a selfie, get your seasonal
palette, and buy the physical Petal Palettes cards.

Built with **Next.js 15 (App Router) + TypeScript + Tailwind CSS + Anthropic
Claude (vision)**.

---

## Current status — Phase 1

- ✅ Scaffold (Next.js, Tailwind, ESLint, TypeScript)
- ✅ Brand palette wired into `tailwind.config.ts`
- ✅ `/api/analyze` route calling Claude with vision + prompt caching
- ✅ `/analyze` test page (upload → resize → JSON response)
- ⏳ Landing, results, account, shop, legal pages (next)
- ⏳ Supabase (DB + auth) and Stripe (checkout) (later)

The test harness at `/analyze` exists so you can validate analysis quality
against real photos before iterating on UI. Once you're happy with the AI
output, we'll build the polished multi-page experience on top.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get an Anthropic API key

1. Go to <https://console.anthropic.com/>
2. Sign up / sign in
3. **Settings → API Keys → Create Key**
4. Copy the key (you'll only see it once)
5. Add **$5–10 of credit** under **Billing** so requests actually run

### 3. Create your local env file

```bash
cp .env.example .env.local
```

Open `.env.local` and paste your key into `ANTHROPIC_API_KEY=`. Leave the
Supabase / Stripe variables blank for now — we'll fill those in later.

`.env.local` is gitignored; it will never be committed.

### 4. Run the dev server

```bash
npm run dev
```

Visit <http://localhost:3000/analyze>, upload a selfie, and you should see the
structured JSON from Claude. Each analysis takes ~5–15 seconds.

---

## What lives where

| Path                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `app/page.tsx`              | Landing page (placeholder — built out later)          |
| `app/analyze/page.tsx`      | Upload + resize + show raw JSON (test harness)        |
| `app/api/analyze/route.ts`  | Server route that calls Claude with vision            |
| `app/layout.tsx`            | Root layout, metadata, global styles                  |
| `app/globals.css`           | Tailwind entry + base typography                      |
| `tailwind.config.ts`        | Brand colors: `apricity-blush / cream / charcoal / gold` |
| `.env.example`              | Template for env vars — copy to `.env.local`          |
| `reference/`                | Your original hand-styled HTML prototype, preserved   |

---

## How the AI route works

`app/api/analyze/route.ts` does the following:

1. Accepts JSON `{ image: <base64>, mediaType: "image/jpeg" }` from the client
2. Validates size (≤ ~7MB base64) and allowed media types
3. Sends the image to Claude with a detailed color-analyst system prompt
4. Uses **prompt caching** on the system prompt — the first request pays
   ~1.25× for the cache write, subsequent requests within 5 minutes pay ~0.1×
   on the cached prefix. In practice this cuts input token costs by ~90% on
   repeat requests.
5. Parses Claude's JSON response (defensively strips Markdown code fences)
6. Returns the parsed analysis + token usage + model name

### Model

Using `claude-sonnet-4-5` (as specified in the brief). To upgrade to a newer
model later, edit the `MODEL` constant at the top of
`app/api/analyze/route.ts`. `claude-sonnet-4-6` and `claude-opus-4-7` are
drop-in replacements with the same vision-input shape.

### Prompt caching

The system prompt is ~1.5k tokens and is identical on every request, so it's
the ideal thing to cache. The `system` field is declared as an array with one
text block and `cache_control: { type: "ephemeral" }` — Anthropic's SDK handles
the rest. You'll see `cache_read_input_tokens > 0` in the response `usage`
field from the second request onward (within 5 minutes).

### Privacy

**Photos are never stored.** The route keeps the base64 only in memory while
calling Anthropic, then discards it. No database writes, no filesystem writes,
no logs containing image data.

---

## Scripts

| Command         | What it does                                |
| --------------- | ------------------------------------------- |
| `npm run dev`   | Start the dev server at `localhost:3000`    |
| `npm run build` | Production build (type-checks everything)   |
| `npm run start` | Run the production build                    |
| `npm run lint`  | Run ESLint                                  |

---

## Deploying to Vercel

1. Push this repo to GitHub
2. Go to <https://vercel.com/new>, import the repo
3. Add environment variables in the Vercel project settings:
   - `ANTHROPIC_API_KEY` — your key (required)
   - Supabase / Stripe vars (once added in later phases)
4. Deploy. Vercel auto-detects Next.js.

That's it — no additional config needed. The `/api/analyze` route runs on
Vercel's Node runtime.

---

## Roadmap (what comes next)

Once the `/analyze` test page produces good results on a few real photos:

1. Landing page (`/`) — hero, example result, CTA
2. Polished upload page (`/analyze`) — guidance, consent checkbox, good/bad examples
3. Processing screen + animation
4. Results page (`/results/[id]`) — season, reasoning, swatches, buy CTA
5. Supabase integration — save analyses, user accounts
6. Stripe Checkout — Petal Palettes product at $9.99
7. Legal pages — privacy, terms, about

See the original brief for full feature specs.
