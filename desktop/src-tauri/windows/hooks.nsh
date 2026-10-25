; The models and the engine live under %LOCALAPPDATA%\kalsa-brain, outside the
; ai.kalsa.brain folders the template clears. The template tests the checkbox
; and /UPDATE outside this macro, so the same tests are repeated here.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\kalsa-brain"
  ${EndIf}
!macroend
