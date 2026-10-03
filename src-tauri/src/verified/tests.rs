use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-verified-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

fn stamp_of(path: &Path) -> Stamp {
    Stamp::of(&std::fs::metadata(path).expect("stat")).expect("a stamp")
}

/// One modification time on an existing file, the handle opened for
/// writing because the platform's own setter wants that much
/// permission.
fn set_mtime(path: &Path, at: std::time::SystemTime) {
    std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open")
        .set_modified(at)
        .expect("set the time");
}

fn mtime(path: &Path) -> std::time::SystemTime {
    std::fs::metadata(path)
        .expect("stat")
        .modified()
        .expect("mtime")
}

/// The recorded pin, stamp and sample answer; every difference — another
/// pin, another byte under the same name, another size, a record that is
/// not one — reads again. A line from before the sample was part of the
/// record is no record either.
#[test]
fn a_recorded_file_answers_and_every_difference_re_reads() {
    let dir = scratch("roundtrip");
    let path = dir.join("model.gguf");
    std::fs::write(&path, b"the bytes").expect("write");
    let sha = "a".repeat(64);
    assert!(
        !unchanged(&path, &sha, &stamp_of(&path)),
        "no record is not a match"
    );
    record(&path, &sha, &stamp_of(&path));
    assert!(unchanged(&path, &sha, &stamp_of(&path)));
    assert!(
        !unchanged(&path, &"b".repeat(64), &stamp_of(&path)),
        "a pin the record does not name"
    );
    // The same name and size, another byte: the time is the signal.
    std::fs::write(&path, b"other one").expect("write");
    assert!(!unchanged(&path, &sha, &stamp_of(&path)));
    // A size that moved is the other signal.
    std::fs::write(&path, b"a longer set of bytes").expect("write");
    assert!(!unchanged(&path, &sha, &stamp_of(&path)), "the size moved");
    // A record that is not one — text, too few fields, the four fields
    // a record carried before the sample — is no record at all.
    record(&path, &sha, &stamp_of(&path));
    assert!(unchanged(&path, &sha, &stamp_of(&path)));
    for stub in [
        "not a record\n".to_string(),
        format!("{sha} 1 2\n"),
        format!("{sha} {} {} {}\n", stamp_of(&path).size, 1, 2),
    ] {
        std::fs::write(record_path(&path), stub).expect("write");
        assert!(!unchanged(&path, &sha, &stamp_of(&path)));
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// A change inside the sampled region is caught even when the size and
/// the time were both put back: the sample is read and disagrees.
#[test]
fn a_change_inside_the_sample_is_caught_with_the_time_restored() {
    let dir = scratch("sample");
    let path = dir.join("model.gguf");
    std::fs::write(&path, b"the bytes as pinned").expect("write");
    let sha = "d".repeat(64);
    let stamp = stamp_of(&path);
    record(&path, &sha, &stamp);
    assert!(unchanged(&path, &sha, &stamp_of(&path)));
    let at = mtime(&path);
    std::fs::write(&path, b"the bytes as changd").expect("write");
    set_mtime(&path, at);
    let now = stamp_of(&path);
    assert_eq!(now.size, stamp.size, "the size was kept");
    assert_eq!(now.modified_nanos, stamp.modified_nanos, "the time was put back");
    assert!(!unchanged(&path, &sha, &now), "the sample caught it");
    std::fs::remove_dir_all(&dir).ok();
}

/// A replacement that restored the time is another file: the inode says
/// so on the platforms that have one.
#[cfg(unix)]
#[test]
fn a_replaced_file_with_the_restored_time_is_still_caught() {
    let dir = scratch("replaced");
    let path = dir.join("model.gguf");
    std::fs::write(&path, b"the bytes").expect("write");
    let sha = "c".repeat(64);
    let stamp = stamp_of(&path);
    record(&path, &sha, &stamp);
    let modified = mtime(&path);
    // A file that exists while the old one does cannot be handed the
    // old one's inode, so the replacement is guaranteed to be another
    // file even where inode numbers are reused.
    let replacement = dir.join("replacement.gguf");
    std::fs::write(&replacement, b"the bytes").expect("write");
    std::fs::rename(&replacement, &path).expect("replace");
    set_mtime(&path, modified);
    let replacement = stamp_of(&path);
    assert_eq!(replacement.modified_nanos, stamp.modified_nanos);
    assert_ne!(replacement.id, stamp.id, "the replacement is another file");
    assert!(!unchanged(&path, &sha, &replacement));
    std::fs::remove_dir_all(&dir).ok();
}

/// A link planted at the record's name is replaced, never written
/// through: the line lands in a temporary and takes the name by rename.
#[cfg(unix)]
#[test]
fn a_link_planted_at_the_record_s_name_is_replaced_not_written_through() {
    let dir = scratch("symlink");
    let path = dir.join("model.gguf");
    std::fs::write(&path, b"the bytes").expect("write");
    let victim = dir.join("victim.txt");
    std::fs::write(&victim, b"not a record").expect("write");
    std::os::unix::fs::symlink(&victim, record_path(&path)).expect("plant");
    record(&path, &"e".repeat(64), &stamp_of(&path));
    assert_eq!(
        std::fs::read(&victim).expect("read"),
        b"not a record",
        "the link's target is untouched"
    );
    assert!(!std::fs::symlink_metadata(record_path(&path))
        .expect("stat")
        .file_type()
        .is_symlink());
    assert!(unchanged(&path, &"e".repeat(64), &stamp_of(&path)));
    std::fs::remove_dir_all(&dir).ok();
}

/// The record is written only for a stamp that held still through the
/// whole read: a file that moved under it is read again next launch.
#[test]
fn only_a_stamp_that_held_still_through_the_read_is_recordable() {
    let dir = scratch("recordable");
    let path = dir.join("model.gguf");
    std::fs::write(&path, b"the bytes").expect("write");
    let before = stamp_of(&path);
    let same = stamp_of(&path);
    assert!(recordable(Some(before), Some(same)).is_some());
    set_mtime(&path, mtime(&path) + std::time::Duration::from_secs(1));
    assert!(
        recordable(Some(stamp_of(&path)), Some(same)).is_none(),
        "a moved file is not recorded"
    );
    assert!(recordable(None, Some(stamp_of(&path))).is_none());
    assert!(recordable(Some(stamp_of(&path)), None).is_none());
    std::fs::remove_dir_all(&dir).ok();
}

/// The sample of a file longer than the sample's own ends skips the
/// bytes between its chunks — that is the trade the fraction of a
/// second buys — and the same size always gives the same ranges.
#[test]
fn the_sample_reads_the_ends_and_sixteen_chunks_and_is_a_function_of_the_size() {
    let size = 22_134_528_992u64;
    let ranges = sample_ranges(size);
    assert_eq!(ranges.len(), 2 + SAMPLE_CHUNKS as usize);
    assert_eq!(ranges[0], (0, SAMPLE_END));
    assert_eq!(ranges[1], (size - SAMPLE_END, SAMPLE_END));
    for (offset, len) in &ranges[2..] {
        assert_eq!(*len, SAMPLE_CHUNK);
        assert!(
            *offset >= SAMPLE_END && offset + len <= size - SAMPLE_END,
            "a middle chunk stays between the ends: {offset} + {len}"
        );
    }
    // Deterministic: the same size is the same ranges, and a tiny file
    // is read whole.
    assert_eq!(ranges, sample_ranges(size));
    assert_eq!(sample_ranges(16), vec![(0, 16), (0, 16)]);
}
