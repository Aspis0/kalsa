#include "dispatch.h"

#include <cctype>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace bmoe {
namespace kernel {
namespace {

std::string to_upper(std::string s) {
    for (char & c : s) {
        c = (char) std::toupper((unsigned char) c);
    }
    return s;
}

bool contains_ci(const std::string & hay, const char * needle) {
    const std::string h = to_upper(hay);
    const std::string n = to_upper(needle);
    return h.find(n) != std::string::npos;
}

std::string read_first_line(const char * path) {
    std::ifstream in(path);
    std::string line;
    if (in) std::getline(in, line);
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' ')) {
        line.pop_back();
    }
    return line;
}

std::string read_file_blob(const char * path, std::size_t cap = 8192) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::string s(cap, '\0');
    in.read(&s[0], (std::streamsize) cap);
    s.resize((std::size_t) in.gcount());
    return s;
}

int parse_memtotal_kb(const std::string & meminfo) {
    const auto pos = meminfo.find("MemTotal:");
    if (pos == std::string::npos) return 0;
    std::size_t i = pos + 9;
    while (i < meminfo.size() && (meminfo[i] == ' ' || meminfo[i] == '\t'))
        ++i;
    int kb = 0;
    while (i < meminfo.size() && meminfo[i] >= '0' && meminfo[i] <= '9') {
        kb = kb * 10 + (meminfo[i] - '0');
        ++i;
    }
    return kb;
}

struct TableRow {
    SocClass soc;
    GeometryClass geo; // Unknown = wildcard (any geometry on this SoC)
    int n_threads;
    int n_expert_used;
    float drop_cold_frac;
    const char * key;
    const char * reason;
};

// Seeded from the measured U-curves (kernel-plan-v1 §1, v2 §1, S2/S3, xiaomi t4
// round, lineup-card, moe-g99-freetier). Host/Unknown keep engine defaults so a
// PC `--kernel-dispatch` run is config-equivalent to dispatch off.
//
// More-specific rows (named geometry) must come before the SoC wildcard.
// ram_mb is not a match key: the table cannot express RAM tiers until the
// first-launch probe exists. Until then these static rows win.
constexpr TableRow kTable[] = {
    {SocClass::Sd8Gen2, GeometryClass::Mellum, 2, 6, 1.0f, "sd8gen2/mellum",
     "S23 t2 k6d10: compute floor 0.148 s/tok, wall 5.151 (stock vec_dot)"},
    {SocClass::Sd8Gen2, GeometryClass::Unknown, 2, 0, 0.0f, "sd8gen2/*",
     "S23/8Gen2 thread U-curve: t2 beats t4 (0.181 vs 0.228 at k8; 0.148 at k6d10)"},

    {SocClass::Sm8650, GeometryClass::Unknown, 4, 0, 0.0f, "sm8650/*",
     "SM8650 thread U-curve: t4>t5>t6 (Marco 8.58 Dozing / 10.57 Awake at t4; t6 4.11)"},

    {SocClass::HelioG99, GeometryClass::Lfm2Moe, 2, 4, 0.0f, "g99/lfm2moe",
     "G99 t2, LFM2.5 default k=4: 10.60 tok/s resident"},
    {SocClass::HelioG99, GeometryClass::Unknown, 2, 0, 0.0f, "g99/*",
     "G99 thread U-curve: t2 (2xA76); big streamed MoEs ranking-only"},

    {SocClass::Host, GeometryClass::Unknown, 4, 0, 0.0f, "host/*",
     "desktop/CI: engine defaults (t=4, model k, drop off) — config-equivalent"},
    {SocClass::Unknown, GeometryClass::Unknown, 4, 0, 0.0f, "unknown/*", "unrecognised SoC: engine defaults"},
};

} // namespace

SocClass classify_soc(const char * raw) {
    if (!raw || !*raw) return SocClass::Unknown;
    const std::string s = raw;
    // Snapdragon 8 Gen 2 / SM8550 (S23). "kalama" is the Qualcomm internal name.
    if (contains_ci(s, "SM8550") || contains_ci(s, "8 GEN 2") || contains_ci(s, "8GEN2") || contains_ci(s, "KALAMA")) {
        return SocClass::Sd8Gen2;
    }
    // Snapdragon 8 Gen 3 / SM8650 (Xiaomi 14). "pineapple" / "houji".
    if (contains_ci(s, "SM8650") || contains_ci(s, "8 GEN 3") || contains_ci(s, "8GEN3") ||
        contains_ci(s, "PINEAPPLE")) {
        return SocClass::Sm8650;
    }
    // Helio G99 / MT6789 (Jelly Star).
    if (contains_ci(s, "MT6789") || contains_ci(s, "G99") || contains_ci(s, "HELIO G99")) {
        return SocClass::HelioG99;
    }
    if (contains_ci(s, "X86") || contains_ci(s, "AMD") || contains_ci(s, "INTEL") || contains_ci(s, "HOST")) {
        return SocClass::Host;
    }
    return SocClass::Unknown;
}

GeometryClass classify_geometry(const ModelGeometry & geo) {
    // Named-arch checks first: a qwen3moe-family model with 32 experts / 2048
    // embd (Marco1c class) must not be classified as Lfm2Moe by the shape
    // heuristic. Mellum is also qwen3moe-family; its unique shape still wins.
    if (contains_ci(geo.arch, "lfm2moe") || contains_ci(geo.arch, "lfm2")) {
        return GeometryClass::Lfm2Moe;
    }
    if (contains_ci(geo.arch, "qwen3moe") || contains_ci(geo.arch, "qwen3.5moe") ||
        contains_ci(geo.arch, "qwen3.6moe")) {
        if (geo.n_embd == 2304 && geo.n_ff == 896 && geo.n_expert == 64) {
            return GeometryClass::Mellum;
        }
        return GeometryClass::Qwen3Moe;
    }
    if (geo.n_embd == 2304 && geo.n_ff == 896 && geo.n_expert == 64) {
        return GeometryClass::Mellum;
    }
    if (geo.n_expert == 32 && (geo.n_embd == 2048 || geo.n_embd == 0)) {
        return GeometryClass::Lfm2Moe;
    }
    if (geo.n_expert == 128 && (geo.n_embd == 2048 || geo.n_embd == 0)) {
        return GeometryClass::Qwen3Moe;
    }
    return GeometryClass::Unknown;
}

DeviceProfile detect_device() {
    DeviceProfile d;

#if defined(_WIN32)
    SYSTEM_INFO si;
    GetNativeSystemInfo(&si);
    MEMORYSTATUSEX ms;
    ms.dwLength = sizeof(ms);
    if (GlobalMemoryStatusEx(&ms)) {
        d.ram_mb = (int) (ms.ullTotalPhys / (1024ull * 1024ull));
    }
#if defined(_M_X64) || defined(__x86_64__)
    d.soc_raw = "x86_64";
#elif defined(_M_ARM64) || defined(__aarch64__)
    d.soc_raw = "arm64-windows";
#else
    d.soc_raw = "windows";
#endif
    d.soc = SocClass::Host;
    d.detect_note = "win32 host (desktop/CI defaults)";
    (void) si;
    return d;
#else
    const std::string cpuinfo = read_file_blob("/proc/cpuinfo");
    const std::string soc0_machine = read_first_line("/sys/devices/soc0/machine");
    const std::string soc0_family = read_first_line("/sys/devices/soc0/family");
    const std::string soc0_soc_id = read_first_line("/sys/devices/soc0/soc_id");

    std::string hardware;
    {
        const auto pos = cpuinfo.find("Hardware");
        if (pos != std::string::npos) {
            auto nl = cpuinfo.find('\n', pos);
            hardware = cpuinfo.substr(pos, nl == std::string::npos ? std::string::npos : nl - pos);
        }
    }

    std::ostringstream raw;
    if (!soc0_machine.empty()) raw << soc0_machine << ' ';
    if (!soc0_family.empty()) raw << soc0_family << ' ';
    if (!soc0_soc_id.empty()) raw << soc0_soc_id << ' ';
    if (!hardware.empty()) raw << hardware;
    d.soc_raw = raw.str();
    while (!d.soc_raw.empty() && d.soc_raw.back() == ' ')
        d.soc_raw.pop_back();

    const int mem_kb = parse_memtotal_kb(read_file_blob("/proc/meminfo", 4096));
    if (mem_kb > 0) d.ram_mb = mem_kb / 1024;

    d.soc = classify_soc(d.soc_raw.c_str());
    if (d.soc == SocClass::Unknown) {
        // Desktop Linux / CI: no Qualcomm/MediaTek identifiers.
        if (d.soc_raw.empty() || contains_ci(cpuinfo, "GenuineIntel") || contains_ci(cpuinfo, "AuthenticAMD") ||
            contains_ci(cpuinfo, "model name")) {
            d.soc = SocClass::Host;
            if (d.soc_raw.empty()) d.soc_raw = "host";
        }
    }

    std::ostringstream note;
    note << "soc=" << soc_class_name(d.soc) << " raw='" << d.soc_raw << "' ram_mb=" << d.ram_mb;
    d.detect_note = note.str();
    return d;
#endif
}

DispatchDecision resolve_dispatch(const DeviceProfile & dev, const ModelGeometry & geo) {
    const GeometryClass gclass = classify_geometry(geo);

    const TableRow * hit = nullptr;
    for (const TableRow & row : kTable) {
        if (row.soc != dev.soc) continue;
        if (row.geo != GeometryClass::Unknown && row.geo != gclass) continue;
        hit = &row;
        break;
    }
    if (!hit) {
        for (const TableRow & row : kTable) {
            if (row.soc == SocClass::Unknown && row.geo == GeometryClass::Unknown) {
                hit = &row;
                break;
            }
        }
    }

    DispatchDecision out;
    out.soc = dev.soc;
    out.geo = gclass;
    out.impl = kMulMatIdChampion;
    if (!hit) return out; // engine defaults already in DispatchDecision
    out.n_threads = hit->n_threads;
    out.n_expert_used = hit->n_expert_used;
    out.drop_cold_frac = hit->drop_cold_frac;
    out.table_key = hit->key;
    out.reason = hit->reason;
    return out;
}

DispatchApplied apply_dispatch(
    const DispatchDecision & row, int cur_threads, int cur_expert_used, float cur_drop, DispatchApplyFlags flags) {
    DispatchApplied a;
    a.n_threads = cur_threads;
    a.n_expert_used = cur_expert_used;
    a.drop_cold_frac = cur_drop;
    a.output_changing_row = (row.n_expert_used > 0 || row.drop_cold_frac > 0.0f);
    if (!flags.user_set_threads) {
        a.n_threads = row.n_threads;
        a.applied_threads = true;
    }
    if (!flags.user_set_expert_used && row.n_expert_used > 0) {
        a.n_expert_used = row.n_expert_used;
        a.applied_expert_used = true;
    }
    if (!flags.user_set_drop && row.drop_cold_frac > 0.0f) {
        a.drop_cold_frac = row.drop_cold_frac;
        a.applied_drop = true;
    }
    return a;
}

#ifndef BMOE_HAVE_LLAMA
bool probe_geometry(const char * model_path, ModelGeometry & out) {
    (void) model_path;
    (void) out;
    return false;
}
#endif

const char * soc_class_name(SocClass s) {
    switch (s) {
    case SocClass::Unknown:
        return "unknown";
    case SocClass::Host:
        return "host";
    case SocClass::Sd8Gen2:
        return "sd8gen2";
    case SocClass::Sm8650:
        return "sm8650";
    case SocClass::HelioG99:
        return "g99";
    }
    return "unknown";
}

const char * geometry_class_name(GeometryClass g) {
    switch (g) {
    case GeometryClass::Unknown:
        return "unknown";
    case GeometryClass::Mellum:
        return "mellum";
    case GeometryClass::Qwen3Moe:
        return "qwen3moe";
    case GeometryClass::Lfm2Moe:
        return "lfm2moe";
    }
    return "unknown";
}

AutobenchResult run_autobench_stub(const AutobenchRequest & req) {
    (void) req;
    AutobenchResult r;
    r.ran = false;
    r.cache_hit = false;
    r.note = "TODO: first-launch micro-bench not implemented; static table used";
    return r;
}

} // namespace kernel
} // namespace bmoe
