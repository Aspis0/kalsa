# Cell #65 - NOT RUN (blocked at QDC login)

- Job tag: none. No session was created, no minutes requested or used.
- Blocker: the Paseo browser tab is `visibilityState=hidden` (list_tabs `isActive:false`, `document.hasFocus()=false`) once it lands on `account.qualcomm.com`. The Okta sign-in widget never renders (`#okta-login-container` empty, `#inactive-tab-main-div` shows "The page has timed out"). No login field exists, so no password was typed. Screenshot always returns `screenshot_no_frame`.
- Tried: new tab, resize 2400x1400, Allow All on the cookie banner, reload, re-navigate, a second fresh tab, overriding `visibilityState` (the override did not take effect; the page still read `hidden`).
- No 2FA was requested (never reached it).
- Not touched: no tunnel started (6037 untouched, 5037 untouched), no adb run, d_run.sh not executed, raw/ empty.
- Needs: the Paseo browser tab made visible/active (the Paseo app showing the browser panel), or an already-logged-in tab for aspis.launcher@gmail.com. Then rerun.
