/* iogate_ufs4 — seq vs shuffled-block pread, O_DIRECT.
 * Gate #14 packing indicator. Not the S23 decision gate.
 *
 * Reads the SAME N 4K-aligned blocks: sequential order vs Fisher-Yates shuffle
 * of those indices (fixed seed). Never writes the file.
 *
 *   iogate_ufs4 PATH seq|rand [nblocks] [blocksize] [seed]
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#ifndef O_DIRECT
#define O_DIRECT 00040000
#endif

static uint64_t xorshift64(uint64_t *s) {
    uint64_t x = *s;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *s = x;
    return x;
}

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s PATH seq|rand [nblocks=2000] [blocksize=983040] [seed=14]\n", argv[0]);
        return 2;
    }
    const char *path = argv[1];
    const char *mode = argv[2];
    int nblocks = (argc > 3) ? atoi(argv[3]) : 2000;
    size_t bsz = (argc > 4) ? (size_t)atoll(argv[4]) : 983040u; /* 240*4096 ≈ 0.9375 MiB */
    uint64_t seed = (argc > 5) ? (uint64_t)atoll(argv[5]) : 14ull;
    const size_t align = 4096;

    int is_rand = 0;
    if (strcmp(mode, "rand") == 0 || strcmp(mode, "random") == 0) is_rand = 1;
    else if (strcmp(mode, "seq") != 0) {
        fprintf(stderr, "mode must be seq or rand\n");
        return 2;
    }
    if (nblocks < 1 || bsz < align || (bsz % align) != 0) {
        fprintf(stderr, "nblocks>=1 and blocksize 4K-aligned required\n");
        return 2;
    }

    int fd = open(path, O_RDONLY | O_DIRECT);
    if (fd < 0) {
        fprintf(stderr, "open O_DIRECT failed errno=%d (%s)\n", errno, strerror(errno));
        return 1;
    }
    struct stat st;
    if (fstat(fd, &st) != 0) {
        fprintf(stderr, "fstat failed errno=%d\n", errno);
        close(fd);
        return 1;
    }
    uint64_t need = (uint64_t)nblocks * (uint64_t)bsz;
    if ((uint64_t)st.st_size < need) {
        fprintf(stderr, "file too small: size=%lld need=%llu\n",
                (long long)st.st_size, (unsigned long long)need);
        close(fd);
        return 1;
    }

    uint32_t *idx = (uint32_t *)malloc((size_t)nblocks * sizeof(uint32_t));
    void *buf = NULL;
    if (posix_memalign(&buf, align, bsz) != 0 || !idx || !buf) {
        fprintf(stderr, "alloc failed\n");
        free(idx);
        close(fd);
        return 1;
    }
    for (int i = 0; i < nblocks; i++) idx[i] = (uint32_t)i;
    if (is_rand) {
        uint64_t s = seed ? seed : 1ull;
        for (int i = nblocks - 1; i > 0; i--) {
            uint32_t j = (uint32_t)(xorshift64(&s) % (uint64_t)(i + 1));
            uint32_t t = idx[i];
            idx[i] = idx[j];
            idx[j] = t;
        }
    }

    /* touch-free: first aligned pread as a discard warmup is NOT done — O_DIRECT
     * should not hit page cache; measuring includes open-to-last-byte. */

    double t0 = now_s();
    uint64_t got_sum = 0;
    for (int i = 0; i < nblocks; i++) {
        off_t off = (off_t)idx[i] * (off_t)bsz;
        ssize_t got = pread(fd, buf, bsz, off);
        if (got != (ssize_t)bsz) {
            fprintf(stderr, "pread fail i=%d off=%lld got=%zd errno=%d\n",
                    i, (long long)off, got, errno);
            free(idx);
            free(buf);
            close(fd);
            return 1;
        }
        got_sum += (uint64_t)got;
    }
    double t1 = now_s();
    double dt = t1 - t0;
    if (dt < 1e-9) dt = 1e-9;
    double mb_s = ((double)got_sum / dt) / 1e6;
    double mib_s = ((double)got_sum / dt) / (1024.0 * 1024.0);

    printf("mode=%s nblocks=%d bsz=%zu bytes=%llu sec=%.6f MB_s=%.3f MiB_s=%.3f seed=%llu file=%s odirect=1\n",
           is_rand ? "rand" : "seq", nblocks, bsz,
           (unsigned long long)got_sum, dt, mb_s, mib_s,
           (unsigned long long)seed, path);
    fflush(stdout);

    free(idx);
    free(buf);
    close(fd);
    return 0;
}
