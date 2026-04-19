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
; MUI Settings
; ─────────────────────────────────────────────────────────────────────────────

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "English"

; ─────────────────────────────────────────────────────────────────────────────
; Custom Install Actions
; ─────────────────────────────────────────────────────────────────────────────

Section "Custom Install"
  ; Créer les raccourcis (optionnel - electron-builder en fait déjà)
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_FILENAME}.exe"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_FILENAME}.exe"
SectionEnd

