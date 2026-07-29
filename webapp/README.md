# Masselink Facturen

PWA voor klanten, projecten, facturen en PDF-export met centrale opslag via Supabase.

## Lokale start

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4174
```

## Vereiste environment variables

Zet deze in Vercel en lokaal in `.env.local`:

```bash
VITE_SUPABASE_URL=https://izdgqyvqbtnmzrnqooxs.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Gebruik alleen de `anon` key, niet de `service_role` key.

## Supabase

Voer voor deployment eerst de actuele SQL uit:

- [supabase/schema.sql](./supabase/schema.sql)

Die maakt en actualiseert:

- `app_settings`
- `customers`
- `projects`
- `invoice_drafts`
- `invoices`

## Vercel deployment

1. Maak in Vercel een nieuw project.
2. Kies de map `webapp` als root directory.
3. Voeg deze environment variables toe:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

Vercel hoort dit automatisch te detecteren:

- framework: `Vite`
- install command: `npm install`
- build command: `npm run build`
- output directory: `dist`

## Login

De eindgebruiker moet al in Supabase `Authentication > Users` bestaan of zichzelf eenmalig registreren als signup tijdelijk aanstaat.
