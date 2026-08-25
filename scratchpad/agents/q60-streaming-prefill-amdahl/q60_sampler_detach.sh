#!/system/bin/sh

if [ "$#" -lt 2 ]; then
    echo 'usage: q60_sampler_detach.sh <pid> <csv> [interval_s]' >&2
    exit 64
fi

mkdir -p /data/local/tmp/q60_sampler
nohup /data/local/tmp/q60_sampler.sh "$1" "$2" "${3:-1}" </dev/null >/dev/null 2>&1 &
echo "SAMPLER_PID=$!"

