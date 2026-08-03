"""
vlm_engine.py — Moondream Cloud API for Auto Bouffe's UI-state detection.
Pixel-color / OCR / template-matching heuristics proved too brittle for this,
so this asks a real (small) vision model a plain-text question about a
captured screen region instead.

Previously ran moondream2 locally via `transformers` (torch + a multi-GB
model download, minutes on first use, GPU/CPU inference on every call).
Moved to Moondream's hosted Cloud API instead: no local weights, no torch/
transformers dependency, works identically on any machine. Costs a free
API key (https://moondream.ai) that the user pastes into Auto Bouffe's
settings and that travels with every request — never stored here.

Empirically (see conversation notes), asking this model to directly classify
the zone ("answer OWN/THIRD/CLOSED") is unreliable — it tends to default to
one answer or ramble instead of following the format. Asking it to simply
transcribe the panel title text it sees is far more reliable, so callers
should ask a transcription-style question and classify the *returned text*
themselves (see page-autobouffe.js's _abfDetectState).
"""
from __future__ import annotations
import base64
import io
import json
import urllib.request
import urllib.error

_API_URL = 'https://api.moondream.ai/v1/query'
_MODEL = 'moondream3.1-9B-A2B'
_TIMEOUT_S = 30


def ask_image(pil_image, question: str, api_key: str, on_log=None) -> str:
    """Ask a natural-language question about a PIL image via Moondream Cloud,
    return the answer text."""
    if not api_key:
        raise RuntimeError("clé API Moondream manquante — configure-la dans l'onglet Auto Bouffe.")

    buf = io.BytesIO()
    pil_image.convert('RGB').save(buf, format='JPEG', quality=85)
    image_b64 = base64.b64encode(buf.getvalue()).decode('ascii')

    payload = json.dumps({
        'model': _MODEL,
        'image_url': f'data:image/jpeg;base64,{image_b64}',
        'question': question,
    }).encode('utf-8')

    req = urllib.request.Request(
        _API_URL,
        data=payload,
        method='POST',
        headers={
            'Content-Type':      'application/json',
            'X-Moondream-Auth':  api_key,
            'User-Agent':        'MacroEngine/1.0',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='ignore')[:300]
        if e.code == 401:
            raise RuntimeError("Moondream Cloud: clé API invalide (401).") from e
        raise RuntimeError(f"Moondream Cloud: erreur HTTP {e.code} — {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Moondream Cloud: connexion impossible — {e.reason}") from e

    answer = body.get('answer')
    if answer is None:
        raise RuntimeError(f"Moondream Cloud: réponse inattendue — {body}")
    if on_log:
        on_log(f'Moondream Cloud → "{answer}"', 'INFO')
    return answer


def ask_region(x: int, y: int, w: int, h: int, question: str, api_key: str, on_log=None) -> str:
    from .screen_reader import capture_region_pil
    img = capture_region_pil(x, y, w, h)
    return ask_image(img, question, api_key, on_log)
