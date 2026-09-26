//! The first run: Test's plan, remembered so Allow fetches exactly what the
//! consent screen showed, and the refusal that keeps every other turn-on
//! from downloading anything before a choice exists.

use std::path::Path;

use kalsa_catalog::ModelEntry;
use serde::Serialize;

use crate::failure::StartupFailure;
use crate::startup::{self, Machine};

/// Allow pressed with no Test behind it in this run of the app.
const NO_PLAN: &str = "Kalsa has not tested this computer yet. Press Start first.";

/// What Test found, kept in memory for Allow: the machine it measured, the
/// models it listed in the order it listed them, and what they still need.
#[derive(Clone)]
pub(crate) struct Plan {
    machine: Machine,
    entries: Vec<&'static ModelEntry>,
    missing_bytes: u64,
}

/// Test's answer on the wire.
#[derive(Serialize)]
pub(crate) struct TestPlanDto {
    /// Engine bytes still to fetch; zero when every candidate build and
    /// the probe model are already here.
    engine_bytes: u64,
    options: Vec<OptionDto>,
    /// Why this computer can run nothing, when that is the answer.
    refusal: Option<String>,
    /// Everything Allow would download: missing engine plus missing models.
    total_bytes: u64,
}

#[derive(Serialize)]
struct OptionDto {
    id: String,
    name: &'static str,
    weights_bytes: u64,
    on_disk: bool,
}

/// Test's pricing, once the machine is measured: every piece against the
/// disk. A present model file is hashed whole, so this runs on a blocking
/// thread. No plan comes back when there is nothing to allow.
pub(crate) fn survey(
    machine: Machine,
    entries: Vec<&'static ModelEntry>,
    refusal: Option<String>,
    root: &Path,
) -> Result<(Option<Plan>, TestPlanDto), StartupFailure> {
    let engine_bytes = engine_missing_bytes(machine.measurement.will_run_on)
        .ok_or(StartupFailure::NoBuildForThisMachine)?;
    let options: Vec<OptionDto> = entries
        .iter()
        .map(|entry| OptionDto {
            id: startup::model_token(entry),
            name: entry.display_name,
            weights_bytes: entry.weights_bytes,
            on_disk: startup::model_on_disk(root, entry),
        })
        .collect();
    let total_bytes = engine_bytes
        + options
            .iter()
            .filter(|option| !option.on_disk)
            .map(|option| option.weights_bytes)
            .sum::<u64>();
    let plan = (!entries.is_empty()).then(|| Plan {
        machine,
        entries,
        missing_bytes: total_bytes,
    });
    let dto = TestPlanDto {
        engine_bytes,
        options,
        refusal,
        total_bytes,
    };
    Ok((plan, dto))
}

/// `decide` may try every candidate build, so the most it could fetch is
/// all of the missing ones.
fn engine_missing_bytes(detected: kalsa_probe::Backend) -> Option<u64> {
    let platform = kalsa_runtime::Platform::current()?;
    let candidates = kalsa_runtime::candidates_for(Some(platform), detected);
    if candidates.is_empty() {
        return None;
    }
    kalsa_runtime::engine_missing_bytes(platform, &candidates)
}

/// Allow: one walk per model the remembered plan lists, in its order, and
/// nothing else. `free_bytes` is `None` when the platform would not say.
pub(crate) fn allow(
    plan: Option<&Plan>,
    free_bytes: Option<u64>,
    mut walk: impl FnMut(&Machine, &'static ModelEntry, String) -> Result<(), String>,
) -> Result<(), String> {
    let plan = plan.ok_or_else(|| NO_PLAN.to_string())?;
    if free_bytes.is_some_and(|free| free < plan.missing_bytes) {
        let gib = (plan.missing_bytes as f64 / 1_073_741_824.0).ceil();
        return Err(format!(
            "Kalsa needs {gib} GiB free on this computer's disk to download what it listed. \
             Free some space and press Try again."
        ));
    }
    let total = plan.entries.len();
    for (index, entry) in plan.entries.iter().enumerate() {
        let label = format!("Model {} of {total}: {}", index + 1, entry.display_name);
        walk(&plan.machine, entry, label)?;
    }
    Ok(())
}

/// Checked before a turn-on walks at all — no measuring, no engine, no
/// model: without a stored choice or a development override there is
/// nothing anyone agreed to download.
pub(crate) fn require_choice(state_file: &Path, dev_override: bool) -> Result<(), StartupFailure> {
    if dev_override || crate::options::load(state_file).model.is_some() {
        Ok(())
    } else {
        Err(StartupFailure::AwaitingChoice)
    }
}

/// Free bytes on the volume that will hold `path`. A fresh install has no
/// runtime directory yet, so the nearest directory that exists answers.
pub(crate) fn disk_free(path: &Path) -> Option<u64> {
    volume_free(path.ancestors().find(|dir| dir.is_dir())?)
}

fn volume_free(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        let c = std::ffi::CString::new(path.as_os_str().to_str()?).ok()?;
        let mut fs: libc::statvfs = unsafe { std::mem::zeroed() };
        // SAFETY: `c` is a valid NUL-terminated path; statvfs only reads it
        // and fills the caller's struct.
        let rc = unsafe { libc::statvfs(c.as_ptr(), &mut fs) };
        (rc == 0).then(|| fs.f_bavail as u64 * fs.f_frsize as u64)
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free: u64 = 0;
        // SAFETY: `wide` is NUL-terminated; the call fills one u64.
        let rc = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        (rc != 0).then_some(free)
    }
}

#[cfg(test)]
mod tests;
