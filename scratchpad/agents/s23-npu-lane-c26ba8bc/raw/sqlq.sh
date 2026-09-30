#!/usr/bin/env bash
# usage: sqlq.sh "SQL"   (device DB read via ci-lib sql helper)
S=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
source /tmp/s23env.sh
sql "$1"
echo "SQL_EXIT=$?"
