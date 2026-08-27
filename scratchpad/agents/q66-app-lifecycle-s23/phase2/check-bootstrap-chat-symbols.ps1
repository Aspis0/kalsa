[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $CppCommonRoot
)

$ErrorActionPreference = 'Stop'

# Phase-3 gate: run this after llama.rn bootstrap has generated cpp/common.
# The pinned fork already supplies the caps/variant API. If bootstrap patches
# add the same definitions, fail before any native compile.
$headerPath = Join-Path $CppCommonRoot 'chat.h'
$sourcePath = Join-Path $CppCommonRoot 'chat.cpp'
$commonParamsPath = Join-Path $CppCommonRoot 'common.h'
if (-not (Test-Path -LiteralPath $headerPath) -or -not (Test-Path -LiteralPath $sourcePath) -or -not (Test-Path -LiteralPath $commonParamsPath)) {
    Write-Error "bootstrap chat files not found under '$CppCommonRoot'"
    exit 2
}

$header = Get-Content -LiteralPath $headerPath -Raw
$source = Get-Content -LiteralPath $sourcePath -Raw
$commonParams = Get-Content -LiteralPath $commonParamsPath -Raw

function Assert-OneMatch([string] $Label, [string] $Text, [string] $Pattern) {
    $count = [regex]::Matches($Text, $Pattern).Count
    Write-Output "$Label=$count"
    if ($count -ne 1) {
        throw "Phase-3 bootstrap duplicate/missing definition: $Label (expected 1, got $count)"
    }
}

# Keep the overload-specific pattern so the pre-existing one-argument caps API
# is not mistaken for the pinned fork's variant API.
Assert-OneMatch 'chat_caps_struct' $header '(?m)^\s*struct\s+common_chat_template_caps\s*\{'
Assert-OneMatch 'chat_has_variant_declaration' $header '(?ms)\bbool\s+common_chat_templates_has_variant\s*\(\s*const\s+struct\s+common_chat_templates\s*\*[^,;]*,\s*const\s+std::string\s*&'
Assert-OneMatch 'chat_has_variant_definition' $source '(?ms)^\s*bool\s+common_chat_templates_has_variant\s*\(\s*const\s+common_chat_templates\s*\*[^,;]*,\s*const\s+std::string\s*&'
Assert-OneMatch 'chat_get_caps_variant_declaration' $header '(?ms)\bcommon_chat_template_caps\s+common_chat_templates_get_caps\s*\(\s*const\s+struct\s+common_chat_templates\s*\*[^,;]*,\s*const\s+std::string\s*&'
Assert-OneMatch 'chat_get_caps_variant_definition' $source '(?ms)^\s*common_chat_template_caps\s+common_chat_templates_get_caps\s*\(\s*const\s+common_chat_templates\s*\*[^,;]*,\s*const\s+std::string\s*&'

# common.h.patch must be removed in Phase 3. These checks catch its three
# silent duplicate-member hunks as well as an accidental duplicate of the
# already-pinned activation field.
Assert-OneMatch 'common_reasoning_budget_activate_immediately' $commonParams '(?m)^\s*bool\s+reasoning_budget_activate_immediately\s*=\s*false\s*;'
Assert-OneMatch 'common_vocabulary_only' $commonParams '(?m)^\s*bool\s+vocab_only\s*=\s*false\s*;'
Assert-OneMatch 'common_progress_callback' $commonParams '(?m)^\s*llama_progress_callback\s+progress_callback\s*=\s*(?:nullptr|NULL)\s*;'
Assert-OneMatch 'common_progress_callback_user_data' $commonParams '(?m)^\s*void\s*\*\s+progress_callback_user_data\s*=\s*(?:nullptr|NULL)\s*;'

Write-Output 'BOOTSTRAP_CHAT_SYMBOL_GATE=PASS'
