use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};

use jni::objects::JObject;
use jni::sys::jboolean;
use jni::{EnvUnowned, Outcome};

static ANDROID_CONTEXT_INSTALLED: OnceLock<Mutex<bool>> = OnceLock::new();

#[no_mangle]
pub extern "system" fn Java_expo_modules_kalsairoh_KalsaIrohModule_nativeInstallAndroidContext<
    'local,
>(
    mut unowned_env: EnvUnowned<'local>,
    _module: JObject<'local>,
    application_context: JObject<'local>,
) -> jboolean {
    if application_context.is_null() {
        return false;
    }

    let installed = catch_unwind(AssertUnwindSafe(|| {
        let state = ANDROID_CONTEXT_INSTALLED.get_or_init(|| Mutex::new(false));
        let mut installed = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !*installed {
            *installed = install_android_context(&mut unowned_env, application_context);
        }
        *installed
    }))
    .unwrap_or(false);

    installed
}

fn install_android_context<'local>(
    unowned_env: &mut EnvUnowned<'local>,
    application_context: JObject<'local>,
) -> bool {
    let outcome = unowned_env.with_env(|env| -> jni::errors::Result<bool> {
        let java_vm = match env.get_java_vm() {
            Ok(java_vm) => java_vm,
            Err(_) => {
                clear_pending_exception(env);
                return Ok(false);
            }
        };
        let global_context = match env.new_global_ref(application_context) {
            Ok(context) => context,
            Err(_) => {
                clear_pending_exception(env);
                return Ok(false);
            }
        };

        let context_pointer = global_context.into_raw() as *mut c_void;
        // iroh-dns stores both pointers for process lifetime, so retain the global reference too.
        unsafe {
            iroh::dns::install_android_jni_context(
                java_vm.get_raw() as *mut c_void,
                context_pointer,
            );
        }
        Ok(true)
    });

    match outcome.into_outcome() {
        Outcome::Ok(installed) => installed,
        Outcome::Err(_) | Outcome::Panic(_) => {
            let _ = unowned_env.with_env(|env| -> jni::errors::Result<()> {
                clear_pending_exception(env);
                Ok(())
            });
            false
        }
    }
}

fn clear_pending_exception(env: &jni::Env<'_>) {
    if env.exception_check() {
        env.exception_clear();
    }
}
