import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from api.routers import image as image_router
from api.routers import video as video_router
from lovart import LovartAPIError, LovartClient, release_lovart_tasks


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args):
        return self

    def order_by(self, *args):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self, rows):
        self.rows = rows

    def query(self, *args):
        return FakeQuery(self.rows)


def fake_asset(task_id, index=1, *, kind="generated_image"):
    return SimpleNamespace(
        id=f"asset-{index}",
        title=f"Asset {index}",
        public_url=f"/uploads/asset-{index}",
        storage_key=f"asset-{index}.bin",
        asset_metadata={"taskId": task_id, "model": "test-model"},
        kind=kind,
    )


class LovartCleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_terminate_tasks_deduplicates_and_filters_placeholder_ids(self):
        client = LovartClient(
            task_base_url="http://relay.example",
            relay_secret="relay-secret",
            user_uuid="test-user",
        )
        captured = {}

        async def fake_task_request(method, path, *, json_payload=None, params=None):
            captured.update(
                method=method,
                path=path,
                json_payload=json_payload,
                params=params,
            )
            return {"terminated": len(json_payload["task_ids"])}

        client._task_request = fake_task_request
        result = await client.terminate_tasks(
            ["task-1", "", "task-1", "local-pending", "等待远端任务ID", "task-2"]
        )

        self.assertEqual(result, {"terminated": 2})
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/tasks/terminate")
        self.assertEqual(
            captured["json_payload"],
            {"task_ids": ["task-1", "task-2"], "user_uuid": "test-user"},
        )

    async def test_release_failure_does_not_break_terminal_response(self):
        class FailingClient:
            async def terminate_tasks(self, task_ids):
                raise LovartAPIError(503, "relay unavailable")

        released = await release_lovart_tasks(
            FailingClient(),
            ["task-1"],
            reason="test",
        )

        self.assertFalse(released)

    async def test_partial_image_batch_is_not_treated_as_archived(self):
        task_id = "lovart-batch:task-1,task-2"
        assets = image_router._saved_lovart_images(
            FakeDB([fake_asset(task_id)]),
            SimpleNamespace(id="user-1"),
            task_id,
            flow_id=None,
            node_id=None,
        )

        self.assertEqual(assets, [])

    async def test_archived_image_status_retries_release(self):
        task_id = "lovart-batch:task-1,task-2"
        db = FakeDB([fake_asset(task_id, 1), fake_asset(task_id, 2)])
        with patch.object(image_router, "release_lovart_tasks", new=AsyncMock()) as release:
            status = await image_router.get_image_generation_status(
                task_id,
                model="test-model",
                flowId=None,
                nodeId=None,
                db=db,
                user=SimpleNamespace(id="user-1"),
            )

        self.assertEqual(status.status, "completed")
        release.assert_awaited_once()
        self.assertEqual(release.await_args.args[1], ["task-1", "task-2"])

    async def test_archived_video_status_retries_release(self):
        video_id = "lovart:task-3"
        db = FakeDB([fake_asset(video_id, kind="project_video")])
        with patch.object(video_router, "release_lovart_tasks", new=AsyncMock()) as release:
            status = await video_router._get_lovart_video_status(
                video_id,
                db,
                SimpleNamespace(id="user-1"),
            )

        self.assertEqual(status["status"], "completed")
        release.assert_awaited_once()
        self.assertEqual(release.await_args.args[1], ["task-3"])


if __name__ == "__main__":
    unittest.main()
