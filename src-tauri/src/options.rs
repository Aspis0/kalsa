use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use kalsa_launch::{
    KvCache, ServerSettings, DEFAULT_IDLE_UNLOAD_SECONDS, MAX_BATCH, MAX_IDLE_UNLOAD_SECONDS,
    MAX_UBATCH, MIN_BATCH, MIN_IDLE_UNLOAD_SECONDS, MIN_UBATCH,
};
use serde::{Deserialize, Serialize};

use crate::startup::LaunchInfo;

pub(crate) const MIN_CONTEXT_TOKENS: u64 = 512;

/// Reads the saved cache name, treating anything this build does not know as
/// "automatic". Only this field is forgiving: a cache type a future or older
/// build writes must not take the owner's context and idle choices with it,
/// while genuinely malformed JSON is still the whole file's problem and
/// [`load`] still falls back to defaults.
fn deserialize_cache<'de, D>(deserializer: D) -> Result<Option<KvCache>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(raw.as_str().and_then(KvCache::parse))
}

/// The only launch values the owner may change. Context can only go down from
/// the budgeted maximum; idle time stays between one minute and one hour.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) struct LaunchOverrides {
    pub(crate) context_tokens: Option<u64>,
    pub(crate) idle_unload_seconds: Option<u32>,
    /// The logical prompt batch the owner saved, if any. `#[serde(default)]`
    /// so files written before the knob existed still load.
    #[serde(default)]
    pub(crate) batch_size: Option<u32>,
    /// The micro-batch the owner saved, if any.
    #[serde(default)]
    pub(crate) ubatch_size: Option<u32>,
    /// The KV cache precision the owner saved, if any. An unknown name
    /// degrades to "automatic" rather than discarding the rest of the file.
    #[serde(default, deserialize_with = "deserialize_cache")]
    pub(crate) kv_cache: Option<KvCache>,
    /// Whether the computer may open its second, internet-facing road at
    /// all. Opening it announces the machine on a public directory service,
    /// which is not a thing consent may be presumed from: the default is
    /// off. `#[serde(default)]` so files written before the switch existed
    /// keep loading — a missing field reads as the owner never having
    /// asked for the road, which is the truth.
    #[serde(default)]
    pub(crate) internet_road: bool,
    /// The model the owner picked, as the opaque token the capability page was
    /// handed (`startup::model_token`). `None` — the default, and what an
    /// unknown token degrades to at launch — means this computer keeps
    /// choosing for itself. It is stored as the token and not as a name or a
    /// size: only the backend can turn a token back into a catalog row, and
    /// only one row answers to it.
    #[serde(default)]
    pub(crate) model: Option<String>,
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
        // A file this build cannot make sense of is no preferences at all —
        // including the model choice, which is the field most likely to be
        // written by a newer build.
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
    /// Checked in place: the choice it carries is a value, not a thing to
    /// spend, and the callers that validate then keep the value had to clone it
    /// while this took `self`.
    pub(crate) fn validate(&self) -> Result<(), String> {
        if let Some(context) = self.context_tokens {
            // Only the floor is fixed here: the ceiling is the machine's
            // funded maximum — 262_144 for the row on disk on this Mac — and
            // this value cannot know it. A fixed ceiling must not come back,
            // because the machine funds far more than any constant would
            // admit. The ceiling is enforced where the maximum is known:
            // `startup`'s `ContextTooLarge` guard on the launch path and the
            // save guard in `main`, both of which name the real number.
            if context < MIN_CONTEXT_TOKENS {
                return Err(format!(
                    "Context must be at least {MIN_CONTEXT_TOKENS} tokens."
                ));
            }
        }
        if let Some(seconds) = self.idle_unload_seconds {
            if !(MIN_IDLE_UNLOAD_SECONDS..=MAX_IDLE_UNLOAD_SECONDS).contains(&seconds) {
                return Err("Idle time must be between 60 seconds and 1 hour.".to_string());
            }
        }
        // The micro-batch ceiling is a measurement, not a preference: 1024
        // fits the 512 MiB compute-buffer forfait and 2048 does not. The
        // refusal carries both numbers.
        if let Some(ubatch) = self.ubatch_size {
            if !(MIN_UBATCH..=MAX_UBATCH).contains(&ubatch) {
                return Err("The micro-batch must be between 64 and 1024. At 2048 the compute buffers measured 602 MiB, above the 512 MiB this computer keeps for them.".to_string());
            }
        }
        if let Some(batch) = self.batch_size {
            if !(MIN_BATCH..=MAX_BATCH).contains(&batch) {
                return Err("The batch must be between 64 and 8192.".to_string());
            }
        }
        // A batch below the micro-batch is not a value the server can honour;
        // the rule compares the values that would actually be launched — the
        // override when set, the shipped default otherwise — and names both.
        let automatic = ServerSettings::defaults(DEFAULT_IDLE_UNLOAD_SECONDS);
        let batch = self.batch_size.unwrap_or(automatic.batch_size);
        let ubatch = self.ubatch_size.unwrap_or(automatic.ubatch_size);
        if batch < ubatch {
            return Err(format!(
                "The batch ({batch}) cannot be smaller than the micro-batch ({ubatch})."
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
pub(crate) struct AdvancedDto {
    pub(crate) context_tokens: Option<u64>,
    pub(crate) context_max: Option<u64>,
    /// The funded maximum under the f16 cache, shown beside the cache knob so
    /// the panel recomputes the context from Rust's arithmetic instead of
    /// inventing its own.
    pub(crate) context_max_f16: Option<u64>,
    /// What the launcher picks with no owner choice, under the cache in force
    /// and under f16: the panel shows this beside the control, so "Automatic"
    /// names the figure it will actually use rather than a blank.
    pub(crate) context_automatic: Option<u64>,
    pub(crate) context_automatic_f16: Option<u64>,
    /// The launcher's own KV price for the running row, per cache type: bytes
    /// per token of context, and the fixed per-slot term already summed over
    /// the slots. The panel multiplies the first by the length the owner is
    /// showing and adds the second, so the memory it displays is the
    /// launcher's arithmetic and never a second one.
    pub(crate) kv_bytes_per_token: Option<u64>,
    pub(crate) kv_bytes_per_token_f16: Option<u64>,
    pub(crate) kv_bytes_fixed: Option<u64>,
    pub(crate) kv_bytes_fixed_f16: Option<u64>,
    pub(crate) context_override: Option<u64>,
    pub(crate) idle_unload_seconds: u32,
    pub(crate) idle_override: Option<u32>,
    pub(crate) batch_size: u32,
    pub(crate) ubatch_size: u32,
    pub(crate) batch_override: Option<u32>,
    pub(crate) ubatch_override: Option<u32>,
    pub(crate) batch_automatic: u32,
    pub(crate) ubatch_automatic: u32,
    pub(crate) kv_cache_type: &'static str,
    pub(crate) kv_cache_override: Option<&'static str>,
    pub(crate) kv_cache_automatic: &'static str,
    pub(crate) flash_attention: &'static str,
    pub(crate) gpu_layers: Option<String>,
    pub(crate) threads: Option<usize>,
    pub(crate) threads_batch: Option<usize>,
    pub(crate) door_port: Option<u16>,
    /// The pairing desk's own loopback port and whether it is the
    /// preferred one, for the Tailscale note the panel gives beside the
    /// door's. `None` only when the desk listener does not exist at all;
    /// a desk on a fallback port must be said, because the owner's
    /// standing serve rule keeps pointing at the preferred one.
    pub(crate) desk_port: Option<u16>,
    pub(crate) desk_port_preferred: bool,
    /// The second road to the door, in words for being human. Absent
    /// secrets: the node id is public, failures are the road's own.
    pub(crate) iroh_sentence: String,
    pub(crate) internet_road: bool,
    pub(crate) running: bool,
}

pub(crate) fn dto(
    overrides: LaunchOverrides,
    active: Option<&LaunchInfo>,
    door_port: Option<u16>,
    iroh_sentence: String,
) -> AdvancedDto {
    let idle = overrides
        .idle_unload_seconds
        .unwrap_or(DEFAULT_IDLE_UNLOAD_SECONDS);
    // The automatic values are the shipped defaults, shown as themselves: the
    // panel must not become a second source of truth for 2048/512/q8_0.
    let automatic = ServerSettings::defaults(idle);
    let (settings, context_tokens, running) = match active {
        Some(info) => (info.args.settings(), Some(info.args.context_tokens), true),
        // "Next start": the owner's saved overrides on top of the automatic
        // values, or the panel would report 2048/512/q8_0 while the file says
        // otherwise.
        None => (
            ServerSettings {
                batch_size: overrides.batch_size.unwrap_or(automatic.batch_size),
                ubatch_size: overrides.ubatch_size.unwrap_or(automatic.ubatch_size),
                kv_cache_type: overrides.kv_cache.unwrap_or_default().flag(),
                ..automatic
            },
            overrides.context_tokens,
            false,
        ),
    };
    // The maximum, the automatic figure and the price each follow the cache
    // type the running args carry — the guard and the panel must read the
    // same number — with the f16 copy beside them for the cache knob.
    let running_cache = active.map(|info| info.args.kv_cache).unwrap_or_default();
    let price = active.and_then(|info| info.context_prices.for_cache(running_cache));
    let price_f16 = active.and_then(|info| info.context_prices.f16);
    AdvancedDto {
        context_tokens,
        context_max: active.and_then(|info| info.maximum_context.for_cache(running_cache)),
        context_max_f16: active.and_then(|info| info.maximum_context.f16),
        context_automatic: active
            .and_then(|info| info.automatic_context.for_cache(running_cache)),
        context_automatic_f16: active.and_then(|info| info.automatic_context.f16),
        kv_bytes_per_token: price.map(|price| price.bytes_per_token),
        kv_bytes_per_token_f16: price_f16.map(|price| price.bytes_per_token),
        kv_bytes_fixed: price.map(|price| price.bytes_fixed),
        kv_bytes_fixed_f16: price_f16.map(|price| price.bytes_fixed),
        context_override: overrides.context_tokens,
        idle_unload_seconds: settings.idle_unload_seconds,
        idle_override: overrides.idle_unload_seconds,
        batch_size: settings.batch_size,
        ubatch_size: settings.ubatch_size,
        batch_override: overrides.batch_size,
        ubatch_override: overrides.ubatch_size,
        batch_automatic: automatic.batch_size,
        ubatch_automatic: automatic.ubatch_size,
        kv_cache_type: settings.kv_cache_type,
        kv_cache_override: overrides.kv_cache.map(KvCache::flag),
        kv_cache_automatic: automatic.kv_cache_type,
        flash_attention: settings.flash_attention,
        gpu_layers: settings.gpu_layers.map(str::to_string),
        threads: settings.threads,
        threads_batch: settings.threads_batch,
        door_port,
        desk_port: None,
        desk_port_preferred: false,
        iroh_sentence,
        internet_road: overrides.internet_road,
        running,
    }
}

impl AdvancedDto {
    /// The desk's port facts, applied where they belong: at the command
    /// layer, which is the only place that can see the desk - not through
    /// the settings signature that computes everything else here.
    pub(crate) fn with_desk_port(mut self, desk_port: Option<(u16, bool)>) -> Self {
        match desk_port {
            Some((port, preferred)) => {
                self.desk_port = Some(port);
                self.desk_port_preferred = preferred;
            }
            None => self.desk_port = None,
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::{dto, load, path_for, save, write_atomic, KvCache, LaunchOverrides};
    use crate::startup::{ContextMaxima, ContextPrices, LaunchInfo};
    use kalsa_launch::{ContextPrice, ServerArgs};
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
            model: None,
            context_tokens: Some(4096),
            idle_unload_seconds: Some(600),
            batch_size: Some(1024),
            ubatch_size: Some(256),
            kv_cache: Some(KvCache::F16),
            internet_road: true,
        };
        save(&state_file, values.clone()).expect("save advanced settings");
        assert_eq!(load(&state_file), values);
        assert!(path_for(&state_file).exists());
        assert_eq!(KvCache::parse("f16"), Some(KvCache::F16));
        assert_eq!(KvCache::parse("nonsense"), None);
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

        // A file written before the switch existed still loads: the missing
        // field is the owner never having asked for the road.
        fs::write(
            path_for(&state_file),
            br#"{"context_tokens": 4096, "idle_unload_seconds": 600}"#,
        )
        .expect("write pre-switch settings");
        let loaded = load(&state_file);
        assert_eq!(loaded.context_tokens, Some(4096));
        assert!(
            !loaded.internet_road,
            "a missing switch is a closed road"
        );
        // The same file predates the batch, micro-batch and cache knobs: a
        // missing key is "automatic", never an invented value.
        assert_eq!(loaded.batch_size, None);
        assert_eq!(loaded.ubatch_size, None);
        assert_eq!(loaded.kv_cache, None);
    }

    #[test]
    fn an_unknown_cache_name_does_not_discard_the_other_settings() {
        let state_file = scratch("unknown-cache");
        // A cache type this build does not know (a future build's q4_0, or a
        // typo) must degrade to "automatic" for that one field. It must not
        // take the owner's context and idle choices with it.
        fs::write(
            path_for(&state_file),
            br#"{"context_tokens": 4096, "idle_unload_seconds": 600, "kv_cache": "q4_0"}"#,
        )
        .expect("write an unknown cache type");
        let loaded = load(&state_file);
        assert_eq!(loaded.context_tokens, Some(4096));
        assert_eq!(loaded.idle_unload_seconds, Some(600));
        assert_eq!(
            loaded.kv_cache, None,
            "an unknown cache name degrades to automatic"
        );
    }

    #[test]
    fn a_micro_batch_above_the_measured_ceiling_is_refused_with_the_number() {
        let overrides = LaunchOverrides {
            ubatch_size: Some(2048),
            ..LaunchOverrides::default()
        };
        let spoken = overrides
            .validate()
            .expect_err("2048 micro-batch exceeds the measured ceiling");
        assert!(
            spoken.contains("1024"),
            "the refusal must name the ceiling: {spoken}"
        );
        assert!(
            spoken.contains("602"),
            "the refusal must carry the measurement: {spoken}"
        );
    }

    #[test]
    fn a_batch_below_the_automatic_microbatch_names_both_numbers() {
        let overrides = LaunchOverrides {
            batch_size: Some(256),
            ..LaunchOverrides::default()
        };
        let spoken = overrides
            .validate()
            .expect_err("256 cannot carry the automatic 512 micro-batch");
        assert!(spoken.contains("256"), "{spoken}");
        assert!(spoken.contains("512"), "{spoken}");
    }

    /// The regression lock on the fixed 32768 ceiling: a value above it must
    /// be accepted here — it is an eighth of the 262144 this machine funds
    /// for the row on disk — because only the floor is fixed. The ceiling
    /// belongs to the guards that know the machine's funded maximum.
    #[test]
    fn a_context_above_the_old_panel_cap_is_accepted_here_and_left_to_the_machines_guard() {
        let high = LaunchOverrides {
            context_tokens: Some(262_144),
            ..LaunchOverrides::default()
        };
        assert!(
            high.validate().is_ok(),
            "the fixed 32768 cap must not come back: {}",
            high.validate().unwrap_err()
        );
        let below = LaunchOverrides {
            context_tokens: Some(super::MIN_CONTEXT_TOKENS - 1),
            ..LaunchOverrides::default()
        };
        assert!(below.validate().is_err(), "the floor still holds");
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
            internet_road: true,
            ..LaunchOverrides::default()
        };
        let b = LaunchOverrides {
            context_tokens: Some(2048),
            idle_unload_seconds: None,
            internet_road: false,
            ..LaunchOverrides::default()
        };
        // The readers start before any writer has published: seed the file,
        // or the first reads would honestly see "no file", which is a state
        // this test does not investigate.
        save(&state_file, a.clone()).expect("seed the file with a whole value");
        std::thread::scope(|scope| {
            for values in [a.clone(), b.clone()] {
                for _ in 0..2 {
                    let values = values.clone();
                    let writer_state = state_file.clone();
                    scope.spawn(move || {
                        for _ in 0..40 {
                            save(&writer_state, values.clone()).expect("concurrent save");
                            std::thread::yield_now();
                        }
                    });
                }
            }
            for _ in 0..2 {
                let reader_state = state_file.clone();
                let (a, b) = (a.clone(), b.clone());
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

    /// The field names of an object and the JSON type of each value.
    fn field_types(value: &serde_json::Value) -> std::collections::BTreeMap<String, &'static str> {
        value
            .as_object()
            .expect("the advanced dto is a JSON object")
            .iter()
            .map(|(name, value)| (name.clone(), json_type(value)))
            .collect()
    }

    fn json_type(value: &serde_json::Value) -> &'static str {
        match value {
            serde_json::Value::Null => "null",
            serde_json::Value::Bool(_) => "boolean",
            serde_json::Value::Number(_) => "number",
            serde_json::Value::String(_) => "string",
            serde_json::Value::Array(_) => "array",
            serde_json::Value::Object(_) => "object",
        }
    }

    /// The advanced JSON the panel reads is a contract, pinned here for the
    /// harness to validate its fixtures against. The names and the JSON types
    /// are compared by field, so a rename names itself; the whole sample is
    /// then compared by value, because a test that rewrites its own fixture
    /// cannot go red on drift — a quietly changed default is exactly the
    /// change that must be regenerated deliberately, not waved through.
    #[test]
    fn the_json_the_advanced_page_reads_is_a_contract_pinned_here() {
        // A realistic answer: a server running, with the owner's overrides
        // saved for context, micro-batch and the f16 cache, so the sample
        // exercises the interesting fields rather than a row of nulls.
        let args = ServerArgs {
            model_path: PathBuf::from("/models/chosen.gguf"),
            port: 8130,
            context_tokens: 4096,
            cache_ram_mib: 1024,
            threads: Some(8),
            offload: kalsa_launch::Offload::All,
            idle_unload_seconds: 600,
            batch_size: 2048,
            ubatch_size: 1024,
            kv_cache: KvCache::F16,
            parallel: kalsa_launch::DEFAULT_PARALLEL,
            slot_save_path: PathBuf::from("/slots"),
        };
        let maxima = ContextMaxima {
            // The real machine's figures for the row on disk: a maximum well
            // above the 32768 the panel used to refuse at, so the pinned
            // sample shows that the ceiling is the machine's.
            q8_0: Some(262_144),
            f16: Some(131_072),
        };
        let sample = dto(
            LaunchOverrides {
                model: None,
                context_tokens: Some(4096),
                idle_unload_seconds: Some(600),
                batch_size: Some(2048),
                ubatch_size: Some(1024),
                kv_cache: Some(KvCache::F16),
                internet_road: true,
            },
            Some(&LaunchInfo {
                args,
                maximum_context: maxima,
                // The automatic figures the panel will show as "Automatic":
                // the chat default where the machine funds it.
                automatic_context: ContextMaxima {
                    q8_0: Some(65_536),
                    f16: Some(65_536),
                },
                context_prices: ContextPrices {
                    q8_0: Some(ContextPrice {
                        bytes_per_token: 40_960,
                        bytes_fixed: 65_863_680,
                    }),
                    f16: Some(ContextPrice {
                        bytes_per_token: 81_920,
                        bytes_fixed: 65_863_680,
                    }),
                },
                display_name: Some("Alibaba Qwen 3.6".to_string()),
                reason: Some("It is the more capable of the two.".to_string()),
                model_sha256: None,
            }),
            Some(8130),
            "The internet road is open.".to_string(),
        )
        .with_desk_port(Some((8134, true)));
        let json = serde_json::to_value(&sample).expect("serialise the advanced dto");
        println!(
            "{}",
            serde_json::to_string_pretty(&sample).expect("serialise")
        );

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../chat/scripts/advanced-contract.json");
        let Ok(text) = fs::read_to_string(&path) else {
            panic!(
                "the advanced contract is missing: create {} from the JSON printed above",
                path.display()
            );
        };
        let contract: serde_json::Value =
            serde_json::from_str(&text).expect("the contract file is json");

        let pinned = field_types(&contract["sample"]);
        let actual = field_types(&json);
        let mut problems: Vec<String> = Vec::new();
        for (name, kind) in &actual {
            match pinned.get(name) {
                None => problems.push(format!("appeared: {name} ({kind})")),
                Some(pinned_kind) if pinned_kind != kind => {
                    problems.push(format!("type changed: {name}: {pinned_kind} -> {kind}"))
                }
                _ => {}
            }
        }
        for name in pinned.keys() {
            if !actual.contains_key(name) {
                problems.push(format!("vanished: {name}"));
            }
        }
        assert!(
            problems.is_empty(),
            "the advanced DTO no longer matches chat/scripts/advanced-contract.json:\n  {}",
            problems.join("\n  ")
        );

        // The fixture the harness reads is pinned under the one convention:
        // compare and fail, regenerate only on purpose. The field types
        // above name what moved; this comparison catches every other drift
        // between the type and the stored sample. UPDATE_CONTRACT=1
        // replaces only the sample, and the hand-written keys beside it stay.
        crate::contract::check_sample(
            &path,
            "the_json_the_advanced_page_reads_is_a_contract_pinned_here",
            &json,
        );
    }
}
