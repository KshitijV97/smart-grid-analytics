FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 gridml && mkdir -p /data/models && chown gridml /data/models
USER gridml
ENV PATH="/opt/venv/bin:$PATH" \
    PORT=8000 \
    ARTIFACT_STORE=file:///data/models
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn gridml.api:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
