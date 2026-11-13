#!/usr/bin/env python3
"""ChatShelf Creem license proxy.

Stdlib only. Binds 127.0.0.1 and forwards three JSON routes to
https://api.creem.io/v1/licenses/{activate,validate,deactivate} with the
x-api-key header. The key comes from CREEM_API_KEY or from a chmod-600
file (default /etc/chatshelf/creem_api_key). It is never logged or returned.

Put nginx in front of this process. Do not expose port 8787 publicly.
"""

from __future__ import annotations

import json
import logging
import os
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = logging.getLogger("chatshelf.license_proxy")

DEFAULT_UPSTREAM = "https://api.creem.io"
DEFAULT_KEY_FILE = "/etc/chatshelf/creem_api_key"
BIND_HOST = "127.0.0.1"
MAX_BODY = 4096
MAX_UPSTREAM = 65536
UPSTREAM_TIMEOUT = 12

ROUTES = {
    "/api/licenses/activate": ("activate", ("key", "instance_name")),
    "/api/licenses/validate": ("validate", ("key", "instance_id")),
    "/api/licenses/deactivate": ("deactivate", ("key", "instance_id")),
}
FIELD_LIMITS = {"key": 256, "instance_name": 128, "instance_id": 128}

# Same sentences the extension shows. Never substitute an upstream body.
SAFE_MESSAGES = {
    "invalid_key": "This license key is not valid.",
    "bad_request": "This license key is not valid.",
    "activation_limit": (
        "This key has reached its activation limit (3 browsers). "
        "Remove it from another browser and try again."
    ),
    "expired": "This license has expired.",
    "revoked": "This license was revoked.",
    "expired_or_revoked": "This license has expired or was revoked.",
    "not_active": "This license is not active on this browser.",
    "already_inactive": "This browser was already deactivated.",
    "unavailable": "Couldn't reach the license server. Check your connection and try again.",
    "not_found": "Not found.",
    "forbidden": "Origin is not allowed.",
}

_PLACEHOLDERS = {
    "replace-with-creem-api-key",
    "changeme",
    "your-api-key",
    "your_api_key",
}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}\Z")
_OPENER = None


class UpstreamError(Exception):
    """Network or protocol failure talking to Creem. Carries no response body."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)


def error_body(code):
    return {"error": code, "message": SAFE_MESSAGES[code]}


def allowed_origin(value):
    if not value or not isinstance(value, str):
        return None
    origin = value.strip()
    if _ORIGIN.fullmatch(origin):
        return origin
    return None


def check_bind_host(host):
    if host not in (BIND_HOST, ""):
        raise SystemExit("license proxy refuses to bind anything except 127.0.0.1")


def validate_upstream(base):
    raw = (base or "").strip() or DEFAULT_UPSTREAM
    parts = urllib.parse.urlsplit(raw)
    if parts.username or parts.password or parts.query or parts.fragment:
        raise SystemExit("CREEM_API_BASE must not include credentials or a query")
    host = (parts.hostname or "").lower()
    if parts.scheme == "https" and host:
        return raw.rstrip("/")
    if parts.scheme == "http" and host in ("127.0.0.1", "localhost"):
        return raw.rstrip("/")
    raise SystemExit("CREEM_API_BASE must be https (http is only allowed for 127.0.0.1 tests)")


def _reject_key(key):
    if (
        not key
        or key in _PLACEHOLDERS
        or len(key) > 500
        or _CONTROL.search(key)
    ):
        raise SystemExit("CREEM_API_KEY is missing or still a placeholder")


def _key_from_text(text):
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("CREEM_API_KEY="):
            stripped = stripped.split("=", 1)[1].strip().strip('"').strip("'")
        lines.append(stripped)
    if len(lines) != 1:
        raise SystemExit("key file must contain exactly one key")
    return lines[0]


def load_api_key(environ=None):
    env = os.environ if environ is None else environ
    raw = env.get("CREEM_API_KEY", "")
    if raw.strip():
        key = raw.strip()
        _reject_key(key)
        return key
    path = env.get("CREEM_API_KEY_FILE", DEFAULT_KEY_FILE)
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
    except FileNotFoundError:
        raise SystemExit("CREEM_API_KEY is not set and the key file is missing")
    except OSError:
        raise SystemExit("CREEM_API_KEY file could not be read")
    if mode & 0o077:
        LOG.warning("key file %s is readable by group or others; chmod 600", path)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        raise SystemExit("CREEM_API_KEY file could not be read")
    key = _key_from_text(text)
    _reject_key(key)
    return key


def _clean_str(value, limit):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > limit or _CONTROL.search(value):
        return None
    return value


def select_fields(payload, names):
    """Keep only the Creem fields for this route. Drop everything else."""
    if not isinstance(payload, dict):
        return None
    selected = {}
    for name in names:
        value = _clean_str(payload.get(name), FIELD_LIMITS[name])
        if not value:
            return None
        selected[name] = value
    return selected


def _one_instance(obj):
    if not isinstance(obj, dict):
        return None
    instance_id = _clean_str(obj.get("id"), 128)
    if not instance_id:
        return None
    return {
        "id": instance_id,
        "name": _clean_str(obj.get("name"), 128),
        "status": _clean_str(obj.get("status"), 32),
    }


def _pick_instance(raw, prefer_name, prefer_id):
    if isinstance(raw, dict):
        return _one_instance(raw)
    if not isinstance(raw, list):
        return None
    items = [item for item in (_one_instance(entry) for entry in raw) if item]
    if prefer_id:
        for item in items:
            if item["id"] == prefer_id:
                return item
    if prefer_name:
        named = [item for item in items if item.get("name") == prefer_name]
        active = [item for item in named if item.get("status") == "active"]
        if active:
            return active[-1]
        if named:
            return named[-1]
    active = [item for item in items if item.get("status") == "active"]
    if active:
        return active[-1]
    return items[-1] if items else None


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    return int(value)


def sanitize_license(payload, prefer_name=None, prefer_id=None):
    """Return the few license fields the extension needs. Drop the key and anything else."""
    if not isinstance(payload, dict):
        return None
    status = _clean_str(payload.get("status"), 32)
    if not status:
        return None
    expires = payload.get("expires_at")
    return {
        "product_id": _clean_str(payload.get("product_id"), 80),
        "status": status,
        "activation": _number(payload.get("activation")),
        "activation_limit": _number(payload.get("activation_limit")),
        "expires_at": _clean_str(expires, 40) if expires is not None else None,
        "instance": _pick_instance(payload.get("instance"), prefer_name, prefer_id),
    }


def _hint(payload):
    if not isinstance(payload, dict):
        return ""
    parts = []
    for key in ("message", "error", "code", "type", "status"):
        value = payload.get(key)
        if isinstance(value, str):
            parts.append(value.lower())
    return " ".join(parts)


def classify_upstream(action, status, payload, prefer_name=None, prefer_id=None):
    """Map a Creem response to a safe status and body. Upstream text is not copied."""
    if status == 200:
        clean = sanitize_license(payload, prefer_name=prefer_name, prefer_id=prefer_id)
        if clean is None:
            return 502, error_body("unavailable")
        return 200, clean
    hint = _hint(payload)
    if status in (301, 302, 303, 307, 308, 401) or status >= 500:
        return 502, error_body("unavailable")
    if status == 429:
        return 503, error_body("unavailable")
    if status == 403 or ("activation" in hint and "limit" in hint):
        return 403, error_body("activation_limit")
    if status == 410:
        if "revok" in hint or "disabled" in hint:
            return 410, error_body("revoked")
        if "expir" in hint:
            return 410, error_body("expired")
        return 410, error_body("expired_or_revoked")
    if status == 409:
        return 409, error_body("already_inactive")
    if status == 404:
        if action == "activate":
            return 404, error_body("invalid_key")
        return 404, error_body("not_active")
    if status == 400:
        return 400, error_body("bad_request")
    return 502, error_body("unavailable")


def _opener():
    global _OPENER
    if _OPENER is None:
        _OPENER = urllib.request.build_opener(_NoRedirect)
    return _OPENER


def forward(action, fields, api_key, upstream_base):
    url = upstream_base.rstrip("/") + "/v1/licenses/" + action
    data = json.dumps(fields, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "chatshelf-license-proxy",
            "x-api-key": api_key,
        },
    )
    try:
        response = _opener().open(request, timeout=UPSTREAM_TIMEOUT)
        try:
            raw = response.read(MAX_UPSTREAM + 1)
            status = getattr(response, "status", None) or response.getcode()
        finally:
            response.close()
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read(MAX_UPSTREAM + 1)
        except Exception:
            raw = b""
        status = exc.code
        exc.close()
    except Exception as exc:
        raise UpstreamError(type(exc).__name__) from None
    if len(raw) > MAX_UPSTREAM:
        raise UpstreamError("oversized")
    if not raw:
        return status, None
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = None
    return status, parsed


def route_of(raw_path):
    """Return a known route, 'other', or 'reject' when the URI is not a plain path."""
    parts = urllib.parse.urlsplit(raw_path)
    if parts.query or parts.fragment:
        return "reject"
    path = parts.path.rstrip("/") or "/"
    if path in ROUTES:
        return path
    return "other"


class LicenseProxyServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, port, api_key, upstream_base):
        self.api_key = api_key
        self.upstream_base = upstream_base
        super().__init__((BIND_HOST, port), LicenseHandler)
        bound_host = self.server_address[0]
        if bound_host != BIND_HOST:
            self.server_close()
            raise SystemExit("refusing to bind " + bound_host)


class LicenseHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def version_string(self):
        return "chatshelf-license-proxy"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        self._method_not_allowed()

    def do_PUT(self):
        self._method_not_allowed()

    def do_DELETE(self):
        self._method_not_allowed()

    def do_HEAD(self):
        self._method_not_allowed()

    def do_OPTIONS(self):
        origin_header = self.headers.get("Origin")
        route = route_of(self.path)
        if route not in ROUTES:
            self._finish(404, error_body("not_found"), None)
            LOG.info("OPTIONS other -> 404")
            return
        origin = allowed_origin(origin_header)
        if origin_header and not origin:
            self._finish(403, error_body("forbidden"), None)
            LOG.info("OPTIONS %s -> 403", route)
            return
        self._finish(204, None, origin, preflight=True)
        LOG.info("OPTIONS %s -> 204", route)

    def do_POST(self):
        origin = allowed_origin(self.headers.get("Origin"))
        route = route_of(self.path)
        # Read the body first so a keep-alive connection stays in sync on 404.
        status, payload = self._read_json()
        if route not in ROUTES:
            self._finish(404, error_body("not_found"), origin)
            LOG.info("POST other -> 404")
            return
        action, names = ROUTES[route]
        if status != 200:
            self._finish(status, error_body("bad_request"), origin)
            LOG.info("POST %s -> %s", route, status)
            return
        fields = select_fields(payload, names)
        if fields is None:
            self._finish(400, error_body("bad_request"), origin)
            LOG.info("POST %s -> 400", route)
            return
        try:
            upstream_status, upstream_body = forward(
                action, fields, self.server.api_key, self.server.upstream_base
            )
        except UpstreamError as exc:
            self._finish(504, error_body("unavailable"), origin)
            LOG.info("POST %s upstream %s -> 504", route, exc)
            return
        client_status, client_body = classify_upstream(
            action,
            upstream_status,
            upstream_body,
            prefer_name=fields.get("instance_name"),
            prefer_id=fields.get("instance_id"),
        )
        self._finish(client_status, client_body, origin)
        LOG.info("POST %s upstream %s -> %s", route, upstream_status, client_status)

    def _method_not_allowed(self):
        route = route_of(self.path)
        status = 405 if route in ROUTES else 404
        body = error_body("bad_request" if status == 405 else "not_found")
        self._finish(status, body, allowed_origin(self.headers.get("Origin")), allow=status == 405)
        logged = route if route in ROUTES else "other"
        LOG.info("%s %s -> %s", self.command, logged, status)

    def _read_json(self):
        media = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if media != "application/json":
            return 400, None
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return 400, None
        try:
            length = int(raw_len)
        except ValueError:
            return 400, None
        if length < 0:
            return 400, None
        if length > MAX_BODY:
            self.close_connection = True
            return 413, None
        try:
            raw = self.rfile.read(length)
        except Exception:
            return 400, None
        if len(raw) != length:
            return 400, None
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return 400, None
        return 200, payload

    def _finish(self, status, payload, origin, preflight=False, allow=False):
        body = b""
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        self.send_response(status)
        if payload is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if allow or preflight:
            self.send_header("Allow", "POST, OPTIONS")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)


def main(argv=None):
    del argv
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    check_bind_host(os.environ.get("LICENSE_PROXY_HOST", BIND_HOST))
    try:
        port = int(os.environ.get("LICENSE_PROXY_PORT", "8787"))
    except ValueError:
        raise SystemExit("LICENSE_PROXY_PORT is invalid")
    if not 1 <= port <= 65535:
        raise SystemExit("LICENSE_PROXY_PORT is invalid")
    api_key = load_api_key()
    upstream = validate_upstream(os.environ.get("CREEM_API_BASE", DEFAULT_UPSTREAM))
    LOG.info("listening on 127.0.0.1:%s", port)
    server = LicenseProxyServer(port, api_key, upstream)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
