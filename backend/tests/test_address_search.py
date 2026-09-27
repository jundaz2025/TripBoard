# Exercise provider address normalization, including missing name metadata and house-number-only results.
import httpx
from conftest import signup
from test_scoped_search import make_trip, mock_search, row


def test_street_address_with_null_name_details_is_searchable(client, monkeypatch):
    signup(client)
    trip = make_trip(client)
    address = "55, Clark Street, Brooklyn, New York, United States"

    def respond(request):
        if request.url.params.get("featureType") == "city":
            return httpx.Response(
                200,
                json=[
                    row(
                        "New York",
                        40.71,
                        -74.0,
                        boundingbox=[40.47, 40.92, -74.26, -73.70],
                    )
                ],
            )
        return httpx.Response(
            200,
            json=[
                row(
                    address,
                    40.697,
                    -73.993,
                    namedetails=None,
                    address={
                        "country_code": "us",
                        "house_number": "55",
                        "road": "Clark Street",
                    },
                ),
                row(
                    "343, Gold Street, Brooklyn, New York, United States",
                    40.694,
                    -73.983,
                    namedetails={"name": "343"},
                    address={
                        "country_code": "us",
                        "house_number": "343",
                        "road": "Gold Street",
                    },
                ),
                row(
                    "Museum, 55, Clark Street, New York",
                    40.697,
                    -73.993,
                    namedetails={"name:en": "Local Museum"},
                    address={
                        "country_code": "us",
                        "house_number": "55",
                        "road": "Clark Street",
                    },
                ),
                row(
                    "55, Clark Street, Brooklyn, New York",
                    40.697,
                    -73.993,
                    namedetails=None,
                ),
                row("Clark Street, London", 51.5, -0.12, "gb", namedetails=None),
            ],
        )

    cache = mock_search(monkeypatch, respond)
    path = f"/api/trips/{trip['id']}/places/search"
    assert client.get(path, params={"q": "55 clark st"}).status_code == 429
    cache.values.pop("geocode:rate", None)
    response = client.get(path, params={"q": "55 clark st"})
    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "name": "55 Clark Street",
            "address": address,
            "lat": 40.697,
            "lon": -73.993,
        },
        {
            "name": "343 Gold Street",
            "address": "343, Gold Street, Brooklyn, New York, United States",
            "lat": 40.694,
            "lon": -73.983,
        },
        {
            "name": "Local Museum",
            "address": "Museum, 55, Clark Street, New York",
            "lat": 40.697,
            "lon": -73.993,
        },
        {
            "name": "55, Clark Street, Brooklyn, New York",
            "address": "55, Clark Street, Brooklyn, New York",
            "lat": 40.697,
            "lon": -73.993,
        },
    ]
