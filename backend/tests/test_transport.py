# Cover journey CRUD, cross-zone elapsed time, DST validation, dated overlaps, and shared-trip permissions.
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.api import app
from app import planning, transport
from app.core import Session
from app.models import Board
from conftest import signup, create, add


def leg(**changes):
    return { 'title': 'Flight to New York', 'direction': 'outbound', 'mode': 'flight',
        'origin': 'Chicago, Illinois, United States', 'destination': 'New York, United States',
        'departure_date': '2026-10-01', 'departure_time': '09:00', 'departure_timezone': 'America/Chicago',
        'arrival_date': '2026-10-01', 'arrival_time': '12:00', 'arrival_timezone': 'America/New_York', **changes }


def activity(**changes):
    return {'title': 'Museum', 'location': '', 'notes': '', 'day': '2026-10-01', 'start': '10:30', 'duration': 60, 'locked': False, 'place_id': None, 'reminder_minutes': None, **changes}


def test_transport_crud_real_duration_and_reconnect(client):
    signup(client)
    trip = create(client)
    assert trip['transports'] == []
    updated = add(client, trip, 'transports', leg(number='UA123', reference='TEST123'))
    record = updated['transports'][0]
    assert record['duration_minutes'] == 120
    assert record['departure_at'] == '2026-10-01T14:00:00+00:00'
    assert record['arrival_at'] == '2026-10-01T16:00:00+00:00'
    path = '/api/trips/' + trip['id']
    replay = client.get(path + '/sync?since=1').json()
    assert replay['events'][-1]['kind'] == 'transports.created'
    assert replay['snapshot']['transports'][0]['number'] == 'UA123'
    update_path = path + '/items/transports/' + record['id']
    assert client.put(update_path, json=leg(mode='driving'), headers={'If-Match': '1'}).status_code == 409
    response = client.put(update_path, json=leg(mode='driving'), headers={'If-Match': str(updated['version'])})
    assert response.status_code == 200
    updated = response.json()
    assert updated['transports'][0]['mode'] == 'driving'
    assert client.delete(update_path, headers={'If-Match': str(updated['version'])}).status_code == 200
    assert client.get(path).json()['transports'] == []


@pytest.mark.parametrize('changes', [
    {'arrival_time': '08:00'}, {'departure_time': '25:00'}, {'departure_timezone': 'Wrong/Zone'},
    {'departure_date': '2026-03-08', 'departure_time': '02:30', 'departure_timezone': 'America/New_York', 'arrival_date': '2026-03-08'},
    {'departure_date': '2026-11-01', 'departure_time': '01:30', 'departure_timezone': 'America/New_York', 'arrival_date': '2026-11-01'},
    {'link': 'javascript:alert(1)'}, {'mode': 'unrecognized'},
])
def test_invalid_transport_is_not_saved(client, changes):
    signup(client); trip = create(client)
    path = '/api/trips/' + trip['id']
    response = client.post(path + '/items/transports', json=leg(**changes), headers={'If-Match': str(trip['version'])})
    assert response.status_code == 422
    assert client.get(path).json()['version'] == trip['version']
    assert client.get(path).json()['transports'] == []


def test_cross_date_line_and_overnight():
    west = leg(departure_date='2026-10-02', departure_time='10:00', departure_timezone='Asia/Tokyo', arrival_date='2026-10-01', arrival_time='22:00', arrival_timezone='Pacific/Honolulu')
    transport.validate(west)
    assert transport.present(west)['duration_minutes'] == 420
    overnight = leg(departure_time='22:00', departure_timezone='America/Los_Angeles', arrival_date='2026-10-02', arrival_time='06:00')
    assert transport.present(overnight)['duration_minutes'] == 300


def test_conflicts_include_day_event_times_and_overlap_window(client):
    signup(client); trip = create(client)
    trip = add(client, trip, 'activities', activity(title='First', start='09:00', duration=120))
    trip = add(client, trip, 'activities', activity(title='Second', start='09:30', duration=30))
    trip = add(client, trip, 'activities', activity(title='Third', start='10:00', duration=90))
    conflicts = trip['conflicts']
    assert len(conflicts) == 2 # The contained interval must not hide the later overlap.
    assert all(c['days'] == ['2026-10-01'] for c in conflicts)
    assert all(c['timezone'] == 'America/New_York' for c in conflicts)
    first = conflicts[0]
    assert first['overlap_start'] == '2026-10-01T13:30:00+00:00'
    assert first['overlap_end'] == '2026-10-01T14:00:00+00:00'
    assert '2026-10-01 09:30' in first['message']
    assert len(first['items']) == 2


def test_transport_activity_overlap_and_touching_boundary(client):
    signup(client); trip = create(client)
    trip = add(client, trip, 'transports', leg())
    trip = add(client, trip, 'activities', activity())
    conflict = trip['conflicts'][0]
    assert {item['kind'] for item in conflict['items']} == {'transport', 'activity'}
    assert conflict['days'] == ['2026-10-01']
    assert conflict['overlap_start'] == '2026-10-01T14:30:00+00:00'
    assert conflict['overlap_end'] == '2026-10-01T15:30:00+00:00'
    path = f"/api/trips/{trip['id']}/items/activities/{trip['activities'][0]['id']}"
    result = client.put(path, json=activity(start='12:00'), headers={'If-Match': str(trip['version'])})
    assert result.json()['conflicts'] == []


def test_overnight_conflict_is_on_the_correct_trip_day():
    travel = {'id': 'travel', **leg(departure_time='22:00', departure_timezone='America/Los_Angeles', arrival_date='2026-10-02', arrival_time='06:00')}
    state = {'start_date': '2026-10-01', 'end_date': '2026-10-03', 'timezone': 'America/New_York', 'activities': [{'id': 'a', **activity(day='2026-10-02', start='05:30')}], 'hotels': [], 'places': [], 'transports': [travel]}
    conflict = planning.conflicts(state)[0]
    assert conflict['days'] == ['2026-10-02']
    assert conflict['overlap_end'] == '2026-10-02T10:00:00+00:00'


def test_viewer_cannot_edit_transport(client):
    signup(client); trip = create(client)
    path = '/api/trips/' + trip['id']
    token = client.post(path + '/invites', json={'role':'viewer'}).json()['token']
    with TestClient(app) as viewer:
        signup(viewer, 'viewer@example.com')
        viewer.post('/api/invites/join', json={'token':token})
        latest = viewer.get(path).json()
        assert viewer.post(path + '/items/transports', json=leg(), headers={'If-Match': str(latest['version'])}).status_code == 403
    with TestClient(app) as stranger:
        signup(stranger, 'stranger@example.com')
        assert stranger.post(path + '/items/transports', json=leg(), headers={'If-Match':str(trip['version'])}).status_code == 404


def test_legacy_trip_without_transport_key(client):
    signup(client); trip = create(client)
    with Session() as db:
        board = db.get(Board, trip['id'])
        state = dict(board.state); state.pop('transports'); board.state = state; db.commit()
    assert client.get('/api/trips/' + trip['id']).json()['transports'] == []
    assert len(add(client, trip, 'transports', leg())['transports']) == 1


def test_proposal_cannot_schedule_activity_during_travel():
    state = {'start_date': '2026-10-01', 'end_date': '2026-10-03', 'timezone': 'America/New_York', 'activities': [], 'hotels': [], 'places': [{'id':'p','title':'Museum','location':'Museum','duration':60,'opens':'09:00','closes':'20:00'}], 'transports': [{'id':'travel',**leg()}]}
    operation = {'kind':'add','place_id':'p','day':'2026-10-01','start':'10:30','duration':60}
    with pytest.raises(HTTPException) as error:
        planning.apply_operations(state, [operation])
    assert 'overlaps' in error.value.detail
    assert len(planning.apply_operations(state, [{**operation,'start':'12:00'}])) == 1
