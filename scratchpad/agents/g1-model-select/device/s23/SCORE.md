# S23 G1 score — MiniCPM5 arm stopped at 16/24 by owner decision

MiniCPM5 IDs not run: I14, M01, M02, M03, M04, T09, T11. I12 completed during signal/EXIT cleanup before the runner exited. `score_device.py` does not deduplicate by id, so this score used temporary inputs `.score-lfm-last-ok.jsonl` and `.score-minicpm-last-ok.jsonl`, selecting the last `ok` row per id (fallback latest row).

rows=41 cases=24
model	phone	lang	category	pass	fail	rubric	error
dev-minicpm5-2b	S23	en	conversation	3	0	0	0
dev-minicpm5-2b	S23	en	instructions	5	0	0	1
dev-minicpm5-2b	S23	it	conversation	3	0	1	0
dev-minicpm5-2b	S23	it	instructions	3	0	0	1
lfm2.5-2.6b	S23	en	conversation	3	0	0	0
lfm2.5-2.6b	S23	en	instructions	6	0	1	0
lfm2.5-2.6b	S23	en	memory	2	0	0	0
lfm2.5-2.6b	S23	it	conversation	3	0	1	0
lfm2.5-2.6b	S23	it	instructions	4	0	0	0
lfm2.5-2.6b	S23	it	memory	2	0	0	0
lfm2.5-2.6b	S23	it	tools	2	0	0	0
model	phone	metric	median	max	n
dev-minicpm5-2b	S23	promptMs	5354.9	21273.1	15
dev-minicpm5-2b	S23	tok_s	6.1	6.9	15
lfm2.5-2.6b	S23	promptMs	1541.5	5043.9	24
lfm2.5-2.6b	S23	tok_s	10.7	11.8	24
failures
dev-minicpm5-2b	S23	I01	ERROR	reply_timeout (never dropped)
dev-minicpm5-2b	S23	I06	ERROR	reply_timeout (never dropped)
