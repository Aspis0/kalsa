# The two fixed prompts of the designed cell. Italian, ASCII only: `input text` drops accented letters, and an
# apostrophe, percent or ampersand breaks the device-side quoting. Both prompts are typed verbatim in a NEW chat
# every turn, so prompt length is the same for every turn of a given length.
SHORT_PROMPT="Scrivi in italiano un testo di circa 200 parole che spiega in modo semplice perche il cielo e azzurro di giorno. Usa frasi brevi e nessun elenco."
LONG_PROMPT="Scrivi in italiano un testo di circa 900 parole che racconta la storia di un piccolo paese di montagna durante un inverno lungo e difficile. Usa almeno cinque paragrafi e nessun elenco."

prompt_for() { case "$1" in short) echo "$SHORT_PROMPT";; long) echo "$LONG_PROMPT";; *) return 1;; esac; }

# ASCII printable only, no quote, percent or ampersand: the same test turn.sh relies on.
prompt_ok() { local p=$1
  LC_ALL=C grep -q "[^ -~]" <<<"$p" && return 1
  LC_ALL=C grep -q "[\"'%&]" <<<"$p" && return 1
  return 0; }
