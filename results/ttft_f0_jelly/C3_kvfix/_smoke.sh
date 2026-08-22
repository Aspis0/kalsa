#!/data/data/com.termux/files/usr/bin/bash
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/src/BigMoeOnEdge/build-kvfix/bin"
chmod 755 "$HOME/bin/bmoe-cli-kvfix"
chmod 755 "$HOME/experiments/results/ttft_f0_jelly/C3_kvfix/run_c3_kvfix.sh"
echo "=== CAMPAIGN PIN ==="
sha256sum "$HOME/bin/bmoe-cli" "$HOME/bin/bmoe-cli.JELLY"
echo "=== KVFIX ELF ==="
ls -l "$HOME/bin/bmoe-cli-kvfix"
sha256sum "$HOME/bin/bmoe-cli-kvfix"
echo "=== LIBS ==="
ls -l "$HOME/src/BigMoeOnEdge/build-kvfix/bin"
echo "=== VERSION ==="
"$HOME/bin/bmoe-cli-kvfix" --version
echo "=== LIST ARCH ==="
"$HOME/bin/bmoe-cli-kvfix" --list-archs
echo "=== LOAD SMOKE ==="
timeout 45 "$HOME/bin/bmoe-cli-kvfix" -m "$HOME/models/Qwen3.5-2B-Q4_K_M.gguf" --session --chatml --no-think -t 2 -c 512 --ubatch 128 --temp 0 -n 1 <<'EOF'
{"cmd":"generate","id":1,"prompt":"Reply with the single word: hello.","n_predict":1,"think":false,"clear_kv":true}
{"cmd":"close"}
EOF
echo smoke_rc=$?
echo "=== BATTERY ==="
timeout 5 termux-api-start >/dev/null 2>&1 || true
sleep 1
timeout 10 termux-battery-status
echo "=== C3 SHA ==="
sha256sum "$HOME/experiments/results/ttft_f0_jelly/prompts/c3_reuse.jsonl"
