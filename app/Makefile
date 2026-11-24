.PHONY: migrate upgrade downgrade revision run

migrate:
	alembic upgrade head

revision:
	alembic revision --autogenerate -m "$(m)"

upgrade:
	alembic upgrade +1

downgrade:
	alembic downgrade -1

run:
	cd .. && uvicorn app.main:main_app --reload --host 0.0.0.0 --port 8000