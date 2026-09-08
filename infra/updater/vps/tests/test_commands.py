import os
import sys
from unittest import mock
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docker_adapter import run
from release import Refused


class CommandBoundaryTests(unittest.TestCase):
    def test_untrusted_output_is_bounded(self):
        with self.assertRaisesRegex(Refused, "command_output_limit"):
            run([sys.executable, "-c", "print('x'*65536)"], max_output=1024)

    def test_command_timeout_terminates_child(self):
        with self.assertRaisesRegex(Refused, "command_timeout"):
            run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.1)

    def test_failure_has_private_diagnostics_but_safe_public_message(self):
        with self.assertRaises(Refused) as caught:
            run([sys.executable, "-c", "import sys; sys.stderr.write('synthetic-detail');sys.exit(1)"])
        self.assertEqual(str(caught.exception), "command_failed")
        self.assertEqual(caught.exception.diagnostic, "synthetic-detail")

    def test_timeout_after_child_closes_output_is_classified(self):
        with self.assertRaisesRegex(Refused, "command_timeout"):
            run([sys.executable, "-c", "import os,time;os.close(1);os.close(2);time.sleep(5)"], timeout=0.15)

    def test_cleanup_exit_race_preserves_original_failure(self):
        kill = os.killpg
        def raced_kill(pid, signal):
            kill(pid, signal)
            raise ProcessLookupError()
        with mock.patch("docker_adapter.os.killpg", side_effect=raced_kill):
            with self.assertRaisesRegex(Refused, "command_output_limit"):
                run([sys.executable, "-c", "import time;print('x'*65536,flush=True);time.sleep(5)"], max_output=1024)
