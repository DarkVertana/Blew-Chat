"""Private-network, CPU speech recognition. Audio is discarded after each turn."""
import asyncio
import io
import os
import av
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, File, UploadFile, HTTPException
from faster_whisper import WhisperModel

app = FastAPI()
worker = ThreadPoolExecutor(max_workers=1)
model = None
pending = 0

def transcribe(data):
    global model
    # Decode incrementally and reject long compressed recordings before inference.
    chunks = []
    samples = 0
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunk = converted.to_ndarray().flatten()
                samples += len(chunk)
                if samples > 30 * 16000:
                    raise ValueError("Audio is longer than 30 seconds")
                chunks.append(chunk)
    if not chunks:
        return ""
    audio = np.concatenate(chunks).astype(np.float32) / 32768.0
    if model is None:
        model = WhisperModel(os.getenv("WHISPER_MODEL", "tiny"), device="cpu", compute_type="int8", download_root="/models")
    segments, _ = model.transcribe(audio, beam_size=1, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()

@app.get("/health")
def health():
    return {"ready": model is not None, "model": os.getenv("WHISPER_MODEL", "tiny")}

@app.post("/transcribe")
async def speech(audio: UploadFile = File(...)):
    global pending
    if pending >= 4:
        raise HTTPException(429, "Speech service is busy. Try again shortly.")
    data = await audio.read(8 * 1024 * 1024 + 1)
    await audio.close()
    if not data or len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Audio must be between 1 byte and 8 MB.")
    pending += 1
    try:
        text = await asyncio.get_running_loop().run_in_executor(worker, transcribe, data)
        return {"text": text}
    except Exception:
        raise HTTPException(503, "Could not transcribe audio. The first run may still be downloading the speech model.")
    finally:
        pending -= 1
