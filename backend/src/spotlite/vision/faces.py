"""Face recognition engine for Spotlite — copied from JARVIS, adapted for spotlite namespace."""

from __future__ import annotations

import glob
import logging
import os
import pickle
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np

logger = logging.getLogger(__name__)

_ENCODE_CACHE: dict[tuple[str, int], np.ndarray] = {}
_ENCODE_CACHE_MAX = 512
_RECOG_CACHE: dict[tuple, tuple] = {}
_RECOG_CACHE_TTL = float(os.getenv("SPOTLITE_RECOG_CACHE_TTL", "4"))
_IMAGE_GLOBS = ("*.jpg", "*.jpeg", "*.png", "*.bmp")
_INSIGHTFACE_EMBEDDING_DIM = 512


@dataclass
class PersonData:
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    profession: Optional[str] = None
    image_paths: list[str] = field(default_factory=list)
    face_encodings: list[np.ndarray] = field(default_factory=list)
    additional_data: dict[str, Any] = field(default_factory=dict)

    @property
    def primary_image_path(self) -> Optional[str]:
        return self.image_paths[0] if self.image_paths else None


@dataclass
class RecognitionResult:
    person: Optional[PersonData]
    confidence: float
    matched: bool
    processing_time: float
    error_message: Optional[str] = None


_SHARED_INSIGHT_APP = None
_SHARED_INSIGHT_LOCK = None


def _get_shared_app():
    global _SHARED_INSIGHT_APP, _SHARED_INSIGHT_LOCK
    import threading
    if _SHARED_INSIGHT_LOCK is None:
        _SHARED_INSIGHT_LOCK = threading.Lock()
    with _SHARED_INSIGHT_LOCK:
        if _SHARED_INSIGHT_APP is None:
            _SHARED_INSIGHT_APP = _init_insightface()
    return _SHARED_INSIGHT_APP


class FaceRecognitionEngine:
    def __init__(
        self,
        data_dir: str | Path = "data/faces",
        encodings_file: str = "known_faces.pkl",
        tolerance: float = 0.40,
    ):
        self.data_dir = Path(data_dir)
        self.encodings_path = self.data_dir / encodings_file
        self.tolerance = tolerance
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.known_faces: list[PersonData] = []
        self.stats = {"successful_matches": 0, "failed_matches": 0, "processing_times": []}
        self._app = _get_shared_app()
        self.load()

    def load(self) -> None:
        if not self.encodings_path.exists():
            return
        try:
            with self.encodings_path.open("rb") as fh:
                data = pickle.load(fh)
        except Exception as exc:
            logger.exception("Failed to load %s: %s", self.encodings_path, exc)
            return
        if isinstance(data, dict):
            self.known_faces = [
                PersonData(name=name, face_encodings=[encoding])
                for name, encoding in data.items()
            ]
        else:
            self.known_faces = list(data)
        for person in self.known_faces:
            person.face_encodings = [e for e in person.face_encodings if e.shape == (_INSIGHTFACE_EMBEDDING_DIM,)]
        logger.info("Loaded %d people from %s", len(self.known_faces), self.encodings_path)

    def save(self) -> None:
        with self.encodings_path.open("wb") as fh:
            pickle.dump(self.known_faces, fh)

    def encode(self, image_path: str | Path) -> Optional[np.ndarray]:
        if self._app is None:
            return None
        abs_path = str(Path(image_path).resolve())
        try:
            mtime_ns = Path(abs_path).stat().st_mtime_ns
        except OSError:
            mtime_ns = 0
        cache_key = (abs_path, mtime_ns)
        if cache_key in _ENCODE_CACHE:
            return _ENCODE_CACHE[cache_key]
        try:
            import cv2
            img = cv2.imread(abs_path)
            if img is None:
                try:
                    from PIL import Image as _PILImage
                    pil_img = _PILImage.open(abs_path).convert("RGB")
                    img = np.array(pil_img)[:, :, ::-1]
                except Exception:
                    return None
            faces = self._app.get(img)
            if not faces:
                return None
            embedding = faces[0].normed_embedding.astype(np.float32)
        except Exception as exc:
            logger.warning("Failed to encode %s: %s", abs_path, exc)
            return None
        if len(_ENCODE_CACHE) >= _ENCODE_CACHE_MAX:
            _ENCODE_CACHE.pop(next(iter(_ENCODE_CACHE)))
        _ENCODE_CACHE[cache_key] = embedding
        return embedding

    def recognize_face(self, image_path: str | Path) -> RecognitionResult:
        start = time.monotonic()
        if self._app is None:
            return RecognitionResult(None, 0.0, False, 0.0, "InsightFace not available")
        unknown_emb = self.encode(image_path)
        if unknown_emb is None:
            return RecognitionResult(None, 0.0, False, time.monotonic() - start, "No face found in image")
        recog_key = tuple(np.round(unknown_emb[:8], 1).tolist())
        now = time.monotonic()
        if recog_key in _RECOG_CACHE:
            cached_result, expiry = _RECOG_CACHE[recog_key]
            if now < expiry:
                return cached_result
        best_match: Optional[PersonData] = None
        best_confidence = 0.0
        for person in self.known_faces:
            valid = [e for e in person.face_encodings if e.shape == (_INSIGHTFACE_EMBEDDING_DIM,)]
            if not valid:
                continue
            sims = [float(np.dot(unknown_emb, enc)) for enc in valid]
            confidence = max(sims)
            if confidence > best_confidence and confidence >= self.tolerance:
                best_confidence = confidence
                best_match = person
        elapsed = time.monotonic() - start
        self.stats["processing_times"].append(elapsed)
        if best_match:
            self.stats["successful_matches"] += 1
            result = RecognitionResult(best_match, best_confidence, True, elapsed)
        else:
            self.stats["failed_matches"] += 1
            result = RecognitionResult(None, best_confidence, False, elapsed, "No matching face found")
        _RECOG_CACHE[recog_key] = (result, now + _RECOG_CACHE_TTL)
        return result

    def add_person(self, name: str, image_paths: list[str | Path], metadata: Optional[dict] = None) -> Optional[PersonData]:
        encodings = [enc for path in image_paths if (enc := self.encode(path)) is not None]
        if not encodings:
            return None
        metadata = metadata or {}
        person = PersonData(
            name=name,
            profession=metadata.get("title") or metadata.get("profession"),
            image_paths=[str(p) for p in image_paths],
            face_encodings=encodings,
            additional_data=metadata,
        )
        self.known_faces.append(person)
        self.save()
        return person

    def remove_person(self, name: str) -> bool:
        idx = next((i for i, p in enumerate(self.known_faces) if p.name.lower() == name.lower()), None)
        if idx is None:
            return False
        self.known_faces.pop(idx)
        self.save()
        return True

    def get_statistics(self) -> dict:
        times = self.stats["processing_times"]
        return {
            "total_people": len(self.known_faces),
            "successful_matches": self.stats["successful_matches"],
            "failed_matches": self.stats["failed_matches"],
            "average_processing_time": (sum(times) / len(times)) if times else 0.0,
        }


def _build_ort_providers() -> list:
    try:
        import onnxruntime as ort
        available = set(ort.get_available_providers())
    except Exception:
        return ["CPUExecutionProvider"]
    providers: list = []
    if "CUDAExecutionProvider" in available:
        providers.append(("CUDAExecutionProvider", {"device_id": 0}))
    if "CoreMLExecutionProvider" in available and sys.platform == "darwin":
        providers.append("CoreMLExecutionProvider")
    providers.append("CPUExecutionProvider")
    return providers


def _init_insightface():
    try:
        from insightface.app import FaceAnalysis
        model_root = os.getenv("INSIGHTFACE_HOME", "data/.insightface")
        os.makedirs(model_root, exist_ok=True)
        os.environ.setdefault("INSIGHTFACE_HOME", model_root)
        model_name = os.getenv("INSIGHTFACE_MODEL", "buffalo_sc")
        providers = _build_ort_providers()
        app = FaceAnalysis(name=model_name, providers=providers)
        det_thresh = float(os.getenv("INSIGHTFACE_DET_THRESH", "0.35"))
        app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=det_thresh)
        logger.info("InsightFace initialised (model=%s)", model_name)
        return app
    except ImportError:
        logger.warning("insightface not installed — face matching disabled")
        return None
    except Exception as exc:
        logger.warning("InsightFace init failed: %s", exc)
        return None
