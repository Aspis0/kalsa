# MarcoKEXP — comando quantize PRONTO ma NON eseguito

## Prerequisiti (quando T2c promuove Marco)

1. `models/Marco-Mini-Instruct.Q8_0.gguf` presente + sha OK  
2. Opzionale: `models/Marco-Mini-Instruct.imatrix.gguf`  
3. Recipe: `results/marcokexp/tensor_types.txt` (default = conservative q3_k experts)  
   Alternative: `tensor_types_aggressive_q2k.txt`  
4. Binario: `build-pc-quantize/bin/llama-quantize.exe` (o path Termux analogo)

## Comando (Windows host — NON lanciare in questo mandato)

```powershell
# conservative (default recipe)
$Q = "build-pc-quantize\bin\llama-quantize.exe"
$SRC = "models\Marco-Mini-Instruct.Q8_0.gguf"
$OUT = "models\Marco-Mini-Instruct-KEXP-q3k.gguf"
$TYPES = "results\marcokexp\tensor_types_conservative_q3k.txt"
# se imatrix:
# &$Q --allow-requantize --imatrix models\Marco-Mini-Instruct.imatrix.gguf --tensor-type-file $TYPES $SRC $OUT Q4_K_M
# senza imatrix (o se si ricalcola dopo):
& $Q --allow-requantize --tensor-type-file $TYPES $SRC $OUT Q4_K_M
```

Variante aggressiva: `-tensor-type-file results\marcokexp\tensor_types_aggressive_q2k.txt` → out `...-KEXP-q2k.gguf`.

**STOP:** non eseguire quantize in questo mandato.
