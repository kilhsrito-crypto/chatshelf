# Privacy Policy (Draft) — ChatShelf

**Last updated:** 2026-11-13

## Overview

ChatShelf (“the Extension”) helps you organize ChatGPT and Claude web conversations into folders and store prompt snippets. This policy describes what the Extension does with data.

## Data we store

Stored **only** in your browser via `chrome.storage.local` (on your device):

- Folder names and IDs
- Chat bookmarks: title, page URL, optional note, site label (`chatgpt` / `claude`), timestamps
- Prompt snippets: title, body text, optional tags, timestamps
- Settings (e.g. default folder, UI preferences)
- A random install id (used as the license instance name)
- License metadata (plan, license key, Creem instance id, status, validation timestamps) — only if you activate Pro

## Data we do **not** collect

- No analytics SDKs
- No advertising identifiers
- No automatic upload of chat transcripts to our servers
- No account system
- We do **not** read your ChatGPT/Claude message history into our storage beyond what you explicitly save (title/URL/note) or type into the prompt library
- We do **not** send your hostname, email, or page contents with the license check

## Permissions

- `storage` — save folders, bookmarks, prompts locally
- `activeTab` / host access to `chatgpt.com`, `chat.openai.com`, `claude.ai` — inject the floating UI and insert prompts into the page composer
- Host access to `chatshelf.naruhodoowl.me` — activate or re-check a Pro license key

## Third parties

**ChatShelf license service** (`chatshelf.naruhodoowl.me`) — only if you activate ChatShelf Pro, remove the key, or the weekly re-check runs. The Extension POSTs your license key and either a random install id (first activation) or the instance id from that activation. The service forwards that request to **Creem** (`api.creem.io`) with an API key that stays on the server. Creem replies with whether the license is valid. Purchases themselves happen on Creem's website. Nothing else is sent anywhere.

## Export / delete

- **Export:** Settings → Export JSON (license key omitted from export)
- **Delete:** Settings → Remove key from this browser (deactivates this install, then deletes the local license). Removing the extension in `chrome://extensions`, or clearing extension storage, deletes local ChatShelf data. Clearing storage without deactivating first can leave an activation slot in use until it is removed another way.

## Children

Not directed at children under 13 (or higher age as required in your jurisdiction).

## Contact

Open an issue at <https://github.com/kilhsrito-crypto/chatshelf>, or use the email on your Creem receipt.

## Changes

We will update this document before adding sync, telemetry, or any new third party.
