# Jelly lifecycle verification — APK 3ca6145 / e455afc (2026-09-10)
Phone: Jelly Star / MediaTek G99 / Android 13 / USB `JELLYS0000053795`; model `lfm2.5-2.6b`; charge 100%, startup temperature 29°C. Source APK SHA-256 `10bc57d4314fe878ac12c17b95acb33cf012658e26608ee7f7ed824a1c6a1583`; installed `base.apk` matched exactly. Data/models preserved; no phone files deleted; no other serial touched.
Evidence: `JELLY-LIFECYCLE-3ca6145-2026-09-10/`. Keep-awake was restored after the stop.

| Cycle/item | Expected | Observed | Verdict |
|---|---|---|---|
| 1 startup/module | AppShell mount logs `background.grace {"timer":"native"}` once | `09-10 09:35:43.030 12621 12644 I ReactNativeJS: 'background.grace', '{"timer":"js"}'` | FAIL |
| 2 long background ×2 | Native 45s unload, `.kvs` load, cold fit `availableMb`, cached reopen | Not run: startup gate reported JS timer; stop condition reached | SKIP |
| 3 brief background | 15s reopen cancels grace; engine resident | Not run: startup gate failed | SKIP |
| 4 trim BACKGROUND/HIDDEN | Level 40 cancels+unloads; level 20 does nothing | Not run: startup gate failed | SKIP |
| 5 extraction ×3 + rapid pair | Measured timeout, completed facts, then `aborted_by_send` | Not run: startup gate failed | SKIP |

FAIL exact line: `09-10 09:35:43.030 12621 12644 I ReactNativeJS: 'background.grace', '{"timer":"js"}'`.
