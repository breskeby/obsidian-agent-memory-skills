import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sync_sessions.py"


class SyncSessionsTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="obs-memory-test-"))
        (self.tmpdir / "sessions").mkdir(parents=True)
        (self.tmpdir / "Home.md").write_text("# Home\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def run_sync(self):
        subprocess.run(
            ["python3", str(SCRIPT), str(self.tmpdir), "sessions"],
            check=True,
            capture_output=True,
            text=True,
        )

    def read_log(self) -> str:
        return (self.tmpdir / "sessions" / "Session Log.md").read_text(encoding="utf-8")

    def write_session(self, name: str, content: str):
        (self.tmpdir / "sessions" / name).write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")

    def test_rebuilds_session_log_with_dataview_and_static_fallback(self):
        self.write_session(
            "2026-06-16 - Alpha.md",
            """
            ---
            tags: [sessions]
            type: session
            projects:
              - "[[projects/demo/demo]]"
            created: 2026-06-16
            branch: main
            summary: "Alpha summary"
            ---

            # Alpha heading
            """,
        )
        self.write_session(
            "2026-06-15 - Beta.md",
            """
            ---
            tags: [sessions]
            type: session
            projects:
              - "[[projects/demo/demo]]"
            created: 2026-06-15
            branch: feat/test
            ---

            # Beta heading fallback
            """,
        )

        self.run_sync()
        log = self.read_log()

        self.assertIn("generated: true", log)
        self.assertIn("```dataview", log)
        self.assertIn('| 2026-06-16 | [[projects/demo/demo]] | `main` | [[sessions/2026-06-16 - Alpha|Alpha summary]] |', log)
        self.assertIn('| 2026-06-15 | [[projects/demo/demo]] | `feat/test` | [[sessions/2026-06-15 - Beta|Beta heading fallback]] |', log)
        self.assertLess(
            log.index("2026-06-16 - Alpha"),
            log.index("2026-06-15 - Beta"),
        )

    def test_ignores_existing_session_log_and_rewrites_from_source_notes(self):
        self.write_session(
            "Session Log.md",
            "# stale log\n",
        )
        self.write_session(
            "2026-06-16 - Gamma.md",
            """
            ---
            tags: [sessions]
            type: session
            project: "[[projects/demo/demo]]"
            created: 2026-06-16
            branch: repair
            summary: "Gamma summary"
            ---

            # Gamma heading
            """,
        )

        self.run_sync()
        log = self.read_log()

        self.assertNotIn("# stale log", log)
        self.assertIn("Gamma summary", log)
        self.assertIn("[[projects/demo/demo]]", log)


if __name__ == "__main__":
    unittest.main()
