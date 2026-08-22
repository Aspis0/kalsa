"""Minimal PC clBuildProgram of both oracle programs (consumer .cl + wrapper)."""
import ctypes
from pathlib import Path

K = Path("BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/kernels")
OPTS = b"-cl-std=CL3.0 -cl-mad-enable  -cl-fast-relaxed-math"

dll = ctypes.WinDLL("OpenCL")

def f(name, restype, *argtypes):
    fn = getattr(dll, name)
    fn.restype = restype
    fn.argtypes = list(argtypes)
    return fn

clGetPlatformIDs = f("clGetPlatformIDs", ctypes.c_int, ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint))
clGetPlatformInfo = f("clGetPlatformInfo", ctypes.c_int, ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t))
clGetDeviceIDs = f("clGetDeviceIDs", ctypes.c_int, ctypes.c_void_p, ctypes.c_ulonglong, ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint))
clCreateContext = f("clCreateContext", ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int))
clCreateProgramWithSource = f("clCreateProgramWithSource", ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_int))
clBuildProgram = f("clBuildProgram", ctypes.c_int, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p)
clGetProgramBuildInfo = f("clGetProgramBuildInfo", ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t))
clReleaseProgram = f("clReleaseProgram", ctypes.c_int, ctypes.c_void_p)
clReleaseContext = f("clReleaseContext", ctypes.c_int, ctypes.c_void_p)

CL_DEVICE_TYPE_ALL = 0xFFFFFFFF
CL_PLATFORM_NAME = 0x0902
CL_PROGRAM_BUILD_LOG = 0x1183
CL_SUCCESS = 0

def plat_name(p):
    sz = ctypes.c_size_t()
    clGetPlatformInfo(p, CL_PLATFORM_NAME, 0, None, ctypes.byref(sz))
    buf = ctypes.create_string_buffer(sz.value)
    clGetPlatformInfo(p, CL_PLATFORM_NAME, sz.value, buf, None)
    return buf.value.decode("utf-8", "replace")

def load(name):
    t = (K / name).read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return t

gemv = load("gemv_moe_q4_0_f32_ns.cl") + b"\n" + load("oracle_consumer_q4_0_gemv.cl")
gemm = load("gemm_moe_q4_0_f32_ns.cl") + b"\n" + load("oracle_consumer_q4_0_gemm.cl")
progs = [("gemv+wrap", gemv), ("gemm+wrap", gemm)]

nplat = ctypes.c_uint(0)
err = clGetPlatformIDs(0, None, ctypes.byref(nplat))
assert err == 0 and nplat.value > 0, (err, nplat.value)
plats = (ctypes.c_void_p * nplat.value)()
clGetPlatformIDs(nplat.value, plats, None)

all_ok = True
for i in range(nplat.value):
    p = plats[i]
    name = plat_name(p)
    print(f"=== platform {i}: {name} ===")
    ndev = ctypes.c_uint(0)
    e = clGetDeviceIDs(p, CL_DEVICE_TYPE_ALL, 0, None, ctypes.byref(ndev))
    if e != 0 or ndev.value == 0:
        print("  no devices", e)
        all_ok = False
        continue
    devs = (ctypes.c_void_p * ndev.value)()
    clGetDeviceIDs(p, CL_DEVICE_TYPE_ALL, ndev.value, devs, None)
    cerr = ctypes.c_int(0)
    ctx = clCreateContext(None, 1, devs, None, None, ctypes.byref(cerr))
    if cerr.value != 0 or not ctx:
        print("  clCreateContext", cerr.value)
        all_ok = False
        continue
    for label, src in progs:
        src_p = ctypes.c_char_p(src)
        slen = ctypes.c_size_t(len(src))
        perr = ctypes.c_int(0)
        prog = clCreateProgramWithSource(ctx, 1, ctypes.byref(src_p), ctypes.byref(slen), ctypes.byref(perr))
        if perr.value != 0:
            print(f"  {label} clCreateProgramWithSource {perr.value}")
            all_ok = False
            continue
        st = clBuildProgram(prog, 1, devs, OPTS, None, None)
        logsz = ctypes.c_size_t(0)
        clGetProgramBuildInfo(prog, devs[0], CL_PROGRAM_BUILD_LOG, 0, None, ctypes.byref(logsz))
        log = ctypes.create_string_buffer(max(logsz.value, 1))
        clGetProgramBuildInfo(prog, devs[0], CL_PROGRAM_BUILD_LOG, logsz.value, log, None)
        logt = log.value.decode("utf-8", "replace")
        print(f"  {label} clBuildProgram={st} log_bytes={logsz.value}")
        # print last/first of log if fail
        if st != CL_SUCCESS:
            all_ok = False
            snippet = logt.strip()
            if len(snippet) > 1500:
                snippet = snippet[:1500] + "\n...[truncated]..."
            print(snippet)
        else:
            print("  CL_SUCCESS")
        clReleaseProgram(prog)
    clReleaseContext(ctx)

print("OVERALL_OK" if all_ok else "OVERALL_FAIL")
raise SystemExit(0 if all_ok else 1)
