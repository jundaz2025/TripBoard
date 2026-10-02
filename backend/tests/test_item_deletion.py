"""Deletion keeps schedules and saved places independent without bypassing version checks."""

from conftest import add
from test_tripboard import activity, prepared


def test_deleting_activity_with_saved_place_keeps_place_and_other_activities(client):
    trip = prepared(client)
    first = trip["activities"][0]
    response = client.delete(
        f"/api/trips/{trip['id']}/items/activities/{first['id']}",
        headers={"If-Match": str(trip["version"])},
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["places"] == trip["places"]
    assert saved["activities"] == trip["activities"][1:]
    assert saved["version"] == trip["version"] + 1


def test_deleting_saved_place_preserves_all_linked_activities_and_other_places(client):
    trip = prepared(client)
    removed_place = trip["places"][0]
    trip = add(
        client, trip, "activities",
        activity(title="Another visit", day="2026-10-02", place_id=removed_place["id"],
                 location="Museum address", notes="Keep my notes"),
    )
    path = f"/api/trips/{trip['id']}"
    response = client.delete(
        path + f"/items/places/{removed_place['id']}",
        headers={"If-Match": str(trip["version"])},
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    expected = [
        {**item, "place_id": None} if item["place_id"] == removed_place["id"] else item
        for item in trip["activities"]
    ]
    assert saved["activities"] == expected
    assert saved["places"] == trip["places"][1:]
    assert saved["version"] == trip["version"] + 1
    persisted = client.get(path).json()
    assert persisted["activities"] == expected
    assert persisted["places"] == saved["places"]
    sync = client.get(path + f"/sync?since={trip['version']}").json()
    assert sync["snapshot"]["activities"] == expected
    assert len(sync["events"]) == 1


def test_stale_place_deletion_does_not_detach_activities(client):
    trip = prepared(client)
    path = f"/api/trips/{trip['id']}"
    response = client.delete(
        path + f"/items/places/{trip['places'][0]['id']}",
        headers={"If-Match": str(trip["version"] - 1)},
    )
    assert response.status_code == 409
    saved = client.get(path).json()
    assert saved["places"] == trip["places"]
    assert saved["activities"] == trip["activities"]
    assert saved["version"] == trip["version"]
