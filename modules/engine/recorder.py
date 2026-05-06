"""
recorder.py — Record keyboard + mouse events into macro action steps
"""
from __future__ import annotations
import queue
import time
import threading
from typing import Callable

try:
    from pynput import keyboard, mouse
    _PYNPUT_AVAILABLE = True
except ImportError:
    _PYNPUT_AVAILABLE = False


_DRAG_THRESHOLD = 5  # pixels — en dessous = clic simple, au-dessus = drag


class MacroRecorder:
    """Record keyboard and mouse events, output them as macro action dicts."""

    def __init__(self, on_event: Callable[[dict], None] | None = None):
        self.on_event = on_event or (lambda e: None)
        self._actions: list[dict] = []
        self._recording = False
        self._start_time = 0.0
        self._last_time = 0.0
        self._kb_listener = None
        self._ms_listener = None
        self._lock = threading.RLock()
        self._event_queue: queue.Queue = queue.Queue()
        self._sender_thread: threading.Thread | None = None
        # drag tracking
        self._drag_start: dict | None = None   # {x, y, button, time}
        self._current_pos: tuple[int, int] = (0, 0)

    def start(self):
        if not _PYNPUT_AVAILABLE:
            raise RuntimeError('pynput not installed — pip install pynput')
        if self._recording:
            return
        self._recording = True
        self._actions = []
        self._start_time = time.time()
        self._last_time = self._start_time

        self._sender_thread = threading.Thread(target=self._sender_loop, daemon=True)
        self._sender_thread.start()

        self._kb_listener = keyboard.Listener(
            on_press=self._on_key_press,
            on_release=self._on_key_release,
        )
        self._ms_listener = mouse.Listener(
            on_move=self._on_mouse_move,
            on_click=self._on_mouse_click,
            on_scroll=self._on_mouse_scroll,
        )
        self._kb_listener.start()
        self._ms_listener.start()

    def stop(self) -> list[dict]:
        self._recording = False
        if self._kb_listener:
            self._kb_listener.stop()
            self._kb_listener = None
        if self._ms_listener:
            self._ms_listener.stop()
            self._ms_listener = None
        with self._lock:
            self._flush_drag()
        # drain queue before returning so on_event flushes all pending events
        self._event_queue.join()
        if self._sender_thread:
            self._event_queue.put(None)  # sentinel to stop sender
            self._sender_thread.join(timeout=2)
            self._sender_thread = None
        with self._lock:
            return list(self._actions)

    def is_recording(self) -> bool:
        return self._recording

    def _elapsed(self) -> float:
        with self._lock:
            now = time.time()
            dt = round(now - self._last_time, 3)
            self._last_time = now
        return dt

    def _sender_loop(self):
        """Drain event queue on dedicated thread so listener threads never block on I/O."""
        while True:
            item = self._event_queue.get()
            if item is None:
                self._event_queue.task_done()
                break
            try:
                self.on_event(item)
            finally:
                self._event_queue.task_done()

    def _add(self, action: dict):
        with self._lock:
            self._actions.append(action)
        self._event_queue.put(action)

    # ── Keyboard ──────────────────────────────────────────────
    def _key_name(self, key) -> str | None:
        """Convert pynput key to string name."""
        if hasattr(key, 'char') and key.char:
            return key.char
        if hasattr(key, 'name') and key.name:
            return key.name
        return None

    def _on_key_press(self, key):
        if not self._recording:
            return
        name = self._key_name(key)
        if not name:
            return
        dt = self._elapsed()
        if dt > 0.05:
            self._add({'type': 'wait', 'duration': dt})
        self._add({'type': 'key_tap', 'key': name, 'duration': 0.05, 'count': 1, 'use_direct': True})

    def _on_key_release(self, key):
        pass  # We record taps, not hold/release pairs

    # ── Mouse ─────────────────────────────────────────────────
    def _flush_drag(self):
        """Finalise un drag en cours — appelé sous self._lock."""
        if self._drag_start is None:
            return
        start = self._drag_start
        self._drag_start = None
        ex, ey = self._current_pos
        dx = abs(ex - start['x'])
        dy = abs(ey - start['y'])
        if dx > _DRAG_THRESHOLD or dy > _DRAG_THRESHOLD:
            drag_duration = round(time.time() - start['time'], 3)
            self._add({
                'type': 'mouse_drag',
                'x1': start['x'], 'y1': start['y'],
                'x2': ex, 'y2': ey,
                'button': start['button'],
                'duration': max(drag_duration, 0.1),
            })
        else:
            self._add({'type': 'mouse_click', 'x': start['x'], 'y': start['y'],
                       'button': start['button'], 'count': 1})

    def _on_mouse_move(self, x, y):
        if not self._recording:
            return
        with self._lock:
            self._current_pos = (x, y)

    def _on_mouse_click(self, x, y, button, pressed):
        if not self._recording:
            return
        btn = 'left'
        if button == mouse.Button.right:
            btn = 'right'
        elif button == mouse.Button.middle:
            btn = 'middle'

        if pressed:
            dt = self._elapsed()
            if dt > 0.05:
                self._add({'type': 'wait', 'duration': dt})
            with self._lock:
                self._drag_start = {'x': x, 'y': y, 'button': btn, 'time': time.time()}
                self._current_pos = (x, y)
        else:
            with self._lock:
                if self._drag_start is None:
                    return
                self._flush_drag()
                self._last_time = time.time()

    def _on_mouse_scroll(self, x, y, dx, dy):
        if not self._recording:
            return
        dt = self._elapsed()
        if dt > 0.05:
            self._add({'type': 'wait', 'duration': dt})
        direction = 'up' if dy > 0 else 'down'
        self._add({'type': 'scroll', 'clicks': abs(dy), 'direction': direction, 'x': x, 'y': y})
