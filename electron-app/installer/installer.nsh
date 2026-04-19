; ══════════════════════════════════════════════════════════════════════════════
; MacroEngine Installer personnalisé NSIS
; ══════════════════════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "x64.nsh"

; Les variables sont déjà définies par electron-builder:
; - PRODUCT_NAME
; - VERSION
; - PROJECT_DIR
; - APP_PACKAGE_NAME
; etc.

; ─────────────────────────────────────────────────────────────────────────────
; MUI Settings (MUST be before MUI_LANGUAGE!)
; ─────────────────────────────────────────────────────────────────────────────

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Languages MUST come after pages!
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "English"


