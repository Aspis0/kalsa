rows=48 cases=24
model	phone	lang	category	pass	fail	rubric	error
dev-minicpm5-2b	Jelly	en	conversation	3	0	0	0
dev-minicpm5-2b	Jelly	en	instructions	5	1	1	0
dev-minicpm5-2b	Jelly	en	memory	1	0	0	1
dev-minicpm5-2b	Jelly	it	conversation	3	0	1	0
dev-minicpm5-2b	Jelly	it	instructions	2	2	0	0
dev-minicpm5-2b	Jelly	it	memory	2	0	0	0
dev-minicpm5-2b	Jelly	it	tools	0	2	0	0
lfm2.5-2.6b	Jelly	en	conversation	2	1	0	0
lfm2.5-2.6b	Jelly	en	instructions	5	1	1	0
lfm2.5-2.6b	Jelly	en	memory	1	0	0	1
lfm2.5-2.6b	Jelly	it	conversation	3	0	1	0
lfm2.5-2.6b	Jelly	it	instructions	4	0	0	0
lfm2.5-2.6b	Jelly	it	memory	2	0	0	0
lfm2.5-2.6b	Jelly	it	tools	2	0	0	0
model	phone	metric	median	max	n
dev-minicpm5-2b	Jelly	promptMs	13008.3	33262.9	24
dev-minicpm5-2b	Jelly	tok_s	2.3	2.5	24
lfm2.5-2.6b	Jelly	promptMs	6212.4	29181.3	24
lfm2.5-2.6b	Jelly	tok_s	3.4	5.0	24
failures
lfm2.5-2.6b	Jelly	C02	FAIL	check mismatch
lfm2.5-2.6b	Jelly	I06	FAIL	check mismatch
lfm2.5-2.6b	Jelly	M02	ERROR	send_failed (never dropped)
dev-minicpm5-2b	Jelly	I05	FAIL	check mismatch
dev-minicpm5-2b	Jelly	I06	FAIL	check mismatch
dev-minicpm5-2b	Jelly	I07	FAIL	check error: Expecting value: line 1 column 1 (char 0)
dev-minicpm5-2b	Jelly	M02	ERROR	send_failed (never dropped)
dev-minicpm5-2b	Jelly	T09	FAIL	expected tool device_calc; executed=[] requested=[]
dev-minicpm5-2b	Jelly	T11	FAIL	expected tool write_note; executed=[] requested=[]
