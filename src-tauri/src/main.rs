use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{webview::WebviewWindowBuilder, WebviewUrl};
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MachineInfo {
    chip: Option<String>,
    backend: kalsa_probe::Backend,
    physical_cores: Option<usize>,
    logical_cores: Option<usize>,
    ram_bytes: u64,
}

#[tauri::command]
fn brain_machine() -> MachineInfo {
    MachineInfo {
        chip: kalsa_probe::brand_string(),
        backend: kalsa_probe::backend(),
        physical_cores: kalsa_probe::physical_cores(),
        logical_cores: kalsa_probe::logical_cores(),
        ram_bytes: ram_bytes(),
    }
}

/// Open a public address in the system browser, never in the app's webview.
/// The page has already checked the spelling; this is the real boundary.
#[tauri::command]
fn brain_open_external(address: String) -> Result<(), String> {
    let url = Url::parse(&address).map_err(|_| "That address is not a link.".to_string())?;
    if !public_http(&url) {
        return Err("Only public web links can be opened.".to_string());
    }
    open_browser(url.as_str()).map_err(|_| "The system browser could not be opened.".to_string())
}

fn public_http(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    if host.parse::<std::net::IpAddr>().is_ok() {
        return false;
    }
    let lower = host.to_ascii_lowercase();
    !["localhost", ".localhost", ".local", ".internal"]
        .iter()
        .any(|suffix| lower == *suffix || lower.ends_with(suffix))
}

fn open_browser(address: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let (program, args) = ("open", [address]);
    #[cfg(target_os = "windows")]
    let (program, args) = ("rundll32", ["url.dll,FileProtocolHandler", address]);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (program, args) = ("xdg-open", [address]);
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// The webview may only show the app's own origin. External links go through
/// `brain_open_external`; navigation to any other origin is refused.
/// Attached to the window with `WebviewWindowBuilder::on_navigation`.
fn app_origin(url: &Url) -> bool {
    if url.scheme() == "tauri" {
        return url.host_str() == Some("localhost");
    }
    if url.scheme() == "http" && url.host_str() == Some("tauri.localhost") {
        return true;
    }
    #[cfg(debug_assertions)]
    {
        if url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && url.port() == Some(5173)
        {
            return true;
        }
    }
    false
}

fn ram_bytes() -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut value: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = b"hw.memsize\0";
        let ok = unsafe {
            libc::sysctlbyname(
                name.as_ptr() as *const libc::c_char,
                &mut value as *mut u64 as *mut libc::c_void,
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if ok == 0 { value } else { 0 }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    line.strip_prefix("MemTotal:")
                        .and_then(|rest| rest.trim_end_matches("kB").trim().parse::<u64>().ok())
                })
            })
            .map(|kib| kib * 1024)
            .unwrap_or(0)
    }
    #[cfg(not(unix))]
    {
        0
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Kalsa")
                .inner_size(1000.0, 720.0)
                .min_inner_size(720.0, 480.0)
                .resizable(true)
                .on_navigation(app_origin)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![brain_machine, brain_open_external])
        .run(tauri::generate_context!())?;
    Ok(())
}
