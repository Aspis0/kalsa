from pathlib import Path

import fitz


OUT = Path('/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite')
OUT.mkdir(parents=True, exist_ok=True)


def add_text_page(doc: fitz.Document, text: str, title: str, size: float = 8.4) -> None:
    page = doc.new_page(width=595, height=842)
    page.insert_text((42, 35), title, fontsize=11, fontname='helv', color=(0.08, 0.12, 0.18))
    rect = fitz.Rect(42, 52, 553, 812)
    rc = page.insert_textbox(rect, text, fontsize=size, fontname='helv', lineheight=1.25,
                             color=(0.08, 0.08, 0.08), align=0)
    if rc < 0:
        raise RuntimeError(f'text overflow on {title}: {rc}')


small_text = '''Avviso ai condomini — Condominio Il Glicine

Si comunica ai proprietari e agli inquilini che l'assemblea straordinaria del Condominio Il Glicine si terrà martedì 22 settembre 2026 alle ore 18:30 nella sala riunioni al piano terra. La convocazione riguarda la sostituzione della pompa dell'acqua e la revisione del cancello carrabile. Il preventivo approvato prevede una spesa complessiva di 1.860 euro, da ripartire secondo i millesimi indicati nel regolamento.

La referente per i lavori è la signora Marta Bellini, interno 4. Per consentire al tecnico di controllare il locale contatori, il sopralluogo richiede che il proprietario dell'appartamento al terzo piano lasci libero l'accesso alla cantina entro le ore 17:00. Il termine ultimo per inviare osservazioni scritte all'amministratore è venerdì 11 settembre 2026. Le osservazioni possono essere consegnate nella cassetta della posta dell'amministrazione oppure inviate all'indirizzo condominio.glicine@example.invalid.

Si ricorda inoltre che il cancello resterà chiuso durante il collaudo e che i residenti dovranno utilizzare l'ingresso pedonale. Non lasciare biciclette davanti al locale tecnico. I documenti del preventivo sono disponibili presso l'amministratore per la consultazione. Questo avviso è fittizio e vale esclusivamente come materiale di prova per una verifica della lettura documentale.

Durante la settimana dei lavori si prega di non depositare cartoni o sacchi nel corridoio del piano terra. L'amministratore pubblicherà un breve aggiornamento sulla bacheca dopo il collaudo. Le richieste diverse dalle osservazioni sull'intervento saranno trattate nella prossima assemblea ordinaria. In caso di emergenza, chiamare il numero indicato nel regolamento condominiale e non intervenire sul quadro elettrico. La partecipazione all'assemblea è consigliata perché il verbale riporterà le decisioni operative e la ripartizione finale della spesa.'''

small = fitz.open()
add_text_page(small, small_text, 'AVVISO CONDOMINIALE — DOCUMENTO DI PROVA', 10.0)
small_path = OUT / 'small_condominium_notice_it.pdf'
small.save(small_path)
small.close()


filler_a = ('The Asterion maintenance handbook uses controlled procedures for inspection, calibration, '
            'replacement, and acceptance testing. Operators should record observations in the service log, '
            'keep work areas clean, and confirm that guards are fitted before applying power. This section '
            'contains ordinary reference guidance and deliberately repeats the safe sequence in slightly '
            'different language so that every page has a searchable text layer. ')
filler_b = ('Before service, isolate the supply, wait for the indicator to discharge, and inspect seals for '
            'damage. After service, run the self-test, review the diagnostic screen, and attach the result to '
            'the work order. If a check fails, stop and escalate to a qualified technician. Measurements must '
            'be made with calibrated instruments and recorded with units, date, and operator initials. ')

manual = fitz.open()
for page_no in range(1, 41):
    paragraphs = [
        f'Section {page_no}: Field reference and service notes.',
        filler_a * 3,
        filler_b * 3,
    ]
    if page_no == 3:
        paragraphs.append('Buried configuration fact: the approved product code for the blue Asterion relay module is AXR-7Q4-031. This identifier is not a generic example; use it when matching the module to the service manifest.')
    if page_no == 17:
        paragraphs.append('Buried calibration fact: the lower hinge clamp must be tightened to exactly 42.6 N·m after alignment. Do not substitute the nearby cover-screw value of 8.0 N·m.')
    if page_no == 31:
        paragraphs.append('Buried traceability fact: production serial numbers for the QX9 controller use the format QX9-YYWW-NNNN, where YY is the two-digit year, WW is the ISO production week, and NNNN is a four-digit sequence.')
    paragraphs.append(f'End of page {page_no}. Continue with the next numbered section for additional procedures, examples, and maintenance reminders.')
    add_text_page(manual, '\n\n'.join(paragraphs), f'ASTERION TECHNICAL MANUAL — PAGE {page_no}', 8.2)
manual_path = OUT / 'large_asterion_manual_en.pdf'
manual.save(manual_path)
manual.close()


def verify(path: Path, expected_pages: int) -> None:
    doc = fitz.open(path)
    if len(doc) != expected_pages:
        raise RuntimeError(f'{path.name}: pages={len(doc)}, expected={expected_pages}')
    text = '\n'.join(page.get_text() for page in doc)
    if len(text.strip()) == 0:
        raise RuntimeError(f'{path.name}: empty text layer')
    print(path.name, 'pages=', len(doc), 'chars=', len(text), 'words=', len(text.split()), 'bytes=', path.stat().st_size)
    doc.close()


verify(small_path, 1)
verify(manual_path, 40)
for page_index in (2, 16, 30):
    page_text = fitz.open(manual_path)[page_index].get_text()
    print('large page', page_index + 1, 'fact_present=', any(token in page_text for token in ('AXR-7Q4-031', '42.6 N·m', 'QX9-YYWW-NNNN')))
