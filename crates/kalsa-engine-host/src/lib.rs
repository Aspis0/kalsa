//! Backend for installing and running the two supported local engines.

mod extract;
mod host;
mod install;
mod launch;
mod locks;
mod paths;
mod process;

pub use host::{EngineHost, EngineState, EngineStatus};
pub use install::ProgressFn;
pub use process::group_gone;

#[cfg(test)]
mod integration {
    use super::*;
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct Root {
        dir: PathBuf,
        previous: Option<OsString>,
    }

    impl Root {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("kalsa-m3-{name}-{}", std::process::id()));
            let previous = std::env::var_os("KALSA_ENGINES_ROOT");
            std::env::set_var("KALSA_ENGINES_ROOT", &dir);
            Self { dir, previous }
        }
    }

    impl Drop for Root {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var("KALSA_ENGINES_ROOT", value),
                None => std::env::remove_var("KALSA_ENGINES_ROOT"),
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn wait_running(host: &EngineHost, id: &str) -> EngineStatus {
        let deadline = Instant::now() + Duration::from_secs(600);
        loop {
            let status = host.status(id);
            match status.state {
                EngineState::Running => return status,
                EngineState::Exited | EngineState::Crashed => {
                    panic!("{id} exited before answering: {:?}", status.log_tail);
                }
                _ if Instant::now() >= deadline => {
                    panic!("{id} never answered in 600 s: {:?}", status.log_tail);
                }
                _ => std::thread::sleep(Duration::from_secs(1)),
            }
        }
    }

    fn check_models(host: &EngineHost, id: &str, status: &EngineStatus) {
        let port = status.port.expect("running engine has a port");
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
        let deadline = Instant::now() + Duration::from_secs(600);
        loop {
            match host.status(id).state {
                EngineState::Exited | EngineState::Crashed => {
                    panic!("{id} exited while waiting for models: {:?}", host.status(id).log_tail);
                }
                _ => {}
            }
            if let Ok(response) = agent.get(&format!("http://127.0.0.1:{port}/v1/models")).call() {
                if response.status() == 200 {
                    if let Ok(body) = response.into_string() {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(models) = value["data"].as_array() {
                                if !models.is_empty() { return; }
                            }
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                panic!("{id} never published a model in 600 s: {:?}", host.status(id).log_tail);
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    fn stop_and_check_group(root: &Root, host: &EngineHost, id: &str) {
        let pidfile = root.dir.join(".pids").join(format!("{id}.pid"));
        let text = std::fs::read_to_string(pidfile).expect("pidfile written at start");
        let leader: u32 = text.lines().next().unwrap().parse().expect("pid in pidfile");
        host.stop(id).expect("server stops");
        assert!(group_gone(leader), "process group {leader} is still alive");
    }

    fn run(id: &str, model: &str) {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let root = Root::new(id);
        let host = EngineHost::new().expect("catalog parses");
        let progress = |_: &str, _: u64, _: u64| {};
        host.install(id, &progress).expect("install succeeds");
        let started = host.start(id, model, &progress).expect("start succeeds");
        assert_eq!(started.state, EngineState::Starting);
        let running = wait_running(&host, id);
        check_models(&host, id, &running);
        stop_and_check_group(&root, &host, id);
    }

    #[test]
    #[ignore = "downloads a llama.cpp release and a tiny Hugging Face GGUF"]
    fn llama_cpp_installs_and_answers() {
        run("llama-cpp", "ggml-org/tiny-llamas");
    }

    #[test]
    #[ignore = "installs mlx-lm from the lock and downloads a tiny MLX model"]
    fn mlx_lm_installs_and_answers() {
        run("mlx-lm", "mlx-community/SmolLM2-135M-Instruct-8bit");
    }
}
