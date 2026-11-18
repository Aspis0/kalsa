//! Start, supervise and reap engine processes in their own process group.

use std::collections::VecDeque;
use std::ffi::CStr;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::api_key::ApiKey;
use crate::launch::Launch;

const LOG_LINES: usize = 200;
const POLL: Duration = Duration::from_millis(10);

#[link(name = "proc")]
extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_char, size: u32) -> i32;
}

pub struct Running {
    child: Child,
    logs: Arc<Mutex<VecDeque<String>>>,
    pub program: PathBuf,
    group: i32,
}

fn drain<R: std::io::Read + Send + 'static>(stream: R, logs: Arc<Mutex<VecDeque<String>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let mut lines = logs.lock().expect("log lock");
            if lines.len() == LOG_LINES { lines.pop_front(); }
            lines.push_back(line);
        }
    });
}

pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    Ok(listener.local_addr().map_err(|error| error.to_string())?.port())
}

/// Our argv always carries `--host 127.0.0.1`. The listening socket is checked
/// after spawn by [`verify_listener`], so a port race cannot go unnoticed.
pub fn start(launch: Launch, root: &Path) -> Result<Running, String> {
    let mut command = Command::new(&launch.program);
    command.args(&launch.args).env_clear().process_group(0);
    let models = root.join("models/hf");
    let cache = root.join("cache");
    std::fs::create_dir_all(models.join("hub")).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    command.env("HOME", root);
    command.env("HF_HOME", &models);
    command.env("HF_HUB_CACHE", models.join("hub"));
    command.env("XDG_CACHE_HOME", &cache);
    command.env("PATH", "/usr/bin:/bin");
    if let Some(venv) = &launch.venv {
        command.env("PATH", format!("{}:/usr/bin:/bin", venv.join("bin").display()));
    }
    if let Some(library) = launch.library_path {
        command.env("DYLD_LIBRARY_PATH", library);
    }
    for (name, value) in &launch.env {
        command.env(name, value);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("could not start {}: {error}", launch.program.display()))?;
    let pid = child.id() as i32;
    // Two-sided group setup: either side may win,
    // and getpgid is the authority before any group signal is sent.
    unsafe { libc::setpgid(pid, pid); }
    if !group_owned(pid) {
        let _ = child.kill();
        return Err("child did not lead its own process group".to_string());
    }
    let logs = Arc::new(Mutex::new(VecDeque::with_capacity(LOG_LINES)));
    if let Some(out) = child.stdout.take() { drain(out, Arc::clone(&logs)); }
    if let Some(err) = child.stderr.take() { drain(err, Arc::clone(&logs)); }
    Ok(Running { child, logs, program: launch.program, group: pid })
}

pub fn reachable(port: u16, key: &ApiKey) -> bool {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).build();
    matches!(
        agent
            .get(&format!("http://127.0.0.1:{port}/v1/models"))
            .set("Authorization", &format!("Bearer {}", key.as_str()))
            .call(),
        Ok(_)
    )
}

/// Runs the absolute-path lsof with a short deadline. A missing, hung or
/// failing lsof is a start failure, never proof that the port is ours.
fn lsof_output(port: u16) -> Result<String, String> {
    let mut child = Command::new("/usr/sbin/lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fpn"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not run /usr/sbin/lsof: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => {
                let output = child.wait_with_output().map_err(|error| error.to_string())?;
                let text = String::from_utf8_lossy(&output.stdout).into_owned();
                // lsof exits 1 when no socket matches yet; that is a normal
                // poll miss, not a failed inspection.
                if status.success() || text.is_empty() {
                    return Ok(text);
                }
                return Err("lsof could not inspect the listening socket".to_string());
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("lsof timed out while inspecting the listening socket".to_string());
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn lsof_entries(text: &str) -> Vec<(i32, String)> {
    let mut entries = Vec::new();
    let mut pid = 0;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse().unwrap_or(0);
        } else if pid > 0 {
            if let Some(address) = line.strip_prefix('n') {
                entries.push((pid, address.to_string()));
            }
        }
    }
    entries
}

fn listener_verdict(entries: &[(bool, &str)], port: u16) -> Result<bool, String> {
    if let Some((_, address)) = entries.iter().find(|(ours, _)| !*ours) {
        return Err(format!("port {port} is also held by another process on {address}"));
    }
    let loopback = format!("127.0.0.1:{port}");
    if entries.iter().any(|(_, address)| *address == loopback) {
        return Ok(true);
    }
    if let Some((_, address)) = entries.first() {
        return Err(format!("engine bound to {address}, expected 127.0.0.1"));
    }
    Ok(false)
}

/// Verify that only our child's process group listens on the reachable address.
pub fn verify_listener(port: u16, leader: u32) -> Result<bool, String> {
    let group = leader as i32;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let entries = lsof_entries(&lsof_output(port)?);
        let parsed: Vec<(bool, &str)> = entries
            .iter()
            .map(|(pid, address)| (unsafe { libc::getpgid(*pid) == group }, address.as_str()))
            .collect();
        match listener_verdict(&parsed, port) {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(error) => return Err(error),
        }
        if Instant::now() >= deadline { return Ok(false); }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// True once no process answers for the group the leader used to own.
pub fn group_gone(leader: u32) -> bool {
    leader == 0 || unsafe { libc::kill(-(leader as i32), 0) != 0 }
}

fn group_owned(leader: i32) -> bool {
    unsafe { libc::kill(leader, 0) == 0 && libc::getpgid(leader) == leader }
}

fn signal_group(group: i32, signal: i32) -> Result<(), String> {
    if unsafe { libc::kill(-group, signal) } == 0 { return Ok(()); }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) { return Ok(()); }
    Err(error.to_string())
}

fn wait_for_empty_group(group: i32, deadline: Instant) -> bool {
    loop {
        if unsafe { libc::kill(-group, 0) } != 0 { return true; }
        if Instant::now() >= deadline { return false; }
        std::thread::sleep(POLL);
    }
}

impl Running {
    pub fn child_pid(&self) -> u32 {
        self.child.id()
    }

    pub fn tail(&self) -> Vec<String> {
        self.logs.lock().expect("log lock").iter().cloned().collect()
    }

    /// `None` while alive; `Some(code)` once it has exited.
    pub fn try_wait(&mut self) -> Result<Option<i32>, String> {
        match self.child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => Ok(Some(status.code().unwrap_or(-1))),
            None => Ok(None),
        }
    }

    pub fn stop(&mut self, grace: Duration) -> Result<(), String> {
        let group = self.group;
        signal_group(group, libc::SIGTERM)?;
        if self.wait_for_empty_group(group, Instant::now() + grace) { return Ok(()); }
        signal_group(group, libc::SIGKILL)?;
        if !self.wait_for_empty_group(group, Instant::now() + grace) {
            return Err(format!("process group {group} did not stop before the deadline"));
        }
        Ok(())
    }

    /// Reaping the leader on every poll is essential: a zombie still counts
    /// as a member of its process group until `try_wait` removes it.
    fn wait_for_empty_group(&mut self, group: i32, deadline: Instant) -> bool {
        loop {
            let _ = self.child.try_wait();
            if unsafe { libc::kill(-group, 0) } != 0 { return true; }
            if Instant::now() >= deadline { return false; }
            std::thread::sleep(POLL);
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) { let _ = self.stop(Duration::from_secs(2)); }
}

fn start_time(pid: i32) -> Option<u64> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>();
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut std::ffi::c_void,
            size as i32,
        )
    };
    (read as usize == size).then_some(info.pbi_start_tvsec)
}

fn exe_path(pid: i32) -> Option<PathBuf> {
    let mut buffer = [0i8; 1024];
    let length = unsafe { proc_pidpath(pid, buffer.as_mut_ptr(), buffer.len() as u32) };
    if length <= 0 { return None; }
    let bytes = buffer[..length as usize].iter().map(|b| *b as u8).collect::<Vec<_>>();
    CStr::from_bytes_until_nul(&bytes).ok().map(|name| PathBuf::from(name.to_string_lossy().into_owned()))
}

/// Kills a stale process group only when its executable is still the recorded
/// engine binary inside the engines root. Other pidfiles are simply removed.
pub fn cleanup_stale(root: &Path, pidfiles: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(pidfiles) else { return Ok(()) };
    for entry in entries.flatten() {
        let text = fs::read_to_string(entry.path()).unwrap_or_default();
        let mut lines = text.lines();
        let pid: i32 = lines.next().and_then(|line| line.parse().ok()).unwrap_or(0);
        let recorded = lines.next().unwrap_or("");
        let recorded_start: u64 = lines.next().and_then(|line| line.parse().ok()).unwrap_or(0);
        let stale = pid > 0
            && recorded_start > 0
            && start_time(pid) == Some(recorded_start)
            && group_owned(pid)
            // proc_pidpath reports the interpreter for a shebang script; that
            // is the process image we must identify, not the console script.
            && exe_path(pid).is_some_and(|exe| exe == Path::new(recorded))
            && Path::new(recorded).starts_with(root);
        if stale {
            let _ = signal_group(pid, libc::SIGTERM);
            let deadline = Instant::now() + Duration::from_secs(5);
            if !wait_for_empty_group(pid, deadline) {
                let _ = signal_group(pid, libc::SIGKILL);
                let _ = wait_for_empty_group(pid, Instant::now() + Duration::from_secs(5));
            }
            unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG); }
        }
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

pub fn write_pidfile(id: &str, pid: u32, program: &Path) -> Result<PathBuf, String> {
    let root = crate::paths::safe_root()?;
    let dir = root.join(".pids");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("{id}.pid"));
    let child = pid as i32;
    let image = exe_path(child).or_else(|| fs::canonicalize(program).ok()).unwrap_or_else(|| program.to_path_buf());
    let started = start_time(child).unwrap_or(0);
    fs::write(&path, format!("{pid}\n{}\n{started}\n", image.display())).map_err(|error| error.to_string())?;
    Ok(path)
}

pub fn remove_pidfile(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_verdict_is_strict() {
        let port = 8123;
        assert_eq!(listener_verdict(&[(true, "127.0.0.1:8123")], port), Ok(true));
        assert_eq!(
            listener_verdict(&[(true, "[::1]:8123")], port),
            Err("engine bound to [::1]:8123, expected 127.0.0.1".to_string()),
        );
        assert!(listener_verdict(&[(true, "127.0.0.1:8123"), (false, "*:8123")], port).is_err());
        assert!(listener_verdict(&[(false, "*:8123")], port).is_err());
    }

    #[test]
    fn lsof_entries_skips_garbage_and_preserves_order() {
        let text = "n*:8123\np12\nf4\nn127.0.0.1:8123\nn[::1]:8123\npbad\np13\nn*:8123\n";
        let entries = lsof_entries(text);
        assert_eq!(entries, vec![
            (12, "127.0.0.1:8123".to_string()),
            (12, "[::1]:8123".to_string()),
            (13, "*:8123".to_string()),
        ]);
    }

    #[test]
    fn stop_signals_the_group_after_the_leader_exits() {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 &"]).process_group(0).stdout(Stdio::null()).stderr(Stdio::null());
        let child = command.spawn().expect("spawn");
        let pid = child.id() as i32;
        unsafe { libc::setpgid(pid, pid); }
        std::thread::sleep(std::time::Duration::from_millis(300));
        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let mut running = Running { child, logs, program: PathBuf::from("sh"), group: pid };
        assert!(running.try_wait().expect("leader exits").is_some());
        running.stop(Duration::from_secs(2)).expect("group stops");
        assert!(group_gone(pid as u32), "the surviving group member was not stopped");
    }

    #[test]
    fn stop_reaps_a_group_before_the_grace_deadline() {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30"]).process_group(0).stdout(Stdio::null()).stderr(Stdio::null());
        let child = command.spawn().expect("spawn a group leader");
        let pid = child.id() as i32;
        unsafe { libc::setpgid(pid, pid); }
        assert!(group_owned(pid));
        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let mut running = Running { child, logs, program: PathBuf::from("sh"), group: pid };
        let started = Instant::now();
        running.stop(Duration::from_secs(2)).expect("stop succeeds");
        assert!(started.elapsed() < Duration::from_secs(2), "stop used the whole grace period");
        assert!(group_gone(pid as u32), "process group survived stop");
    }
}
