# Corpus index

Report-to-fixture map (audit number : fixture):

- 1 : nosemgrep_escape
- 2 : url_less_dropper, dynamic_getattr, importlib_dispatch, builtins_exec, dlsym_pointer
- 3 : two_step_download
- 4 : deleted_guard, binary_nul
- 5 : macro_alias
- 6 : lfs_pointer, malware_payload
- 7 : instruction_comment, fake_signoff, non_english_instruction, homoglyph_instruction, disregard_instruction
- 8 : hidden_instruction
- 9 : split_payload
- 10 : long_line
- 11 : base64_blob, short_base64, short_hex, escaped_instruction
- 12 : fake_json_answer, fake_precedent, empty_quoted_line, eval_variable, compile_variable
- known-good : known_good

- 13 extra: russian_instruction, arabic_instruction, leetspeak_instruction, instruction_identifier, instruction_filename
- 13 good: good_reviewed_prose, good_approved_prose, good_long_identifier, good_hex_hash

- 13 split: split_across_blocks, split_across_files
- 13 ships: ships_false_built

- 13 forks: good_lidenburg, good_architectds, good_achyudh (zero person blocks after the fix)

- 14 co-occurrence: reviewer_looked_at, automated_tools_skip, model_says_harmless, bots_skip, passive_approved, typo_ignore, typo_disregard, mixed_script_reviewer
- 14 encoded defences: encoded_base64_junk_sink, encoded_gzip_b64_sink, encoded_rot13_sink, encoded_reversed_sink, encoded_char_codes_sink, encoded_fromcharcode_sink. Non-decodable encodings are left to hard rules (sinks), not the detector.
