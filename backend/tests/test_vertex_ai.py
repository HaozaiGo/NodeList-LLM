import base64
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from api.routers.assets import _download_finished_video
from api.routers.video import VideoGenerateRequest, _generate_video_without_billing, _validate_generation_request
from providers.vertex_ai import (
    VERTEX_IMAGE_MODEL,
    VERTEX_VIDEO_TASK_PREFIX,
    VERTEX_VIDEO_MODEL,
    VertexImage,
    VertexAIError,
    _extract_generated_images,
    create_vertex_video,
    decode_vertex_video_task,
    encode_vertex_video_task,
    vertex_video_status,
)


class _FakeResponse:
    status_code = 200

    @staticmethod
    def json():
        return {
            "name": (
                "projects/demo/locations/us-central1/publishers/google/models/"
                "veo-3.1-fast-generate-001/operations/operation-123"
            )
        }


class _FakeAsyncClient:
    def __init__(self):
        self.request_json = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, _url, *, headers, json):
        self.request_json = json
        return _FakeResponse()


class VertexAIProviderTests(unittest.TestCase):
    def test_video_task_id_round_trip(self):
        operation = (
            "projects/demo/locations/us-central1/publishers/google/models/"
            "veo-3.1-fast-generate-001/operations/operation-123"
        )

        task_id = encode_vertex_video_task(operation)

        self.assertTrue(task_id.startswith("vertex-veo:"))
        self.assertEqual(decode_vertex_video_task(task_id), operation)

    def test_invalid_video_task_id_is_rejected(self):
        with self.assertRaises(VertexAIError) as raised:
            decode_vertex_video_task("vertex-veo:bm90LWFuLW9wZXJhdGlvbg")

        self.assertEqual(raised.exception.status_code, 400)

    def test_extracts_inline_gemini_image(self):
        expected = b"fake-png"
        payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "done"},
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": base64.b64encode(expected).decode("ascii"),
                                }
                            },
                        ]
                    }
                }
            ]
        }

        images = _extract_generated_images(payload)

        self.assertEqual(len(images), 1)
        self.assertEqual(images[0].data, expected)
        self.assertEqual(images[0].mime_type, "image/png")

    def test_completed_inline_video_has_content_path(self):
        task_id = encode_vertex_video_task(
            "projects/demo/locations/us-central1/publishers/google/models/veo/operations/operation-1"
        )
        operation = {
            "name": "operation-1",
            "done": True,
            "response": {
                "videos": [
                    {
                        "bytesBase64Encoded": base64.b64encode(b"video").decode("ascii"),
                        "mimeType": "video/mp4",
                    }
                ]
            },
        }

        result = vertex_video_status(task_id, VERTEX_VIDEO_MODEL, operation)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["content_path"], f"/api/video/generate/{task_id}/content")
        self.assertTrue(result["raw"]["hasInlineVideo"])

    def test_filtered_video_is_failed(self):
        task_id = encode_vertex_video_task(
            "projects/demo/locations/us-central1/publishers/google/models/veo/operations/operation-2"
        )
        operation = {"done": True, "response": {"raiMediaFilteredCount": 1, "videos": []}}

        result = vertex_video_status(task_id, VERTEX_VIDEO_MODEL, operation)

        self.assertEqual(result["status"], "failed")
        self.assertIn("安全策略", result["error"])

    def test_vertex_veo_parameters_are_validated(self):
        _validate_generation_request(
            VideoGenerateRequest(
                prompt="A paper boat sailing through a neon city",
                model=VERTEX_VIDEO_MODEL,
                ratio="16:9",
                resolution="1080p",
                seconds=8,
            )
        )

        with self.assertRaises(HTTPException) as raised:
            _validate_generation_request(
                VideoGenerateRequest(
                    prompt="A paper boat",
                    model=VERTEX_VIDEO_MODEL,
                    ratio="1:1",
                    resolution="1080p",
                    seconds=8,
                )
            )
        self.assertEqual(raised.exception.status_code, 400)

    def test_expected_models_are_configured(self):
        self.assertEqual(VERTEX_IMAGE_MODEL, "gemini-2.5-flash-image")
        self.assertEqual(VERTEX_VIDEO_MODEL, "veo-3.1-fast-generate-001")


class VertexAIVideoGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_project_asset_cache_downloads_vertex_video_with_vertex_provider(self):
        download_vertex = AsyncMock(return_value=(b"video", "video/mp4"))
        download_tokenops = AsyncMock()

        with patch("api.routers.assets._download_vertex_video", new=download_vertex):
            with patch("api.routers.assets._download_tokenops_video", new=download_tokenops):
                content, mime_type, provider = await _download_finished_video(
                    f"{VERTEX_VIDEO_TASK_PREFIX}encoded-operation"
                )

        self.assertEqual(content, b"video")
        self.assertEqual(mime_type, "video/mp4")
        self.assertEqual(provider, "vertex-ai")
        download_vertex.assert_awaited_once()
        download_tokenops.assert_not_awaited()

    async def test_first_frame_is_sent_with_the_prompt(self):
        client = _FakeAsyncClient()
        first_frame = VertexImage(data=b"first-frame", mime_type="image/png")
        with patch("providers.vertex_ai._auth_context", new=AsyncMock(return_value=("token", "demo"))):
            with patch(
                "providers.vertex_ai._download_reference_image",
                new=AsyncMock(return_value=first_frame),
            ):
                with patch("providers.vertex_ai.httpx.AsyncClient", return_value=client):
                    result = await create_vertex_video(
                        prompt="The subject turns toward the camera",
                        model=VERTEX_VIDEO_MODEL,
                        aspect_ratio="16:9",
                        resolution="720p",
                        seconds=8,
                        generate_audio=True,
                        reference_image="data:image/png;base64,Zmlyc3QtZnJhbWU=",
                    )

        instance = client.request_json["instances"][0]
        self.assertEqual(instance["prompt"], "The subject turns toward the camera")
        self.assertEqual(instance["image"]["mimeType"], "image/png")
        self.assertEqual(base64.b64decode(instance["image"]["bytesBase64Encoded"]), b"first-frame")
        self.assertEqual(client.request_json["parameters"]["resizeMode"], "crop")
        self.assertNotIn("task", client.request_json["parameters"])
        self.assertEqual(result["request"]["task"], "imageToVideo")
        self.assertEqual(result["request"]["reference_image_count"], 1)

    async def test_router_resolves_and_forwards_only_the_first_image(self):
        payload = VideoGenerateRequest(
            prompt="Animate the first frame",
            model=VERTEX_VIDEO_MODEL,
            ratio="9:16",
            resolution="720p",
            seconds=8,
            reference_images=["https://example.com/first.png", "https://example.com/second.png"],
        )
        resolve_image = AsyncMock(return_value=("data:image/png;base64,Zmlyc3Q=", "first.png"))
        create_video = AsyncMock(return_value={"id": "vertex-veo:task", "status": "running"})
        with patch("api.routers.video._image_reference_to_data_url", new=resolve_image):
            with patch("api.routers.video.create_vertex_video", new=create_video):
                await _generate_video_without_billing(payload, None, None)

        resolve_image.assert_awaited_once_with(None, None, "https://example.com/first.png")
        self.assertEqual(
            create_video.await_args.kwargs["reference_image"],
            "data:image/png;base64,Zmlyc3Q=",
        )

    async def test_text_only_request_remains_supported(self):
        client = _FakeAsyncClient()
        with patch("providers.vertex_ai._auth_context", new=AsyncMock(return_value=("token", "demo"))):
            with patch("providers.vertex_ai.httpx.AsyncClient", return_value=client):
                result = await create_vertex_video(
                    prompt="A paper boat crosses a neon canal",
                    model=VERTEX_VIDEO_MODEL,
                    aspect_ratio="16:9",
                    resolution="720p",
                    seconds=8,
                    generate_audio=True,
                )

        self.assertNotIn("image", client.request_json["instances"][0])
        self.assertNotIn("task", client.request_json["parameters"])
        self.assertEqual(result["request"]["task"], "textToVideo")
        self.assertEqual(result["request"]["reference_image_count"], 0)


if __name__ == "__main__":
    unittest.main()
