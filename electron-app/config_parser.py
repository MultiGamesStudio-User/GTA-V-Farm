#!/usr/bin/env python3
"""
config_parser.py  –  Bridge JSON entre l'app Electron et config.py

Usage :
    python config_parser.py read
        → lit config.py avec exec() et imprime un objet JSON sur stdout

    python config_parser.py write '{"KEY": valeur, ...}'
        → met à jour les assignations correspondantes dans config.py
"""

import sys
import json
import re
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'config.py')


# ─── Lecture ────────────────────────────────────────────────────────────────

def read_config():
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            source = f.read()

        namespace = {}
        exec(compile(source, CONFIG_PATH, 'exec'), namespace)  # nosec B102

        result = {}
        for key, val in namespace.items():
            if key.startswith('_'):
                continue
            if isinstance(val, (str, int, float, bool)):
                result[key] = val
            elif isinstance(val, (list, tuple)):
                try:
                    json.dumps(list(val))
                    result[key] = list(val)
                except (TypeError, ValueError):
                    result[key] = str(val)
            elif isinstance(val, dict):
                try:
                    json.dumps(val)
                    result[key] = val
                except (TypeError, ValueError):
                    result[key] = str(val)

        print(json.dumps(result))

    except Exception as exc:
        print(json.dumps({'__error__': str(exc)}))
        sys.exit(1)


# ─── Helpers de localisation ─────────────────────────────────────────────────

def find_assignment_range(content, key):
    """
    Retourne (start, end) où content[start:end] est l'assignation complète
    de `key`, nouvelle-ligne finale incluse.
    Retourne (None, None) si la clé est introuvable.
    """
    pattern = re.compile(r'^[ \t]*' + re.escape(key) + r'[ \t]*=[ \t]*',
                         re.MULTILINE)
    m = pattern.search(content)
    if not m:
        return None, None

    line_start = m.start()
    val_start  = m.end()

    # Sauter les espaces éventuels entre = et la valeur
    while val_start < len(content) and content[val_start] in (' ', '\t'):
        val_start += 1

    if val_start >= len(content):
        return line_start, len(content)

    first = content[val_start]

    if first in ('{', '[', '('):
        # ── Valeur multi-ligne : chercher la fermeture ──────────────
        depth       = 0
        in_str      = False
        str_char    = None
        escape_next = False
        pos         = val_start

        while pos < len(content):
            ch = content[pos]
            if escape_next:
                escape_next = False
            elif in_str:
                if ch == '\\':
                    escape_next = True
                elif ch == str_char:
                    in_str = False
            else:
                if ch in ('"', "'"):
                    # Triple quote ?
                    triple = content[pos:pos + 3]
                    if triple in ('"""', "'''"):
                        end_t = content.find(triple, pos + 3)
                        if end_t != -1:
                            pos = end_t + 3
                            continue
                    in_str   = True
                    str_char = ch
                elif ch in ('{', '[', '('):
                    depth += 1
                elif ch in ('}', ']', ')'):
                    depth -= 1
                    if depth == 0:
                        pos += 1
                        # Consommer virgule + fin de ligne
                        while pos < len(content) and content[pos] in (' ', '\t', ','):
                            pos += 1
                        if pos < len(content) and content[pos] == '\n':
                            pos += 1
                        return line_start, pos
            pos += 1

        return line_start, len(content)

    else:
        # ── Valeur simple : fin de ligne ────────────────────────────
        eol = content.find('\n', val_start)
        end = (eol + 1) if eol != -1 else len(content)
        return line_start, end


# ─── Écriture ────────────────────────────────────────────────────────────────

def write_config(changes):
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            content = f.read()

        for key, value in changes.items():
            py_repr = value_to_python(value)
            start, end = find_assignment_range(content, key)

            if start is None:
                content += f'\n{key} = {py_repr}\n'
            else:
                new_line = f'{key} = {py_repr}\n'
                content  = content[:start] + new_line + content[end:]

        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            f.write(content)

        print(json.dumps({'success': True}))

    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}))
        sys.exit(1)


def value_to_python(value):
    """Convertit une valeur JSON en représentation Python littérale."""
    if value is None:
        return 'None'
    if isinstance(value, bool):
        return 'True' if value else 'False'
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, list):
        items = ', '.join(value_to_python(v) for v in value)
        return f'[{items}]'
    if isinstance(value, dict):
        items = ', '.join(f'{repr(k)}: {value_to_python(v)}' for k, v in value.items())
        return '{' + items + '}'
    return repr(value)


# ─── Entrée principale ───────────────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'__error__': 'No command provided'}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'read':
        read_config()
    elif cmd == 'write':
        if len(sys.argv) < 3:
            print(json.dumps({'__error__': 'No JSON data provided'}))
            sys.exit(1)
        try:
            data = json.loads(sys.argv[2])
        except json.JSONDecodeError as exc:
            print(json.dumps({'__error__': f'JSON invalide : {exc}'}))
            sys.exit(1)
        write_config(data)
    else:
        print(json.dumps({'__error__': f'Commande inconnue : {cmd}'}))
        sys.exit(1)
