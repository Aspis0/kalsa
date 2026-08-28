// Per-token weight bytes from a GGUF tensor index, read over HTTP.
//
// This is the method §7.31 used by hand and nothing automated: it downloads the
// header, metadata and tensor index with a range request (the weights are never
// fetched) and sums the tensors a single generated token actually reads.
//
// WHY it is not "the file size": §7.31 found every file-size estimate we carried
// was 3-4% LOW, because a tied `token_embd` is read in full as the output head on
// every token and is therefore counted twice in spirit and once in bytes. The
// gate consumes this number, so an estimate dressed as a measurement is a defect.
//
// DENSE ONLY, deliberately. On a MoE only the routed experts of the selected
// top-k are read, so the answer depends on n_expert_used and this file cannot
// know it. Rather than emit a plausible wrong number the script refuses and says
// so — a refusal is recoverable, a wrong constant in the registry is not.
//
// CONSEQUENCE, so a later reader does not misread the refusal: the one MoE entry
// in the registry (`lfm2.5-8b-a1b-kexp`, 848 MB/token) IS tensor-map derived —
// by hand, accounting for routing, in `b312602` — but it is the only value here
// that this script cannot reproduce or check. It is rounded to MB where the
// dense entries are exact bytes. If the recipe or n_expert_used ever changes,
// nothing automated will notice.
//
//   node scripts/bench/ggufWeightBytes.mjs <hfRepo> <revision> <file>

// block size, bytes per block. Only the types our catalogue actually uses.
const GGML_TYPES = {
  0: ["F32", 1, 4],
  1: ["F16", 1, 2],
  2: ["Q4_0", 32, 18],
  3: ["Q4_1", 32, 20],
  6: ["Q5_0", 32, 22],
  7: ["Q5_1", 32, 24],
  8: ["Q8_0", 32, 34],
  10: ["Q2_K", 256, 84],
  11: ["Q3_K", 256, 110],
  12: ["Q4_K", 256, 144],
  13: ["Q5_K", 256, 176],
  14: ["Q6_K", 256, 210],
  15: ["Q8_K", 256, 292],
  30: ["BF16", 1, 2],
};

class Reader {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  u32() {
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return Number(v);
  }
  i64() {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return Number(v);
  }
  str() {
    const n = this.u64();
    const s = this.b.subarray(this.o, this.o + n).toString("utf8");
    this.o += n;
    return s;
  }
  // GGUF metadata values; we skip them, but skipping requires knowing the shapes.
  skipValue(type) {
    switch (type) {
      case 0: case 1: case 7: this.o += 1; break;            // u8 i8 bool
      case 2: case 3: this.o += 2; break;                     // u16 i16
      case 4: case 5: case 6: this.o += 4; break;             // u32 i32 f32
      case 10: case 11: case 12: this.o += 8; break;          // u64 i64 f64
      case 8: this.str(); break;                              // string
      case 9: {                                               // array
        const t = this.u32();
        const n = this.u64();
        for (let i = 0; i < n; i++) this.skipValue(t);
        break;
      }
      default: throw new Error(`unknown GGUF metadata type ${type}`);
    }
  }
}

function tensorBytes(dims, typeId) {
  const t = GGML_TYPES[typeId];
  if (!t) throw new Error(`unhandled ggml type id ${typeId}`);
  const [, blockSize, bytesPerBlock] = t;
  const n = dims.reduce((a, b) => a * b, 1);
  if (n % blockSize !== 0) {
    throw new Error(`element count ${n} not a multiple of block size ${blockSize} for ${t[0]}`);
  }
  return (n / blockSize) * bytesPerBlock;
}

async function main() {
  const [repo, revision, file] = process.argv.slice(2);
  if (!repo || !revision || !file) {
    console.error("usage: node scripts/bench/ggufWeightBytes.mjs <hfRepo> <revision> <file>");
    process.exit(2);
  }
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
  // 25 MB covers header + metadata + tensor index on every model we ship; the
  // parser throws if it does not, rather than silently truncating the sum.
  const res = await fetch(url, { headers: { Range: "bytes=0-26214399" } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const r = new Reader(buf);
  if (buf.subarray(0, 4).toString("ascii") !== "GGUF") throw new Error("not a GGUF file");
  r.o = 4;
  const version = r.u32();
  const tensorCount = r.u64();
  const kvCount = r.u64();
  let arch = "";
  let nExpert = 0;
  for (let i = 0; i < kvCount; i++) {
    const key = r.str();
    const type = r.u32();
    if (key === "general.architecture" && type === 8) {
      arch = r.str();
    } else if (/\.expert_count$/.test(key) && (type === 4 || type === 5)) {
      nExpert = r.u32();
    } else {
      r.skipValue(type);
    }
  }

  let blocks = 0;
  let embd = 0;
  let other = 0;
  let speculative = 0;
  let sawExpertTensor = false;
  for (let i = 0; i < tensorCount; i++) {
    const name = r.str();
    const nDims = r.u32();
    const dims = [];
    for (let d = 0; d < nDims; d++) dims.push(r.u64());
    const typeId = r.u32();
    r.u64(); // offset
    const bytes = tensorBytes(dims, typeId);
    if (/exps/.test(name)) sawExpertTensor = true;
    // MTP / nextn layers are read only when speculative decoding runs, not on
    // an ordinary token, so counting them would inflate the per-token bill on
    // every -MTP- repack of an otherwise ordinary dense model.
    if (/\bnextn\b|\.mtp\./.test(name)) speculative += bytes;
    else if (name === "token_embd.weight") embd += bytes;
    else if (name.startsWith("blk.")) blocks += bytes;
    else other += bytes;
  }

  if (nExpert > 0 || sawExpertTensor) {
    console.error(
      `REFUSING: ${file} is a MoE (expert_count=${nExpert}${sawExpertTensor ? ", has *_exps tensors" : ""}). ` +
        "Per-token bytes depend on how many experts are routed, which this file cannot know. " +
        "Compute it from the recipe instead.",
    );
    process.exit(3);
  }

  const perToken = blocks + embd;
  console.log(
    JSON.stringify(
      {
        file, arch, ggufVersion: version, tensorCount,
        blocksBytes: blocks,
        tokenEmbdBytes: embd,
        excludedBytes: other,
        speculativeOnlyBytes: speculative,
        weightsBytesPerToken: perToken,
        mbPerToken: +(perToken / 1e6).toFixed(1),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(`[ggufWeightBytes] ${e.message}`);
  process.exit(1);
});
