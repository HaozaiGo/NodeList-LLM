import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from api.routers.admin import _extract_model_runs


class AdminModelRunsTests(unittest.TestCase):
    def test_extracts_only_configured_active_model_runs(self):
        now = datetime.now(timezone.utc)
        flow = SimpleNamespace(
            id="flow-1",
            name="Campaign",
            created_at=now - timedelta(minutes=4),
            updated_at=now - timedelta(seconds=5),
            nodes=[
                {
                    "id": "image-1",
                    "type": "sceneAsset",
                    "data": {
                        "label": "Scene",
                        "status": "running",
                        "config": {
                            "model": "gpt-image-2",
                            "generationStatus": "running",
                            "taskId": "task-1",
                            "taskCreatedAt": (now - timedelta(minutes=2)).isoformat(),
                        },
                    },
                },
                {
                    "id": "done-1",
                    "type": "videoGeneration",
                    "data": {"config": {"model": "seedance-2-0", "status": "completed"}},
                },
                {
                    "id": "template-only",
                    "type": "doubaoAnalysis",
                    "data": {"status": "running", "config": {}},
                },
            ],
        )
        user = SimpleNamespace(id="user-1", email="user@example.com")

        runs = _extract_model_runs(flow, user, now=now)

        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0].user_email, "user@example.com")
        self.assertEqual(runs[0].kind, "image")
        self.assertEqual(runs[0].provider, "Lovart")
        self.assertFalse(runs[0].stale)

    def test_marks_unupdated_run_as_stale(self):
        now = datetime.now(timezone.utc)
        flow = SimpleNamespace(
            id="flow-2",
            name="Old Flow",
            created_at=now - timedelta(hours=1),
            updated_at=now - timedelta(minutes=11),
            nodes=[
                {
                    "id": "video-1",
                    "type": "videoGeneration",
                    "data": {
                        "label": "Video",
                        "config": {
                            "model": "seedance-2-0",
                            "status": "polling_retry",
                            "taskId": "lovart:task-2",
                        },
                    },
                }
            ],
        )
        user = SimpleNamespace(id="user-2", email="stale@example.com")

        runs = _extract_model_runs(flow, user, now=now)

        self.assertEqual(len(runs), 1)
        self.assertTrue(runs[0].stale)
        self.assertEqual(runs[0].provider, "Lovart")


if __name__ == "__main__":
    unittest.main()
