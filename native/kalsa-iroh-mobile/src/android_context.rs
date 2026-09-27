use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

use jni::objects::JObject;
use jni::sys::{jboolean, jobject, JNIEnv, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv as JniEnv;

static ANDROID_CONTEXT_INSTALLED: OnceLock<bool> = OnceLock::new();

#[no_mangle]
pub extern "system" fn Java_expo_modules_kalsairoh_KalsaIrohModule_nativeInstallAndroidContext(
    raw_env: *mut JNIEnv,
    _module: jobject,
    application_context: jobject,
) -> jboolean {
    if raw_env.is_null() || application_context.is_null() {
        return JNI_FALSE;
    }

    let installed = ANDROID_CONTEXT_INSTALLED.get_or_init(|| {
        catch_unwind(AssertUnwindSafe(|| unsafe {
            install_android_context(raw_env, application_context)
        }))
        .unwrap_or(false)
    });

    if *installed {
        JNI_TRUE
    } else {
        JNI_FALSE
    }
}

unsafe fn install_android_context(raw_env: *mut JNIEnv, application_context: jobject) -> bool {
    let mut env = unsafe { JniEnv::from_raw(raw_env) };
    let java_vm = match env.get_java_vm() {
        Ok(java_vm) => java_vm,
        Err(_) => {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            return false;
        }
    };
    let context = unsafe { JObject::from_raw(&env, application_context) };
    let global_context = match env.new_global_ref(context) {
        Ok(context) => context,
        Err(_) => {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            return false;
        }
    };

    let context_pointer = global_context.as_raw() as *mut c_void;
    // iroh-dns stores both pointers for process lifetime, so this global ref must live too.
    std::mem::forget(global_context);
    unsafe {
        iroh::dns::install_android_jni_context(java_vm.get_raw() as *mut c_void, context_pointer);
    }
    true
}
