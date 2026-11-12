# Privacy Policy (Draft) — ChatShelf

**Last updated:** 2026-11-12

## Overview

ChatShelf (“the Extension”) helps you organize ChatGPT and Claude web conversations into folders and store prompt snippets. This policy describes what the Extension does with data.

## Data we store

Stored **only** in your browser via `chrome.storage.local` (on your device):

- Folder names and IDs
- Chat bookmarks: title, page URL, optional note, site label (`chatgpt` / `claude`), timestamps
- Prompt snippets: title, body text, optional tags, timestamps
- Settings (e.g. default folder, UI preferences)
- License metadata (plan, license key, purchase email returned by Gumroad, use count, validation timestamps) — only if you activate Pro

## Data we do **not** collect

- No analytics SDKs
- No advertising identifiers
- No automatic upload of chat transcripts to our servers
- No account system
- We do **not** read your ChatGPT/Claude message history into our storage beyond what you explicitly save (title/URL/note) or type into the prompt library

## Permissions

- `storage` — save folders, bookmarks, prompts locally
- `activeTab` / host access to `chatgpt.com`, `chat.openai.com`, `claude.ai` — inject the floating UI and insert prompts into the page composer
- Host access to `api.gumroad.com` — verify a Pro license key

## Third parties

**Gumroad** (gumroad.com) — only if you activate ChatShelf Pro. When you click Activate, and about once a week afterwards, the Extension sends your license key and the ChatShelf product ID to `https://api.gumroad.com/v2/licenses/verify`. Gumroad replies with whether the purchase is valid. Purchases themselves happen on Gumroad's website under [Gumroad's privacy policy](https://gumroad.com/privacy). Nothing else is sent anywhere.

## Export / delete

- **Export:** Settings → Export JSON (license key omitted from export)
- **Delete:** Remove the extension in `chrome://extensions`, or clear extension storage; this deletes local ChatShelf data

## Children

Not directed at children under 13 (or higher age as required in your jurisdiction).

## Contact

Open an issue on the GitHub repository, or reply to your Gumroad receipt. (Maintainer: replace with a support email before public listing.)

## Changes

We will update this document before adding sync, telemetry, or any new third party.
