# Build the API image; Compose reuses it for the separate reminder worker.
FROM python:3.13-slim
WORKDIR /app
# Install dependencies before source code so code-only edits can reuse the dependency layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
COPY main.py .
# Run application code without root privileges and give it a writable attachment directory.
RUN useradd --create-home app && mkdir -p /app/uploads && chown -R app:app /app
USER app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
