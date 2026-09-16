use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use kalsa_launch::{
    ServerArgs, ServerSettings, DEFAULT_IDLE_UNLOAD_SECONDS, MAX_IDLE_UNLOAD_SECONDS,
    MIN_IDLE_UNLOAD_SECONDS,
};
use serde::{Deserialize, Serialize};

pub(crate) const MIN_CONTEXT_TOKENS: u64 = 512;
pub(crate) const MAX_CONTEXT_TOKENS: u64 = 32_768;

/// The only launch values the owner may change. Context can only go down from
/// the budgeted maximum; idle time stays between one minute and one hour.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) struct LaunchOverrides {
    pub(crate) context_tokens: Option<u64>,
    pub(crate) idle_unload_seconds: Option<u32>,
}

pub(crate) fn load(state_file: &Path) -> LaunchOverrides {
    let path = path_for(state_file);
    let Ok(bytes) = fs::read(path) else {
        return LaunchOverrides::default();
    };
    let Ok(overrides) = serde_json::from_slice::<LaunchOverrides>(&bytes) else {
        return LaunchOverrides::default();
    };
    if overrides.validate().is_ok() {
        overrides
    } else {
        LaunchOverrides::default()
    }
}

pub(crate) fn save(state_file: &Path, overrides: LaunchOverrides) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(&overrides)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    write_atomic(&path_for(state_file), &bytes, |_| Ok(()))
}

fn path_for(state_file: &Path) -> PathBuf {
    state_file.with_file_name("advanced.json")
}

/// Distinct temporary names, one per save: two saves sharing a temporary can
/// interleave their writes and publish a torn file, which [`load`] would read
/// as defaults — the owner's choices silently reset. The pid separates app
/// instances writing the same directory; the counter separates this
/// instance's saves. The temporary stays beside the destination, so the
/// rename never crosses a filesystem.
static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn write_atomic(
    path: &Path,
    bytes: &[u8],
    before_rename: impl FnOnce(&Path) -> io::Result<()>,
) -> io::Result<()> {
    let temporary = path.with_extension(format!(
        "json.tmp.{}.{}",
        std::process::id(),
        TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        before_rename(&temporary)?;
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temporary, path)
}

#[cfg(windows)]
fn replace_file(temporary: &Path, path: &Path) -> io::Result<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(once(0)).collect();
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
    let flags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH;
    if unsafe { MoveFileExW(temporary.as_ptr(), path.as_ptr(), flags) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

impl LaunchOverrides {
    pub(crate) fn validate(self) -> Result<(), &'static str> {
        if let Some(context) = self.context_tokens {
            if !(MIN_CONTEXT_TOKENS..=MAX_CONTEXT_TOKENS).contains(&context) {
                return Err("Context must be between 512 and 32768 tokens.");
            }
        }
        if let Some(seconds) = self.idle_unload_seconds {
            if !(MIN_IDLE_UNLOAD_SECONDS..=MAX_IDLE_UNLOAD_SECONDS).contains(&seconds) {
                return Err("Idle time must be between 60 seconds and 1 hour.");
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
pub(crate) struct AdvancedDto {
    pub(crate) context_tokens: Option<u64>,
    pub(crate) context_max: Option<u64>,
    pub(crate) context_override: Option<u64>,
    pub(crate) idle_unload_seconds: u32,
    pub(crate) idle_override: Option<u32>,
    pub(crate) batch_size: u32,
    pub(crate) ubatch_size: u32,
    pub(crate) kv_cache_type: &'static str,
    pub(crate) flash_attention: &'static str,
    pub(crate) gpu_layers: Option<String>,
    pub(crate) threads: Option<usize>,
    pub(crate) threads_batch: Option<usize>,
    pub(crate) door_port: Option<u16>,
    pub(crate) running: bool,
}

pub(crate) fn dto(
    overrides: LaunchOverrides,
    active: Option<(&ServerArgs, Option<u64>)>,
    door_port: Option<u16>,
) -> AdvancedDto {
    let idle = overrides
        .idle_unload_seconds
        .unwrap_or(DEFAULT_IDLE_UNLOAD_SECONDS);
    let (settings, context_tokens, context_max, running) = match active {
        Some((args, maximum_context)) => (
            args.settings(),
            Some(args.context_tokens),
            maximum_context,
            true,
        ),
        None => (
            ServerSettings::defaults(idle),
            overrides.context_tokens,
            None,
            false,
        ),
    };
    AdvancedDto {
        context_tokens,
        context_max,
        context_override: overrides.context_tokens,
        idle_unload_seconds: settings.idle_unload_seconds,
        idle_override: overrides.idle_unload_seconds,
        batch_size: settings.batch_size,
        ubatch_size: settings.ubatch_size,
        kv_cache_type: settings.kv_cache_type,
        flash_attention: settings.flash_attention,
        gpu_layers: settings.gpu_layers.map(str::to_string),
        threads: settings.threads,
        threads_batch: settings.threads_batch,
        door_port,
        running,
    }
}

#[cfg(test)]
mod tests {
    use super::{load, path_for, save, write_atomic, LaunchOverrides};
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "kalsa-brain-advanced-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("mkdir");
        directory.join("server.state")
    }

    #[test]
    fn saved_values_round_trip_beside_the_state_file() {
        let state_file = scratch("round-trip");
        let values = LaunchOverrides {
            context_tokens: Some(4096),
            idle_unload_seconds: Some(600),
        };
        save(&state_file, values).expect("save advanced settings");
        assert_eq!(load(&state_file), values);
        assert!(path_for(&state_file).exists());
    }

    #[test]
    fn absent_malformed_and_invalid_values_use_defaults() {
        let state_file = scratch("invalid");
        let defaults = LaunchOverrides::default();
        assert_eq!(load(&state_file), defaults);

        fs::write(path_for(&state_file), b"not json").expect("write malformed settings");
        assert_eq!(load(&state_file), defaults);

        fs::write(
            path_for(&state_file),
            br#"{"context_tokens": 1, "idle_unload_seconds": 600}"#,
        )
        .expect("write invalid settings");
        assert_eq!(load(&state_file), defaults);
    }

    #[test]
    fn atomic_write_keeps_the_old_file_until_the_new_one_is_ready() {
        let state_file = scratch("atomic");
        let path = path_for(&state_file);
        fs::write(&path, b"old settings").expect("write old settings");
        write_atomic(&path, b"new settings", |temporary| {
            assert_eq!(fs::read(&path).expect("read old settings"), b"old settings");
            assert_eq!(
                fs::read(temporary).expect("read temporary settings"),
                b"new settings"
            );
            Ok(())
        })
        .expect("publish settings");
        assert_eq!(fs::read(path).expect("read new settings"), b"new settings");
    }

    #[test]
    fn concurrent_saves_publish_only_whole_files_that_were_asked_for() {
        // Two saves racing for one file: whatever is published must be a
        // whole `a` or a whole `b` at every instant a reader can look, not
        // just at the end — a torn file that is overwritten a moment later
        // still had one reader window in which `load` reads it as defaults,
        // silently resetting the owner's choices.
        let state_file = scratch("concurrent");
        let a = LaunchOverrides {
            context_tokens: Some(1024),
            idle_unload_seconds: Some(600),
        };
        let b = LaunchOverrides {
            context_tokens: Some(2048),
            idle_unload_seconds: None,
        };
        // The readers start before any writer has published: seed the file,
        // or the first reads would honestly see "no file", which is a state
        // this test does not investigate.
        save(&state_file, a).expect("seed the file with a whole value");
        std::thread::scope(|scope| {
            for values in [a, b] {
                for _ in 0..2 {
                    let writer_state = state_file.clone();
                    scope.spawn(move || {
                        for _ in 0..40 {
                            save(&writer_state, values).expect("concurrent save");
                            std::thread::yield_now();
                        }
                    });
                }
            }
            for _ in 0..2 {
                let reader_state = state_file.clone();
                scope.spawn(move || {
                    for _ in 0..4000 {
                        let observed = load(&reader_state);
                        assert!(
                            observed == a || observed == b,
                            "a torn file was published: {observed:?}"
                        );
                        std::thread::yield_now();
                    }
                });
            }
        });
        let observed = load(&state_file);
        assert!(
            observed == a || observed == b,
            "the last writer left something else behind: {observed:?}"
        );
    }
}
