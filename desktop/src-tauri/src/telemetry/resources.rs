use super::spec;
use serde_json::{Value, json};

#[derive(Default)]
pub(super) struct Cpu {
    previous: Option<(u64, u64)>,
    pub bucket: Option<&'static str>,
}

impl Cpu {
    pub fn sample(&mut self) {
        if let Some((idle, total)) = counters() {
            if let Some((old_idle, old_total)) = self.previous {
                let elapsed = total.saturating_sub(old_total);
                if elapsed > 0 {
                    let busy = elapsed.saturating_sub(idle.saturating_sub(old_idle));
                    self.bucket = spec::bucket("cpuLoad", busy as f64 * 100.0 / elapsed as f64);
                }
            }
            self.previous = Some((idle, total));
        }
    }
}

pub(super) fn memory(total: u64, cpu: &Cpu) -> Value {
    let mut d = json!({"thermal":"unknown"});
    if let Some(free) =
        crate::system::available_ram_bytes().filter(|free| total > 0 && *free <= total)
    {
        d["freeRam"] = json!(spec::bucket("freeRam", free as f64));
        d["ramUse"] = json!(spec::bucket(
            "ramUse",
            (total - free) as f64 * 100.0 / total as f64
        ));
    }
    if let Some(bucket) = cpu.bucket {
        d["cpuLoad"] = json!(bucket);
    }
    d
}

#[cfg(target_os = "linux")]
fn counters() -> Option<(u64, u64)> {
    let text = std::fs::read_to_string("/proc/stat").ok()?;
    let first = text.lines().next()?;
    let values: Vec<u64> = first
        .strip_prefix("cpu ")?
        .split_whitespace()
        .take(8)
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    Some((
        values.get(3)? + values.get(4).unwrap_or(&0),
        values.iter().sum(),
    ))
}

#[cfg(target_os = "macos")]
fn counters() -> Option<(u64, u64)> {
    unsafe extern "C" {
        fn mach_host_self() -> u32;
        fn host_statistics(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
        fn mach_port_deallocate(task: u32, port: u32) -> i32;
        static mach_task_self_: u32;
    }
    let mut ticks = [0u32; 4];
    let mut count = 4;
    // HOST_CPU_LOAD_INFO exposes aggregate counters only, never process or host identities.
    let status = unsafe {
        let host = mach_host_self();
        let status = host_statistics(host, 3, ticks.as_mut_ptr().cast(), &mut count);
        mach_port_deallocate(mach_task_self_, host);
        status
    };
    (status == 0 && count == 4).then(|| {
        (
            u64::from(ticks[2]),
            ticks.iter().map(|v| u64::from(*v)).sum(),
        )
    })
}

#[cfg(target_os = "windows")]
fn counters() -> Option<(u64, u64)> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    let mut idle = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut kernel = idle;
    let mut user = idle;
    let number = |t: FILETIME| u64::from(t.dwLowDateTime) | (u64::from(t.dwHighDateTime) << 32);
    (unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0)
        .then(|| (number(idle), number(kernel) + number(user)))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn counters() -> Option<(u64, u64)> {
    None
}

pub(super) fn date(now: u64) -> String {
    let z = (now / 86400) as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    format!(
        "{:04}-{:02}-{:02}",
        year + i64::from(month <= 2),
        month,
        day
    )
}
