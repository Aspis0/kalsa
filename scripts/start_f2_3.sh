#!/usr/bin/env bash
# LEGACY / UNSAFE — refused.
# Old starter used phase=F2.3, cooldown=25, and broad pkill -f.
# Compliant path: start_f2_3c.sh (phase F2.3c, cooldown 180, cool≤30, size gate, no pkill).
set -euo pipefail
echo "ERROR: start_f2_3.sh is retired (noncompliant F2.3 protocol)." >&2
echo "Use: bash \$HOME/experiments/scripts/start_f2_3c.sh" >&2
echo "Rules: phase F2.3c, cooldown≥180s, cool temp≤30.0°C, LFM2 size=5044779712, no pkill." >&2
exit 3
