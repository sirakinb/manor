FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DLT_PIPELINES_DIR=/tmp/dlt
ENV RUNTIME__DLTHUB_TELEMETRY=false RUNTIME__LOG_LEVEL=CRITICAL

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ingestion ./ingestion

USER 1000:1000

EXPOSE 8080
CMD ["uvicorn", "ingestion.app:app", "--host", "0.0.0.0", "--port", "8080"]
