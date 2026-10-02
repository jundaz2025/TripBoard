"""Activity map locations persist independently from bookmarks and retain the existing authorization/version rules."""
import copy
import pytest
from app.core import Session
from app.models import Board
from conftest import signup, create, add
from test_tripboard import activity, prepared


def test_activity_only_keeps_coordinates_without_creating_saved_place(client):
    signup(client)
    trip = create(client)
    coordinates = {"lat": 40.7829, "lon": -73.9654}
    trip = add(client, trip, "activities", activity(location="Central Park", map_location=coordinates))
    assert trip["places"] == []
    item = trip["activities"][0]
    assert item["place_id"] is None
    assert item["map_location"] == coordinates
    path = f"/api/trips/{trip['id']}"
    assert client.get(path).json()["activities"][0]["map_location"] == coordinates
    assert client.get(path + "/sync").json()["snapshot"]["activities"][0]["map_location"] == coordinates
    update = {k: v for k, v in item.items() if k != "id"}
    update["notes"] = "Updated notes"
    result = client.put(path + "/items/activities/" + item["id"], json=update, headers={"If-Match": str(trip["version"])})
    assert result.status_code == 200, result.text
    assert result.json()["activities"][0]["map_location"] == coordinates
    assert result.json()["places"] == []


@pytest.mark.parametrize("point", [{"lat": 91, "lon": 0}, {"lat": 0, "lon": -181}, {"lat": "NaN", "lon": 0}])
def test_invalid_activity_coordinates_are_rejected_without_writing(client, point):
    signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    result = client.post(path + "/items/activities", json=activity(map_location=point), headers={"If-Match": str(trip["version"])})
    assert result.status_code == 422
    assert client.get(path).json()["activities"] == []


def test_deleting_legacy_bookmark_retains_its_activity_pin(client):
    trip = prepared(client)
    place = trip["places"][0]
    # Simulate pre-upgrade data with no independent activity coordinates.
    with Session() as db:
        board = db.get(Board, trip["id"])
        state = copy.deepcopy(board.state)
        for row in state["activities"]:
            row.pop("map_location", None)
        board.state = state
        db.commit()
    path = f"/api/trips/{trip['id']}"
    result = client.delete(path + "/items/places/" + place["id"], headers={"If-Match": str(trip["version"])})
    assert result.status_code == 200
    linked_ids = {a["id"] for a in trip["activities"] if a["place_id"] == place["id"]}
    for item in result.json()["activities"]:
        if item["id"] in linked_ids:
            assert item["place_id"] is None
            assert item["map_location"] == {"lat": place["lat"], "lon": place["lon"]}
