FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py ./
RUN useradd -m speech && mkdir -p /models && chown speech:speech /models
USER speech
ENV WHISPER_MODEL=tiny HF_HOME=/models
EXPOSE 8090
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8090"]
