import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from billing import finalize_generation_charge, refund_generation_credits, reserve_generation_credits
from api.routers.image import ImageGenerateRequest, generate_image
from api.routers.video import VideoGenerateRequest, generate_video
from lovart import LovartTaskResult
from models import Base, BillingConfig, CreditTransaction, User


class BillingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(
            id="user-1",
            email="user@example.com",
            hashed_password="hash",
            credit_balance=100,
        )
        self.db.add_all(
            [
                self.user,
                BillingConfig(id="default", image_cost=3, video_cost=20),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_image_batch_charges_per_generated_image(self):
        charge = reserve_generation_credits(
            self.db,
            self.user,
            kind="image",
            units=4,
            note="图片生成 4 张",
        )

        self.assertIsNotNone(charge)
        self.assertEqual(charge.amount, 12)
        self.db.refresh(self.user)
        self.assertEqual(self.user.credit_balance, 88)
        transaction = self.db.get(CreditTransaction, charge.transaction_id)
        self.assertEqual(transaction.amount, -12)
        self.assertEqual(transaction.balance_after, 88)

        finalize_generation_charge(self.db, charge, "task-1")
        self.db.refresh(transaction)
        self.assertIn("task-1", transaction.note)

    def test_failed_submission_refunds_reserved_credits(self):
        charge = reserve_generation_credits(self.db, self.user, kind="video", note="视频生成")

        refund_generation_credits(self.db, self.user, charge, reason="provider rejected")

        self.db.refresh(self.user)
        self.assertEqual(self.user.credit_balance, 100)
        refund = (
            self.db.query(CreditTransaction)
            .filter(CreditTransaction.transaction_type == "generation_refund")
            .one()
        )
        self.assertEqual(refund.amount, 20)
        self.assertEqual(refund.balance_after, 100)

    def test_insufficient_balance_rejects_before_generation(self):
        self.user.credit_balance = 2
        self.db.commit()

        with self.assertRaises(HTTPException) as raised:
            reserve_generation_credits(self.db, self.user, kind="image", units=1)

        self.assertEqual(raised.exception.status_code, 402)
        self.assertEqual(self.db.query(CreditTransaction).count(), 0)

    def test_zero_cost_keeps_existing_free_generation_behavior(self):
        config = self.db.get(BillingConfig, "default")
        config.video_cost = 0
        self.db.commit()

        charge = reserve_generation_credits(self.db, self.user, kind="video")

        self.assertIsNone(charge)
        self.db.refresh(self.user)
        self.assertEqual(self.user.credit_balance, 100)


class GenerationBillingIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(
            id="user-1",
            email="user@example.com",
            hashed_password="hash",
            credit_balance=100,
        )
        self.db.add_all(
            [
                self.user,
                BillingConfig(id="default", image_cost=5, video_cost=25),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    async def test_image_route_charges_requested_count_after_task_creation(self):
        client = AsyncMock()
        client.create_task.side_effect = [
            LovartTaskResult(task_id="image-task-1", request_id="request-1"),
            LovartTaskResult(task_id="image-task-2", request_id="request-2"),
        ]
        payload = ImageGenerateRequest(prompt="测试图片", model="gpt-image-2", count=2)

        with patch("api.routers.image.LovartClient", return_value=client):
            result = await generate_image(payload, db=self.db, user=self.user)

        self.assertEqual(result.creditsCharged, 10)
        self.assertEqual(result.creditBalance, 90)
        self.assertTrue(result.id.startswith("lovart-batch:"))

    async def test_video_route_charges_one_video(self):
        payload = VideoGenerateRequest(prompt="测试视频", model="seedance-2-0-fast")
        generated = {"id": "video-task-1", "model": payload.model, "status": "running"}

        with patch("api.routers.video._validate_generation_request"), patch(
            "api.routers.video._select_generation_model", return_value=payload.model
        ), patch(
            "api.routers.video._generate_video_without_billing", new=AsyncMock(return_value=generated)
        ):
            result = await generate_video(payload, db=self.db, user=self.user)

        self.assertEqual(result["creditsCharged"], 25)
        self.assertEqual(result["creditBalance"], 75)


if __name__ == "__main__":
    unittest.main()
