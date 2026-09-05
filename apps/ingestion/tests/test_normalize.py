import pytest

from ingestion.normalize import norm_street_addr

# Expected values were produced by running the SQL norm_street_addr from
# packages/db/scripts/import-pentridge-workspace.sql against the same inputs.
PARITY = [
    ("10 EXAMPLE AVE", "10 example avenue"),
    ("20 N EXAMPLE ST", "20 north example street"),
    ("30 N. Sample St.", "30 north sample street"),
    ("40 S. Demo St", "40 south demo street"),
    ("50 N. Fiction St", "50 north fiction street"),
    ("60 Example St, - Unit 101", "60 example street - unit 101"),
    ("  70  Sample Road ", "70 sample road"),
    ("12 E. Main Dr", "12 east main drive"),
    ("W 5th Ave, Apt 3", "west 5th avenue apt 3"),
    ("", ""),
    (None, ""),
    ("St. Louis Ave", "street louis avenue"),
    ("1016-1018 Chestnut St", "1016-1018 chestnut street"),
    ("N Broad St / S Broad St", "north broad street / south broad street"),
    ("ELM STREET N.", "elm street north"),
]


@pytest.mark.parametrize(("raw", "expected"), PARITY)
def test_matches_the_sql_normalizer(raw, expected):
    assert norm_street_addr(raw) == expected


def test_equivalent_address_forms():
    # Fictional addresses exercise case and punctuation equivalence.
    assert norm_street_addr("80 Demo St") == "80 demo street"
    assert norm_street_addr("90 EXAMPLE ST") == "90 example street"
    assert norm_street_addr("30 N SAMPLE ST") == norm_street_addr("30 N. Sample St.")
