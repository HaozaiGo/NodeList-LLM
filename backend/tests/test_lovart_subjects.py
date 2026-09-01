import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from api.routers.video import LovartSubjectReference, _resolve_lovart_subject_assets
from lovart import LovartClient, _build_chat_body


class FakeDB:
    def __init__(self, assets):
        self.assets = {asset.id: asset for asset in assets}

    def get(self, _model, asset_id):
        return self.assets.get(asset_id)


class LovartSubjectTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_subject_uses_kit_confirmation_and_moderation(self):
        client = LovartClient(task_base_url="http://relay.example", relay_secret="secret", user_uuid="user-1")
        calls = []

        async def fake_task_request(method, path, *, json_payload=None, params=None):
            calls.append((method, path, json_payload, params))
            if path == "/v1/kit/list":
                return {"items": [{"id": "kit-1"}]}
            if path == "/v1/kit/asset/presign":
                return {"upload_url": "https://upload.example/subject", "callback_token": "callback-1"}
            if path == "/v1/kit/asset/confirm":
                return {"asset": {"id": "subject-1"}}
            if path == "/v1/kit/asset/moderation/submit":
                return {"accepted": True}
            if path == "/v1/kit/asset/moderation/check":
                return {"items": [{"asset_id": "subject-1", "status": "active"}]}
            if path == "/v1/kit/assets":
                return {
                    "assetDataset": [
                        {
                            "id": "subject-1",
                            "display_name": "女主角",
                            "files": [{"url": "https://lovart.example/subject.png"}],
                        }
                    ]
                }
            raise AssertionError(f"unexpected Lovart request: {method} {path}")

        client._task_request = fake_task_request
        client._put_subject_upload = AsyncMock()

        result = await client.upload_subject_image(
            b"image-bytes",
            content_type="image/png",
            display_name="女主角",
        )

        self.assertEqual(result["asset_id"], "subject-1")
        self.assertEqual(result["status"], "active")
        self.assertEqual(result["asset_url"], "https://lovart.example/subject.png")
        client._put_subject_upload.assert_awaited_once_with(
            "https://upload.example/subject",
            b"image-bytes",
            "image/png",
        )
        self.assertIn(("POST", "/v1/kit/asset/moderation/submit"), [(method, path) for method, path, _, _ in calls])

    def test_chat_body_includes_subject_asset_list(self):
        body = _build_chat_body(
            {
                "prompt": "生成视频",
                "reference_images": ["https://example.com/scene.png"],
                "subject_assets": [
                    {
                        "assetId": "subject-1",
                        "url": "https://lovart.example/subject.png",
                        "displayName": "女主角",
                        "channel": "ark_sd2",
                    }
                ],
            },
            "project-1",
        )

        self.assertEqual(body["attachments"], ["https://example.com/scene.png"])
        self.assertEqual(body["subjectAssetList"][0]["assetId"], "subject-1")
        self.assertEqual(body["subjectAssetList"][0]["type"], "subject_image")

    def test_video_subject_is_resolved_from_current_users_asset(self):
        asset = SimpleNamespace(
            id="local-asset-1",
            user_id="user-1",
            title="女主角",
            asset_metadata={
                "lovartSubjectId": "trusted-subject",
                "lovartSubjectStatus": "active",
                "lovartSubjectUrl": "https://lovart.example/trusted.png",
                "lovartSubjectChannel": "ark_sd2",
            },
        )
        request = LovartSubjectReference(
            sourceAssetId="local-asset-1",
            assetId="forged-subject",
            url="https://attacker.example/forged.png",
        )

        resolved = _resolve_lovart_subject_assets(FakeDB([asset]), SimpleNamespace(id="user-1"), [request])

        self.assertEqual(resolved[0]["assetId"], "trusted-subject")
        self.assertEqual(resolved[0]["url"], "https://lovart.example/trusted.png")

    def test_video_subject_rejects_another_users_asset(self):
        asset = SimpleNamespace(
            id="local-asset-2",
            user_id="user-2",
            title="其他账号人物",
            asset_metadata={
                "lovartSubjectId": "subject-2",
                "lovartSubjectStatus": "active",
                "lovartSubjectUrl": "https://lovart.example/other.png",
            },
        )
        request = LovartSubjectReference(sourceAssetId="local-asset-2")

        with self.assertRaises(HTTPException) as raised:
            _resolve_lovart_subject_assets(FakeDB([asset]), SimpleNamespace(id="user-1"), [request])

        self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
