import unittest
from io import BytesIO
from unittest.mock import PropertyMock, patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from api.routers.branding import MAX_LOGO_BYTES, _read_logo, get_branding, get_branding_logo, update_branding
from models import Base, BrandingConfig, User
from storage import StoredObject, storage


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"test-png-content"


def make_upload(filename: str, content_type: str, content: bytes) -> UploadFile:
    return UploadFile(
        BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


class BrandingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.admin = User(
            id="admin-1",
            email="admin@example.com",
            hashed_password="hash",
            role="admin",
        )
        self.db.add(self.admin)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    async def test_public_config_uses_default_brand(self):
        result = get_branding(db=self.db)

        self.assertEqual(result.name, "NodeList AI")
        self.assertEqual(result.logo_url, "")
        self.assertIsNotNone(self.db.get(BrandingConfig, "default"))

    async def test_admin_can_change_name_without_logo(self):
        result = await update_branding(
            name="  Example   Studio  ",
            logo=None,
            remove_logo=False,
            db=self.db,
            admin=self.admin,
        )

        self.assertEqual(result.name, "Example Studio")
        config = self.db.get(BrandingConfig, "default")
        self.assertEqual(config.updated_by, self.admin.id)

    async def test_upload_replaces_and_deletes_old_logo(self):
        self.db.add(
            BrandingConfig(
                id="default",
                name="Old Brand",
                logo_storage_key="branding/old.png",
                logo_url="/uploads/branding/old.png",
                logo_mime_type="image/png",
            )
        )
        self.db.commit()
        logo = make_upload("brand.png", "image/png", PNG_BYTES)
        stored = StoredObject(
            storage_key="branding/new.png",
            public_url="/uploads/branding/new.png",
            size=11,
        )

        with patch("api.routers.branding.storage.save_bytes", return_value=stored), patch(
            "api.routers.branding.storage.delete"
        ) as delete:
            result = await update_branding(
                name="New Brand",
                logo=logo,
                remove_logo=False,
                db=self.db,
                admin=self.admin,
            )

        self.assertTrue(result.logo_url.startswith("/api/branding/logo?v="))
        delete.assert_called_once_with("branding/old.png")

    async def test_uses_real_file_type_when_extension_is_wrong(self):
        content, content_type, filename = await _read_logo(
            make_upload("微信图片.jpg", "image/jpeg", PNG_BYTES)
        )

        self.assertEqual(content, PNG_BYTES)
        self.assertEqual(content_type, "image/png")
        self.assertTrue(filename.endswith(".png"))

    async def test_logo_route_serves_private_storage_through_backend(self):
        config = BrandingConfig(
            id="default",
            name="Private Logo",
            logo_storage_key="branding/private.jpg",
            logo_url="https://private.example.com/branding/private.jpg",
            logo_mime_type="image/jpeg",
        )
        self.db.add(config)
        self.db.commit()

        with patch.object(type(storage), "is_remote", new_callable=PropertyMock, return_value=False), patch(
            "api.routers.branding.storage.ensure_local"
        ) as ensure_local:
            ensure_local.return_value.open.return_value.__enter__.return_value.read.return_value = PNG_BYTES[:16]
            response = get_branding_logo(db=self.db)

        self.assertEqual(response.media_type, "image/png")
        self.assertEqual(response.headers["cache-control"], "public, max-age=3600")

    async def test_remote_logo_route_redirects_to_fresh_signed_url(self):
        self.db.add(
            BrandingConfig(
                id="default",
                name="Remote Logo",
                logo_storage_key="branding/remote.png",
                logo_mime_type="image/png",
            )
        )
        self.db.commit()

        with patch.object(type(storage), "is_remote", new_callable=PropertyMock, return_value=True), patch(
            "api.routers.branding.storage.presign_download",
            return_value="https://storage.example.com/signed-logo.png",
        ):
            response = get_branding_logo(db=self.db)

        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "https://storage.example.com/signed-logo.png")
        self.assertEqual(response.headers["cache-control"], "no-store")

    async def test_rejects_unsupported_or_oversized_logo(self):
        with self.assertRaises(HTTPException) as unsupported:
            await _read_logo(make_upload("logo.svg", "image/svg+xml", b"<svg />"))
        self.assertEqual(unsupported.exception.status_code, 400)

        with self.assertRaises(HTTPException) as oversized:
            await _read_logo(make_upload("logo.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * MAX_LOGO_BYTES))
        self.assertEqual(oversized.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
