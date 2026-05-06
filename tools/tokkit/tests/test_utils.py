from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from tokkit.utils import _read_iana_from_localtime_symlink, get_timezone


class ReadIanaFromLocaltimeSymlinkTests(unittest.TestCase):
    def test_extracts_iana_name_from_macos_style_target(self) -> None:
        with patch("tokkit.utils.os.readlink", return_value="/var/db/timezone/zoneinfo/Asia/Shanghai"):
            self.assertEqual(_read_iana_from_localtime_symlink(), "Asia/Shanghai")

    def test_extracts_iana_name_from_linux_style_target(self) -> None:
        with patch("tokkit.utils.os.readlink", return_value="/usr/share/zoneinfo/Europe/Berlin"):
            self.assertEqual(_read_iana_from_localtime_symlink(), "Europe/Berlin")

    def test_handles_relative_symlink_with_dotdot_segments(self) -> None:
        # Some installers create relative symlinks like
        # ../usr/share/zoneinfo/UTC; rfind on the marker still recovers the
        # IANA tail.
        with patch("tokkit.utils.os.readlink", return_value="../usr/share/zoneinfo/UTC"):
            self.assertEqual(_read_iana_from_localtime_symlink(), "UTC")

    def test_returns_none_when_symlink_unreadable(self) -> None:
        with patch("tokkit.utils.os.readlink", side_effect=OSError("not a symlink")):
            self.assertIsNone(_read_iana_from_localtime_symlink())

    def test_returns_none_when_target_lacks_zoneinfo_marker(self) -> None:
        with patch("tokkit.utils.os.readlink", return_value="/some/unrelated/path"):
            self.assertIsNone(_read_iana_from_localtime_symlink())


class GetTimezoneTests(unittest.TestCase):
    def test_explicit_name_short_circuits_detection(self) -> None:
        self.assertEqual(get_timezone("America/Los_Angeles"), ZoneInfo("America/Los_Angeles"))

    def test_recovers_iana_name_from_localtime_when_tzinfo_lacks_key(self) -> None:
        # Regression for the macOS bug: datetime.now().astimezone().tzinfo
        # is a fixed-offset `datetime.timezone` instance (NOT a ZoneInfo),
        # and tzname() returns an abbreviation like "CST" that isn't a
        # valid IANA name — `ZoneInfo("CST")` raises and the original
        # fallback would silently swallow it into UTC.
        from datetime import datetime, timezone, timedelta

        fake_now = datetime(
            2026, 5, 6, 10, 0, 0,
            tzinfo=timezone(timedelta(hours=8), "CST"),
        )

        class _FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):  # type: ignore[override]
                return fake_now if tz is None else fake_now.astimezone(tz)

        with patch("tokkit.utils.datetime", _FrozenDatetime), patch(
            "tokkit.utils.os.readlink",
            return_value="/var/db/timezone/zoneinfo/Asia/Shanghai",
        ):
            tz = get_timezone()
        self.assertEqual(tz, ZoneInfo("Asia/Shanghai"))

    def test_invalid_localtime_iana_name_continues_to_fallback(self) -> None:
        from datetime import datetime, timedelta, timezone

        fake_now = datetime(
            2026, 5, 6, 10, 0, 0,
            tzinfo=timezone(timedelta(hours=8), "NotAnIanaZone"),
        )

        class _FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):  # type: ignore[override]
                return fake_now if tz is None else fake_now.astimezone(tz)

        with patch("tokkit.utils.datetime", _FrozenDatetime), patch(
            "tokkit.utils.os.readlink",
            return_value="/var/db/timezone/zoneinfo/Definitely/NotAZone",
        ):
            tz = get_timezone()
        self.assertEqual(tz, ZoneInfo("UTC"))


if __name__ == "__main__":
    unittest.main()
