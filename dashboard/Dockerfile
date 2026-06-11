FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY server ./server
COPY static ./static
RUN pip install --no-cache-dir .

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn server.app:create_app --factory --host 0.0.0.0 --port ${PORT}"]
