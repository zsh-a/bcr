"""The common CLI dispatches only; evidence and stage guards stay in each tool."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import unittest

import cli


class CliTests(unittest.TestCase):
    def test_arguments_are_forwarded_as_tokens_including_spaces_and_negative_values(self):
        tail = ["--plan", "study with spaces/plan.json", "--output", "new output", "--workers", "-1"]
        command = cli.command(["run", *tail])
        self.assertEqual(command[0], sys.executable)
        self.assertEqual(Path(command[1]), Path(__file__).resolve().with_name("research.py"))
        self.assertEqual(command[2:], tail)
        self.assertNotIn("cargo", command)

    def test_all_declared_routes_resolve_to_existing_tools(self):
        routes = [([name], module) for name, (module, _) in cli.TOOLS.items()]
        routes += [([group, name], module) for group, (_, tools) in cli.GROUPS.items()
                   for name, (module, _) in tools.items()]
        for route, module in routes:
            with self.subTest(route=route):
                command = cli.command([*route, "--help"])
                self.assertEqual(Path(command[1]).stem, module)
                self.assertTrue(Path(command[1]).is_file())
                self.assertEqual(command[2:], ["--help"])

    def test_incomplete_or_unknown_actions_fail_before_dispatch(self):
        for args in ([], ["evaluate"], ["diagnose", "unknown"], ["publish"]):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as failure:
                    cli.command(args)
                self.assertEqual(failure.exception.code, 2)

    def test_real_leaf_help_and_validation_keep_exit_codes(self):
        path = str(Path(__file__).with_name("cli.py"))
        result = subprocess.run([sys.executable, path, "study", "compile", "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--receipt", result.stdout)
        result = subprocess.run([sys.executable, path, "run", "--plan", "missing", "--manifest", "missing",
                                 "--output", "unused"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--binary", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_statistical_and_stage_tools_do_not_import_report_rendering(self):
        script = """
import builtins
original = builtins.__import__
def guarded(name, *args, **kwargs):
    if name == 'report':
        raise AssertionError('Statistical tools must not depend on report rendering')
    return original(name, *args, **kwargs)
builtins.__import__ = guarded
import study, transfer_evaluation, mechanism_evaluation, search_evaluation, trade_diagnostics
"""
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parent,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
