#!/usr/bin/env python3
"""Local tests for the license proxy. No live Creem calls."""

import importlib.util
import json
import logging
import os
import stat
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_SPEC = importlib.util.spec_from_file_location(
    "license_proxy",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "license-proxy.py"),
)
proxy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(proxy)

PRODUCT = "prod_3FqFPPZL4T22ud6OFOyhgg"
API_KEY = "proxy-test-key"
LICENSE_KEY = "SHOULD-NOT-LEAK"
ORIGIN = "chrome-extension://" + ("a" * 32)


class ListHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


class UpstreamHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            body = None
        self.server.hits.append(
            {
                "path": self.path,
                "body": body,
                "api_key": self.headers.get("x-api-key"),
                "content_type": self.headers.get("Content-Type"),
            }
        )
        spec = self.server.routes.get(self.path)
        if spec is None:
            status, payload, extra = 404, {"message": "missing"}, {}
        else:
            status, payload = spec[:2]
            extra = spec[2] if len(spec) > 2 else {}
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("x-api-key", API_KEY)
        for name, value in extra.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)


def license_body(**overrides):
    body = {
        "id": "lic_123",
        "mode": "prod",
        "object": "license",
        "product_id": PRODUCT,
        "status": "active",
        "key": LICENSE_KEY,
        "activation": 1,
        "activation_limit": 3,
        "expires_at": None,
        "created_at": "2023-09-13T00:00:00Z",
        "customer_email": "person@example.com",
        "instance": {
            "id": "inst_abc",
            "mode": "prod",
            "object": "license-instance",
            "name": "cs-abcdef1234567890",
            "status": "active",
            "created_at": "2023-09-13T00:00:00Z",
            "secret": "instance-secret",
        },
    }
    body.update(overrides)
    return body


class ProxyTest(unittest.TestCase):
    def setUp(self):
        self.logs = ListHandler()
        self.logs.setLevel(logging.INFO)
        proxy.LOG.setLevel(logging.INFO)
        proxy.LOG.addHandler(self.logs)
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
        self.upstream.hits = []
        self.upstream.routes = {
            "/v1/licenses/activate": (200, license_body()),
            "/v1/licenses/validate": (200, license_body()),
            "/v1/licenses/deactivate": (200, license_body(status="active")),
        }
        self.upstream_thread = threading.Thread(target=self.upstream.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.upstream_thread.start()
        upstream_port = self.upstream.server_address[1]
        self.proxy_server = proxy.LicenseProxyServer(
            0,
            API_KEY,
            "http://127.0.0.1:%d" % upstream_port,
        )
        self.assertEqual(self.proxy_server.server_address[0], "127.0.0.1")
        self.proxy_thread = threading.Thread(target=self.proxy_server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.proxy_thread.start()
        self.port = self.proxy_server.server_address[1]

    def tearDown(self):
        self.proxy_server.shutdown()
        self.proxy_server.server_close()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.proxy_thread.join(timeout=3)
        self.upstream_thread.join(timeout=3)
        proxy.LOG.removeHandler(self.logs)

    def request(self, method, path, body=None, origin=None, content_type="application/json", raw=None):
        import http.client

        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}
        data = None
        if raw is not None:
            data = raw
            headers["Content-Type"] = content_type
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = content_type
        if origin is not None:
            headers["Origin"] = origin
        conn.request(method, path, body=data, headers=headers)
        resp = conn.getresponse()
        payload = resp.read()
        headers_out = {key.lower(): value for key, value in resp.getheaders()}
        conn.close()
        return resp.status, headers_out, payload

    def assert_clean(self, payload, headers):
        text = payload.decode("utf-8", errors="replace")
        blob = text + json.dumps(headers)
        self.assertNotIn(API_KEY, blob)
        self.assertNotIn(LICENSE_KEY, blob)
        self.assertNotIn("person@example.com", blob)
        self.assertNotIn("instance-secret", blob)
        self.assertNotIn("x-api-key", headers)
        joined = "\n".join(self.logs.messages)
        self.assertNotIn(API_KEY, joined)
        self.assertNotIn(LICENSE_KEY, joined)
        self.assertNotIn("person@example.com", joined)

    def test_activate_strips_fields_and_hides_key(self):
        status, headers, payload = self.request(
            "POST",
            "/api/licenses/activate",
            {
                "key": "cust-key",
                "instance_name": "cs-abcdef1234567890",
                "product_id": "nope",
                "admin": True,
            },
            origin=ORIGIN,
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("access-control-allow-origin"), ORIGIN)
        self.assertNotIn("access-control-allow-credentials", headers)
        self.assertEqual(headers.get("server"), "chatshelf-license-proxy")
        body = json.loads(payload)
        self.assertEqual(
            set(body),
            {"product_id", "status", "activation", "activation_limit", "expires_at", "instance"},
        )
        self.assertEqual(body["product_id"], PRODUCT)
        self.assertEqual(body["instance"]["id"], "inst_abc")
        self.assertNotIn("secret", body["instance"])
        self.assertEqual(len(self.upstream.hits), 1)
        hit = self.upstream.hits[0]
        self.assertEqual(hit["path"], "/v1/licenses/activate")
        self.assertEqual(hit["api_key"], API_KEY)
        self.assertEqual(hit["body"], {"key": "cust-key", "instance_name": "cs-abcdef1234567890"})
        self.assert_clean(payload, headers)

    def test_validate_and_deactivate_paths(self):
        for path, upstream in (
            ("/api/licenses/validate", "/v1/licenses/validate"),
            ("/api/licenses/deactivate", "/v1/licenses/deactivate"),
        ):
            self.upstream.hits.clear()
            status, headers, payload = self.request(
                "POST",
                path,
                {"key": "cust-key", "instance_id": "inst_abc", "extra": "drop-me"},
            )
            self.assertEqual(status, 200, payload)
            self.assertNotIn("access-control-allow-origin", headers)
            self.assertEqual(self.upstream.hits[0]["path"], upstream)
            self.assertEqual(
                self.upstream.hits[0]["body"],
                {"key": "cust-key", "instance_id": "inst_abc"},
            )
            self.assert_clean(payload, headers)

    def test_unknown_route_and_method(self):
        status, headers, payload = self.request("POST", "/api/licenses/verify", {"key": "cust-key"})
        self.assertEqual(status, 404)
        self.assertIn(b"not_found", payload)
        self.assert_clean(payload, headers)

        status, headers, payload = self.request("GET", "/api/licenses/activate")
        self.assertEqual(status, 405)
        self.assertIn("POST", headers.get("allow", ""))
        self.assert_clean(payload, headers)

        status, _, payload = self.request("POST", "/api/licenses/activate?key=%s" % LICENSE_KEY, {"key": "cust-key", "instance_name": "cs-abc"})
        self.assertEqual(status, 404)
        self.assertNotIn(LICENSE_KEY.encode(), payload)
        self.assertNotIn(LICENSE_KEY, "\n".join(self.logs.messages))
        self.assertTrue(any("other" in line for line in self.logs.messages))

    def test_cors_preflight(self):
        status, headers, payload = self.request("OPTIONS", "/api/licenses/activate", origin=ORIGIN)
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("access-control-allow-origin"), ORIGIN)
        self.assertNotIn("access-control-allow-credentials", headers)
        self.assertEqual(payload, b"")

        status, headers, payload = self.request(
            "OPTIONS", "/api/licenses/activate", origin="https://evil.example"
        )
        self.assertEqual(status, 403)
        self.assertNotIn("access-control-allow-origin", headers)
        self.assertNotIn(b"*", payload)

    def test_upstream_errors_are_sanitized(self):
        self.upstream.routes["/v1/licenses/activate"] = (
            403,
            {"message": "activation limit reached token=SECRET", "trace": "db password"},
        )
        status, headers, payload = self.request(
            "POST",
            "/api/licenses/activate",
            {"key": "cust-key", "instance_name": "cs-abcdef1234567890"},
        )
        self.assertEqual(status, 403)
        body = json.loads(payload)
        self.assertEqual(body["error"], "activation_limit")
        self.assertNotIn(b"SECRET", payload)
        self.assertNotIn(b"password", payload)
        self.assert_clean(payload, headers)

        self.upstream.routes["/v1/licenses/activate"] = (
            401,
            {"message": "bad key " + API_KEY},
        )
        status, headers, payload = self.request(
            "POST",
            "/api/licenses/activate",
            {"key": "cust-key", "instance_name": "cs-abcdef1234567890"},
        )
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(payload)["error"], "unavailable")
        self.assert_clean(payload, headers)

        self.upstream.routes["/v1/licenses/validate"] = (
            404,
            {"message": "no such license " + LICENSE_KEY},
        )
        status, _, payload = self.request(
            "POST",
            "/api/licenses/validate",
            {"key": "cust-key", "instance_id": "inst_missing"},
        )
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(payload)["error"], "not_active")
        self.assertNotIn(LICENSE_KEY.encode(), payload)

    def test_redirect_is_not_followed(self):
        self.upstream.routes["/v1/licenses/activate"] = (
            302,
            {"key": LICENSE_KEY},
            {"Location": "http://127.0.0.1:9/steal"},
        )
        status, headers, payload = self.request(
            "POST",
            "/api/licenses/activate",
            {"key": "cust-key", "instance_name": "cs-abcdef1234567890"},
        )
        self.assertEqual(status, 502)
        self.assertEqual(len(self.upstream.hits), 1)
        self.assert_clean(payload, headers)

    def test_bad_json(self):
        status, _, payload = self.request(
            "POST",
            "/api/licenses/activate",
            raw=b"{",
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(payload)["error"], "bad_request")

        status, _, payload = self.request(
            "POST",
            "/api/licenses/activate",
            raw=b'{"key":"abc","instance_name":"cs-abcdef1234567890"}',
            content_type="text/plain",
        )
        self.assertEqual(status, 400)


class PureTest(unittest.TestCase):
    def test_bind_host_and_upstream(self):
        with self.assertRaises(SystemExit):
            proxy.check_bind_host("0.0.0.0")
        with self.assertRaises(SystemExit):
            proxy.validate_upstream("http://example.com")
        with self.assertRaises(SystemExit):
            proxy.validate_upstream("https://user:pass@api.creem.io")
        self.assertEqual(proxy.validate_upstream("https://api.creem.io/"), "https://api.creem.io")

    def test_placeholder_and_key_file_mode(self):
        with self.assertRaises(SystemExit):
            proxy.load_api_key({"CREEM_API_KEY": "replace-with-creem-api-key"})
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "creem_api_key")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("unit-test-key\n")
            os.chmod(path, 0o644)
            logs = ListHandler()
            proxy.LOG.addHandler(logs)
            try:
                key = proxy.load_api_key({"CREEM_API_KEY_FILE": path})
            finally:
                proxy.LOG.removeHandler(logs)
            self.assertEqual(key, "unit-test-key")
            self.assertTrue(any("chmod 600" in line for line in logs.messages))
            self.assertNotIn("unit-test-key", "\n".join(logs.messages))
            os.chmod(path, 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode) & 0o077, 0)

    def test_instance_list_picks_matching_name(self):
        clean = proxy.sanitize_license(
            {
                "status": "active",
                "product_id": PRODUCT,
                "key": LICENSE_KEY,
                "instance": [
                    {"id": "old", "name": "other", "status": "active"},
                    {"id": "new", "name": "cs-abcdef1234567890", "status": "active", "extra": "nope"},
                ],
            },
            prefer_name="cs-abcdef1234567890",
        )
        self.assertEqual(clean["instance"]["id"], "new")
        self.assertNotIn("key", clean)


if __name__ == "__main__":
    unittest.main()
