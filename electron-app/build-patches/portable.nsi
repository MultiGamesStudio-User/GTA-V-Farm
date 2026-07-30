!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  # ── Cache persistant (au lieu de $TEMP recree/detruit a chaque run) ────────
  # $INSTDIR fixe dans %LOCALAPPDATA% : extrait une seule fois par version,
  # reste en place entre les lancements. Voir docs/superpowers/specs/
  # 2026-07-29-portable-persistent-cache-design.md
  StrCpy $INSTDIR "$LOCALAPPDATA\MacroEngine\runtime"

  StrCpy $9 "0"
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 do_extract
  IfFileExists "$INSTDIR\.version" 0 do_extract
    FileOpen $8 "$INSTDIR\.version" r
    FileRead $8 $7
    FileClose $8
    StrCmp $7 "__APP_VERSION__" 0 do_extract
      StrCpy $9 "1"
  do_extract:

  StrCmp $9 "1" skip_extract 0

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        {endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  FileOpen $8 "$INSTDIR\.version" w
  FileWrite $8 "__APP_VERSION__"
  FileClose $8

  # Obscurcissement cosmetique seulement : n'importe qui avec "afficher
  # fichiers caches" active ou un terminal voit ce dossier normalement.
  nsExec::ExecToLog 'attrib +h +s "$INSTDIR"'
  Pop $0

  skip_extract:

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0
SectionEnd
