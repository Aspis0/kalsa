def collect(item, bucket=[]):
    """Append item to bucket and return bucket. A missing bucket starts empty and is not shared."""
    bucket.append(item)
    return bucket
