# The API, for docker-compose.prod.yml. The frontend isn't in here: scripts/deploy.sh builds it
# and Caddy serves the files. Python and Postgres match what CI tests against.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    POETRY_VIRTUALENVS_CREATE=false

WORKDIR /srv
RUN pip install poetry==2.3.2
COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root --no-interaction
COPY app ./app

RUN useradd --system app
USER app

# --proxy-headers: the visitor's address comes from Caddy's X-Forwarded-For (the login limit
# counts per address). Trusting every peer is safe only because nothing but Caddy can reach this
# port: never publish it.
CMD ["uvicorn", "app.main:main_app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
