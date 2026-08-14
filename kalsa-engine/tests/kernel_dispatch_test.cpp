// Unit tests for the kernel dispatcher table. Pure policy — no model, no llama.cpp.
//
// The HOST/Unknown rows must resolve to the engine defaults (t=4, k=0, drop=0,
// stock vec_dot) so a PC `--kernel-dispatch` run is config-equivalent to dispatch off.

#include "kernel/dispatch.h"

#include <cstddef>
#include <cstdio>
#include <cstring>

using namespace bmoe::kernel;

static int failures = 0;

static void expect(const char * name, bool ok) {
    if (ok) {
        std::printf("[PASS] %s\n", name);
    } else {
        std::printf("[FAIL] %s\n", name);
        ++failures;
    }
}

int main() {
    {
        DeviceProfile d;
        d.soc = SocClass::Host;
        d.ram_mb = 32768;
        const DispatchDecision dec = resolve_dispatch(d, ModelGeometry{});
        expect("host threads == 4", dec.n_threads == 4);
        expect("host k == 0 (model default)", dec.n_expert_used == 0);
        expect("host drop == 0", dec.drop_cold_frac == 0.0f);
        expect("host impl is stock vec_dot", dec.impl == kMulMatIdChampion);
        expect("host table key", std::strcmp(dec.table_key, "host/*") == 0);
    }
    {
        DeviceProfile d;
        d.soc = SocClass::Unknown;
        const DispatchDecision dec = resolve_dispatch(d, ModelGeometry{});
        expect("unknown SoC threads == 4", dec.n_threads == 4);
        expect("unknown SoC k == 0", dec.n_expert_used == 0);
        expect("unknown SoC drop == 0", dec.drop_cold_frac == 0.0f);
    }
    {
        DeviceProfile d;
        d.soc = SocClass::Sd8Gen2;
        const DispatchDecision dec = resolve_dispatch(d, ModelGeometry{});
        expect("sd8gen2 wildcard t=2", dec.n_threads == 2);
        expect("sd8gen2 wildcard k=0", dec.n_expert_used == 0);
    }
    {
        DeviceProfile d;
        d.soc = SocClass::Sd8Gen2;
        ModelGeometry g;
        g.n_embd = 2304;
        g.n_ff = 896;
        g.n_expert = 64;
        const DispatchDecision dec = resolve_dispatch(d, g);
        expect("sd8gen2+mellum t=2", dec.n_threads == 2);
        expect("sd8gen2+mellum k=6", dec.n_expert_used == 6);
        expect("sd8gen2+mellum drop=1.0", dec.drop_cold_frac == 1.0f);
        expect("sd8gen2+mellum geo class", dec.geo == GeometryClass::Mellum);
        expect("sd8gen2+mellum key", std::strcmp(dec.table_key, "sd8gen2/mellum") == 0);
    }
    {
        DeviceProfile d;
        d.soc = SocClass::Sm8650;
        const DispatchDecision dec = resolve_dispatch(d, ModelGeometry{});
        expect("sm8650 t=4", dec.n_threads == 4);
    }
    {
        DeviceProfile d;
        d.soc = SocClass::HelioG99;
        ModelGeometry g;
        g.arch = "lfm2moe";
        const DispatchDecision dec = resolve_dispatch(d, g);
        expect("g99+lfm t=2", dec.n_threads == 2);
        expect("g99+lfm k=4", dec.n_expert_used == 4);
    }
    {
        // Arch check before shape heuristics: qwen3moe + 32 experts is Marco1c,
        // not Lfm2Moe.
        ModelGeometry g;
        g.arch = "qwen3moe";
        g.n_embd = 2048;
        g.n_ff = 768;
        g.n_expert = 32;
        expect("qwen3moe+32exp is Qwen3Moe not Lfm2Moe", classify_geometry(g) == GeometryClass::Qwen3Moe);
        g.arch = "qwen3moe";
        g.n_embd = 2304;
        g.n_ff = 896;
        g.n_expert = 64;
        expect("qwen3moe+mellum shape is Mellum", classify_geometry(g) == GeometryClass::Mellum);
    }
    {
        // User/env flags win over the table.
        DeviceProfile d;
        d.soc = SocClass::Sd8Gen2;
        ModelGeometry g;
        g.n_embd = 2304;
        g.n_ff = 896;
        g.n_expert = 64;
        const DispatchDecision row = resolve_dispatch(d, g);
        expect("mellum row is output-changing", row.n_expert_used == 6 && row.drop_cold_frac == 1.0f);

        DispatchApplyFlags none;
        const DispatchApplied applied = apply_dispatch(row, 8, 0, 0.0f, none);
        expect("no-user applies threads", applied.applied_threads && applied.n_threads == 2);
        expect("no-user applies k", applied.applied_expert_used && applied.n_expert_used == 6);
        expect("no-user applies drop", applied.applied_drop && applied.drop_cold_frac == 1.0f);
        expect("row flagged output-changing", applied.output_changing_row);

        DispatchApplyFlags user_t;
        user_t.user_set_threads = true;
        const DispatchApplied keep_t = apply_dispatch(row, 8, 0, 0.0f, user_t);
        expect("user -t wins", !keep_t.applied_threads && keep_t.n_threads == 8);
        expect("user -t still applies k", keep_t.applied_expert_used && keep_t.n_expert_used == 6);

        DispatchApplyFlags user_all;
        user_all.user_set_threads = true;
        user_all.user_set_expert_used = true;
        user_all.user_set_drop = true;
        const DispatchApplied keep = apply_dispatch(row, 8, 2, 0.3f, user_all);
        expect("user k wins", !keep.applied_expert_used && keep.n_expert_used == 2);
        expect("user drop wins", !keep.applied_drop && keep.drop_cold_frac == 0.3f);
        expect("user-all still flags output-changing row", keep.output_changing_row);
    }
    {
        expect("classify SM8550", classify_soc("Qualcomm SM8550") == SocClass::Sd8Gen2);
        expect("classify kalama", classify_soc("kalama") == SocClass::Sd8Gen2);
        expect("classify SM8650", classify_soc("SM8650 pineapple") == SocClass::Sm8650);
        expect("classify MT6789", classify_soc("MT6789V/CD") == SocClass::HelioG99);
        expect("classify x86", classify_soc("x86_64") == SocClass::Host);
    }
    {
        const DeviceProfile live = detect_device();
        const DispatchDecision dec = resolve_dispatch(live, ModelGeometry{});
        expect("live detect yields a named SoC", live.soc != SocClass::Unknown);
        expect("live resolve keeps champion impl", dec.impl == MulMatIdImpl::StockVecDot);
        // This test runs on the PC: Host must keep engine defaults.
        if (live.soc == SocClass::Host) {
            expect("live host t=4", dec.n_threads == 4);
            expect("live host k=0", dec.n_expert_used == 0);
            expect("live host drop=0", dec.drop_cold_frac == 0.0f);
        }
        std::printf("  live: soc=%s raw='%s' ram_mb=%d key=%s\n", soc_class_name(live.soc), live.soc_raw.c_str(),
                    live.ram_mb, dec.table_key);
    }
    {
        AutobenchRequest req;
        req.device.soc = SocClass::Host;
        const AutobenchResult r = run_autobench_stub(req);
        expect("autobench stub does not run", !r.ran);
        expect("autobench stub is not a cache hit", !r.cache_hit);
    }
    {
        expect("contract champion is stock vec_dot", kMulMatIdChampion == MulMatIdImpl::StockVecDot);
        expect("contract NMSE cap is 5e-4", kMulMatIdNmseLimit == 5e-4);
        expect("contract has the S2 7 shapes", kMulMatIdContractShapeCount == 7);
        bool saw_n2 = false;
        for (std::size_t i = 0; i < kMulMatIdContractShapeCount; ++i) {
            if (kMulMatIdContractShapes[i].n_tokens == 2) {
                saw_n2 = true;
                expect("n_tokens=2 is not fused-legal", !kMulMatIdContractShapes[i].fused_legal);
            }
        }
        expect("prefill n=2 is in the contract", saw_n2);
    }

    if (failures) {
        std::printf("%d failure(s)\n", failures);
        return 1;
    }
    std::printf("kernel_dispatch: all passed\n");
    return 0;
}
