; NSIS hooks for the Markdown Editor installer.
;
; Why this exists: Windows caches file-type icons by icon resource path and
; index. Both are stable across upgrades ("...\mdeditor.exe",0), so after
; installing a version with a new icon, Explorer keeps drawing the cached old
; bitmap until the shell is told the association changed. Without this hook the
; icon only updates when the cache happens to expire, which can be a long time.
;
; SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST | SHCNF_FLUSH, 0, 0) tells the
; shell to re-read association icons now.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Refreshing shell icons..."
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend

; The uninstaller removes the association, so the shell needs the same nudge
; afterwards or .md files keep the icon of an app that is no longer installed.
!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "Refreshing shell icons..."
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend
