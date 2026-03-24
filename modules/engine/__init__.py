"""
engine/__init__.py — Exports publics du moteur de macros.
"""
from .macro_runner   import MacroRunner
from .window_manager import (
    list_windows, find_window,
    get_window_rect, get_window_size, get_window_info,
    focus_window, is_window_focused,
    get_primary_screen_size, get_all_monitors, find_monitor_for_window,
)
from .screen_reader  import (
    capture_region, capture_region_pil, capture_full_window,
    get_pixel_color, region_to_b64,
    get_primary_screen_size, get_all_monitors,
)
from .conditions     import eval_condition, set_runners_registry
from .actions        import exec_action
from .recorder       import MacroRecorder
from .coord_utils    import (
    rect_size,
    validate_point, validate_region,
    clamp_point, clamp_region,
    window_to_screen, screen_to_window,
    region_window_to_screen, region_screen_to_window,
    scale_point, scale_region,
    auto_scale_point, auto_scale_region,
    describe_point, describe_region, check_point,
)
from . import state
from . import humanizer
