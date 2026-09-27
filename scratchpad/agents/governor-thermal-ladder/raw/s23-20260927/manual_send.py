#!/usr/bin/env python3
"""Manual ACTION_VIEW composer delivery to the one pinned S23 adb endpoint."""
import re, subprocess, sys, time, urllib.parse
from pathlib import Path
SERIAL = 'adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'

def adb(*args, capture=False):
    p = subprocess.run(['adb', '-s', SERIAL, *args], text=True,
                     stdout=subprocess.PIPE if capture else None,
                     stderr=subprocess.STDOUT if capture else None)
    if p.returncode:
        raise SystemExit(f'adb failed rc={p.returncode}: {args!r}\n{p.stdout or ""}')
    return p.stdout or ''

def ui_dump():
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/thermal-ladder-ui.xml')
    return adb('shell', 'cat', '/data/local/tmp/thermal-ladder-ui.xml', capture=True)

def main():
    stage = False
    if len(sys.argv) == 3 and sys.argv[1] == '--file':
        text = Path(sys.argv[2]).read_text(encoding='utf-8')
    elif len(sys.argv) == 4 and sys.argv[1] == '--file' and sys.argv[3] == '--stage':
        text = Path(sys.argv[2]).read_text(encoding='utf-8'); stage = True
    elif len(sys.argv) == 3 and sys.argv[1] == '--stage':
        text = sys.argv[2]; stage = True
    elif len(sys.argv) == 2:
        text = sys.argv[1]
    else:
        raise SystemExit('usage: manual_send.py TEXT | --stage TEXT | --file PATH [--stage]')
    uri = 'kalsa://share?text=' + urllib.parse.quote(text, safe='') + '#n=thermal_' + str(time.time_ns())
    print('share_intent=' + uri[:160] + ('...' if len(uri) > 160 else ''))
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', uri)
    time.sleep(3)
    xml = ui_dump()
    if not xml or '<hierarchy' not in xml:
        raise SystemExit('uiautomator failed to produce hierarchy')
    print('uiautomator_chars=' + str(len(xml)))
    send = re.search(r'<node\b(?=[^>]*resource-id="shell\.composer\.send")(?=[^>]*enabled="true")[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
    if stage:
        Path('/tmp/thermal-ladder-staged.xml').write_text(xml, encoding='utf-8')
        print('staged_no_send')
        return
    if not send:
        open('/tmp/thermal-ladder-send-missing.xml', 'w').write(xml)
        raise SystemExit('send button not enabled; XML in /tmp/thermal-ladder-send-missing.xml')
    x = (int(send.group(1)) + int(send.group(3))) // 2
    y = (int(send.group(2)) + int(send.group(4))) // 2
    print(f'send_bounds={send.group(1)},{send.group(2)},{send.group(3)},{send.group(4)} tap={x},{y}')
    adb('shell', 'input', 'tap', str(x), str(y))
    print('send_tapped')

if __name__ == '__main__':
    main()
