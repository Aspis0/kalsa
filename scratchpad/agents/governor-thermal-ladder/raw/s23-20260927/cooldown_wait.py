import datetime,re,subprocess,time,sys
SERIAL='adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'
LOG='raw/s23-20260927/cooldown-wait.log'
def adb(s):
 p=subprocess.run(['adb','-s',SERIAL,'shell',s],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 if p.returncode: raise SystemExit('ADB_ERROR '+p.stdout)
 return p.stdout
def val(p,s):
 m=re.search(p,s,re.M)
 if not m: raise SystemExit('MISSING_READING '+p)
 return m.group(1)
while True:
 t=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
 b=adb("dumpsys battery | grep -E '^  (AC powered|USB powered|Wireless powered|level:|temperature:)'; dumpsys thermalservice | grep -m1 'Thermal Status:'; dumpsys power | grep -m1 'mWakefulness='; dumpsys window | grep -m1 'mCurrentFocus'")
 level=int(val(r'^  level: (\d+)',b)); temp=int(val(r'^  temperature: (\d+)',b))/10; status=int(val(r'^Thermal Status: (\d+)',b)); powered=any(val(rf'^  {k}: (true|false)',b)=='true' for k in ['AC powered','USB powered','Wireless powered']); awake='mWakefulness=Awake' in b; focused='com.kalsa.app/com.kalsa.app.MainActivity' in b
 row=f'{t} level={level} battery_c={temp:.1f} thermal_status={status} powered={int(powered)} awake={int(awake)} kalsa_focused={int(focused)}'
 print(row,flush=True)
 with open(LOG,'a') as f:f.write(row+'\n')
 if powered or not awake or not focused: print('STOP=preflight_lost',flush=True);break
 if level<=30: print('STOP=battery_floor_30',flush=True);break
 if temp<=33.0 and status==0: print('GATE=ready',flush=True);break
 time.sleep(30)
