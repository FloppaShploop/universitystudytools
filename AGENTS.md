<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Rules
- Accounts use a custom signed HttpOnly cookie (src/lib/auth/core.server.ts), not Cloud Auth — admins live in secrets and usernames need no email.
- The proxy route enforces sign-in and per-account site limits on page loads — UI-only checks could be bypassed.
- Account data is reached only through the key-checked app_db database function (src/lib/auth/db.server.ts) — it needs no service-role key, so the app runs on Lovable and on external hosts like Netlify.
- Non-admin accounts allow one device: each browser gets a long-lived device cookie; tabs share it, so only sign-ins from a different recently-active device trigger the ban.
