import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.routers.auth import GoogleLoginRequest, google_config, google_login
from models import Base, User


class GoogleAuthTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def google_payload(self, *, sub="google-123", email="creator@gmail.com"):
        return {
            "sub": sub,
            "email": email,
            "email_verified": True,
            "aud": "test-client-id",
        }

    def login_with_payload(self, payload):
        with patch("api.routers.auth.GOOGLE_CLIENT_ID", "test-client-id"), patch(
            "api.routers.auth._verify_google_credential",
            return_value=payload,
        ):
            return google_login(GoogleLoginRequest(credential="google-id-token"), db=self.db)

    def test_config_is_disabled_without_client_id(self):
        with patch("api.routers.auth.GOOGLE_CLIENT_ID", ""):
            result = google_config()

        self.assertFalse(result.enabled)
        self.assertEqual(result.client_id, "")

    def test_first_google_login_creates_user(self):
        result = self.login_with_payload(self.google_payload())

        user = self.db.query(User).filter(User.google_sub == "google-123").one()
        self.assertEqual(user.email, "creator@gmail.com")
        self.assertEqual(result.user_id, user.id)
        self.assertTrue(result.access_token)

    def test_existing_email_account_is_linked(self):
        existing = User(id="user-1", email="Creator@Gmail.com", hashed_password="existing-hash")
        self.db.add(existing)
        self.db.commit()

        result = self.login_with_payload(self.google_payload())

        self.db.refresh(existing)
        self.assertEqual(existing.google_sub, "google-123")
        self.assertEqual(result.user_id, existing.id)
        self.assertEqual(self.db.query(User).count(), 1)

    def test_unverified_google_email_is_rejected(self):
        payload = self.google_payload()
        payload["email_verified"] = False

        with self.assertRaises(HTTPException) as raised:
            self.login_with_payload(payload)

        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(self.db.query(User).count(), 0)

    def test_disabled_existing_account_is_rejected_without_linking(self):
        existing = User(
            id="user-1",
            email="creator@gmail.com",
            hashed_password="existing-hash",
            disabled_at=datetime.utcnow(),
        )
        self.db.add(existing)
        self.db.commit()

        with self.assertRaises(HTTPException) as raised:
            self.login_with_payload(self.google_payload())

        self.assertEqual(raised.exception.status_code, 403)
        self.db.refresh(existing)
        self.assertIsNone(existing.google_sub)


if __name__ == "__main__":
    unittest.main()
