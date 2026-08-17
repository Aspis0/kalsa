# Device input

Superseded by `scripts/device-share-send.sh` (turn delivery) and
`scripts/device-env.sh` (serial, thermal reads, wake-lock). Those scripts
are the source of truth: why `adb input text` is not used, the
`kalsa://share?text=` cost (`am start` unloads the model), the reload tap,
serial/`-s` discipline, thermal reads, and wake-lock restore. Do not
re-discover this from chat logs.
