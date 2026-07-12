# ssg-ap-bridge

A lightweight, high-performance ActivityPub bridge for Static Site Generators (Hugo, Astro, Eleventy, Jekyll, etc.) running on Cloudflare Workers and D1, based off [minidon](https://github.com/yusukebe/minidon).

It allows you to host an ActivityPub actor (e.g., `@blog@yourdomain.com`) on your custom domain, intercepting Webfinger and ActivityPub requests, while letting your static blog content serve normally. It allows for automatically publishing new blog posts to your followers when your site is updated, and includes basic outbound following and profile administration.

You may like this if you want something like Ghost's ActivityPub integration but can accept the lack of fancy UI or inter-blog relations (besides simply following and being followed). You may like this if you're like me and had a Ghost blog but lost the ActivityPub private key on the way out!

If you are like me, this can help you recover your blog's handle and continue using it. Just bear in mind that Mastodon tends to cache aggressively, so it may take a good minute before you see the profile "reset".

This is used for [@blog@srp.life](https://defcon.social/@blog@srp.life), which forwards posts from https://srp.life ([repo](https://github.com/RdrSeraphim/blog)).

## Features

- **RSS-to-Fediverse Bridge**: A zero-dependency regex RSS parser syncs new posts via a secure POST API (`/api/sync-feed`).
- **Custom Post Templating**: Write post templates using dynamic placeholders: `{title}`, `{description}`, and `{link}`.
- **Admin Portal (`/ap`)**: A clean, responsive two-column dashboard styled with Pico.css to write manual notes, edit display name/avatar/bio, and manage follows. Protected by Basic Authentication.
- **Outbound Follows & Unfollows**: Search for federated handles (`@user@domain`) or Actor IRIs and follow/unfollow them directly from the portal.

---

## Quickstart Setup

### 1. Installation
Install project dependencies using Yarn:
```bash
yarn install
```

### 2. Generate a Private Key
Generate a new secure RSA 2048-bit PKCS#8 private key for your ActivityPub actor:
```bash
node scripts/generate-key.js
```
*Keep this output secure; you will configure it as a secret in Cloudflare.*

### 3. Initialize D1 Database
1. Create a D1 database named `ssg-ap-bridge`:
   ```bash
   npx wrangler d1 create ssg-ap-bridge
   ```
2. Copy the `database_id` output and paste it into the `database_id` field in your `wrangler.toml`.
3. Apply the SQL schema to create the tables:
   - **For local testing**: `npx wrangler d1 execute ssg-ap-bridge --local --file=./ssg-ap-bridge.sql`
   - **For production**: `npx wrangler d1 execute ssg-ap-bridge --remote --file=./ssg-ap-bridge.sql`

### 4. Configure wrangler.toml
Edit `wrangler.toml` and fill in your variables under `[vars]`:
- `preferredUsername`: The handle username (e.g. `blog`).
- `name`: Default display name.
- `BASIC_USERNAME`: Dashboard username.

### 5. Set Production Secrets
Upload your secure password and private key to Cloudflare:
```bash
npx wrangler secret put BASIC_PASSWORD
# Enter your desired dashboard password

npx wrangler secret put PRIVATE_KEY
# Paste the RSA private key generated in Step 2
```

### 6. Deploy the Worker
Publish your Worker to Cloudflare:
```bash
yarn deploy
```

If you wish to try locally, just to get an idea, put a BASIC_PASSWORD and PRIVATE_KEY into `wrangler.toml` (not recommended for production), and run `yarn dev`.

---

## Routing & DNS Configuration

To intercept ActivityPub calls under your own domain (e.g., `srp.life`), you need to map specific routes in the Cloudflare DNS dashboard of your website:

1. Go to your domain settings in Cloudflare.
2. Navigate to **Workers Routes** (under DNS / Websites).
3. Bind your domain paths to the `ssg-ap-bridge` worker:
    - `yourdomain.com/.well-known/webfinger*` -> `ssg-ap-bridge`
    - `yourdomain.com/u/*` -> `ssg-ap-bridge`
    - `yourdomain.com/ap/*` -> `ssg-ap-bridge` *(for accessing the dashboard)*
    - `yourdomain.com/api/*` -> `ssg-ap-bridge` *(for sync feed and outbound programmatic API)*
    - `yourdomain.com/ap*` -> `ssg-ap-bridge` *(optional: only use if you don't have page/post slugs that might conflict)*
    - `yourdomain.com/ap/` -> `ssg-ap-bridge` *(optional: for use if you **do** have page/post slugs that might conflict, saves some trouble)*

All other requests to `yourdomain.com` (like standard static articles, images, and HTML) will bypass the worker and fall back to your main site (e.g., on Cloudflare Pages).

---

## RSS Templating

You can customize how your posts appear on the Fediverse via the Admin Portal (`/ap`). In the **Post Template** field, you can structure your posts using:
- `{title}`: Title of the blog post.
- `{description}`: Snippet/summary of the post (automatically stripped of HTML and truncated to 300 characters).
- `{link}`: Canonical URL of the post.

The default format is:
```text
**{title}**

{description}

{link}
```

---

## Automated Deployment (GitHub Actions)

Add a script or deploy step to your static site repository to sync posts automatically upon compilation. Set repository secrets `BRIDGE_USERNAME` and `BRIDGE_PASSWORD` in GitHub.

```yaml
name: update-ap

on:
  deployment_status:

jobs:
  sync:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - name: sync activitypub
        run: |
          curl -f -X POST "https://example.com/api/sync-feed?feedUrl=https://example.com/feed.xml" \
            -u "${{ secrets.BRIDGE_USERNAME }}:${{ secrets.BRIDGE_PASSWORD }}"
```

---

## Author & Attribution
- Original version: Yusuke Wada (MIT)
- Heavy inspiration and logic adapted from **Matchbox** (Copyright © 2022 Acefed, MIT) and **Express ActivityPub Server** (Copyright © 2018 Darius Kazemi, MIT).
