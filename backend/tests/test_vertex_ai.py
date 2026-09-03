import base64
import unittest

from fastapi import HTTPException

from api.routers.video import VideoGenerateRequest, _validate_generation_request
from providers.vertex_ai import (
    VERTEX_IMAGE_MODEL,
    VERTEX_VIDEO_MODEL,
    VertexAIError,
    _extract_generated_images,
    decode_vertex_video_task,
    encode_vertex_video_task,
    vertex_video_status,
)


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


if __name__ == "__main__":
    unittest.main()
