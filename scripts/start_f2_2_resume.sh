#!/usr/bin/env bash
# LEGACY / UNSAFE — refused.
# Old resume used phase=F2.2, cooldown=20, and broad pkill -f.
# Compliant path: start_f2_2c.sh (phase F2.2c, cooldown 180, cool≤30, no pkill).
set -euo pipefail
echo "ERROR: start_f2_2_resume.sh is retired (noncompliant F2.2 protocol)." >&2
echo "Use: bash \$HOME/experiments/scripts/start_f2_2c.sh" >&2
echo "Rules: phase F2.2c, cooldown≥180s, cool temp≤30.0°C, build-safe only, no pkill." >&2
exit 3
