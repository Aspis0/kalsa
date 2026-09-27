#!/usr/bin/env python3
"""Two-second Android battery/thermal sampler for a single interactive arm."""
import csv, datetime, json, os, re, subprocess, sys, time
SERIAL='adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'

def adb(script):
    p=subprocess.run(['adb','-s',SERIAL,'shell',script],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if p.returncode: raise RuntimeError(f'adb rc {p.returncode}: {p.stdout}')
    return p.stdout

def die_stop(reason):
    print('STOP_REASON='+reason,flush=True)
    # Tap the active send/stop control only for a live arm stop condition.
    try:
        x=adb("uiautomator dump /data/local/tmp/thermal-ladder-ui.xml >/dev/null 2>&1; cat /data/local/tmp/thermal-ladder-ui.xml")
        m=re.search(r'<node\b(?=[^>]*resource-id="shell\.composer\.send")(?=[^>]*enabled="true")[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',x)
        if m:
            xx=(int(m.group(1))+int(m.group(3)))//2; yy=(int(m.group(2))+int(m.group(4)))//2
            adb(f'input tap {xx} {yy}')
            print(f'STOP_TAP={xx},{yy}',flush=True)
        else: print('STOP_TAP=not-found',flush=True)
    except Exception as e: print('STOP_TAP_ERROR='+str(e),flush=True)

def sample():
    out=adb("dumpsys battery | grep -E '^  (AC powered|USB powered|Wireless powered|level:|voltage:|temperature:|current now:)'; dumpsys thermalservice | grep -E 'Thermal Status:|mName=(BAT|SKIN)'")
    powered=[]
    for k in ('AC powered','USB powered','Wireless powered'):
        m=re.search(rf'^  {re.escape(k)}: (true|false)',out,re.M)
        if not m: raise ValueError('missing '+k)
        powered.append(m.group(1)=='true')
    def one(pattern,name):
        m=re.search(pattern,out,re.M)
        if not m: raise ValueError('missing '+name)
        return float(m.group(1))
    level=one(r'^  level: (\d+)','level')
    voltage_mv=one(r'^  voltage: (\d+)','voltage')
    temp_dc=one(r'^  temperature: (\d+)','battery_temperature')
    current_ma=one(r'^  current now: (-?\d+)','current')
    status=one(r'^Thermal Status: (\d+)','thermal_status')
    skin=None
    for m in re.finditer(r'Temperature\{mValue=([0-9.]+), mType=3, mName=SKIN',out): skin=float(m.group(1)); break
    return dict(powered=any(powered),level=level,voltage_mv=voltage_mv,current_ma=current_ma,battery_c=temp_dc/10,thermal_status=status,skin_c=skin)

def new_governor_count():
    # Native logging may be noisy; filter on device and only pull the small evidence tag.
    out=adb("logcat -d -s ReactNativeJS:I -v threadtime | grep 'KALSA_GOVERNOR {' | wc -l")
    try:return int(out.strip())
    except:return -1

def main():
    if len(sys.argv)!=4: raise SystemExit('usage: sample_arm.py ARM_ID CSV_PATH STOP_FILE')
    arm,path,stopfile=sys.argv[1:]
    os.makedirs(os.path.dirname(path),exist_ok=True)
    base=new_governor_count(); print(f'ARM={arm} BASE_GOVERNOR_LINES={base}',flush=True)
    fields=['t_epoch','t_utc','level_pct','battery_c','skin_c','thermal_status','current_ma','voltage_mv','powered','energy_mwh_cumulative','screen_awake','kalsa_focused']
    rows=[]; start=time.time(); prev=None; energy=0.0; exit_reason=''
    with open(path,'w',newline='') as f:
      w=csv.DictWriter(f,fieldnames=fields); w.writeheader()
      while True:
        now=time.time(); s=sample()
        power=adb("dumpsys power | grep -m1 'mWakefulness='; dumpsys window | grep -m1 'mCurrentFocus'")
        awake='mWakefulness=Awake' in power
        focused='com.kalsa.app/com.kalsa.app.MainActivity' in power
        if prev:
            dt=now-prev['t_epoch']; energy += ((abs(prev['current_ma'])*prev['voltage_mv'])+(abs(s['current_ma'])*s['voltage_mv']))*0.5*dt/3600000.0
        row=dict(t_epoch=f'{now:.3f}',t_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),level_pct=int(s['level']),battery_c=f"{s['battery_c']:.1f}",skin_c='' if s['skin_c'] is None else f"{s['skin_c']:.1f}",thermal_status=int(s['thermal_status']),current_ma=int(s['current_ma']),voltage_mv=int(s['voltage_mv']),powered=int(s['powered']),energy_mwh_cumulative=f'{energy:.4f}',screen_awake=int(awake),kalsa_focused=int(focused))
        w.writerow(row); f.flush(); rows.append((now,s)); print(json.dumps(row),flush=True)
        if not awake or not focused: exit_reason='screen_or_focus_lost'; die_stop(exit_reason); break
        if s['powered']: exit_reason='plugged'; die_stop(exit_reason); break
        if s['level']<=30: exit_reason='battery_floor_30'; die_stop(exit_reason); break
        if s['thermal_status']>=3: exit_reason='thermal_status_3'; die_stop(exit_reason); break
        if os.path.exists(stopfile): exit_reason='turn_complete'; break
        if base>=0 and new_governor_count()>base: exit_reason='governor_completion_line'; break
        if now-start>300: exit_reason='sampler_timeout_300s'; die_stop(exit_reason); break
        prev=dict(t_epoch=now,**s); time.sleep(max(0,2-(time.time()-now)))
    f.close()
    if rows:
        dt=rows[-1][0]-rows[0][0]
        db=rows[-1][1]['battery_c']-rows[0][1]['battery_c']
        peak=max(x[1]['thermal_status'] for x in rows)
        print(json.dumps(dict(END=exit_reason,duration_s=round(dt,2),energy_mwh=round(energy,4),delta_battery_c=round(db,1),peak_status=int(peak),samples=len(rows))),flush=True)
    return 3 if exit_reason in ('battery_floor_30','plugged','screen_or_focus_lost','sampler_timeout_300s') else 0

if __name__=='__main__': sys.exit(main())
