"""
vlm_engine.py — Local vision-language model (moondream2) for Auto Bouffe's
UI-state detection. Pixel-color / OCR / template-matching heuristics proved
too brittle for this, so this asks a real (small) vision model a plain-text
question about a captured screen region instead.

Not the official `moondream` PyPI package: its fast "Photon" runtime only
supports NVIDIA GPU or Apple Silicon and nothing else, so this loads
`vikhyatk/moondream2` straight from HuggingFace via `transformers` instead —
works on any machine, using CUDA automatically when available and falling
back to CPU (slower, seconds per query) otherwise.

Model + weights are loaded lazily on first use (not at process startup) since
this is an optional, heavy dependency most features never touch — first call
may need to download several GB and take minutes; later calls just run
inference on the already-loaded model.

Empirically (see conversation notes), asking this model to directly classify
the zone ("answer OWN/THIRD/CLOSED") is unreliable — it tends to default to
one answer or ramble instead of following the format. Asking it to simply
transcribe the panel title text it sees is far more reliable, so callers
should ask a transcription-style question and classify the *returned text*
themselves (see page-autobouffe.js's _abfDetectState).
"""
from __future__ import annotations
import threading

_MODEL_ID = 'vikhyatk/moondream2'
_MODEL_REVISION = '2024-08-26'

_lock = threading.Lock()
_model = None
_tokenizer = None


def _load(on_log=None):
    global _model, _tokenizer
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        if on_log:
            on_log('IA locale (moondream2): chargement — le premier lancement peut '
                   'télécharger plusieurs Go et prendre quelques minutes.', 'INFO')
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        use_cuda = torch.cuda.is_available()
        device = torch.device('cuda') if use_cuda else torch.device('cpu')
        dtype = torch.float16 if use_cuda else torch.float32
        if on_log:
            gpu_name = torch.cuda.get_device_name(0) if use_cuda else None
            on_log(f'IA locale (moondream2): GPU détecté ({gpu_name}), inférence accélérée.'
                   if use_cuda else 'IA locale (moondream2): pas de GPU CUDA, inférence CPU.', 'INFO')
        tokenizer = AutoTokenizer.from_pretrained(_MODEL_ID, revision=_MODEL_REVISION)
        model = AutoModelForCausalLM.from_pretrained(
            _MODEL_ID, revision=_MODEL_REVISION, trust_remote_code=True,
            torch_dtype=dtype,
        ).to(device)
        model.eval()
        _tokenizer = tokenizer
        _model = model
        if on_log:
            on_log('IA locale (moondream2): prête.', 'INFO')


def warmup(on_log=None) -> None:
    """Load the model without asking anything — used to pre-warm VRAM a few
    seconds before a scheduled scan instead of eagerly on first use."""
    _load(on_log)


def unload(on_log=None) -> None:
    """Free the model and its VRAM. Auto Bouffe's interval is typically
    hours — there's no reason to hold ~4 Go of VRAM reserved the whole
    time between scans, so the caller unloads right after each cycle and
    calls warmup() again shortly before the next one."""
    global _model, _tokenizer
    with _lock:
        if _model is None:
            return
        was_cuda = next(_model.parameters()).is_cuda
        _model = None
        _tokenizer = None
        if was_cuda:
            import torch
            torch.cuda.empty_cache()
        if on_log:
            on_log('IA locale (moondream2): déchargée (VRAM libérée) jusqu\'au prochain scan.', 'INFO')


def ask_image(pil_image, question: str, on_log=None) -> str:
    """Ask a natural-language question about a PIL image, return the answer text."""
    _load(on_log)
    # Capture local references under the lock instead of using the globals
    # directly below: a concurrent unload() (e.g. the interval loop freeing
    # VRAM right as a manual "Tester" click is mid-request) could otherwise
    # null out _model/_tokenizer between this call and encode_image().
    with _lock:
        model, tokenizer = _model, _tokenizer
    if model is None:
        raise RuntimeError('vision model was unloaded before inference could run')
    encoded = model.encode_image(pil_image)
    return model.answer_question(encoded, question, tokenizer)


def ask_region(x: int, y: int, w: int, h: int, question: str, on_log=None) -> str:
    from .screen_reader import capture_region_pil
    img = capture_region_pil(x, y, w, h)
    return ask_image(img, question, on_log)
