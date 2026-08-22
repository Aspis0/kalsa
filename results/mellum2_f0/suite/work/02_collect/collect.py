def collect(item, bucket=None):
    """Append item to bucket and return bucket. A missing bucket starts empty and is not shared."""
    bucket = [] if bucket is None else bucket
    bucket.append(item)
    return bucket
