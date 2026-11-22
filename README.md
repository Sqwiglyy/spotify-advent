# December Mixtape on GitHub Pages

Create 24-song Spotify advent calendars and share them by six-character code. GitHub Pages serves the website and a separate Cloudflare Worker with D1 stores the calendars and enforces release dates.

## First deployment

1. Create a **new public GitHub repository** named `spotify-advent` and push the contents of this folder to its `main` branch, including `.github/workflows/pages.yml`.
2. [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FSqwiglyy%2Fspotify-advent). This link assumes the repo is `Sqwiglyy/spotify-advent`. If you choose another repo name or account, use `https://deploy.workers.cloudflare.com/?url=YOUR_GITHUB_REPO_URL`. Cloudflare provisions D1 and the deploy script applies its migration. During setup, set `PAGES_ORIGIN` to your Pages origin, such as `https://sqwiglyy.github.io`, with no trailing slash or repo path.
3. In the original GitHub repo, open **Settings → Secrets and variables → Actions → Variables** and add `WORKER_URL` with the HTTPS URL printed by Cloudflare. Then open **Settings → Pages** and select **GitHub Actions** as the source.
4. Open **Actions → Deploy calendar to GitHub Pages → Run workflow**. After it succeeds, open the Pages URL listed in the job. Subsequent pushes to `main` redeploy the frontend automatically.

If Cloudflare creates its own copy of the repository, keep using the original repo for GitHub Pages and use the Worker URL from the Cloudflare deployment.

## Check the deployment

Open the Pages URL, create a calendar with all 24 Spotify track links, and open the share link in a private browser window. Before December the doors should render locked. Titles and cover art are fetched from Spotify only when an available door is opened. The direct Spotify link remains available if metadata is temporarily unavailable.

## Testing before December

Use a separate local database to test an open door. Run `npm install`, `npx wrangler d1 migrations apply DB --local`, and `npx wrangler dev`. With a local calendar code, adjust that row's year to a past year in the local database:

```sh
npx wrangler d1 execute DB --local --command "UPDATE calendars SET year = 2025 WHERE code = 'ABC123'"
```

## Update an existing deployment

Copy the updated public files (including fonts and spotify.js), worker.mjs, workflow and migrations/0002_calendar_title.sql into your existing repo. Preserve your actual wrangler.jsonc database ID and PAGES_ORIGIN. Preserve the applied 0001 migration. The existing npm run deploy command applies migration 0002 before deployment.

Create or open your Spotify Developer app. Add the exact Pages address as an approved redirect URI, including its repository path and trailing slash, for example https://sqwiglyy.github.io/spotify-advent/. Set SPOTIFY_CLIENT_ID as a GitHub Actions repository variable, then rerun the Pages workflow. This is a public client ID. Keep Spotify client secrets out of the frontend.

Spotify's development mode currently requires the app owner to have Premium and allows five approved users. Add intended recipient accounts to the Spotify app's allowlist. The recipient grants permission to create a private playlist after opening all 24 doors. Playlist order matches calendar order and its name matches the calendar title. There is no Spotify account required for calendar creation or door viewing.

The finale is shown after all 24 doors have been opened in that browser. Only the opened-day numbers and playlist retry references are kept in browser storage. Opening a song cannot verify that it was listened to. The Worker releases the full list only from December 24 onward. Existing calendars retain the default title until new named calendars are created.

The Squeaklands pixel font is Aseprite. This update includes the same WOFF2 asset served by squeaklands.com.
