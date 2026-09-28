# cl_qcom_dmabuf_host_ptr research (Adreno 740 / Galaxy S23, SM8550)

Date: 2026-09-28. Question: wrap an EXISTING dma-buf fd (allocated by Hexagon
rpcmem/FastRPC) in a `cl_mem` with no copy, using `cl_qcom_dmabuf_host_ptr`.

**Verdict: FOUND.** The extension is real, used in production by Qualcomm's own
code (QcNode) exactly in the rpcmem→OpenCL zero-copy shape we need. The struct
and constants are public in copies of Qualcomm's `cl_ext_qcom.h`.

---

## 1. Struct and constants — FOUND

### Primary definition (`cl_ext_qcom.h`, Qualcomm Technologies Inc.)

Not in the current Khronos OpenCL-Headers `cl_ext.h` — verified: that header has
`cl_qcom_ion_host_ptr` (`cl_mem_ion_host_ptr`, `CL_MEM_ION_HOST_PTR_QCOM 0x40A8`)
and `cl_mem_android_native_buffer_host_ptr` (`CL_MEM_ANDROID_NATIVE_BUFFER_HOST_PTR_QCOM
0x40C6`) but **no dmabuf entry**. The dmabuf definitions live only in Qualcomm's
SDK header `cl_ext_qcom.h`, which is mirrored in several public repos:

- https://github.com/lijun99/clAmpcor/blob/main/include/CL/cl_ext_qcom.h (lines 378–397)
- https://github.com/comprehensive9/vendor_qcom_proprietary/blob/main/graphics/r-bins/include/public/CL/cl_ext_qcom.h (identical content)
- https://github.com/EraserCN/Ximi13-Sauce-Dump/blob/main/outCpp_t/android-t-qcom/vendor/xiaomi/frameworks/av/services/camera/libcameraservice/privacy/include/CL/cl_ext.h — SM8550 (Xiaomi 13, same SoC as S23) vendor dump; contains the AHB variant, see §3.

Exact C definition, quoted verbatim from the clAmpcor copy:

```c
/**************************
 * cl_qcom_dmabuf_host_ptr *
 **************************/

#define CL_MEM_DMABUF_HOST_PTR_QCOM             0x411D
#define CL_MEM_DMABUF_HOST_PTR_PROTECTED_QCOM   0x411E

typedef struct _cl_mem_dmabuf_host_ptr
{
    /* Type of external memory allocation. */
    /* Must be CL_MEM_DMABUF_HOST_PTR_QCOM or CL_MEM_DMABUF_HOST_PTR_PROTECTED_QCOM for dmabuf allocations. */
    cl_mem_ext_host_ptr  ext_host_ptr;

    /* dmabuf file descriptor */
    int                  dmabuf_filedesc;

    /* Host pointer to the dmabuf allocated memory */
    void*                dmabuf_hostptr;

} cl_mem_dmabuf_host_ptr;
```

Base struct + flag it builds on (Khronos OpenCL-Headers `cl_ext.h`, lines 1342–1348,
https://github.com/KhronosGroup/OpenCL-Headers/blob/main/CL/cl_ext.h):

```c
typedef struct _cl_mem_ext_host_ptr {
    cl_uint allocation_type;
    cl_uint host_cache_policy;
} cl_mem_ext_host_ptr;

/* cl_mem_flags */
#define CL_MEM_EXT_HOST_PTR_QCOM                            (1 << 29)
```

Companion constants (Khronos `cl_ext.h`, lines 1351–1362 and 1405 — these ARE in
the Khronos header, so include that one and only declare the dmabuf bits locally):

| Name | Value |
|---|---|
| `CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM` | `0x40A0` |
| `CL_DEVICE_PAGE_SIZE_QCOM` | `0x40A1` |
| `CL_MEM_HOST_UNCACHED_QCOM` | `0x40A4` |
| `CL_MEM_HOST_WRITEBACK_QCOM` | `0x40A5` |
| `CL_MEM_HOST_WRITETHROUGH_QCOM` | `0x40A6` |
| `CL_MEM_HOST_WRITE_COMBINING_QCOM` | `0x40A7` |
| `CL_MEM_HOST_IOCOHERENT_QCOM` (`cl_qcom_ext_host_ptr_iocoherent`) | `0x40A9` |
| `CL_MEM_DMABUF_HOST_PTR_QCOM` | `0x411D` |
| `CL_MEM_DMABUF_HOST_PTR_PROTECTED_QCOM` | `0x411E` |

### Licence of the header

The `cl_ext_qcom.h` copies on GitHub carry Qualcomm's proprietary banner, quoted:

> `/* Copyright (c) 2009-2022 Qualcomm Technologies, Inc.`
> ` * All Rights Reserved.`
> ` * Confidential and Proprietary - Qualcomm Technologies, Inc. */`

So do **not vendor the file**. The clAmpcor repo itself is MIT
(https://github.com/lijun99/clAmpcor — MIT, © 2023 Lijun Zhu / Caltech), but that
licence covers the repo's own code, not the QTI header text inside it. Safest
path for kalsa: declare the 12-line struct + the three constants ourselves in
our source (values are API numbers), and rely on the Khronos `cl_ext.h` for the
base `cl_mem_ext_host_ptr` / `CL_MEM_EXT_HOST_PTR_QCOM` / cache-policy tokens,
which are openly licensed (Apache-2.0 for OpenCL-Headers).

## 2. Usage rules

There is **no public Khronos-registry spec text** for `cl_qcom_dmabuf_host_ptr`
itself — the OpenCL-Registry `extensions/qcom/` directory contains only
`cl_qcom_android_native_buffer_host_ptr.txt`, `cl_qcom_ext_host_ptr.txt`,
`cl_qcom_ext_host_ptr_iocoherent.txt`, `cl_qcom_ion_host_ptr.txt`,
`cl_qcom_perf_hint.html`
(https://github.com/KhronosGroup/OpenCL-Registry/tree/main/extensions/qcom).
Qualcomm's official guide says samples are available "upon request":

> "Suppose a memory object is initially created outside the scope of the OpenCL
> API and is allocated using ION/DMA-BUF. In that case, developers can use the
> cl_qcom_ion_host_ptr or cl_qcom_dmabuf_host_ptr extensions to create
> buffer/image objects, which map into the GPU-accessible memory without
> incurring extra copy. Samples that illustrate the use of cl_qcom_ion_host_ptr
> and cl_qcom_dmabuf_host_ptr can be provided upon request."
> — *Snapdragon Mobile Platform OpenCL General Programming and Optimization
> Guide*, 80-NB295-11 Rev. C, §7.4.2.1, p. 58
> https://docs.qualcomm.com/bundle/publicresource/80-NB295-11_REV_C_Qualcomm_Snapdragon_Mobile_Platform_Opencl_General_Programming_and_Optimization.pdf

The dmabuf extension is a "layered extension" over `cl_qcom_ext_host_ptr`, so the
published specs for the base + ION layers define the shared rules:

### Flags and host_ptr interpretation

From `cl_qcom_ext_host_ptr.txt`
(https://github.com/KhronosGroup/OpenCL-Registry/blob/main/extensions/qcom/cl_qcom_ext_host_ptr.txt):

> "This flag is valid only when used together with CL_MEM_USE_HOST_PTR. If
> specified, it indicates that the <host_ptr> argument provided by the
> application is actually a pointer to cl_mem_ext_host_ptr."

> "CL_INVALID_VALUE if <flags> has CL_MEM_EXT_HOST_PTR_QCOM enabled and yet
> CL_MEM_USE_HOST_PTR is not enabled."

So: `clCreateBuffer(ctx, CL_MEM_READ_WRITE | CL_MEM_USE_HOST_PTR |
CL_MEM_EXT_HOST_PTR_QCOM, size, &dmabuf_struct, &err)`.

### fd / hostptr semantics

From `cl_qcom_ion_host_ptr.txt` (same struct shape: base + fd + hostptr;
https://github.com/KhronosGroup/OpenCL-Registry/blob/main/extensions/qcom/cl_qcom_ion_host_ptr.txt):

> "* <host_ptr>->[x]_filedesc must be the file descriptor of the ION memory
> allocation that the application wants to use as storage bits for the memory
> object."
>
> "* <host_ptr>->[x]_hostptr must be the host virtual pointer associated with
> the same ION memory allocation. If the application does not need to map the
> newly created cl memory object for host access, it can set
> <host_ptr>->[x]_hostptr to NULL. If this happens, then calls to host access
> functions such as clEnqueueMapBuffer will fail out and return an errorcode of
> CL_INVALID_OPERATION."

→ **Yes, the host pointer must be the CPU mmap of that same fd** (rpcmem's
returned pointer qualifies). There is **no offset field** in the struct; the
whole page-aligned allocation is what you wrap.

### Alignment and padding

Same spec:

> "Memory specified this way must be aligned to the device's page size. The
> application can query the device's page size by using
> clGetDeviceInfo(..., CL_DEVICE_PAGE_SIZE_QCOM, ...)."

And from `cl_qcom_ext_host_ptr.txt`:

> "CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM — Returns the amount of memory
> padding that the application must add to the end of every external allocation
> that will be used in conjunction with CL_MEM_EXT_HOST_PTR_QCOM."

Sample code in the ion spec checks the hostptr alignment explicitly:

> `if(myionmem.ion_hostptr % device_page_size)`
> `{`
> `    error("Host pointer must be aligned to device_page_size!");`
> `}`

For us: rpcmem/FastRPC allocations are already page-multiples and page-aligned
(dma-buf heap pages), and clCreateBuffer receives the *un-padded* logical size
while the underlying allocation includes padding — the spec's sample creates the
buffer with `buffer_size_in_bytes`, not `buffer_size_with_padding`. Relevant
only if we control the allocation size; rpcmem default alignment satisfies it.

### Cache policies

From `cl_qcom_ion_host_ptr.txt` (policy must reflect the real CPU mapping):

> "* <host_ptr>->host_cache_policy should be set as follows - If the ion
> allocation was made with the flag ION_FLAG_CACHED enabled and
> cl_mem_ext_host_ptr_iocoherent is present, <host_ptr>->host_cache_policy can
> be set to either CL_MEM_HOST_WRITEBACK_QCOM or CL_MEM_HOST_IOCOHERENT_QCOM.
> ... It must be equal to CL_MEM_HOST_UNCACHED_QCOM otherwise."

→ For typical rpcmem (uncached) allocations: `CL_MEM_HOST_UNCACHED_QCOM`. The
S23 driver exposes `cl_qcom_ext_host_ptr_iocoherent` (given), so io-coherent
allocations may use `CL_MEM_HOST_IOCOHERENT_QCOM`.

### Simultaneous FastRPC/DSP mapping — YES (Qualcomm's own code does it)

Qualcomm's **QcNode** (official `qualcomm` GitHub org) allocates with rpcmem,
registers/maps it for FastRPC/DSP, and wraps the **same** fd + pointer into
OpenCL via `cl_mem_dmabuf_host_ptr`:

FadasSrv.cpp (https://github.com/qualcomm/QcNode/blob/main/source/Library/FadasIface/FadasSrv.cpp, lines 515–530):

```c
        remote_register_buf_v2( extDomainId, ptr, size, static_cast<int>( bufDesc.dmaHandle ) );
...
        fd = rpcmem_to_fd( static_cast<void *>( ptr ) );
...
        ret = fastrpc_mmap( extDomainId, fd, ptr, 0, size, FASTRPC_MAP_FD_DELAYED );
```

OpenclIface.cpp (https://github.com/qualcomm/QcNode/blob/main/source/Library/OpenclIface/OpenclIface.cpp, lines 422–430):

```cpp
                cl_mem_dmabuf_host_ptr clBufHostPtr = { 0 };
                clBufHostPtr.dmabuf_filedesc = static_cast<int>( buffer.dmaHandle );
                clBufHostPtr.ext_host_ptr.allocation_type = CL_MEM_DMABUF_HOST_PTR_QCOM;
                clBufHostPtr.ext_host_ptr.host_cache_policy = CL_MEM_HOST_UNCACHED_QCOM;
                clBufHostPtr.dmabuf_hostptr = buffer.pBuf;
                cl_mem_flags flags = static_cast<cl_mem_flags>( CL_MEM_USE_HOST_PTR ) |
                                     static_cast<cl_mem_flags>( CL_MEM_EXT_HOST_PTR_QCOM );
                bufferCL = clCreateBuffer( m_context, flags, buffer.size, &clBufHostPtr, &retCL );
```

(and lines 487–497 the same for images with `CL_MEM_HOST_IOCOHERENT_QCOM`).
So the dma-buf is shared between DSP (FastRPC) and GPU (Adreno CL driver) with
no copy — exactly our target shape.

Second Qualcomm-org example, gst-plugins-imsdk
(https://github.com/qualcomm/gst-plugins-imsdk/blob/main/gst-plugin-overlay/overlay-lib/overlay_lib.cc, lines 362–388):
reuses the ion struct layout (identical field layout) with the dmabuf token:

```cpp
  mem_flags |= CL_MEM_READ_WRITE;
  mem_flags |= CL_MEM_USE_HOST_PTR;
  mem_flags |= CL_MEM_EXT_HOST_PTR_QCOM;

  cl_mem_ion_host_ptr ionmem { };
#ifdef HAVE_CL_EXT_QCOM_H
  ionmem.ext_host_ptr.allocation_type   = CL_MEM_DMABUF_HOST_PTR_QCOM;
  ionmem.ext_host_ptr.host_cache_policy = CL_MEM_HOST_IOCOHERENT_QCOM;
#else
  ionmem.ext_host_ptr.allocation_type = CL_MEM_ION_HOST_PTR_QCOM;
  ionmem.ext_host_ptr.host_cache_policy = CL_MEM_HOST_WRITEBACK_QCOM;
#endif
  ionmem.ion_hostptr = vaddr;
  ionmem.ion_filedesc = fd;
```

### Host access sync

From `cl_qcom_ion_host_ptr.txt`:

> "Once the memory object is created, the application must call
> clEnqueueMapBuffer/clEnqueueMapImage with appropriate flags before reading or
> writing to it on the host. ... clEnqueueMapBuffer and clEnqueueMapImage act as
> synchronization points for the region of the buffer object being mapped."

Not found anywhere: a public spec of `cl_qcom_dmabuf_host_ptr` beyond the header;
any fd-offset support (no offset field exists); any mesa/rusticl/freedreno
reference to the extension (GitHub-wide code search for `cl_mem_dmabuf_host_ptr`
returns only the vendor/app repos cited above — the proprietary Adreno CL driver
is the only implementation).

## 3. cl_qcom_android_ahardwarebuffer_host_ptr as alternative — possible but worse

Defined in the same vendor headers (`cl_ext.h` QCOM section; SM8550 dump
https://github.com/EraserCN/Ximi13-Sauce-Dump/blob/main/outCpp_t/android-t-qcom/vendor/xiaomi/frameworks/av/services/camera/libcameraservice/privacy/include/CL/cl_ext.h, lines 426–441):

```c
/*********************************
* cl_qcom_ahardwarebuffer_host_ptr extension
*********************************/

#define CL_MEM_ANDROID_AHARDWAREBUFFER_HOST_PTR_QCOM                0x4119

typedef struct _cl_mem_ahardwarebuffer_host_ptr
{
    /* Type of external memory allocation. */
    /* Must be CL_MEM_ANDROID_AHARDWAREBUFFER_HOST_PTR_QCOM for Android Hardware buffers. */
    cl_mem_ext_host_ptr  ext_host_ptr;

    /* Virtual pointer to the android hardware buffer */
    void*                ahb_ptr;

} cl_mem_ahardwarebuffer_host_ptr;
```

It takes an `AHardwareBuffer*`, i.e. a gralloc-allocated buffer. Per Qualcomm's
guide §7.4.2.3 it exists to share **AHBs** (allocated by the Android graphics
allocator) with OpenCL. Wrapping an arbitrary rpcmem dmabuf in an AHB would need
`AHardwareBuffer_createFromHandle` — a VNDK-private API
(https://android.googlesource.com/platform/frameworks/native/+/master/libs/nativewindow/include/vndk/hardware_buffer.h,
`AHARDWAREBUFFER_CREATE_FROM_HANDLE_METHOD_REGISTER`) whose success depends on
gralloc accepting the raw handle. Not worth it: `cl_qcom_dmabuf_host_ptr` takes
the fd directly. Keep as fallback only if the dmabuf path fails.

## Bottom line for the one-copy GPU path

1. `rpcmem_alloc` → `rpcmem_to_fd(ptr)` → pass `fd` + `ptr` (mmap of the same
   allocation) in a locally declared `cl_mem_dmabuf_host_ptr` with
   `allocation_type = CL_MEM_DMABUF_HOST_PTR_QCOM (0x411D)`,
   `host_cache_policy = CL_MEM_HOST_UNCACHED_QCOM (0x40A4)` (or
   `CL_MEM_HOST_IOCOHERENT_QCOM (0x40A9)` if the allocation is io-coherent/cached+synced),
   `clCreateBuffer(..., CL_MEM_READ_WRITE | CL_MEM_USE_HOST_PTR | CL_MEM_EXT_HOST_PTR_QCOM (1<<29), size, &struct, ...)`.
2. Requirements: `ptr` page-aligned (query `CL_DEVICE_PAGE_SIZE_QCOM 0x40A1` to
   verify), allocation sized with `CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM
   0x40A0` slack (rpcmem page granularity provides it), no offset field.
3. Same buffer may stay mapped for the DSP via FastRPC — Qualcomm's QcNode does
   exactly this concurrently.
4. Guard with `strstr(extensions, "cl_qcom_dmabuf_host_ptr")` at runtime; fall
   back to plain `CL_MEM_USE_HOST_PTR` (copying) path otherwise.

## Source URLs

- Qualcomm `cl_ext_qcom.h` (struct def): https://github.com/lijun99/clAmpcor/blob/main/include/CL/cl_ext_qcom.h (L378–397); mirror: https://github.com/comprehensive9/vendor_qcom_proprietary/blob/main/graphics/r-bins/include/public/CL/cl_ext_qcom.h
- Khronos OpenCL-Headers `cl_ext.h` (base struct, ion, cache tokens): https://github.com/KhronosGroup/OpenCL-Headers/blob/main/CL/cl_ext.h (QCOM section ~L1332–1444; no dmabuf entry)
- `cl_qcom_ext_host_ptr` spec: https://github.com/KhronosGroup/OpenCL-Registry/blob/main/extensions/qcom/cl_qcom_ext_host_ptr.txt
- `cl_qcom_ion_host_ptr` spec (usage rules shared by the layered dmabuf extension): https://github.com/KhronosGroup/OpenCL-Registry/blob/main/extensions/qcom/cl_qcom_ion_host_ptr.txt
- Qualcomm OpenCL guide 80-NB295-11 Rev. C (§7.4.2, p. 58): https://docs.qualcomm.com/bundle/publicresource/80-NB295-11_REV_C_Qualcomm_Snapdragon_Mobile_Platform_Opencl_General_Programming_and_Optimization.pdf
- Qualcomm QcNode (rpcmem + dmabuf-in-OpenCL): https://github.com/qualcomm/QcNode/blob/main/source/Library/OpenclIface/OpenclIface.cpp (L422–430, L487–497), https://github.com/qualcomm/QcNode/blob/main/source/Library/FadasIface/FadasSrv.cpp (L515–530)
- Qualcomm gst-plugins-imsdk: https://github.com/qualcomm/gst-plugins-imsdk/blob/main/gst-plugin-overlay/overlay-lib/overlay_lib.cc (L362–388)
- SM8550 vendor dump cl_ext.h (AHB variant): https://github.com/EraserCN/Ximi13-Sauce-Dump/blob/main/outCpp_t/android-t-qcom/vendor/xiaomi/frameworks/av/services/camera/libcameraservice/privacy/include/CL/cl_ext.h (L426–441)
- AHardwareBuffer_createFromHandle (VNDK, for the AHB alternative): https://android.googlesource.com/platform/frameworks/native/+/master/libs/nativewindow/include/vndk/hardware_buffer.h
