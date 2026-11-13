# ChatShelf license proxy

Small Python 3 process that lets the Chrome extension activate Creem licenses without shipping `CREEM_API_KEY`. It listens on `127.0.0.1:8787` only. nginx on `chatshelf.naruhodoowl.me` forwards `/api/licenses/` to it and keeps the static site on `/`.

The extension calls this host. This process calls `https://api.creem.io/v1/licenses/{activate,validate,deactivate}` and adds the `x-api-key` header. Do not put the key in the extension, this README, or git.

Logs are path and HTTP status only. Request bodies, license keys, and the API key are not logged. Unknown paths are logged as `other`.

## Routes

| Method | Path | Forwarded JSON |
|---|---|---|
| POST | `/api/licenses/activate` | `key`, `instance_name` |
| POST | `/api/licenses/validate` | `key`, `instance_id` |
| POST | `/api/licenses/deactivate` | `key`, `instance_id` |

Anything else is 404. Other methods on those paths are 405. Extra JSON fields are dropped. Creem error bodies are replaced with a short `error` code before they reach the browser. `Access-Control-Allow-Origin` is set only for a `chrome-extension://` origin. Requests with no `Origin` (the extension service worker, curl) still work.

## API key

Pick one. The placeholder `replace-with-creem-api-key` will not start the process.

**systemd (preferred).** systemd reads the env file as root, so the service user does not need to.

```bash
sudo install -d -m 755 /etc/chatshelf /opt/chatshelf
sudo install -m 644 server/license-proxy.py /opt/chatshelf/license-proxy.py
sudo cp server/creem.env.example /etc/chatshelf/creem.env
sudo chmod 600 /etc/chatshelf/creem.env
# Edit /etc/chatshelf/creem.env and replace the placeholder with the live Creem API key.
sudo cp server/chatshelf-license-proxy.service /etc/systemd/system/chatshelf-license-proxy.service
sudo systemctl daemon-reload
sudo systemctl enable --now chatshelf-license-proxy
```

**Key file, foreground.** The file is one line, mode `600`, normally owned by root. Run the process as root, or `chown` the file to the user that runs it and keep mode `600`.

```bash
sudo install -d -m 755 /etc/chatshelf
sudo cp server/creem_api_key.example /etc/chatshelf/creem_api_key
sudo chmod 600 /etc/chatshelf/creem_api_key
# Replace the placeholder in /etc/chatshelf/creem_api_key, then:
sudo CREEM_API_KEY_FILE=/etc/chatshelf/creem_api_key python3 server/license-proxy.py
```

`CREEM_API_KEY` in the environment wins over the file. Leave `CREEM_API_BASE` unset so the proxy uses production `https://api.creem.io`. `http://` is rejected except for `127.0.0.1` tests. `LICENSE_PROXY_HOST` cannot be changed off `127.0.0.1`. Do not put this process in pm2.

## nginx

Copy `server/nginx-chatshelf-api.conf` into the existing TLS server for `chatshelf.naruhodoowl.me` (or `include` it). Do not replace the `location /` static site. Reload nginx after `nginx -t`.

```nginx
include /etc/nginx/snippets/chatshelf-api.conf;
```

## Check

```bash
curl -sS -D - -o /tmp/chatshelf-license-body \
  -X POST http://127.0.0.1:8787/api/licenses/activate \
  -H 'Content-Type: application/json' \
  -d '{"key":"not-a-real-key","instance_name":"cs-testinstance"}'
```

Expect a small JSON error and no `x-api-key` response header. An unknown key comes back invalid. A real customer key activates once; a second check from the extension sends `instance_id` to `/api/licenses/validate`.
