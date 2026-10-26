"""Model artifact storage: local directory or Google Cloud Storage."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import joblib

from gridml.config import get_settings


def _key_uri(key: str) -> str:
    return get_settings().artifact_store.rstrip("/") + "/" + key


def save(obj: Any, key: str) -> str:
    buf = io.BytesIO()
    joblib.dump(obj, buf, compress=3)
    uri = _key_uri(key)
    parsed = urlparse(uri)
    if parsed.scheme == "gs":
        from google.cloud import storage

        blob = storage.Client().bucket(parsed.netloc).blob(parsed.path.lstrip("/"))
        blob.upload_from_string(buf.getvalue(), content_type="application/octet-stream")
    elif parsed.scheme == "file":
        path = Path(parsed.path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(buf.getvalue())
    else:
        raise ValueError(f"unsupported artifact store: {uri}")
    return uri


def load(uri: str) -> Any:
    parsed = urlparse(uri)
    if parsed.scheme == "gs":
        from google.cloud import storage

        blob = storage.Client().bucket(parsed.netloc).blob(parsed.path.lstrip("/"))
        return joblib.load(io.BytesIO(blob.download_as_bytes()))
    if parsed.scheme == "file":
        return joblib.load(parsed.path)
    raise ValueError(f"unsupported artifact uri: {uri}")


def delete(uri: str) -> None:
    parsed = urlparse(uri)
    if parsed.scheme == "gs":
        from google.cloud import storage

        storage.Client().bucket(parsed.netloc).blob(parsed.path.lstrip("/")).delete()
    elif parsed.scheme == "file":
        Path(parsed.path).unlink(missing_ok=True)
