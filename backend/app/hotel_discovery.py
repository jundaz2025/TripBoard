"""Find published hotel websites; fetch current times from the website, never defaults."""

import json
import os
import re
from pathlib import Path
import httpx
from fastapi import HTTPException
from .providers import distance
from .hotel_policy import lookup

# Verified public website references fill gaps in community place metadata.
# This stores identity/source URLs only. Times are always read from the source.
SOURCES = json.loads(Path(__file__).with_name("hotel_sources.json").read_text())


def tokens(name):
    """Extract distinctive hotel-name tokens for identity matching, excluding generic lodging words."""
    return {
        t
        for t in re.findall(r"[a-z0-9]+", name.lower())
        if len(t) >= 3
        and t
        not in {
            "the",
            "hotel",
            "hotels",
            "resort",
            "and",
            "inn",
            "suites",
            "residences",
        }
    }


def match_website(candidates, name, lat, lon):
    """Require a name match and nearby coordinates; reject competing near-equal website matches."""
    matches = []
    wanted = tokens(name.split(",")[0])
    for candidate in candidates:
        if not wanted or not any(
            wanted <= tokens(label) for label in candidate["names"]
        ):
            continue
        separation = distance({"lat": lat, "lon": lon}, candidate)
        if separation <= 0.3 and candidate["website"].startswith(
            ("https://", "http://")
        ):
            matches.append((separation, candidate["website"]))
    matches.sort()
    if not matches:
        return None
    if (
        len(matches) > 1
        and matches[1][0] - matches[0][0] < 0.05
        and matches[1][1] != matches[0][1]
    ):
        return None
    return matches[0][1]


async def discover(name, lat, lon):
    """Look for a matching published website using verified references, then nearby community map metadata."""
    verified = match_website(SOURCES, name, lat, lon)
    if verified:
        return verified
    # A small local query can find the hotel's POI website even when the
    # address-search result represents a building without website metadata.
    query = f'[out:json][timeout:10][maxsize:16777216];nwr["tourism"~"^(hotel|motel|hostel|guest_house)$"](around:300,{lat},{lon});out center;'
    try:
        async with httpx.AsyncClient(
            timeout=16, headers={"User-Agent": "TripBoard-local-project/1.0"}
        ) as client:
            response = await client.get(
                os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
                params={"data": query},
            )
            response.raise_for_status()
            candidates = []
            for row in response.json().get("elements", []):
                tags = row.get("tags", {})
                point = row.get("center", row)
                website = tags.get("website") or tags.get("contact:website")
                if website and "lat" in point and "lon" in point:
                    candidates.append(
                        {
                            "names": [
                                tags.get("name:en", ""),
                                tags.get("name", ""),
                                tags.get("alt_name", ""),
                            ],
                            "lat": point["lat"],
                            "lon": point["lon"],
                            "website": website,
                        }
                    )
            return match_website(candidates, name, lat, lon)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(
            502,
            "Automatic hotel lookup is temporarily unavailable. Try again or enter the times from your booking confirmation.",
        )


async def resolve(name, lat, lon, website=""):
    """Try the selected website before discovery; never substitute guessed check-in/out defaults."""
    if website:
        try:
            result = await lookup(website, name)
            return {**result, "hotel_website": website}
        except HTTPException:
            pass
    discovered = await discover(name, lat, lon)
    if discovered and discovered != website:
        result = await lookup(discovered, name)
        return {**result, "hotel_website": discovered}
    raise HTTPException(
        422,
        "We couldn't find published times for this hotel automatically. Enter the times from your booking confirmation.",
    )
