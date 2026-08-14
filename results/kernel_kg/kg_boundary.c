/* kg_boundary.c — M1 CPU<->GPU activation-handoff microbench for Adreno 740.
 *
 * Measures the same primitive ggml-opencl uses for F32 activations:
 *   set_tensor = clEnqueueWriteBuffer(..., CL_TRUE, ...)
 *   get_tensor = clEnqueueReadBuffer(..., CL_TRUE, ...)
 * F32 activations have NO convert/transpose kernel in this backend
 * (see ggml-opencl.cpp set_tensor F32 fallback). We still time a 1:1
 * f32 copy kernel as an upper bound on a hypothetical layout pass.
 *
 * Build on-device (Termux clang, no OpenCL headers required):
 *   clang -O2 -ldl kg_boundary.c -o kg_boundary
 * Run:
 *   LD_LIBRARY_PATH=/vendor/lib64:$LD_LIBRARY_PATH ./kg_boundary
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Minimal OpenCL 1.2 surface. */
typedef int32_t cl_int;
typedef uint32_t cl_uint;
typedef uint64_t cl_ulong;
typedef uint64_t cl_bitfield;
typedef cl_bitfield cl_device_type;
typedef cl_bitfield cl_mem_flags;
typedef cl_bitfield cl_command_queue_properties;
typedef void *cl_platform_id;
typedef void *cl_device_id;
typedef void *cl_context;
typedef void *cl_command_queue;
typedef void *cl_mem;
typedef void *cl_program;
typedef void *cl_kernel;
typedef void *cl_event;
typedef cl_uint cl_bool;
typedef cl_uint cl_platform_info;
typedef cl_uint cl_device_info;
typedef cl_uint cl_profiling_info;
typedef cl_bitfield cl_queue_properties;

#define CL_SUCCESS 0
#define CL_TRUE 1
#define CL_FALSE 0
#define CL_DEVICE_TYPE_GPU (1u << 2)
#define CL_MEM_READ_WRITE (1u << 0)
#define CL_MEM_READ_ONLY (1u << 2)
#define CL_MEM_WRITE_ONLY (1u << 1)
#define CL_QUEUE_PROFILING_ENABLE (1u << 1)
#define CL_PLATFORM_NAME 0x0902
#define CL_DEVICE_NAME 0x102B
#define CL_DEVICE_VERSION 0x102F
#define CL_DEVICE_MAX_CLOCK_FREQUENCY 0x100C
#define CL_DEVICE_GLOBAL_MEM_SIZE 0x101F
#define CL_DEVICE_MAX_MEM_ALLOC_SIZE 0x1010
#define CL_PROFILING_COMMAND_QUEUED 0x1280
#define CL_PROFILING_COMMAND_SUBMIT 0x1281
#define CL_PROFILING_COMMAND_START 0x1282
#define CL_PROFILING_COMMAND_END 0x1283

typedef cl_int (*fn_clGetPlatformIDs)(cl_uint, cl_platform_id *, cl_uint *);
typedef cl_int (*fn_clGetPlatformInfo)(cl_platform_id, cl_platform_info, size_t, void *, size_t *);
typedef cl_int (*fn_clGetDeviceIDs)(cl_platform_id, cl_device_type, cl_uint, cl_device_id *, cl_uint *);
typedef cl_int (*fn_clGetDeviceInfo)(cl_device_id, cl_device_info, size_t, void *, size_t *);
typedef cl_context (*fn_clCreateContext)(const intptr_t *, cl_uint, const cl_device_id *,
                                         void (*)(const char *, const void *, size_t, void *), void *, cl_int *);
typedef cl_int (*fn_clReleaseContext)(cl_context);
typedef cl_command_queue (*fn_clCreateCommandQueue)(cl_context, cl_device_id, cl_command_queue_properties, cl_int *);
typedef cl_int (*fn_clReleaseCommandQueue)(cl_command_queue);
typedef cl_mem (*fn_clCreateBuffer)(cl_context, cl_mem_flags, size_t, void *, cl_int *);
typedef cl_int (*fn_clReleaseMemObject)(cl_mem);
typedef cl_int (*fn_clEnqueueWriteBuffer)(cl_command_queue, cl_mem, cl_bool, size_t, size_t, const void *,
                                          cl_uint, const cl_event *, cl_event *);
typedef cl_int (*fn_clEnqueueReadBuffer)(cl_command_queue, cl_mem, cl_bool, size_t, size_t, void *,
                                         cl_uint, const cl_event *, cl_event *);
typedef cl_int (*fn_clFinish)(cl_command_queue);
typedef cl_int (*fn_clFlush)(cl_command_queue);
typedef cl_program (*fn_clCreateProgramWithSource)(cl_context, cl_uint, const char **, const size_t *, cl_int *);
typedef cl_int (*fn_clBuildProgram)(cl_program, cl_uint, const cl_device_id *, const char *, void *, void *);
typedef cl_int (*fn_clReleaseProgram)(cl_program);
typedef cl_kernel (*fn_clCreateKernel)(cl_program, const char *, cl_int *);
typedef cl_int (*fn_clReleaseKernel)(cl_kernel);
typedef cl_int (*fn_clSetKernelArg)(cl_kernel, cl_uint, size_t, const void *);
typedef cl_int (*fn_clEnqueueNDRangeKernel)(cl_command_queue, cl_kernel, cl_uint, const size_t *,
                                            const size_t *, const size_t *, cl_uint, const cl_event *, cl_event *);
typedef cl_int (*fn_clWaitForEvents)(cl_uint, const cl_event *);
typedef cl_int (*fn_clReleaseEvent)(cl_event);
typedef cl_int (*fn_clGetEventProfilingInfo)(cl_event, cl_profiling_info, size_t, void *, size_t *);
typedef cl_int (*fn_clGetProgramBuildInfo)(cl_program, cl_device_id, cl_uint, size_t, void *, size_t *);

static fn_clGetPlatformIDs p_clGetPlatformIDs;
static fn_clGetPlatformInfo p_clGetPlatformInfo;
static fn_clGetDeviceIDs p_clGetDeviceIDs;
static fn_clGetDeviceInfo p_clGetDeviceInfo;
static fn_clCreateContext p_clCreateContext;
static fn_clReleaseContext p_clReleaseContext;
static fn_clCreateCommandQueue p_clCreateCommandQueue;
static fn_clReleaseCommandQueue p_clReleaseCommandQueue;
static fn_clCreateBuffer p_clCreateBuffer;
static fn_clReleaseMemObject p_clReleaseMemObject;
static fn_clEnqueueWriteBuffer p_clEnqueueWriteBuffer;
static fn_clEnqueueReadBuffer p_clEnqueueReadBuffer;
static fn_clFinish p_clFinish;
static fn_clFlush p_clFlush;
static fn_clCreateProgramWithSource p_clCreateProgramWithSource;
static fn_clBuildProgram p_clBuildProgram;
static fn_clReleaseProgram p_clReleaseProgram;
static fn_clCreateKernel p_clCreateKernel;
static fn_clReleaseKernel p_clReleaseKernel;
static fn_clSetKernelArg p_clSetKernelArg;
static fn_clEnqueueNDRangeKernel p_clEnqueueNDRangeKernel;
static fn_clWaitForEvents p_clWaitForEvents;
static fn_clReleaseEvent p_clReleaseEvent;
static fn_clGetEventProfilingInfo p_clGetEventProfilingInfo;

#define LOAD(h, name)                                                                 \
    do {                                                                              \
        p_##name = (fn_##name)dlsym(h, #name);                                        \
        if (!p_##name) {                                                              \
            fprintf(stderr, "dlsym %s failed: %s\n", #name, dlerror());               \
            return -1;                                                                \
        }                                                                             \
    } while (0)

static int load_opencl(void) {
    const char *cands[] = {
        "libOpenCL.so",
        "/vendor/lib64/libOpenCL.so",
        "/system/vendor/lib64/libOpenCL.so",
        "/system/lib64/libOpenCL.so",
        NULL,
    };
    void *h = NULL;
    for (int i = 0; cands[i]; i++) {
        h = dlopen(cands[i], RTLD_NOW);
        if (h) {
            fprintf(stderr, "opened %s\n", cands[i]);
            break;
        }
    }
    if (!h) {
        fprintf(stderr, "dlopen libOpenCL.so failed: %s\n", dlerror());
        return -1;
    }
    LOAD(h, clGetPlatformIDs);
    LOAD(h, clGetPlatformInfo);
    LOAD(h, clGetDeviceIDs);
    LOAD(h, clGetDeviceInfo);
    LOAD(h, clCreateContext);
    LOAD(h, clReleaseContext);
    LOAD(h, clCreateCommandQueue);
    LOAD(h, clReleaseCommandQueue);
    LOAD(h, clCreateBuffer);
    LOAD(h, clReleaseMemObject);
    LOAD(h, clEnqueueWriteBuffer);
    LOAD(h, clEnqueueReadBuffer);
    LOAD(h, clFinish);
    LOAD(h, clFlush);
    LOAD(h, clCreateProgramWithSource);
    LOAD(h, clBuildProgram);
    LOAD(h, clReleaseProgram);
    LOAD(h, clCreateKernel);
    LOAD(h, clReleaseKernel);
    LOAD(h, clSetKernelArg);
    LOAD(h, clEnqueueNDRangeKernel);
    LOAD(h, clWaitForEvents);
    LOAD(h, clReleaseEvent);
    LOAD(h, clGetEventProfilingInfo);
    return 0;
}

static uint64_t nsec_now(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static int cmp_u64(const void *a, const void *b) {
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return (x > y) - (x < y);
}

static void summarize(const char *tag, uint64_t *ns, int n) {
    qsort(ns, (size_t)n, sizeof(uint64_t), cmp_u64);
    uint64_t sum = 0;
    for (int i = 0; i < n; i++) sum += ns[i];
    /* p95 index: ceil(0.95*(n-1)) */
    int ip95 = (int)((95 * (n - 1) + 99) / 100);
    if (ip95 >= n) ip95 = n - 1;
    double med_us = ns[n / 2] / 1000.0;
    double p95_us = ns[ip95] / 1000.0;
    double mean_us = (sum / (double)n) / 1000.0;
    double min_us = ns[0] / 1000.0;
    double max_us = ns[n - 1] / 1000.0;
    printf("RESULT %s n=%d min_us=%.2f median_us=%.2f p95_us=%.2f mean_us=%.2f max_us=%.2f\n",
           tag, n, min_us, med_us, p95_us, mean_us, max_us);
    printf("RAW %s", tag);
    for (int i = 0; i < n; i++) printf(" %.2f", ns[i] / 1000.0);
    printf("\n");
}

static const char *kCopySrc =
    "__kernel void f32_copy(__global const float *src, __global float *dst, const int n) {\n"
    "  int i = get_global_id(0);\n"
    "  if (i < n) dst[i] = src[i];\n"
    "}\n"
    "__kernel void empty_nop(void) { }\n";

static int g_warmup = 4;
static int g_iters = 16;

static void bench_blocking_write(cl_command_queue q, cl_mem buf, void *host, size_t bytes, uint64_t *out) {
    for (int i = 0; i < g_warmup; i++) {
        p_clEnqueueWriteBuffer(q, buf, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
    }
    for (int i = 0; i < g_iters; i++) {
        uint64_t t0 = nsec_now();
        cl_int err = p_clEnqueueWriteBuffer(q, buf, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
        uint64_t t1 = nsec_now();
        if (err != CL_SUCCESS) {
            fprintf(stderr, "WriteBuffer err=%d\n", err);
            out[i] = 0;
        } else {
            out[i] = t1 - t0;
        }
    }
}

static void bench_blocking_read(cl_command_queue q, cl_mem buf, void *host, size_t bytes, uint64_t *out) {
    for (int i = 0; i < g_warmup; i++) {
        p_clEnqueueReadBuffer(q, buf, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
    }
    for (int i = 0; i < g_iters; i++) {
        uint64_t t0 = nsec_now();
        cl_int err = p_clEnqueueReadBuffer(q, buf, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
        uint64_t t1 = nsec_now();
        if (err != CL_SUCCESS) {
            fprintf(stderr, "ReadBuffer err=%d\n", err);
            out[i] = 0;
        } else {
            out[i] = t1 - t0;
        }
    }
}

static void bench_finish(cl_command_queue q, uint64_t *out) {
    p_clFinish(q);
    for (int i = 0; i < g_warmup; i++) p_clFinish(q);
    for (int i = 0; i < g_iters; i++) {
        uint64_t t0 = nsec_now();
        p_clFinish(q);
        uint64_t t1 = nsec_now();
        out[i] = t1 - t0;
    }
}

static void bench_empty_launch(cl_command_queue q, cl_kernel k, uint64_t *out_host, uint64_t *out_dev) {
    size_t gws = 64, lws = 64;
    for (int i = 0; i < g_warmup; i++) {
        cl_event ev = NULL;
        p_clEnqueueNDRangeKernel(q, k, 1, NULL, &gws, &lws, 0, NULL, &ev);
        p_clWaitForEvents(1, &ev);
        p_clReleaseEvent(ev);
    }
    for (int i = 0; i < g_iters; i++) {
        cl_event ev = NULL;
        uint64_t t0 = nsec_now();
        cl_int err = p_clEnqueueNDRangeKernel(q, k, 1, NULL, &gws, &lws, 0, NULL, &ev);
        if (err != CL_SUCCESS) {
            fprintf(stderr, "empty NDRange err=%d\n", err);
            out_host[i] = 0;
            out_dev[i] = 0;
            continue;
        }
        p_clWaitForEvents(1, &ev);
        uint64_t t1 = nsec_now();
        out_host[i] = t1 - t0;
        cl_ulong s = 0, e = 0;
        p_clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_START, sizeof(s), &s, NULL);
        p_clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_END, sizeof(e), &e, NULL);
        out_dev[i] = (e > s) ? (e - s) : 0;
        p_clReleaseEvent(ev);
    }
}

static void bench_copy_kernel(cl_command_queue q, cl_kernel k, cl_mem src, cl_mem dst, int nfloat,
                              uint64_t *out_host, uint64_t *out_dev) {
    size_t lws = 64;
    size_t gws = ((size_t)nfloat + lws - 1) / lws * lws;
    p_clSetKernelArg(k, 0, sizeof(cl_mem), &src);
    p_clSetKernelArg(k, 1, sizeof(cl_mem), &dst);
    p_clSetKernelArg(k, 2, sizeof(int), &nfloat);
    for (int i = 0; i < g_warmup; i++) {
        cl_event ev = NULL;
        p_clEnqueueNDRangeKernel(q, k, 1, NULL, &gws, &lws, 0, NULL, &ev);
        p_clWaitForEvents(1, &ev);
        p_clReleaseEvent(ev);
    }
    for (int i = 0; i < g_iters; i++) {
        cl_event ev = NULL;
        uint64_t t0 = nsec_now();
        cl_int err = p_clEnqueueNDRangeKernel(q, k, 1, NULL, &gws, &lws, 0, NULL, &ev);
        if (err != CL_SUCCESS) {
            fprintf(stderr, "copy NDRange err=%d\n", err);
            out_host[i] = 0;
            out_dev[i] = 0;
            continue;
        }
        p_clWaitForEvents(1, &ev);
        uint64_t t1 = nsec_now();
        out_host[i] = t1 - t0;
        cl_ulong s = 0, e = 0;
        p_clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_START, sizeof(s), &s, NULL);
        p_clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_END, sizeof(e), &e, NULL);
        out_dev[i] = (e > s) ? (e - s) : 0;
        p_clReleaseEvent(ev);
    }
}

static int run_shape(cl_context ctx, cl_device_id dev, cl_command_queue q, cl_kernel kcopy, cl_kernel knop,
                     int tokens, int embd) {
    size_t nfloat = (size_t)tokens * (size_t)embd;
    size_t bytes = nfloat * sizeof(float);
    printf("\n=== SHAPE tokens=%d embd=%d bytes=%zu (%.3f MiB) ===\n", tokens, embd, bytes,
           bytes / (1024.0 * 1024.0));

    cl_int err = 0;
    cl_mem gpu = p_clCreateBuffer(ctx, CL_MEM_READ_WRITE, bytes, NULL, &err);
    if (err != CL_SUCCESS || !gpu) {
        fprintf(stderr, "CreateBuffer dst err=%d\n", err);
        return -1;
    }
    cl_mem gpu2 = p_clCreateBuffer(ctx, CL_MEM_READ_WRITE, bytes, NULL, &err);
    if (err != CL_SUCCESS || !gpu2) {
        fprintf(stderr, "CreateBuffer src err=%d\n", err);
        p_clReleaseMemObject(gpu);
        return -1;
    }

    float *host = (float *)malloc(bytes);
    if (!host) {
        fprintf(stderr, "host malloc failed\n");
        p_clReleaseMemObject(gpu);
        p_clReleaseMemObject(gpu2);
        return -1;
    }
    for (size_t i = 0; i < nfloat; i++) host[i] = (float)((i * 1103515245u + 12345u) & 0xFFFF) / 65535.0f;

    /* seed the buffer so reads are not from uninit device mem */
    p_clEnqueueWriteBuffer(q, gpu, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
    p_clEnqueueWriteBuffer(q, gpu2, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
    p_clFinish(q);

    uint64_t *acc = (uint64_t *)calloc((size_t)g_iters * 6, sizeof(uint64_t));
    if (!acc) {
        free(host);
        p_clReleaseMemObject(gpu);
        p_clReleaseMemObject(gpu2);
        return -1;
    }
    uint64_t *w = acc;
    uint64_t *r = acc + g_iters;
    uint64_t *f = acc + 2 * g_iters;
    uint64_t *eh = acc + 3 * g_iters;
    uint64_t *ed = acc + 4 * g_iters;
    uint64_t *ch = acc + 5 * g_iters;
    uint64_t *cd = (uint64_t *)calloc((size_t)g_iters, sizeof(uint64_t));

    char tag[96];
    snprintf(tag, sizeof(tag), "write_f32_%dx%d", tokens, embd);
    bench_blocking_write(q, gpu, host, bytes, w);
    summarize(tag, w, g_iters);

    snprintf(tag, sizeof(tag), "read_f32_%dx%d", tokens, embd);
    bench_blocking_read(q, gpu, host, bytes, r);
    summarize(tag, r, g_iters);

    snprintf(tag, sizeof(tag), "clFinish_idle");
    bench_finish(q, f);
    summarize(tag, f, g_iters);

    snprintf(tag, sizeof(tag), "empty_kernel_host_%dx%d", tokens, embd);
    bench_empty_launch(q, knop, eh, ed);
    summarize(tag, eh, g_iters);
    snprintf(tag, sizeof(tag), "empty_kernel_dev_%dx%d", tokens, embd);
    summarize(tag, ed, g_iters);

    snprintf(tag, sizeof(tag), "layout_copy_host_%dx%d", tokens, embd);
    bench_copy_kernel(q, kcopy, gpu, gpu2, (int)nfloat, ch, cd);
    summarize(tag, ch, g_iters);
    snprintf(tag, sizeof(tag), "layout_copy_dev_%dx%d", tokens, embd);
    summarize(tag, cd, g_iters);

    /* engine-equivalent handoff pair: readback then upload (hybrid layer) */
    uint64_t *pair = (uint64_t *)calloc((size_t)g_iters, sizeof(uint64_t));
    for (int i = 0; i < g_warmup; i++) {
        p_clEnqueueReadBuffer(q, gpu, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
        p_clEnqueueWriteBuffer(q, gpu, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
    }
    for (int i = 0; i < g_iters; i++) {
        uint64_t t0 = nsec_now();
        p_clEnqueueReadBuffer(q, gpu, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
        p_clEnqueueWriteBuffer(q, gpu, CL_TRUE, 0, bytes, host, 0, NULL, NULL);
        uint64_t t1 = nsec_now();
        pair[i] = t1 - t0;
    }
    snprintf(tag, sizeof(tag), "handoff_pair_f32_%dx%d", tokens, embd);
    summarize(tag, pair, g_iters);

    free(pair);
    free(cd);
    free(acc);
    free(host);
    p_clReleaseMemObject(gpu);
    p_clReleaseMemObject(gpu2);
    return 0;
}

int main(int argc, char **argv) {
    int tokens = 512;
    int embd = 2048;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--tokens") && i + 1 < argc) tokens = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--embd") && i + 1 < argc) embd = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--iters") && i + 1 < argc) g_iters = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--warmup") && i + 1 < argc) g_warmup = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--help")) {
            fprintf(stderr, "usage: %s [--tokens N] [--embd N] [--iters N] [--warmup N]\n", argv[0]);
            return 0;
        }
    }
    if (g_iters < 1 || g_iters > 1024) g_iters = 16;
    if (g_warmup < 0 || g_warmup > 64) g_warmup = 4;

    printf("kg_boundary tokens=%d embd=%d iters=%d warmup=%d\n", tokens, embd, g_iters, g_warmup);
    if (load_opencl() != 0) return 1;

    cl_uint np = 0;
    cl_int err = p_clGetPlatformIDs(0, NULL, &np);
    if (err != CL_SUCCESS || np == 0) {
        fprintf(stderr, "clGetPlatformIDs err=%d np=%u\n", err, np);
        return 1;
    }
    cl_platform_id *plats = (cl_platform_id *)calloc(np, sizeof(*plats));
    p_clGetPlatformIDs(np, plats, NULL);

    cl_platform_id plat = NULL;
    cl_device_id dev = NULL;
    char name[256], ver[256], pname[256];
    for (cl_uint i = 0; i < np && !dev; i++) {
        memset(pname, 0, sizeof(pname));
        p_clGetPlatformInfo(plats[i], CL_PLATFORM_NAME, sizeof(pname) - 1, pname, NULL);
        cl_uint nd = 0;
        if (p_clGetDeviceIDs(plats[i], CL_DEVICE_TYPE_GPU, 0, NULL, &nd) != CL_SUCCESS || nd == 0) continue;
        cl_device_id *devs = (cl_device_id *)calloc(nd, sizeof(*devs));
        p_clGetDeviceIDs(plats[i], CL_DEVICE_TYPE_GPU, nd, devs, NULL);
        plat = plats[i];
        dev = devs[0];
        memset(name, 0, sizeof(name));
        memset(ver, 0, sizeof(ver));
        p_clGetDeviceInfo(dev, CL_DEVICE_NAME, sizeof(name) - 1, name, NULL);
        p_clGetDeviceInfo(dev, CL_DEVICE_VERSION, sizeof(ver) - 1, ver, NULL);
        cl_ulong gmem = 0, alloc = 0;
        cl_uint clock = 0;
        p_clGetDeviceInfo(dev, CL_DEVICE_GLOBAL_MEM_SIZE, sizeof(gmem), &gmem, NULL);
        p_clGetDeviceInfo(dev, CL_DEVICE_MAX_MEM_ALLOC_SIZE, sizeof(alloc), &alloc, NULL);
        p_clGetDeviceInfo(dev, CL_DEVICE_MAX_CLOCK_FREQUENCY, sizeof(clock), &clock, NULL);
        printf("platform=%s\n", pname);
        printf("device=%s\n", name);
        printf("device_version=%s\n", ver);
        printf("global_mem_bytes=%llu max_alloc=%llu clock_mhz=%u\n",
               (unsigned long long)gmem, (unsigned long long)alloc, clock);
        free(devs);
    }
    free(plats);
    if (!dev) {
        fprintf(stderr, "no GPU device\n");
        return 1;
    }

    cl_context ctx = p_clCreateContext(NULL, 1, &dev, NULL, NULL, &err);
    if (err != CL_SUCCESS || !ctx) {
        fprintf(stderr, "CreateContext err=%d\n", err);
        return 1;
    }
    cl_command_queue q = p_clCreateCommandQueue(ctx, dev, CL_QUEUE_PROFILING_ENABLE, &err);
    if (err != CL_SUCCESS || !q) {
        fprintf(stderr, "CreateCommandQueue err=%d\n", err);
        return 1;
    }

    const char *src = kCopySrc;
    cl_program prog = p_clCreateProgramWithSource(ctx, 1, &src, NULL, &err);
    err = p_clBuildProgram(prog, 1, &dev, NULL, NULL, NULL);
    if (err != CL_SUCCESS) {
        fprintf(stderr, "BuildProgram err=%d\n", err);
        return 1;
    }
    cl_kernel kcopy = p_clCreateKernel(prog, "f32_copy", &err);
    cl_kernel knop = p_clCreateKernel(prog, "empty_nop", &err);
    if (!kcopy || !knop) {
        fprintf(stderr, "CreateKernel failed\n");
        return 1;
    }

    int rc = run_shape(ctx, dev, q, kcopy, knop, tokens, embd);

    p_clReleaseKernel(kcopy);
    p_clReleaseKernel(knop);
    p_clReleaseProgram(prog);
    p_clReleaseCommandQueue(q);
    p_clReleaseContext(ctx);
    return rc;
}
