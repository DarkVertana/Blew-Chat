FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py ./
RUN useradd -m memory && mkdir -p /data /models && chown memory:memory /data /models
USER memory
ENV HF_HOME=/models HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false
EXPOSE 8091
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8091"]
