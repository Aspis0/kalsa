// fadv — drop the page cache for one or more files without root.
// Used to produce a reproducible "cold model file" state on Android, where
// /proc/sys/vm/drop_caches and reboot-on-demand are both unavailable to us.
//
// POSIX_FADV_DONTNEED evicts *clean* pages of the given file only. Dirty pages
// are flushed first (fsync) so the eviction is complete, and the resident count
// is reported before/after so a run can prove the file was actually cold.
//
// build: clang -O2 -o fadv fadv.c
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

// Returns resident page count of the file, or -1 if it could not be measured.
static long resident_pages(int fd, off_t size, long page) {
    if (size <= 0) return 0;
    void *m = mmap(NULL, (size_t)size, PROT_READ, MAP_SHARED, fd, 0);
    if (m == MAP_FAILED) return -1;
    size_t npages = ((size_t)size + (size_t)page - 1) / (size_t)page;
    unsigned char *vec = calloc(npages, 1);
    long resident = -1;
    if (vec && mincore(m, (size_t)size, vec) == 0) {
        resident = 0;
        for (size_t i = 0; i < npages; i++)
            if (vec[i] & 1) resident++;
    }
    free(vec);
    munmap(m, (size_t)size);
    return resident;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: fadv FILE [FILE...]\n");
        return 2;
    }
    long page = sysconf(_SC_PAGESIZE);
    int rc = 0;
    for (int i = 1; i < argc; i++) {
        int fd = open(argv[i], O_RDONLY);
        if (fd < 0) {
            fprintf(stderr, "fadv: open %s: %s\n", argv[i], strerror(errno));
            rc = 1;
            continue;
        }
        struct stat st;
        if (fstat(fd, &st) != 0) {
            perror("fadv: fstat");
            close(fd);
            rc = 1;
            continue;
        }
        long before = resident_pages(fd, st.st_size, page);
        // Flush dirty pages first: DONTNEED only evicts clean ones.
        fsync(fd);
        int r = posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);
        long after = resident_pages(fd, st.st_size, page);
        printf("%s size=%lld resident_before=%ld resident_after=%ld pages fadvise_rc=%d\n",
               argv[i], (long long)st.st_size, before, after, r);
        if (after > 0) {
            fprintf(stderr, "fadv: WARNING %s still has %ld resident pages (%.1f MiB)\n",
                    argv[i], after, (double)after * (double)page / 1048576.0);
            rc = 3;
        }
        close(fd);
    }
    return rc;
}
