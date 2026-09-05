from ingestion.auth import sign, verify

SECRET = "test-ingestion-secret"
TIMESTAMP = "1788609600"
BODY = b'{"runId":"r1","workspaceId":"w1"}'
# Produced by packages/adapters/src/ingestion-runner.ts signIngestionRequest with the same inputs.
TS_SIGNATURE = "1a93f82e3aec30a67ed4ef4ab8fe2ff9a29b0676776f063a901bb411d4e531d5"


def test_signature_matches_the_typescript_signer():
    assert sign(SECRET, TIMESTAMP, BODY) == TS_SIGNATURE


def test_verify_accepts_within_the_window_and_is_case_insensitive():
    now = float(TIMESTAMP) + 240
    assert verify(SECRET, TIMESTAMP, BODY, TS_SIGNATURE, now=now)
    assert verify(SECRET, TIMESTAMP, BODY, TS_SIGNATURE.upper(), now=now)


def test_verify_rejects_tampering_and_stale_timestamps():
    now = float(TIMESTAMP)
    assert not verify("other", TIMESTAMP, BODY, TS_SIGNATURE, now=now)
    assert not verify(SECRET, TIMESTAMP, BODY + b" ", TS_SIGNATURE, now=now)
    assert not verify(SECRET, TIMESTAMP, BODY, "zz", now=now)
    assert not verify(SECRET, "soon", BODY, TS_SIGNATURE, now=now)
    assert not verify(SECRET, None, BODY, TS_SIGNATURE, now=now)
    assert not verify(SECRET, TIMESTAMP, BODY, None, now=now)
    assert not verify("", TIMESTAMP, BODY, TS_SIGNATURE, now=now)
    assert not verify(SECRET, TIMESTAMP, BODY, TS_SIGNATURE, now=now + 301)
    assert not verify(SECRET, TIMESTAMP, BODY, TS_SIGNATURE, now=now - 301)


def test_nonfinite_timestamps_and_nonascii_signatures_are_rejected():
    for timestamp in ("NaN", "Infinity", "-Infinity"):
        assert not verify(SECRET, timestamp, BODY, sign(SECRET, timestamp, BODY), now=0)
    assert not verify(SECRET, TIMESTAMP, BODY, "é", now=float(TIMESTAMP))
