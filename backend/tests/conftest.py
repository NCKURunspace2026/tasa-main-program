import os
import tempfile
from pathlib import Path


TEST_DATABASE_PATH = Path(tempfile.gettempdir()) / "mission_dashboard_v2_tests.db"
TEST_DATABASE_PATH.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH}"
os.environ["MISSION_DASHBOARD_WORKER_TOKEN"] = "test-worker-token"
