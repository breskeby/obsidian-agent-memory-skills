import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sync_todos.py"


class SyncTodosTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="obs-memory-todos-"))
        (self.tmpdir / "todos").mkdir(parents=True)
        (self.tmpdir / "Home.md").write_text("# Home\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def write_active(self, content: str):
        (self.tmpdir / "todos" / "Active TODOs.md").write_text(
            textwrap.dedent(content).lstrip(), encoding="utf-8"
        )

    def write_archive(self, content: str):
        (self.tmpdir / "todos" / "Completed TODOs Archive.md").write_text(
            textwrap.dedent(content).lstrip(), encoding="utf-8"
        )

    def read(self, name: str) -> str:
        return (self.tmpdir / "todos" / name).read_text(encoding="utf-8")

    def run_sync(self, date="2026-06-18"):
        subprocess.run(
            ["python3", str(SCRIPT), str(self.tmpdir), "todos", "--date", date],
            check=True,
            capture_output=True,
            text=True,
        )

    def test_archives_completed_items_grouped_by_project_heading(self):
        self.write_active(
            """
            ---
            tags: [meta/index, todo]
            ---

            # Active TODOs

            ## demo

            - [x] ship the recap improvements
            - [ ] write the README

            ## other-proj

            - [x] tag v2.4
            """
        )
        self.run_sync()

        active = self.read("Active TODOs.md")
        archive = self.read("Completed TODOs Archive.md")

        # `[x]` items removed, `[ ]` items preserved
        self.assertNotIn("ship the recap improvements", active)
        self.assertNotIn("tag v2.4", active)
        self.assertIn("write the README", active)
        # Project headings remain so future entries can land under them
        self.assertIn("## demo", active)
        self.assertIn("## other-proj", active)

        # Archive grouped by project + date
        self.assertIn("## demo (2026-06-18)", archive)
        self.assertIn("## other-proj (2026-06-18)", archive)
        self.assertIn("- [x] ship the recap improvements", archive)
        self.assertIn("- [x] tag v2.4", archive)

    def test_creates_archive_file_if_missing(self):
        self.write_active(
            """
            # Active TODOs

            ## demo

            - [x] only completed item
            """
        )
        self.assertFalse((self.tmpdir / "todos" / "Completed TODOs Archive.md").exists())
        self.run_sync()
        self.assertTrue((self.tmpdir / "todos" / "Completed TODOs Archive.md").exists())
        archive = self.read("Completed TODOs Archive.md")
        self.assertIn("# Completed TODOs Archive", archive)
        self.assertIn("- [x] only completed item", archive)

    def test_idempotent_when_no_completed_items(self):
        self.write_active(
            """
            # Active TODOs

            ## demo

            - [ ] still pending
            """
        )
        self.run_sync()
        self.run_sync()  # second run should be a no-op
        active = self.read("Active TODOs.md")
        self.assertIn("- [ ] still pending", active)
        # Archive should not have been created since nothing was archived
        self.assertFalse((self.tmpdir / "todos" / "Completed TODOs Archive.md").exists())

    def test_uncategorized_when_no_h2_heading(self):
        self.write_active(
            """
            # Active TODOs

            - [x] orphan completed item
            """
        )
        self.run_sync()
        archive = self.read("Completed TODOs Archive.md")
        self.assertIn("## Uncategorized (2026-06-18)", archive)
        self.assertIn("- [x] orphan completed item", archive)


if __name__ == "__main__":
    unittest.main()
