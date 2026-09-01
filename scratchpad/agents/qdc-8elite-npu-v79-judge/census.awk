BEGIN { ansi = sprintf("%c", 27) "\\[[^m]*m"; header = op "(" }

function verdict(s) {
    if (s ~ /(^|[^[:alnum:]_])not supported([^[:alnum:]_]|$)/) return "skip"
    if (s ~ /(^|[^[:alnum:]_])FAIL([^[:alnum:]_]|$)/) return "fail"
    if (s ~ /(^|[^[:alnum:]_])OK([^[:alnum:]_]|$)/) return "ok"
    return ""
}
function nonfinite(s, p) {
    return s ~ (p "[[:space:]]*(-?nan|-?inf)([^[:alnum:]_]|$)")
}
function observe(s) {
    if (s ~ /ggml_backend_graph_compute failed/) cur_compute = 1
    if (nonfinite(s, "CPU=")) cur_judge = 1
    if (nonfinite(s, "HTP0=")) cur_htp = 1
}
function finish(v, c) {
    if (v == "ok") ok++
    else if (v == "skip") skip++
    else if (v == "fail") {
        fail_total++
        if (cur_compute) c = "compute_failed"
        else if (cur_judge) c = "judge_nonfinite"
        else if (cur_htp) c = "htp_nonfinite"
        else c = "real_fail"
        count[c]++; fail_n++; fail_category[fail_n] = c
        fail_header[fail_n] = cur_header
    }
    pending = cur_compute = cur_judge = cur_htp = 0
}
{
    line = $0; gsub(ansi, "", line)
    if (stopped) next
    if (line ~ /tests passed/) { stopped = 1; next }
    if (line ~ /dsp-rsp: INTERNAL-ERROR/) internal_error_lines++
    if (line ~ /HTP0=/ || line ~ /HTP0 (allocating new session|new session)/) htp_proof = 1
    if (line ~ /^Backend [0-9]+\/[0-9]+: HTP0/) { backend_htp0 = 1; expect_desc = 1 }
    else if (expect_desc) { if (line ~ /Device description: Hexagon/) device_hexagon = 1; expect_desc = 0 }
    if (line ~ /recopy=get\/set/) recopy_lines++
    if (line ~ /\[ref-buf\]/) {
        banner = 1
        if (match(line, /PLAIN_HOST[[:space:]]*[=:][[:space:]]*[^[:space:]]+/)) {
            plain_host = substr(line, RSTART, RLENGTH)
            sub(/^PLAIN_HOST[[:space:]]*[=:][[:space:]]*/, "", plain_host)
        }
    }
    if (index(line, header)) {
        if (pending) unresolved++
        pending = 1; cur_header = line
        cur_compute = cur_judge = cur_htp = 0
        v = verdict(line)
        if (v) { observe(line); finish(v) }
        next
    }
    if (pending) { observe(line); v = verdict(line); if (v) finish(v) }
}
END {
    if (pending) unresolved++
    compute_failed = count["compute_failed"] + 0
    judge_nonfinite = count["judge_nonfinite"] + 0
    htp_nonfinite = count["htp_nonfinite"] + 0
    real_fail = count["real_fail"] + 0
    other = fail_total - compute_failed - judge_nonfinite - htp_nonfinite - real_fail
    print "op=" op; print "ok=" (ok + 0); print "fail_total=" (fail_total + 0)
    print "skip=" (skip + 0); print "executed=" (ok + fail_total)
    print "total=" (ok + fail_total + skip); print "compute_failed=" compute_failed
    print "judge_nonfinite=" judge_nonfinite; print "htp_nonfinite=" htp_nonfinite
    print "real_fail=" real_fail; print "other=" other
    print "internal_error_lines=" (internal_error_lines + 0)
    print "htp_proof=" (htp_proof + 0); print "backend_htp0=" (backend_htp0 + 0)
    print "device_hexagon=" (device_hexagon + 0); print "recopy_lines=" (recopy_lines + 0)
    print "unresolved=" (unresolved + 0); print "banner=" (banner + 0)
    print "plain_host=" plain_host
    for (i = 1; i <= fail_n; i++) print fail_category[i] ": " fail_header[i]
}
