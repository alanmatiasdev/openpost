---
status: accepted
---

# Publish explicit Markdown before edge-selected responses

Marketing and documentation publish explicit `.md` URLs as the primary agent-readable interface, with canonical HTML pages advertising those alternates. Cloudflare may later select the same artifacts only for canonical `GET` and `HEAD` requests whose `Accept` value is exactly `text/markdown`; generated Single Redirects canonicalize paths first, and generated URL Rewrite, response-header, and Vary Cache Rules keep representations separate. This narrow contract avoids an edge Worker and remains usable without negotiation, so the Cloudflare rules can be inspected, enabled, tested, or rolled back independently of the generated content.
