use super::{SERVICE, spec};
use serde_json::json;

pub(crate) fn machine(machine: &crate::system::Machine, host: &str) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        inner.total_ram = machine.ram_total_bytes;
        if let Some(cpu) = &machine.cpu {
            inner.base["cpuModel"] = json!(cpu);
        }
        if let Some(adapter) = machine.adapters.first() {
            let name = crate::system::clean_gathered(&adapter.name, 80, host);
            let vendor = ["apple", "nvidia", "amd", "intel", "qualcomm", "arm"]
                .into_iter()
                .find(|vendor| {
                    spec::gpu_pattern(vendor)
                        .is_some_and(|p| regex::Regex::new(p).is_ok_and(|re| re.is_match(&name)))
                })
                .unwrap_or("other");
            // Preserve the original until the sanitizer checks length and shape; clipping cannot grant consent to a suffix.
            inner.base["gpuModel"] = json!(adapter.name);
            inner.base["gpuVendor"] = json!(vendor);
            if let Some(driver) = &adapter.driver {
                inner.base["gpuDriver"] = json!(driver);
            }
        }
        let os = regex::Regex::new(r"\b([0-9]{1,8})(?:\.|\b)")
            .ok()
            .and_then(|re| re.captures(&machine.os).map(|c| c[1].to_owned()))
            .unwrap_or("0".into());
        inner.base["osMajor"] = json!(os);
    }
}

pub(crate) fn engine(engine: &crate::system::Engine) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        inner.base["backend"] = json!(engine.build);
        inner.base["engineRelease"] = json!(engine.release);

        if let Some(row) = &engine.row {
            inner.base["modelId"] = json!(row);
        }
    }
}

pub(crate) fn launch(prepared: &crate::startup::PreparedStart) {
    let backend = kalsa_runtime::backend_of_exe(&prepared.server.exe);
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        inner.base["backend"] = json!(backend.map(|b| b.name()).unwrap_or("unknown"));
        if backend.is_some() {
            inner.base["engineRelease"] = json!(kalsa_runtime::RELEASE);
        }
        inner.base["ctxTokens"] = json!(spec::bucket(
            "ctxTokens",
            (prepared.info.args.context_tokens / u64::from(prepared.info.args.parallel.max(1)))
                as f64
        ));
        inner.base.as_object_mut().unwrap().remove("offload");
        match prepared.info.args.offload {
            kalsa_launch::Offload::ForcedOff | kalsa_launch::Offload::NoGpuBuild => {
                inner.base["offload"] = json!("cpu")
            }
            kalsa_launch::Offload::All => inner.base["offload"] = json!("gpu"),
            kalsa_launch::Offload::EngineFitted => {}
        }
        inner.base.as_object_mut().unwrap().remove("modelId");
        inner.category = "unknown";
        if let Some(digest) = &prepared.info.model_sha256 {
            let row = kalsa_catalog::DOWNLOADABLE.iter().find_map(|entry| {
                if entry.source.sha256 == digest {
                    Some(&entry.model)
                } else {
                    entry
                        .q8
                        .as_ref()
                        .filter(|q8| q8.source.sha256 == digest)
                        .map(|q8| &q8.model)
                }
            });
            if let Some(row) = row {
                set_model(&mut inner, row);
            }
        }
    }
}

pub(crate) fn model(row: &kalsa_catalog::ModelEntry) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        set_model(&mut inner, row);
    }
}

fn set_model(inner: &mut super::Inner, row: &kalsa_catalog::ModelEntry) {
    inner.base["modelId"] = json!(crate::startup::model_token(row));
    inner.category = if row.parameters.is_mixture() {
        "moe"
    } else {
        match row.parameters.total().count() {
            2_000_000_000..=2_999_999_999 => "dense.2b",
            3_000_000_000..=4_999_999_999 => "dense.4b",
            _ => "unknown",
        }
    };
}

pub(crate) fn clear_engine() {
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        for key in [
            "backend",
            "offload",
            "engineRelease",
            "modelId",
            "ctxTokens",
            "promptTokens",
            "tokensPerSecond",
        ] {
            inner.base.as_object_mut().unwrap().remove(key);
        }
        inner.category = "unknown";
        inner.started = None;
        inner.engine_stage = "load";
    }
}
