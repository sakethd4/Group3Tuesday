"""The requested two-user workflow, using the existing single-item hardware model."""
from app import create_app


def test_two_user_workflow_persists_across_login_and_api_restart(app, client, registration):
    assert app.test_cli_runner().invoke(args=['init-db', '--seed']).exit_code == 0
    created = client.post('/api/register', json=registration)
    assert created.status_code == 201
    assert client.post('/api/login', json={'email': registration['email'], 'password': 'WrongPassword123'}).status_code == 401
    signed_in = client.post('/api/login', json={'email': registration['email'], 'password': registration['password']})
    assert signed_in.status_code == 200
    first = {'Authorization': f"Bearer {signed_in.json['token']}"}
    fields = {'projectId': 'TA-DEMO', 'name': 'TA project'}
    project = client.post('/api/projects', json=fields, headers=first)
    assert project.status_code == 201
    project_id = project.json['project']['id']
    assert client.post('/api/projects', json=fields, headers=first).status_code == 409
    assert client.post('/api/projects/join', json={'projectId': 'TA-DEMO'}, headers=first).status_code == 200
    resources = client.get('/api/hardware', headers=first).json['hardware']
    urls = [f"/api/hardware/{item['id']}" for item in resources[:2]]
    for url in urls:
        assert client.post(f'{url}/checkout', json={'projectId': project_id}, headers=first).status_code == 200
    available = lambda api, headers: sum(item['status'] == 'available' for item in api.get('/api/hardware', headers=headers).json['hardware'])
    assert available(client, first) == 4
    assert client.post(f'{urls[0]}/checkout', json={'projectId': project_id}, headers=first).status_code == 409
    assert client.post(f'{urls[0]}/return', headers=first).status_code == 200
    assert available(client, first) == 5
    assert client.get('/api/projects').status_code == 401

    restarted = create_app(dict(app.config))
    try:
        with restarted.test_client() as fresh:
            signed_in = fresh.post('/api/login', json={'email': registration['email'], 'password': registration['password']})
            first = {'Authorization': f"Bearer {signed_in.json['token']}"}
            assert fresh.get(urls[1], headers=first).json['hardware']['canReturn']
            assert fresh.get('/api/projects', headers=first).json['projects'][0]['id'] == project_id
            ta = {**registration, 'email': 'ta@example.com', 'firstName': 'TA'}
            assert fresh.post('/api/register', json=ta).status_code == 201
            signed_in = fresh.post('/api/login', json={'email': ta['email'], 'password': ta['password']})
            second = {'Authorization': f"Bearer {signed_in.json['token']}"}
            assert fresh.post('/api/projects', json=fields, headers=second).status_code == 409
            assert fresh.get('/api/projects', headers=second).json['projects'] == []
            assert fresh.post(f'{urls[1]}/return', headers=second).status_code == 403
            assert fresh.post('/api/projects/join', json={'projectId': 'WRONG'}, headers=second).status_code == 404
            assert fresh.post('/api/projects/join', json={'projectId': 'TA-DEMO'}, headers=second).status_code == 200
            assert fresh.post(f'{urls[1]}/return', headers=second).status_code == 200
            assert available(fresh, second) == 6
            assert fresh.post(f'{urls[0]}/checkout', json={'projectId': project_id}, headers=second).status_code == 200
            assert available(fresh, second) == 5
    finally:
        restarted.extensions['mongo_client'].close()
