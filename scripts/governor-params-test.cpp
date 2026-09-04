#include "../node_modules/llama.rn/cpp/rn-governor-params.h"

#include <cstdio>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const char * message) {
    if (!condition) {
        std::fprintf(stderr, "governor-params-test: %s\n", message);
        throw std::runtime_error(message);
    }
}

} // namespace

int main() {
    using nlohmann::ordered_json;

    const ordered_json minimal = {
        {"enabled", true},
        {"thermo", {
            {"sensor_valid", true},
            {"batt_temp_tenths_c", 350},
        }},
    };

    llama_governor_params params{};
    llama_governor_thermo_profile thermo{};
    require(rnllama::parse_governor_params(minimal, params, thermo), "minimal params did not parse");
    require(params.gpu_fit == llama_governor_fit::Unknown, "gpu_fit default changed");
    require(!params.reload_budget_available, "reload budget default must be false");
    require(thermo.sensor_valid && thermo.batt_level_pct == 100, "thermo defaults changed");

    auto full = minimal;
    full["generation"] = "V75";
    full["model_kind"] = "MoE";
    full["gpu_fit"] = "Fit";
    full["npu_fit"] = "NotFit";
    full["htp_trunk_readable"] = true;
    full["htp_experts_readable"] = true;
    full["cool_pays"] = "Yes";
    full["admission_margin_c"] = 0.5f;
    full["expert_substitution_lambda"] = 0.25f;
    require(rnllama::parse_governor_params(full, params, thermo), "full params did not parse");
    require(params.generation == llama_governor_generation::V75, "generation was not parsed");
    require(params.model_kind == llama_governor_model_kind::MoE, "model kind was not parsed");
    require(params.gpu_fit == llama_governor_fit::Fit, "gpu fit was not parsed");
    require(params.npu_fit == llama_governor_fit::NotFit, "npu fit was not parsed");
    require(params.htp_trunk_readable && params.htp_experts_readable, "capability flags were not parsed");

    auto explicit_reload = minimal;
    explicit_reload["reload_budget_available"] = true;
    require(rnllama::parse_governor_params(explicit_reload, params, thermo), "explicit reload params failed");
    require(params.reload_budget_available, "explicit reload budget was ignored");

    auto invalid_thermo = minimal;
    invalid_thermo["thermo"]["sensor_valid"] = false;
    bool invalid_rejected = false;
    try {
        rnllama::parse_governor_params(invalid_thermo, params, thermo);
    } catch (const std::invalid_argument & error) {
        invalid_rejected = std::string(error.what()) == "governor: thermo profile invalid";
    }
    require(invalid_rejected, "invalid thermo did not fail with the required error");

    const ordered_json disabled = {{"enabled", false}};
    require(!rnllama::parse_governor_params(disabled, params, thermo), "disabled governor enabled itself");

    std::puts("governor_params=PASS");
    return 0;
}
