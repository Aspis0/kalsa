//! What the supervisor is asked to run, and the defaults it applies.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

/// How long the server gets to exit after stdin EOF, and again after SIGTERM.
pub const DEFAULT_STOP_GRACE: Duration = Duration::from_secs(5);
/// Conservative defaults for old hardware: the objective is the highest
/// throughput the machine can sustain, not its maximum.
pub const DEFAULT_BATCH: u32 = 512;
pub const DEFAULT_UBATCH: u32 = 128;
pub const DEFAULT_IDLE_SECONDS: u32 = 300;
pub const DEFAULT_CTX: u32 = 8192;

/// Half the logical cores, at least two and at most eight: a machine already
/// busy with a browser and an antivirus should not have every core saturated by
/// an inference server it is not using right now.
pub fn conservative_threads(logical_cores: usize) -> u16 {
    (logical_cores / 2).clamp(2, 8) as u16
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub exe: PathBuf,
    pub model: PathBuf,
    /// Where this instance announces itself, so a later start can recognise its
    /// own orphan instead of killing a stranger. See `instance`.
    pub state_file: PathBuf,
    pub port: u16,
    pub threads: u16,
    pub batch: u32,
    pub ubatch: u32,
    pub ctx: u32,
    pub idle_seconds: u32,
    pub ready_timeout: Duration,
    pub stop_grace: Duration,
}

impl ServerConfig {
    /// Loopback only, conservative thread/batch counts, idle unload on. The
    /// server is never exposed on the LAN: the phone reaches it through a
    /// tunnel, so there is no cleartext surface to reason about.
    pub fn arguments(&self) -> Vec<String> {
        vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            self.port.to_string(),
            "--model".into(),
            self.model.display().to_string(),
            "--threads".into(),
            self.threads.to_string(),
            "--threads-batch".into(),
            self.threads.to_string(),
            "--batch-size".into(),
            self.batch.to_string(),
            "--ubatch-size".into(),
            self.ubatch.to_string(),
            "--ctx-size".into(),
            self.ctx.to_string(),
            // Unloads the model and the KV cache after inactivity; /health,
            // /props and /models do not count as work, so a polling phone does
            // not keep the machine warm.
            "--sleep-idle-seconds".into(),
            self.idle_seconds.to_string(),
            "--no-webui".into(),
        ]
    }

    pub(crate) fn address(&self) -> SocketAddr {
        SocketAddr::from(([127, 0, 0, 1], self.port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ServerConfig {
        ServerConfig {
            exe: PathBuf::from("/nonexistent/llama-server"),
            model: PathBuf::from("/models/a.gguf"),
            state_file: PathBuf::from("/tmp/kalsa-brain.state"),
            port: 8123,
            threads: 4,
            batch: DEFAULT_BATCH,
            ubatch: DEFAULT_UBATCH,
            ctx: DEFAULT_CTX,
            idle_seconds: DEFAULT_IDLE_SECONDS,
            ready_timeout: Duration::from_secs(1),
            stop_grace: Duration::from_millis(50),
        }
    }

    #[test]
    fn arguments_stay_on_loopback_and_unload_when_idle() {
        let joined = config().arguments().join(" ");
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--sleep-idle-seconds 300"));
        assert!(joined.contains("--no-webui"));
        assert!(joined.contains("--model /models/a.gguf"));
        assert!(!joined.contains("0.0.0.0"));
    }

    #[test]
    fn threads_are_conservative() {
        assert_eq!(conservative_threads(1), 2);
        assert_eq!(conservative_threads(4), 2);
        assert_eq!(conservative_threads(8), 4);
        assert_eq!(conservative_threads(64), 8);
    }
}
