import unittest

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from api.routers.flows import delete_flow
from models import Asset, Base, Flow, User


class FlowDeleteTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(dbapi_connection, _connection_record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = User(id="user-1", email="user@example.com", hashed_password="hash")
        self.flow = Flow(id="flow-1", name="可删除项目", nodes=[], edges=[], user_id=self.user.id)
        self.asset = Asset(
            id="asset-1",
            user_id=self.user.id,
            flow_id=self.flow.id,
            node_id="node-1",
            kind="image",
            title="保留素材",
            mime_type="image/png",
            storage_key="images/asset-1.png",
            public_url="/uploads/images/asset-1.png",
            size_bytes=12,
        )
        self.db.add_all([self.user, self.flow])
        self.db.commit()
        self.db.add(self.asset)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_deleting_flow_detaches_and_keeps_user_assets(self):
        delete_flow(flow_id=self.flow.id, db=self.db, user=self.user)

        self.assertIsNone(self.db.get(Flow, self.flow.id))
        saved_asset = self.db.get(Asset, self.asset.id)
        self.assertIsNotNone(saved_asset)
        self.assertIsNone(saved_asset.flow_id)
        self.assertIsNone(saved_asset.node_id)


if __name__ == "__main__":
    unittest.main()
