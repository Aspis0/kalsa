# Hand corrections to grade.py, PQ2_0 (same method as GRADES.md)

Raw grade.py (before hand reading): thinking on 45/54 (3 empty), thinking off 44/54 (0 empty).

| item | why grade.py is wrong | on | off |
|---|---|---|---|
| Q12 (Po) | misses bold `**Po**` (' po' test) | +1 per seed-run: 2/3 -> 3/3 | 2/3 -> 3/3 |
| Q11 (riddle) | off-s1 "I sopravvissuti non vengono sepolti" fails the first-80-chars test | none | 2/3 -> 3/3 |

Confirmed, no change: Q1 (key says Häkkinen; on-s2/s3 and off-s2/s3 say Schumacher or another driver), Q15 (every answer says 8 sides or "ottagono" for "ettagono"), Q21 (every answer names a wrong president: Napoléon, Ciampi, Cossiga).

Empty answers (not scored, Q19 poem): thinking on s1 and s3 hit the 6000-token cap with 16.8k and 18.5k reasoning chars; s2 finished with empty content after 13.0k reasoning chars. Thinking off: none.

Hand-corrected totals: thinking on 46/54, thinking off 46/54.
The answer keys (grade.py) were not independently checked against sources, e.g. the Spa 2000 winner.
