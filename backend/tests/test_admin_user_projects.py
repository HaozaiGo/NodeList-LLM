import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.routers.admin import list_user_flows, list_users_page
from auth import _effective_user
from models import Base, Flow, User


class FakeDB:
    def __init__(self, users):
        self.users = {user.id: user for user in users}

    def get(self, _model, user_id):
        return self.users.get(user_id)


class AdminUserProjectTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.admin = User(id="admin-1", email="admin@example.com", hashed_password="hash", role="admin")
        self.db.add(self.admin)
        for index in range(35):
            self.db.add(
                User(
                    id=f"user-{index:02d}",
                    email=f"user-{index:02d}@example.com",
                    hashed_password="hash",
                    role="user",
                )
            )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_users_page_contains_30_rows(self):
        result = list_users_page(page=1, page_size=30, db=self.db, _=self.admin)

        self.assertEqual(len(result.items), 30)
        self.assertEqual(result.total, 36)
        self.assertEqual(result.total_pages, 2)

    def test_user_flow_list_is_scoped_to_requested_user(self):
        self.db.add_all(
            [
                Flow(id="flow-1", name="目标项目", nodes=[{"id": "n1"}], edges=[], user_id="user-00"),
                Flow(id="flow-2", name="其他项目", nodes=[], edges=[], user_id="user-01"),
            ]
        )
        self.db.commit()

        result = list_user_flows(user_id="user-00", db=self.db, _=self.admin)

        self.assertEqual([flow.id for flow in result], ["flow-1"])
        self.assertEqual(result[0].node_count, 1)

    def test_only_admin_can_act_as_another_user(self):
        regular_user = SimpleNamespace(id="user-1", role="user")
        target_user = SimpleNamespace(id="user-2", role="user")
        db = FakeDB([regular_user, target_user])

        with self.assertRaises(HTTPException) as raised:
            _effective_user(db, regular_user, target_user.id)

        self.assertEqual(raised.exception.status_code, 403)

    def test_admin_can_act_as_requested_user(self):
        admin = SimpleNamespace(id="admin-1", role="admin")
        target_user = SimpleNamespace(id="user-2", role="user")

        result = _effective_user(FakeDB([admin, target_user]), admin, target_user.id)

        self.assertIs(result, target_user)


if __name__ == "__main__":
    unittest.main()
