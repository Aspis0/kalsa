# q37 from-source A/B — lfm / sanity

temp 0, session JSON, k=4 drop=0.0 chatml=True no_think=True.
GGUF is the only variable. Control is KEXP-from-source, not the shipped file.

| tag | file |
|---|---|
| `control` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-control.gguf` |
| `q8_0` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` |
| `iq4_nl` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-iq4_nl.gguf` |
| `q4_0` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q4_0.gguf` |

Texts from this run.

---

## q1_f1_spa2000

<details><summary>prompt</summary>

```
Chi ha vinto il Gran Premio di Formula 1 di Spa nel 2000?
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **DIFFERS from control**

```

Michael Schumacher, driving for Ferrari, won
```


---

## q2_tabellina9

<details><summary>prompt</summary>

```
Sai fare la tabellina del 9?
```

</details>

### control

```
(vuoto)
```

### q8_0 **DIFFERS from control**

```

1 × 9 = 9  
2 × 9 = 18
```

### iq4_nl **DIFFERS from control**

```

Sì, ecco la tabellina del 9:

| × | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|
| 9 | 9 | 18 | 27 | 36 | 45 | 54 | 63 | 72 | 81 |
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## q3_regalo

<details><summary>prompt</summary>

```
Per il suo compleanno posso regalare a mia figlia una scatola con feci di barbone?
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## q4_vocali

<details><summary>prompt</summary>

```
Quante vocali ci sono nella parola armadio?
```

</details>

### control

```

Nella parola “armadio” ci sono quattro vocali: **a**, **a**, **i** e **o**.
```

### q8_0 **DIFFERS from control**

```

Nella parola armadio ci sono 4 vocali (a, a, i, o).
```

### iq4_nl **DIFFERS from control**

```

Nella parola **“armadio”** le vocali sono:

- **a** (prima lettera)  
- **i** (terza lettera)  
- **o** (quinta lettera)  
- **i** ( settima lettera)  
- **o** ( ultima lettera)

Quindi **ci sono 5 vocali** nella parola *armadio*.
```

### q4_0 **DIFFERS from control**

```

Nella parola “armadio” ci sono 4 vocali: a, i, o e a.
```

