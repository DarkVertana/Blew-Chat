"""Private, local semantic index. PostgreSQL remains the authoritative memory.
Only IDs/revisions leave this service; the API rechecks ownership and exclusions.
Run one process per Qdrant local-mode data directory.
"""
import os
import secrets
import threading
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
import psycopg
from psycopg.rows import dict_row
from fastembed import TextEmbedding
from qdrant_client import QdrantClient, models

log = logging.getLogger("blew.memory")
lock = threading.RLock()
stop = threading.Event()
gc_offset = None
ready = False
client = None
embedder = None
COLLECTION = "blew_memory_bge_small_v1"

def connect():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)

def sync_batch():
    with connect() as db:
        rows = db.execute("SELECT m.*,b.user_id FROM bot_memories m JOIN bots b ON b.id=m.bot_id WHERE indexed_revision<>revision ORDER BY m.id LIMIT 24").fetchall()
    if not rows:
        return False
    visible = [row for row in rows if not row["hidden"]]
    with lock:
        vectors = list(embedder.passage_embed([row["title"]+"\n"+row["body"] for row in visible])) if visible else []
        if visible:
            client.upsert(COLLECTION, [models.PointStruct(id=row["id"], vector=vector.tolist(), payload={"user_id":row["user_id"],"bot_id":row["bot_id"],"revision":row["revision"]}) for row,vector in zip(visible,vectors)])
        hidden = [row["id"] for row in rows if row["hidden"]]
        if hidden:
            client.delete(COLLECTION, models.PointIdsList(points=hidden))
    with connect() as db:
        for row in rows:
            db.execute("UPDATE bot_memories SET indexed_revision=%s WHERE id=%s AND revision=%s", (row["revision"],row["id"],row["revision"]))
    return True

def purge_deleted_batch():
    # Bounded incremental sweep also removes embeddings after account/bot deletion.
    global gc_offset
    with lock:
        points, gc_offset = client.scroll(COLLECTION, offset=gc_offset, limit=256, with_payload=False, with_vectors=False)
        ids = [int(point.id) for point in points]
        if not ids:
            return
        with connect() as db:
            alive = {row["id"] for row in db.execute("SELECT id FROM bot_memories WHERE id=ANY(%s) AND NOT hidden", (ids,)).fetchall()}
        removed = [point_id for point_id in ids if point_id not in alive]
        if removed:
            client.delete(COLLECTION, models.PointIdsList(points=removed))

def worker():
    global ready,client,embedder
    while not stop.is_set():
        try:
            if not ready:
                embedder = TextEmbedding(model_name="BAAI/bge-small-en-v1.5",cache_dir="/models",threads=2)
                client = QdrantClient(path="/data/qdrant")
                if not client.collection_exists(COLLECTION):
                    client.create_collection(COLLECTION,vectors_config=models.VectorParams(size=384,distance=models.Distance.COSINE))
                    with connect() as db:
                        db.execute("UPDATE bot_memories SET indexed_revision=0")
                ready=True
            purge_deleted_batch()
            if not sync_batch():
                stop.wait(2)
        except Exception:
            log.warning("Memory indexing will retry; keyword recall remains available.")
            stop.wait(10)

@asynccontextmanager
async def lifespan(app):
    thread=threading.Thread(target=worker,daemon=True)
    thread.start()
    yield
    stop.set()
    thread.join(timeout=5)

app=FastAPI(lifespan=lifespan)
class Search(BaseModel):
    user_id:int=Field(gt=0)
    bot_id:int=Field(gt=0)
    query:str=Field(min_length=1,max_length=4000)

@app.get("/health")
def health():
    return {"status":"ready" if ready else "warming"}

@app.post("/search")
def search(body:Search,x_memory_key:str=Header(default="")):
    secret=os.environ.get("MEMORY_SECRET","")
    if len(secret)<32 or not secrets.compare_digest(secret,x_memory_key):
        raise HTTPException(401,"Private service")
    if not ready:
        raise HTTPException(503,"Semantic memory warming up")
    with lock:
        vector=next(embedder.query_embed(body.query)).tolist()
        hits=client.query_points(COLLECTION,query=vector,query_filter=models.Filter(must=[models.FieldCondition(key="user_id",match=models.MatchValue(value=body.user_id)),models.FieldCondition(key="bot_id",match=models.MatchValue(value=body.bot_id))]),limit=24,with_payload=True,score_threshold=0.35).points
    return {"hits":[{"id":hit.id,"revision":hit.payload["revision"],"score":hit.score} for hit in hits]}
