"""Nayara Studio (fabric_order_management) order-management + multi-tenant isolation tests."""
import base64

import pytest

from conftest import API

TINY_PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6300010000050001".replace(" ", "")
)).decode() if False else (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)


# ---------------- Auth / industry flag ----------------
class TestNayaraAuth:
    def test_login_returns_industry(self):
        import requests
        r = requests.post(f"{API}/auth/login", json={"email": "admin@nayara.studio", "password": "Nayara@2026"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()  # login returns a flat user object with token
        assert d.get("token")
        assert d.get("industry") == "fabric_order_management", d
        assert d.get("org_name") == "Nayara Studio", d.get("org_name")
        assert d.get("organization_id") not in (None, "")
        assert "_id" not in d and "password_hash" not in d, d.keys()
        # httpOnly cookies set
        cookies = {c.name: c for c in r.cookies}
        assert "access_token" in cookies, cookies.keys()
        assert cookies["access_token"].has_nonstandard_attr("HttpOnly")

    def test_me_has_industry(self, nayara):
        r = nayara.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["industry"] == "fabric_order_management"

    def test_route39_industry_fleet(self, admin):
        r = admin.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json().get("industry") == "fleet"

    def test_bad_password(self):
        import requests
        r = requests.post(f"{API}/auth/login", json={"email": "admin@nayara.studio", "password": "wrong"}, timeout=30)
        assert r.status_code == 401


# ---------------- Orders / customers read ----------------
class TestNayaraSeedData:
    def test_orders_seeded(self, nayara):
        r = nayara.get(f"{API}/orders", timeout=30)
        assert r.status_code == 200
        orders = r.json()
        assert len(orders) >= 24, len(orders)
        o = orders[0]
        for k in ("id", "order_number", "customer_name", "status", "due_status", "priority"):
            assert k in o, o.keys()
        assert "_id" not in o
        assert o["status"] in ("received", "processing", "on_hold", "completed")

    def test_customers_seeded(self, nayara):
        r = nayara.get(f"{API}/customers", timeout=30)
        assert r.status_code == 200
        cs = r.json()
        assert len(cs) >= 6
        assert all("order_count" in c and "_id" not in c for c in cs)

    def test_order_dashboard(self, nayara):
        r = nayara.get(f"{API}/order-dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        k = d["kpis"]
        assert k["total"] == k["received"] + k["processing"] + k["on_hold"] + k["completed"]
        assert d["pipeline"]["received"] == k["received"]
        for key in ("todays", "due_soon", "recent_completed", "attention"):
            assert isinstance(d[key], list)

    def test_order_reports(self, nayara):
        r = nayara.get(f"{API}/order-reports", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] == sum(d["by_status"].values())
        assert isinstance(d["by_assignee"], list) and isinstance(d["by_customer"], list)

    def test_order_search(self, nayara):
        orders = nayara.get(f"{API}/orders", timeout=30).json()
        num = orders[0]["order_number"]
        r = nayara.get(f"{API}/order-search", params={"q": num}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert any(o["order_number"] == num for o in d["orders"])

    def test_filters(self, nayara):
        r = nayara.get(f"{API}/orders", params={"status": "processing"}, timeout=30)
        assert r.status_code == 200
        assert all(o["status"] == "processing" for o in r.json())
        r2 = nayara.get(f"{API}/orders", params={"priority": "high"}, timeout=30)
        assert r2.status_code == 200
        assert all(o["priority"] == "high" for o in r2.json())


# ---------------- CRUD lifecycle ----------------
@pytest.fixture(scope="module")
def temp_customer(nayara):
    r = nayara.post(f"{API}/customers", json={"name": "TEST_QA Customer", "phone": "9000000001", "company": "TEST_Co"}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    c = r.json()
    yield c
    nayara.delete(f"{API}/customers/{c['id']}", timeout=30)


class TestOrderLifecycle:
    def test_create_customer_persists(self, nayara, temp_customer):
        assert temp_customer["name"] == "TEST_QA Customer"
        g = nayara.get(f"{API}/customers/{temp_customer['id']}", timeout=30)
        assert g.status_code == 200
        d = g.json()
        assert d["name"] == "TEST_QA Customer"
        assert d["counts"]["total"] == len(d["orders"])

    def test_full_order_flow(self, nayara, temp_customer):
        payload = {"customer_id": temp_customer["id"], "product": "TEST_Silk Saree", "quantity": 12,
                   "unit": "metres", "priority": "high", "due_date": "2026-08-30T00:00:00+00:00",
                   "assigned_to": "Nandhini", "total_amount": 5000, "paid_amount": 1000}
        r = nayara.post(f"{API}/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        o = r.json()
        oid = o["id"]
        assert o["status"] == "received"
        assert o["balance"] == 4000
        assert o["customer_name"] == temp_customer["name"]
        assert len(o["timeline"]) >= 1

        # GET verify persistence
        g = nayara.get(f"{API}/orders/{oid}", timeout=30).json()
        assert g["product"] == "TEST_Silk Saree" and g["quantity"] == 12

        # status change -> timeline entry
        u = nayara.put(f"{API}/orders/{oid}", json={"status": "processing"}, timeout=30)
        assert u.status_code == 200
        assert u.json()["status"] == "processing"
        tl = nayara.get(f"{API}/orders/{oid}", timeout=30).json()["timeline"]
        assert any("Processing" in t["text"] for t in tl), tl

        # notes
        nayara.put(f"{API}/orders/{oid}", json={"notes": "TEST note"}, timeout=30)
        d = nayara.get(f"{API}/orders/{oid}", timeout=30).json()
        assert d["notes"] == "TEST note"
        assert any("Notes updated" in t["text"] for t in d["timeline"])

        # payment recompute
        p = nayara.put(f"{API}/orders/{oid}", json={"total_amount": 5000, "paid_amount": 5000, "payment_status": "paid"}, timeout=30)
        assert p.json()["balance"] == 0 and p.json()["payment_status"] == "paid"

        # attachment
        a = nayara.post(f"{API}/orders/{oid}/attachments",
                        json={"name": "TEST_swatch.png", "type": "image/png", "size": 100, "data": TINY_PNG}, timeout=30)
        assert a.status_code == 200, a.text[:300]
        atts = a.json()["attachments"]
        assert len(atts) == 1 and atts[0]["name"] == "TEST_swatch.png"
        aid = atts[0]["id"]
        d = nayara.get(f"{API}/orders/{oid}", timeout=30).json()
        assert any("Attachment uploaded" in t["text"] for t in d["timeline"])
        rm = nayara.delete(f"{API}/orders/{oid}/attachments/{aid}", timeout=30)
        assert rm.status_code == 200 and rm.json()["attachments"] == []

        # complete
        c = nayara.put(f"{API}/orders/{oid}", json={"status": "completed"}, timeout=30)
        assert c.json()["status"] == "completed"

        # customer order count reflects
        cust = nayara.get(f"{API}/customers/{temp_customer['id']}", timeout=30).json()
        assert cust["counts"]["total"] >= 1
        assert any(x["id"] == oid for x in cust["orders"])

        # cleanup
        nayara.delete(f"{API}/orders/{oid}", timeout=30)

    def test_create_order_bad_customer(self, nayara):
        r = nayara.post(f"{API}/orders", json={"customer_id": "507f1f77bcf86cd799439011", "product": "x"}, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_get_order_404(self, nayara):
        r = nayara.get(f"{API}/orders/507f1f77bcf86cd799439011", timeout=30)
        assert r.status_code == 404

    def test_unauth_orders(self):
        import requests
        r = requests.get(f"{API}/orders", timeout=30)
        assert r.status_code in (401, 403)


# ---------------- Multi-tenant isolation ----------------
class TestIsolation:
    def test_route39_sees_no_orders(self, admin):
        r = admin.get(f"{API}/orders", timeout=30)
        assert r.status_code == 200
        assert r.json() == []

    def test_route39_sees_no_nayara_customers(self, admin, nayara):
        nay_ids = {c["id"] for c in nayara.get(f"{API}/customers", timeout=30).json()}
        r39 = admin.get(f"{API}/customers", timeout=30)
        assert r39.status_code == 200
        r39_ids = {c["id"] for c in r39.json()}
        assert not (nay_ids & r39_ids)

    def test_nayara_sees_no_vehicles(self, nayara):
        r = nayara.get(f"{API}/vehicles", timeout=30)
        assert r.status_code == 200
        body = r.json()
        items = body.get("items", body) if isinstance(body, dict) else body
        assert items == [], str(body)[:200]

    def test_nayara_dashboard_summary_zero(self, nayara):
        r = nayara.get(f"{API}/dashboard/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        flat = str(d)
        assert d.get("fleet", {}).get("total", 0) in (0, None), flat[:300]

    def test_nayara_cannot_read_route39_order_by_id(self, admin, nayara):
        # Route39 has no orders; instead verify cross-read of a Nayara order id by Route39 admin => 404
        oid = nayara.get(f"{API}/orders", timeout=30).json()[0]["id"]
        r = admin.get(f"{API}/orders/{oid}", timeout=30)
        assert r.status_code == 404

    def test_route39_cannot_update_nayara_order(self, admin, nayara):
        oid = nayara.get(f"{API}/orders", timeout=30).json()[0]["id"]
        r = admin.put(f"{API}/orders/{oid}", json={"status": "completed"}, timeout=30)
        assert r.status_code == 404

    def test_nayara_cannot_read_route39_vehicle(self, admin, nayara):
        vres = admin.get(f"{API}/vehicles", timeout=30).json()
        items = vres.get("items", vres) if isinstance(vres, dict) else vres
        vid = items[0]["id"]
        r = nayara.get(f"{API}/vehicles/{vid}", timeout=30)
        assert r.status_code == 404

    def test_nayara_search_scoped(self, nayara):
        r = nayara.get(f"{API}/search", params={"q": "a"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert not d.get("vehicles"), d

    def test_route39_regression_dashboard(self, admin):
        r = admin.get(f"{API}/dashboard/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["fleet"]["total"] > 200, d["fleet"]
