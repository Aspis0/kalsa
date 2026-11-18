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
    pub port: u16,
    pub program: PathBuf,
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

/// Our argv always carries `--host 127.0.0.1`; there is no runtime binding
/// verification because the command line is ours, not user input.
pub fn start(launch: Launch, port: u16, root: &Path) -> Result<Running, String> {
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
    Ok(Running { child, logs, port, program: launch.program })
}

pub fn reachable(port: u16) -> bool {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).build();
    matches!(agent.get(&format!("http://127.0.0.1:{port}/v1/models")).call(), Ok(_))
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
        if self.child.try_wait().map_err(|error| error.to_string())?.is_some() { return Ok(()); }
        let leader = self.child.id() as i32;
        if !group_owned(leader) { return Ok(()); }
        signal_group(leader, libc::SIGTERM)?;
        if self.wait_and_reap(leader, Instant::now() + grace) { return Ok(()); }
        if !group_owned(leader) { return Ok(()); }
        signal_group(leader, libc::SIGKILL)?;
        if !self.wait_and_reap(leader, Instant::now() + grace) {
            return Err("process group did not stop before the deadline".to_string());
        }
        Ok(())
    }

    /// Reaping the leader on every poll is essential: a zombie still counts
    /// as a member of its process group until `try_wait` removes it.
    fn wait_and_reap(&mut self, leader: i32, deadline: Instant) -> bool {
        loop {
            if matches!(self.child.try_wait(), Ok(Some(_))) { return true; }
            if unsafe { libc::kill(-leader, 0) } != 0 { return true; }
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
    fn stop_reaps_a_group_before_the_grace_deadline() {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30"]).process_group(0).stdout(Stdio::null()).stderr(Stdio::null());
        let child = command.spawn().expect("spawn a group leader");
        let pid = child.id() as i32;
        unsafe { libc::setpgid(pid, pid); }
        assert!(group_owned(pid));
        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let mut running = Running { child, logs, port: 0, program: PathBuf::from("sh") };
        let started = Instant::now();
        running.stop(Duration::from_secs(2)).expect("stop succeeds");
        assert!(started.elapsed() < Duration::from_secs(2), "stop used the whole grace period");
        assert!(group_gone(pid as u32), "process group survived stop");
    }
}
