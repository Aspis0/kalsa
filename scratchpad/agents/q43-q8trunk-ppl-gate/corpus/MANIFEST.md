# MANIFEST — q43 multilingual PPL-gate corpora

Frozen at build time, BEFORE any PPL run (PREREG.md, Corpora item 2).
Format: UTF-8 plain text, LF line endings only, no BOM.
Source: MediaWiki action API, prop=extracts&explaintext=1&format=json&redirects=1.
Articles concatenated in listed order, blank line between articles.
sha256 computed with Python hashlib. Minimum size enforced: 400,000 bytes.

## it.txt

- Byte size: **480,565**
- sha256: `fddf963377e1a90cd02dde9baf1fbe95a003e86f9ec0eebfda6e9b3652027aac`
- Articles (11), in order of concatenation:

1. Impero romano — 75,531 B
2. Colosseo — 34,781 B
3. Vesuvio — 28,053 B
4. Etna — 45,297 B
5. Alpi — 34,615 B
6. Mar Mediterraneo — 33,757 B
7. Lingua italiana — 57,166 B
8. Cucina italiana — 23,029 B
9. Alessandro Volta — 41,899 B
10. Guglielmo Marconi — 37,008 B
11. Enrico Fermi — 69,419 B

## es.txt

- Byte size: **492,128**
- sha256: `45b4bdbf62de82f8640d259368572553b07240dae7f42eb8c0bdfaa762146915`
- Articles (12), in order of concatenation:

1. Península ibérica — 18,347 B
2. Océano Atlántico — 23,642 B
3. Cordillera de los Andes — 35,091 B
4. Alhambra — 34,049 B
5. Idioma español — 86,306 B
6. Miguel de Cervantes — 58,942 B
7. Gabriel García Márquez — 58,775 B
8. Sistema Solar — 30,314 B
9. Física — 37,536 B
10. Química — 42,299 B
11. Isaac Newton — 47,269 B
12. Telescopio espacial Hubble — 19,547 B

## fr.txt

- Byte size: **454,357**
- sha256: `c477f06d166a387f937784742eb4ac04ac9b4f268f663618f8e28fee8a924f0e`
- Articles (10), in order of concatenation:

1. Pont du Gard — 21,234 B
2. Alpes — 18,769 B
3. Loire — 66,875 B
4. Seine — 50,306 B
5. Impressionnisme — 55,411 B
6. Cuisine française — 59,862 B
7. Antoine Lavoisier — 38,410 B
8. Marie Curie — 46,332 B
9. Gustave Eiffel — 40,957 B
10. TGV — 56,192 B

## zh.txt

- Byte size: **487,776**
- sha256: `234fe0fdfa8785838f995a9681ea3e1871bcb7c8ca74bf2180e4c90310a5c606`
- Articles (11), in order of concatenation:

1. 汉语 — 24,477 B
2. 长江 — 35,730 B
3. 黄河 — 34,710 B
4. 唐朝 — 102,737 B
5. 孔子 — 100,048 B
6. 丝绸之路 — 31,892 B
7. 太阳系 — 58,735 B
8. 相对论 — 15,295 B
9. 四大发明 — 19,523 B
10. 故宫 — 35,039 B
11. 京剧 — 29,580 B

---

## Build notes / anomalies

- All 44 requested articles fetched successfully; none missing, none repeated within or across files.
- HTTP 429 rate-limit responses from Wikipedia occurred during fetching; handled with exponential-backoff retries honoring Retry-After. No data impact.
- Article selection was size-probed beforehand (--probe modes) so each language lands in the 400–500 KB target with ≥ 10 articles.
- Cleaner strips stray HTML tags and short reference brackets `[n]` (n = 1–2 digits). Four such markers were found and removed in the first build (it: `[1]`; es: `[5]`, `[6]`); a 4-digit bracket `[1858]` (original-edition year in a bibliography) was deliberately kept. Files were rebuilt after adding this rule; final sha256s reflect the rebuilt files.
- zh.txt contains mixed Simplified and Traditional characters as returned by zh.wikipedia.org (accepted per task spec).
- Section headings appear as plain `== Heading ==` lines inside article text; they are part of the plain-text extract, not wikitext markup.
