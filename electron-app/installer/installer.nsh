; ══════════════════════════════════════════════════════════════════════════════
; MacroEngine Installer personnalisé NSIS
; ══════════════════════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "x64.nsh"

; ─────────────────────────────────────────────────────────────────────────────
; Configuration
; ─────────────────────────────────────────────────────────────────────────────

!define PRODUCT_NAME "MacroEngine"
!define PRODUCT_VERSION "2.2.0"
!define PRODUCT_PUBLISHER "Multigames Studio"
!define PRODUCT_WEB_SITE "https://github.com/Multigames-studio"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
InstallDir "$PROGRAMFILES\${PRODUCT_NAME}"
InstallDirRegKey HKLM "Software\${PRODUCT_NAME}" ""

; ─────────────────────────────────────────────────────────────────────────────
; MUI Settings
; ─────────────────────────────────────────────────────────────────────────────

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "English"

; ─────────────────────────────────────────────────────────────────────────────
; Section d'installation
; ─────────────────────────────────────────────────────────────────────────────

Section "Install"
  SetOverwrite try

  ; Créer les raccourcis
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\MacroEngine.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\MacroEngine.exe"

  ; Ajouter à la liste d'ajout/suppression
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayIcon" "$INSTDIR\MacroEngine.exe"
SectionEnd

; ─────────────────────────────────────────────────────────────────────────────
; Section de désinstallation
; ─────────────────────────────────────────────────────────────────────────────

Section "Uninstall"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
