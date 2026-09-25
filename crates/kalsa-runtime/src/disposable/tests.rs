    use super::*;
    use kalsa_supervisor::pid_alive;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-disposable-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// A missing exe is the first of the two ways: the claim happens, the
    /// spawn fails, and the state file is released again.
    #[test]
    fn an_exe_that_cannot_spawn_is_a_did_not_start() {
        let root = scratch("missing-exe");
        let port = free_loopback_port().expect("a port");
        let error = match serve(
            &root,
            port,
            Path::new("/nonexistent/kalsa-server"),
            &[],
            Duration::from_secs(1),
        ) {
            Err(error) => error,
            Ok(_) => panic!("nothing to run"),
        };
        assert!(
            matches!(error, ServeError::DidNotStart),
            "{error:?}"
        );
        assert!(
            !crate::decide::state_file(&root).exists(),
            "a failed serve releases its claim"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A child that lives but never answers is the other way: the ready
    /// deadline ends it, and it is stopped, not leaked.
    #[cfg(unix)]
    #[test]
    fn a_child_that_never_answers_is_a_not_ready() {
        let root = scratch("not-ready");
        let port = free_loopback_port().expect("a port");
        let args = ["-c".to_string(), "exec sleep 30".to_string()];
        let error = match serve(
            &root,
            port,
            Path::new("/bin/sh"),
            &args,
            Duration::from_secs(1),
        ) {
            Err(error) => error,
            Ok(_) => panic!("nothing will answer /health"),
        };
        assert!(
            matches!(error, ServeError::NotReady { seconds: 1 }),
            "{error:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `ping -n` is the Windows sleeper: alive, never an HTTP answer.
    #[cfg(windows)]
    #[test]
    fn a_child_that_never_answers_is_a_not_ready() {
        let root = scratch("not-ready");
        let port = free_loopback_port().expect("a port");
        let args = ["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()];
        let error = match serve(
            &root,
            port,
            Path::new("ping"),
            &args,
            Duration::from_secs(1),
        ) {
            Err(error) => error,
            Ok(_) => panic!("nothing will answer /health"),
        };
        assert!(
            matches!(error, ServeError::NotReady { seconds: 1 }),
            "{error:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An exe that starts and dies before answering is the middle of the
    /// three exits: the child's own status carries the reason.
    #[cfg(unix)]
    #[test]
    fn a_child_that_dies_before_answering_is_a_did_not_start() {
        let root = scratch("early-exit");
        let port = free_loopback_port().expect("a port");
        let args = ["-c".to_string(), "exit 7".to_string()];
        let error = match serve(&root, port, Path::new("/bin/sh"), &args, Duration::from_secs(5)) {
            Err(error) => error,
            Ok(_) => panic!("nothing to answer"),
        };
        assert!(
            matches!(error, ServeError::DidNotStart),
            "an early exit is a DidNotStart, not {error:?}"
        );
        assert!(!crate::decide::state_file(&root).exists(), "released");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Dropping the handle is every other path: the child is stopped and
    /// reaped, the state file released — the GPU is free before the next
    /// candidate would spawn. The handle is built directly here (the test
    /// lives in this module): `serve`'s Ok path needs a server that
    /// answers `/health`, which only the real-server test has.
    #[cfg(unix)]
    #[test]
    fn dropping_the_handle_stops_the_child() {
        let root = scratch("drop");
        let port = free_loopback_port().expect("port");
        let state = crate::decide::state_file(&root);
        let instance = InstanceFile::claim(&state).expect("claim");
        let args = ["-c".to_string(), "exec sleep 30".to_string()];
        let running = OsLaunch
            .spawn(Path::new("/bin/sh"), &args, Some(instance.handle()))
            .expect("spawn");
        let pid = running.pid();
        let handle = Disposable {
            running,
            instance: Some(instance),
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            exited: false,
        };
        drop(handle);
        let deadline = Instant::now() + Duration::from_secs(5);
        while pid_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(child::TICK);
        }
        assert!(!pid_alive(pid), "the drop must reap pid {pid}");
        assert!(!state.exists(), "the drop must release the claim");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `ping -n` is the Windows sleeper: alive, never an HTTP answer, and
    /// dropped the same way.
    #[cfg(windows)]
    #[test]
    fn dropping_the_handle_stops_the_child() {
        let root = scratch("drop");
        let port = free_loopback_port().expect("port");
        let state = crate::decide::state_file(&root);
        let instance = InstanceFile::claim(&state).expect("claim");
        let args = ["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()];
        let running = OsLaunch
            .spawn(Path::new("ping"), &args, Some(instance.handle()))
            .expect("spawn");
        let pid = running.pid();
        let handle = Disposable {
            running,
            instance: Some(instance),
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            exited: false,
        };
        drop(handle);
        let deadline = Instant::now() + Duration::from_secs(5);
        while pid_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(child::TICK);
        }
        assert!(!pid_alive(pid), "the drop must reap pid {pid}");
        assert!(!state.exists(), "the drop must release the claim");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The handle remembers an exit it observed: Drop stops only a child
    /// nobody has seen go, because stop() signals the pid and a reaped pid
    /// may already be another program's.
    #[cfg(unix)]
    #[test]
    fn an_exit_seen_by_alive_is_not_signalled_again_on_drop() {
        let root = scratch("observed-exit");
        let port = free_loopback_port().expect("port");
        let state = crate::decide::state_file(&root);
        let instance = InstanceFile::claim(&state).expect("claim");
        let args = ["-c".to_string(), "exit 7".to_string()];
        let running = OsLaunch
            .spawn(Path::new("/bin/sh"), &args, Some(instance.handle()))
            .expect("spawn");
        let mut handle = Disposable {
            running,
            instance: Some(instance),
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            exited: false,
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        while handle.alive() && Instant::now() < deadline {
            std::thread::sleep(child::TICK);
        }
        assert!(handle.exited, "the observed exit must be recorded for Drop");
        drop(handle);
        assert!(!state.exists(), "the claim is released");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `ping -n 1` answers itself and exits: the Windows twin of the
    /// observed-exit contract.
    #[cfg(windows)]
    #[test]
    fn an_exit_seen_by_alive_is_not_signalled_again_on_drop() {
        let root = scratch("observed-exit");
        let port = free_loopback_port().expect("port");
        let state = crate::decide::state_file(&root);
        let instance = InstanceFile::claim(&state).expect("claim");
        let args = ["-n".to_string(), "1".to_string(), "127.0.0.1".to_string()];
        let running = OsLaunch
            .spawn(Path::new("ping"), &args, Some(instance.handle()))
            .expect("spawn");
        let mut handle = Disposable {
            running,
            instance: Some(instance),
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            exited: false,
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        while handle.alive() && Instant::now() < deadline {
            std::thread::sleep(child::TICK);
        }
        assert!(handle.exited, "the observed exit must be recorded for Drop");
        drop(handle);
        assert!(!state.exists(), "the claim is released");
        let _ = std::fs::remove_dir_all(&root);
    }

