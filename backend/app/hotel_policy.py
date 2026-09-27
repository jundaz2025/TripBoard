"""Read explicit hotel times from public website pages; never infer missing times."""

import asyncio
import http.client
import ipaddress
import json
import re
import socket
import ssl
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from fastapi import HTTPException


class PolicyPage(HTMLParser):
    """Collect visible text, links and JSON-LD without executing any website scripts."""
    def __init__(self):
        super().__init__()
        self.parts, self.links, self.structured = [], [], []
        self.script = None
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style"):
            self.skip += 1
            if tag == "script" and attrs.get("type") == "application/ld+json":
                self.script = []
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        if tag in ("p", "div", "li", "h1", "h2", "h3", "h4", "h5", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "script" and self.script is not None:
            try:
                self.structured.append(json.loads("".join(self.script)))
            except ValueError:
                pass
            self.script = None
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        if tag in ("p", "div", "li", "h1", "h2", "h3", "h4", "h5"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        elif not self.skip:
            self.parts.append(data)


def normalize_time(value):
    """Normalize explicit 12/24-hour source times; leave unsupported or ambiguous syntax unresolved."""
    if not isinstance(value, str):
        return None
    value = value.strip().lower().replace(".", "")
    if value == "noon":
        return "12:00"
    if value == "midnight":
        return "00:00"
    if "t" in value and re.match(r"^\d{4}-\d{2}-\d{2}t", value):
        value = value.split("t", 1)[1]
    m = re.fullmatch(
        r"(\d{1,2})(?::(\d{2})(?::00)?)?\s*(am|pm)?(?:z|[+-]\d{2}:\d{2})?", value
    )
    if not m:
        return None
    hour, minute = int(m[1]), int(m[2] or 0)
    if minute > 59 or (m[3] and not 1 <= hour <= 12) or (not m[3] and hour > 23):
        return None
    if m[3]:
        hour = hour % 12 + (12 if m[3] == "pm" else 0)
    return f"{hour:02}:{minute:02}"


def extract_times(page):
    """Combine structured and textual evidence, accepting each time only when the candidates agree."""
    candidates = {"check_in_time": set(), "check_out_time": set()}

    def walk(node):
        if isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            types = node.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if any(
                t
                in (
                    "Hotel",
                    "LodgingBusiness",
                    "Resort",
                    "Motel",
                    "Hostel",
                    "BedAndBreakfast",
                )
                for t in types
            ):
                for field, key in (
                    ("check_in_time", "checkinTime"),
                    ("check_out_time", "checkoutTime"),
                ):
                    value = normalize_time(node.get(key))
                    if value:
                        candidates[field].add(value)
            for child in node.values():
                if isinstance(child, (list, dict)):
                    walk(child)

    for node in page.structured:
        walk(node)
    text = "".join(page.parts)
    token = r"(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2}|noon|midnight)"
    for segment in re.split(r"\n+|(?<=[.!?])\s+", text):
        # Early/late arrival options are not the standard policy and must not fill the form.
        if re.search(r"\b(?:early|late)\b", segment, re.I):
            continue
        for field, direction in (
            ("check_in_time", r"in(?:to)?"),
            ("check_out_time", "out"),
        ):
            pattern = rf"check[\s-]*{direction}\b(?:(?!check[\s-]*(?:in|out)|\?).){{0,100}}?\b({token})(?!\d)"
            for match in re.finditer(pattern, segment, re.I):
                value = normalize_time(match[1])
                if value:
                    candidates[field].add(value)
    # Contradictory source times remain unset rather than choosing an arbitrary first match.
    return {
        key: next(iter(values)) if len(values) == 1 else None
        for key, values in candidates.items()
    }


def public_target(url):
    """Validate public HTTP(S) destinations and pin a validated IP to prevent DNS rebinding."""
    parsed = urlsplit(url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 80 if parsed.scheme == "http" else 443)
    ):
        raise ValueError("Use a public HTTP or HTTPS hotel website.")
    # Resolve once, then connect to the validated IP. TLS still verifies the original hostname.
    addresses = socket.getaddrinfo(
        parsed.hostname,
        parsed.port or (443 if parsed.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    )
    ips = list(dict.fromkeys(row[4][0] for row in addresses))
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError("Use a public hotel website, not a local or private address.")
    return parsed, ips[0]


def fetch_page(url):
    """Revalidate every redirect and bound time, size and redirect count when fetching untrusted URLs."""
    for _ in range(4):
        parsed, ip = public_target(url)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        connection = http.client.HTTPConnection(parsed.hostname, port, timeout=6)
        sock = socket.create_connection((ip, port), timeout=6)
        try:
            if parsed.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(
                    sock, server_hostname=parsed.hostname
                )
            connection.sock = sock
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            connection.request(
                "GET",
                path,
                headers={
                    "User-Agent": "TripBoard-local-project/1.0",
                    "Accept": "text/html",
                    "Accept-Language": "en",
                    "Accept-Encoding": "identity",
                },
            )
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                url = urljoin(url, response.getheader("Location", ""))
                continue
            if response.status != 200 or "text/html" not in response.getheader(
                "Content-Type", ""
            ):
                raise ValueError(
                    "The hotel website could not be read. Try its FAQ or hotel policies page."
                )
            body = response.read(1_000_001)
            if len(body) > 1_000_000:
                raise ValueError("The hotel page is too large. Try its FAQ page.")
            charset = response.headers.get_content_charset() or "utf-8"
            return url, body.decode(charset, errors="replace")
        finally:
            connection.close()
            sock.close()
    raise ValueError("The hotel website redirected too many times.")


def lookup_pages(url, name):
    """Inspect at most three relevant same-site pages and return times with source URL and retrieval timestamp."""
    queue, visited = [url], set()
    for _ in range(3):
        if not queue:
            break
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        try:
            final_url, html = fetch_page(current)
        except (ValueError, OSError, http.client.HTTPException) as exc:
            if len(visited) == 1:
                raise HTTPException(
                    422,
                    str(exc)
                    if isinstance(exc, ValueError)
                    else "The hotel website is unavailable. Try its FAQ page or enter the times from your reservation.",
                )
            continue
        page = PolicyPage()
        page.feed(html)
        text = " ".join(page.parts).lower()
        tokens = [
            t
            for t in re.findall(r"[a-z0-9]+", name.lower())
            if len(t) >= 3
            and t not in {"the", "hotel", "resort", "and", "inn", "suites"}
        ]
        if not tokens or not any(
            re.search(r"\b" + re.escape(t) + r"\b", text) for t in tokens
        ):
            continue
        times = extract_times(page)
        if any(times.values()):
            return {
                **times,
                "source_url": final_url,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }
        origin = urlsplit(final_url)
        for href in page.links:
            link = urljoin(final_url, href).split("#")[0]
            parsed = urlsplit(link)
            if (
                parsed.scheme in ("http", "https")
                and parsed.netloc == origin.netloc
                and re.search(
                    r"faq|polic|hotel-info|good-to-know|check-in", parsed.path, re.I
                )
                and link not in visited
                and link not in queue
            ):
                queue.append(link)
    raise HTTPException(
        422,
        "No unambiguous check-in or check-out time was found for this hotel. Try its official FAQ page, or enter the times from your reservation.",
    )


async def lookup(url, name):
    """Run blocking website reads off the event loop with an overall response deadline."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(lookup_pages, url, name), timeout=22
        )
    except TimeoutError:
        raise HTTPException(
            504,
            "The hotel website took too long to respond. Enter the times from your reservation or try again later.",
        )
