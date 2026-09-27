source scripts/ci-lib.sh
sql "SELECT key || '=' || value FROM catalystLocalStorage WHERE key IN ('kalsa.load.dead.lfm2.5-2.6b','kalsa.governor.enabled');"
