#!/data/data/com.termux/files/usr/bin/bash
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export LD_LIBRARY_PATH=$PREFIX/lib
export TERM=xterm-256color
export DEBIAN_FRONTEND=noninteractive
mkdir -p "$TMPDIR" "$HOME"
echo "PATH=$PATH"
which pkg apt bash
pkg update -y
pkg install -y termux-api openssh
which termux-wake-lock
termux-wake-lock
echo WAKELOCK_RC=$?
termux-battery-status || true