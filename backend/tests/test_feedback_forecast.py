import asyncio
from fastapi.testclient import TestClient
from app.main import app
from app.physics.box_model import FeedbackMetHour, simulate_feedback_72h

met = [FeedbackMetHour(12.0 if i % 24 < 7 else 27.0, 4.0 if i % 24 < 7 else 12.0, 315.0, 0.0 if i % 24 < 7 else 500.0) for i in range(72)]
forecast, insights = simulate_feedback_72h(220.0, 2, met)
assert len(forecast) == 72
assert len({round(float(point['pm2_5']), 1) for point in forecast}) > 10
assert any(float(point['temp_penalty']) < 0 for point in forecast)
assert any(point['inversion'] in {'Strong', 'Moderate', 'Weak'} for point in forecast)
assert insights['stubble_plume_risk'] == 'High (NW Winds detected)'
client = TestClient(app)
response = client.get('/api/forecast')
assert response.status_code == 200, response.text
body = response.json()
assert len(body['forecast_72h']) == 72
assert set(body['atmospheric_insights']) == {'current_pbl', 'inversion_risk', 'aerosol_feedback_status', 'stubble_plume_risk'}
print('deterministic feedback simulation and API schema tests passed')
