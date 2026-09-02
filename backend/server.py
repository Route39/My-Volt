from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, Query
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from bson import ObjectId

import auth as authlib
import seed as seedlib

mongo_url = os.environ["MONGO_URL"]
import certifi
client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="MyVolt API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("myvolt")

CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"]


# ---------- helpers ----------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ser(doc):
    """Serialize a mongo doc: _id -> id (str), recursively convert ObjectIds."""
    if doc is None:
        return None
    import json
    from bson import ObjectId as _OID
    def _convert(v):
        if isinstance(v, _OID):
            return str(v)
        if isinstance(v, dict):
            return {k2: _convert(v2) for k2, v2 in v.items()}
        if isinstance(v, list):
            return [_convert(i) for i in v]
        return v
    doc = _convert(dict(doc))
    if "_id" in doc:
        doc["id"] = doc.pop("_id")
    doc.pop("password_hash", None)
    return doc


def oid(id_str):
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")


async def get_user(request: Request):
    return await authlib.current_user_from_request(request, db)


def org_filter(user, extra=None):
    f = {"organization_id": user["organization_id"]}
    # City managers are restricted to their assigned city
    if user.get("role") == "city_manager" and user.get("city"):
        f["city"] = user["city"]
    if extra:
        f.update(extra)
    return f


def require_role(user, allowed):
    if user.get("role") in ("admin", "company_admin"):
        return
    if user.get("role") not in allowed:
        raise HTTPException(status_code=403, detail="You do not have permission for this action")


async def log_audit(user, action, entity_type, entity_id=None, summary=""):
    await db.audit_logs.insert_one({
        "organization_id": user["organization_id"],
        "actor_id": user["id"],
        "actor_name": user.get("name", ""),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "summary": summary,
        "city": user.get("city"),
        "created_at": now_iso(),
    })


async def add_notification(org_id, level, title, message, link=None, city=None):
    await db.notifications.insert_one({
        "organization_id": org_id,
        "level": level,  # red/amber/green/blue
        "title": title,
        "message": message,
        "link": link,
        "city": city,
        "read": False,
        "created_at": now_iso(),
    })


# ---------- auth models ----------
class LoginBody(BaseModel):
    username: str
    password: str


class UserUpdateBody(BaseModel):
    name: str
    phone: str
    email: str = ""
    role: str
    city: Optional[str] = None

class RegisterBody(BaseModel):
    phone: str
    email: str = ""
    password: str = ""
    name: str
    role: str = "staff"
    city: Optional[str] = None


def set_auth_cookies(response: Response, uid, email):
    at = authlib.create_access_token(uid, email)
    rt = authlib.create_refresh_token(uid)
    response.set_cookie("access_token", at, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", rt, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    return at


async def _check_lockout(identifier):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= 5 and rec.get("locked_until"):
        try:
            if datetime.fromisoformat(rec["locked_until"]) > datetime.now(timezone.utc):
                raise HTTPException(status_code=429, detail="Too many failed attempts. Please try again in a few minutes.")
        except HTTPException:
            raise
        except Exception:
            pass


@api.post("/auth/login")
async def login(body: LoginBody, response: Response):
    username = body.username.lower().strip()
    await _check_lockout(username)
    user = await db.users.find_one({"$or": [{"email": username}, {"phone": username}]})
    if not user or not authlib.verify_password(body.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": username},
            {"$inc": {"count": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await db.login_attempts.delete_one({"identifier": username})
    token = set_auth_cookies(response, str(user["_id"]), username)
    out = ser(user)
    out = await attach_org(out)
    out["token"] = token
    return out


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


async def attach_org(user):
    org = await db.organizations.find_one({"org_id": user["organization_id"]})
    user["industry"] = (org or {}).get("industry", "fleet")
    user["org_name"] = (org or {}).get("name", "Route39")
    user["modules"] = (org or {}).get("modules", [])
    user["max_file_mb"] = (org or {}).get("max_file_mb", 10)
    return user


@api.get("/auth/me")
async def me(request: Request):
    user = await get_user(request)
    return await attach_org(user)


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = authlib.decode_token(rt)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    set_auth_cookies(response, str(user["_id"]), user["email"])
    return {"ok": True}


@api.get("/users")
async def list_users(request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    users = await db.users.find({"organization_id": user["organization_id"]}).to_list(500)
    return [ser(u) for u in users]


@api.post("/users")
async def create_user(body: RegisterBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    
    phone = body.phone.strip()
    email = body.email.lower().strip() if body.email else None
    
    if await db.users.find_one({"phone": phone}):
        raise HTTPException(status_code=400, detail="Phone already exists")
        
    pwd = body.password if body.password else "password123"
    
    doc = {
        "phone": phone,
        "password_hash": authlib.hash_password(pwd),
        "name": body.name,
        "role": body.role if body.role in authlib.ROLES else "staff",
        "city": body.city,
        "organization_id": user["organization_id"],
        "created_at": now_iso(),
    }
    if email:
        doc["email"] = email
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    doc["id"] = str(res.inserted_id)
    await log_audit(user, "user_created", "user", str(res.inserted_id), f"User {body.name} created")
    return ser(doc)

@api.put("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdateBody, request: Request):
    from bson.objectid import ObjectId
    user = await get_user(request)
    require_role(user, ["admin"])
    
    try:
        oid = ObjectId(user_id)
    except:
        oid = user_id
        
    update_data = {
        "name": body.name,
        "phone": body.phone.strip(),
        "email": body.email.lower().strip() if body.email else "",
        "role": body.role,
        "city": body.city
    }
    
    # We must check by _id since MyVolt uses default ObjectIds for inserted users
    res = await db.users.update_one(
        {"_id": oid, "organization_id": user["organization_id"]},
        {"$set": update_data}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "User not found")
        
    await log_audit(user, "user_updated", "user", str(oid), f"User {body.name} updated")
    return {"ok": True}

@api.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    from bson.objectid import ObjectId
    user = await get_user(request)
    require_role(user, ["admin"])
    
    try:
        oid = ObjectId(user_id)
    except:
        oid = user_id
        
    if user_id == str(user.get("id")):
        raise HTTPException(400, "Cannot delete yourself")
        
    res = await db.users.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "User not found")
        
    await log_audit(user, "user_deleted", "user", str(oid), f"User {user_id} deleted")
    return {"ok": True}

# ---------- cities ----------
@api.get("/cities")
async def get_cities(request: Request):
    user = await get_user(request)
    return CITIES


# ---------- generic helper ----------
async def _find(collection, user, extra=None, sort=None, limit=1000):
    cur = db[collection].find(org_filter(user, extra))
    if sort:
        cur = cur.sort(sort[0], sort[1])
    docs = await cur.to_list(limit)
    return [ser(d) for d in docs]


# ---------- vehicles ----------
class VehicleBody(BaseModel):
    vehicle_number: str
    registration_number: str
    model: str = "Route39 EV"
    manufacturing_year: Optional[int] = None
    chassis_number: Optional[str] = None
    battery_capacity: Optional[str] = None
    charger: Optional[str] = None
    city: str
    parking: Optional[str] = None
    status: str = "available"
    battery_percent: int = 100
    battery_health: str = "Healthy"
    odometer: int = 0
    image: Optional[str] = None
    next_service_date: Optional[str] = None


@api.get("/vehicles")
async def list_vehicles(request: Request, status: Optional[str] = None, city: Optional[str] = None,
                        q: Optional[str] = None, page: int = 1, page_size: int = 60):
    user = await get_user(request)
    extra = {}
    if status:
        extra["status"] = status
    if city and city != "all":
        extra["city"] = city
    filt = org_filter(user, extra)
    if q:
        filt["$or"] = [
            {"vehicle_number": {"$regex": q, "$options": "i"}},
            {"registration_number": {"$regex": q, "$options": "i"}},
            {"current_driver_name": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
        ]
    total = await db.vehicles.count_documents(filt)
    cur = db.vehicles.find(filt).sort("vehicle_number", 1).skip((page - 1) * page_size).limit(page_size)
    docs = await cur.to_list(page_size)
    return {"items": [ser(d) for d in docs], "total": total, "page": page, "page_size": page_size}


@api.get("/vehicles/{vid}")
async def get_vehicle(vid: str, request: Request):
    user = await get_user(request)
    v = await db.vehicles.find_one(org_filter(user, {"_id": oid(vid)}))
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    out = ser(v)
    out["assignments"] = [ser(a) for a in await db.driver_vehicle_assignments.find({"vehicle_id": vid}).sort("start", -1).to_list(100)]
    out["services"] = [ser(s) for s in await db.vehicle_services.find({"vehicle_id": vid}).sort("start_date", -1).to_list(100)]
    out["documents"] = [ser(x) for x in await db.documents.find({"owner_type": "vehicle", "owner_id": vid}).to_list(100)]
    out["incidents"] = [ser(i) for i in await db.incidents.find({"vehicle_id": vid}).sort("created_at", -1).to_list(100)]
    out["service_requests"] = [ser(x) for x in await db.service_requests.find({"vehicle_id": vid}).sort("created_at", -1).to_list(100)]
    if out.get("current_rental_id"):
        out["current_rental"] = ser(await db.rentals.find_one({"_id": oid(out["current_rental_id"])}))
    return out


@api.post("/vehicles")
async def create_vehicle(body: VehicleBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.vehicles.insert_one(doc)
    await log_audit(user, "vehicle_created", "vehicle", str(res.inserted_id), f"Vehicle {body.vehicle_number} added")
    return ser(await db.vehicles.find_one({"_id": res.inserted_id}))


@api.put("/vehicles/{vid}")
async def update_vehicle(vid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("id", "_id", "assignments", "services", "documents", "incidents", "service_requests", "current_rental"):
        body.pop(k, None)
    await db.vehicles.update_one(org_filter(user, {"_id": oid(vid)}), {"$set": body})
    await log_audit(user, "vehicle_updated", "vehicle", vid, "Vehicle updated")
    return ser(await db.vehicles.find_one({"_id": oid(vid)}))


@api.post("/vehicles/{vid}/transfer")
async def transfer_vehicle(vid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    v = await db.vehicles.find_one(org_filter(user, {"_id": oid(vid)}))
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    to_city = body.get("to_city")
    from_city = v["city"]
    await db.vehicles.update_one({"_id": oid(vid)}, {"$set": {"city": to_city, "parking": body.get("parking")}})
    await db.vehicle_transfers.insert_one({
        "organization_id": user["organization_id"], "vehicle_id": vid, "vehicle_number": v["vehicle_number"],
        "from_city": from_city, "to_city": to_city, "reason": body.get("reason", ""),
        "notes": body.get("notes", ""), "status": "completed", "created_at": now_iso()})
    await db.audit_logs.insert_one({
        "organization_id": user["organization_id"], "actor_id": user["id"], "actor_name": user.get("name"),
        "action": "vehicle_transferred", "entity_type": "vehicle", "entity_id": vid,
        "summary": f"Vehicle {v['vehicle_number']} moved {from_city} to {to_city}",
        "city": to_city, "created_at": now_iso(),
    })
    await add_notification(user["organization_id"], "blue", "Vehicle transferred",
                           f"{v['vehicle_number']} moved to {to_city}", link=f"/fleet/{vid}", city=to_city)
    return ser(await db.vehicles.find_one({"_id": oid(vid)}))


# ---------- drivers ----------
class DriverBody(BaseModel):
    name: str
    phone: str
    address: Optional[str] = None
    emergency_contact: Optional[str] = None
    city: str
    status: str = "active"
    avatar: Optional[str] = None
    license_number: Optional[str] = None


@api.get("/drivers")
async def list_drivers(request: Request, city: Optional[str] = None, status: Optional[str] = None, q: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all":
        extra["city"] = city
    if status:
        extra["status"] = status
    filt = org_filter(user, extra)
    if q:
        filt["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"current_vehicle_number": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.drivers.find(filt).sort("name", 1).to_list(1000)
    return [ser(d) for d in docs]


@api.get("/drivers/{did}")
async def get_driver(did: str, request: Request):
    user = await get_user(request)
    d = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not d:
        raise HTTPException(status_code=404, detail="Driver not found")
    out = ser(d)
    out["assignments"] = [ser(a) for a in await db.driver_vehicle_assignments.find(
        {"driver_id": did}).sort("start", -1).to_list(100)]
    out["rentals"] = [ser(r) for r in await db.rentals.find({"driver_id": did}).sort("created_at", -1).to_list(100)]
    out["incidents"] = [ser(i) for i in await db.incidents.find({"driver_id": did}).sort("created_at", -1).to_list(100)]
    out["documents"] = [ser(x) for x in await db.documents.find({"owner_type": "driver", "owner_id": did}).to_list(100)]
    return out


@api.post("/drivers")
async def create_driver(body: DriverBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.drivers.insert_one(doc)
    await log_audit(user, "driver_created", "driver", str(res.inserted_id), f"Driver {body.name} added")
    return ser(await db.drivers.find_one({"_id": res.inserted_id}))


@api.put("/drivers/{did}")
async def update_driver(did: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("id", "_id", "assignments", "rentals", "incidents", "documents"):
        body.pop(k, None)
    await db.drivers.update_one(org_filter(user, {"_id": oid(did)}), {"$set": body})
    return ser(await db.drivers.find_one({"_id": oid(did)}))



@api.delete("/drivers/{did}")
async def delete_driver(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(did)
    except: oid = did
    res = await db.drivers.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    await log_audit(user, "driver_deleted", "driver", str(oid), f"Driver {did} deleted")
    return {"ok": True}

@api.post("/drivers/{did}/assign-vehicle")
async def assign_vehicle(did: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    vehicle = await db.vehicles.find_one(org_filter(user, {"_id": oid(body["vehicle_id"])}))
    if not driver or not vehicle:
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
    await db.driver_vehicle_assignments.update_many(
        {"driver_id": did, "end": None}, {"$set": {"end": now_iso()}})
    assignment = {
        "organization_id": user["organization_id"],
        "driver_id": did, "driver_name": driver["name"],
        "vehicle_id": body["vehicle_id"], "vehicle_number": vehicle["vehicle_number"],
        "city": vehicle["city"], "start": now_iso(), "end": None,
        "notes": body.get("notes", ""), "created_at": now_iso(),
    }
    await db.driver_vehicle_assignments.insert_one(assignment)
    await db.drivers.update_one({"_id": oid(did)}, {"$set": {
        "current_vehicle_id": body["vehicle_id"], "current_vehicle_number": vehicle["vehicle_number"]}})
    await db.vehicles.update_one({"_id": oid(body["vehicle_id"])}, {"$set": {
        "current_driver_id": did, "current_driver_name": driver["name"]}})
    await log_audit(user, "driver_assigned", "driver", did, f"{driver['name']} assigned to {vehicle['vehicle_number']}")
    return {"ok": True}


# ---------- rental plans ----------
class PlanBody(BaseModel):
    name: str
    amount: float
    duration_days: int
    deposit: float = 0
    grace_period_days: int = 0
    late_fee: float = 0
    cities: List[str] = []
    vehicle_category: Optional[str] = None
    terms: Optional[str] = None
    active: bool = True


@api.get("/rental-plans")
async def list_plans(request: Request):
    user = await get_user(request)
    docs = await db.rental_plans.find({"organization_id": user["organization_id"]}).to_list(200)
    return [ser(d) for d in docs]


@api.post("/rental-plans")
async def create_plan(body: PlanBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.rental_plans.insert_one(doc)
    return ser(await db.rental_plans.find_one({"_id": res.inserted_id}))


@api.put("/rental-plans/{pid}")
async def update_plan(pid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    body.pop("id", None); body.pop("_id", None)
    await db.rental_plans.update_one(org_filter(user, {"_id": oid(pid)}), {"$set": body})
    return ser(await db.rental_plans.find_one({"_id": oid(pid)}))


# ---------- rentals ----------
class RentalBody(BaseModel):
    driver_id: str
    vehicle_id: str
    plan_id: str
    start: str
    end: str
    amount: float
    deposit: float = 0
    notes: Optional[str] = None


def rental_computed_status(r):
    if r.get("status") in ("closed", "suspended", "draft", "pending_payment"):
        return r["status"]
    try:
        end = datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
    except Exception:
        return r.get("status", "active")
    now = datetime.now(timezone.utc)
    if end < now:
        return "expired"
    if end < now + timedelta(hours=36):
        return "expiring_soon"
    return "active"


@api.get("/rentals")
async def list_rentals(request: Request, status: Optional[str] = None, city: Optional[str] = None, q: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all":
        extra["city"] = city
    filt = org_filter(user, extra)
    if q:
        filt["$or"] = [
            {"driver_name": {"$regex": q, "$options": "i"}},
            {"vehicle_number": {"$regex": q, "$options": "i"}},
            {"rental_code": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.rentals.find(filt).sort("created_at", -1).to_list(2000)
    out = []
    for d in docs:
        s = ser(d)
        s["display_status"] = rental_computed_status(s)
        if status and status != "all":
            if status == "expiring":
                if s["display_status"] not in ("expiring_soon", "expired"):
                    continue
            elif status == "pending_payment":
                if not (s.get("payment_status") in ("pending", "partial") and s.get("status") != "closed"):
                    continue
            elif s["display_status"] != status and s.get("status") != status:
                continue
        out.append(s)
    return out


@api.get("/rentals/{rid}")
async def get_rental(rid: str, request: Request):
    user = await get_user(request)
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    out = ser(r)
    out["display_status"] = rental_computed_status(out)
    out["payments"] = [ser(p) for p in await db.rental_payments.find({"rental_id": rid}).sort("payment_date", 1).to_list(200)]
    out["renewals"] = out.get("renewal_history", [])
    return out


async def _next_rental_code(org_id):
    count = await db.rentals.count_documents({"organization_id": org_id})
    return f"RNT-{1000 + count + 1}"


@api.post("/rentals")
async def create_rental(body: RentalBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(body.driver_id)}))
    vehicle = await db.vehicles.find_one(org_filter(user, {"_id": oid(body.vehicle_id)}))
    plan = await db.rental_plans.find_one(org_filter(user, {"_id": oid(body.plan_id)}))
    if not (driver and vehicle and plan):
        raise HTTPException(status_code=404, detail="Driver, vehicle or plan not found")
    code = await _next_rental_code(user["organization_id"])
    doc = {
        "organization_id": user["organization_id"],
        "rental_code": code,
        "driver_id": body.driver_id, "driver_name": driver["name"],
        "vehicle_id": body.vehicle_id, "vehicle_number": vehicle["vehicle_number"],
        "plan_id": body.plan_id, "plan_name": plan["name"],
        "city": vehicle["city"],
        "start": body.start, "end": body.end,
        "amount": body.amount, "deposit": body.deposit,
        "paid": 0.0, "outstanding": body.amount + body.deposit,
        "payment_status": "pending",
        "status": "pending_payment",
        "notes": body.notes or "",
        "renewal_history": [],
        "created_at": now_iso(),
    }
    res = await db.rentals.insert_one(doc)
    await log_audit(user, "rental_created", "rental", str(res.inserted_id), f"Rental {code} created for {driver['name']}")
    out = ser(await db.rentals.find_one({"_id": res.inserted_id}))
    out["display_status"] = rental_computed_status(out)
    return out



@api.put("/rentals/{rid}")
async def update_rental(rid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("id", "_id"): body.pop(k, None)
    try: oid = ObjectId(rid)
    except: oid = rid
    res = await db.rentals.update_one({"_id": oid, "organization_id": user["organization_id"]}, {"$set": body})
    if res.matched_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.delete("/rentals/{rid}")
async def delete_rental(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(rid)
    except: oid = rid
    res = await db.rentals.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.post("/rentals/{rid}/payments")
async def add_payment(rid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    amount = float(body.get("amount", 0))
    payment = {
        "organization_id": user["organization_id"],
        "rental_id": rid, "rental_code": r["rental_code"], "city": r["city"],
        "type": body.get("type", "payment"),
        "amount": amount,
        "method": body.get("method", "cash"),
        "reference": body.get("reference", ""),
        "payment_date": body.get("payment_date", now_iso()),
        "created_at": now_iso(),
    }
    await db.rental_payments.insert_one(payment)
    paid = r.get("paid", 0) + (amount if payment["type"] != "refund" else -amount)
    total_due = r.get("amount", 0) + r.get("deposit", 0)
    outstanding = max(total_due - paid, 0)
    pstatus = "paid" if outstanding <= 0 else ("partial" if paid > 0 else "pending")
    update = {"paid": paid, "outstanding": outstanding, "payment_status": pstatus}
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": update})
    await log_audit(user, "payment_recorded", "rental", rid, f"Rs {amount} recorded for {r['rental_code']}")
    return {"ok": True, **update}


@api.post("/rentals/{rid}/activate")
async def activate_rental(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "active"}})
    await db.vehicles.update_one({"_id": oid(r["vehicle_id"])}, {"$set": {
        "status": "rented", "current_driver_id": r["driver_id"], "current_driver_name": r["driver_name"],
        "current_rental_id": rid, "current_rental_code": r["rental_code"], "rental_end": r["end"]}})
    await db.drivers.update_one({"_id": oid(r["driver_id"])}, {"$set": {
        "current_vehicle_id": r["vehicle_id"], "current_vehicle_number": r["vehicle_number"],
        "rental_status": "active"}})
    await db.driver_vehicle_assignments.update_many({"driver_id": r["driver_id"], "end": None}, {"$set": {"end": now_iso()}})
    await db.driver_vehicle_assignments.insert_one({
        "organization_id": user["organization_id"], "driver_id": r["driver_id"], "driver_name": r["driver_name"],
        "vehicle_id": r["vehicle_id"], "vehicle_number": r["vehicle_number"], "city": r["city"],
        "start": now_iso(), "end": None, "notes": f"Via rental {r['rental_code']}", "created_at": now_iso()})
    await log_audit(user, "rental_activated", "rental", rid, f"Rental {r['rental_code']} activated")
    await add_notification(user["organization_id"], "green", "Rental activated",
                           f"{r['rental_code']} activated for {r['driver_name']}", link=f"/rentals/{rid}", city=r["city"])
    return {"ok": True}


@api.post("/rentals/{rid}/renew")
async def renew_rental(rid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    history = r.get("renewal_history", [])
    history.append({"previous_end": r["end"], "previous_plan": r["plan_name"], "renewed_at": now_iso(),
                    "amount": body.get("amount", r["amount"])})
    update = {"end": body.get("end", r["end"]), "renewal_history": history, "status": "active"}
    if body.get("plan_id"):
        plan = await db.rental_plans.find_one(org_filter(user, {"_id": oid(body["plan_id"])}))
        if plan:
            update["plan_id"] = body["plan_id"]; update["plan_name"] = plan["name"]
    if body.get("amount"):
        update["amount"] = float(body["amount"])
        update["outstanding"] = float(body["amount"]) + r.get("deposit", 0) - r.get("paid", 0)
        update["payment_status"] = "paid" if update["outstanding"] <= 0 else "partial"
    if body.get("vehicle_id") and body["vehicle_id"] != r["vehicle_id"]:
        nv = await db.vehicles.find_one(org_filter(user, {"_id": oid(body["vehicle_id"])}))
        if nv:
            update["vehicle_id"] = body["vehicle_id"]; update["vehicle_number"] = nv["vehicle_number"]
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": update})
    await db.vehicles.update_one({"_id": oid(update.get("vehicle_id", r["vehicle_id"]))}, {"$set": {"rental_end": update["end"]}})
    await log_audit(user, "rental_renewed", "rental", rid, f"Rental {r['rental_code']} renewed")
    await add_notification(user["organization_id"], "green", "Rental renewed",
                           f"{r['rental_code']} renewed for {r['driver_name']}", link=f"/rentals/{rid}", city=r["city"])
    return {"ok": True}


@api.post("/rentals/{rid}/suspend")
async def suspend_rental(rid: str, request: Request, body: dict = None):
    user = await get_user(request)
    body = body or {}
    require_role(user, ["admin", "city_manager"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "suspended", "suspend_reason": body.get("reason", "")}})
    await db.drivers.update_one({"_id": oid(r["driver_id"])}, {"$set": {"rental_status": "suspended"}})
    await log_audit(user, "rental_suspended", "rental", rid, f"Rental {r['rental_code']} suspended")
    return {"ok": True}


@api.post("/rentals/{rid}/close")
async def close_rental(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "closed", "closed_at": now_iso()}})
    await db.vehicles.update_one({"_id": oid(r["vehicle_id"])}, {"$set": {
        "status": "available", "current_driver_id": None, "current_driver_name": None,
        "current_rental_id": None, "current_rental_code": None, "rental_end": None}})
    await db.drivers.update_one({"_id": oid(r["driver_id"])}, {"$set": {"rental_status": "none"}})
    await log_audit(user, "rental_closed", "rental", rid, f"Rental {r['rental_code']} closed")
    return {"ok": True}


# ---------- handovers & returns ----------
@api.get("/handovers")
async def list_handovers(request: Request, vehicle_id: Optional[str] = None, rental_id: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if vehicle_id: extra["vehicle_id"] = vehicle_id
    if rental_id: extra["rental_id"] = rental_id
    return await _find("vehicle_handovers", user, extra, sort=("created_at", -1))


@api.post("/handovers")
async def create_handover(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    body["type"] = "handover"
    res = await db.vehicle_handovers.insert_one(body)
    await log_audit(user, "vehicle_handed_over", "vehicle", body.get("vehicle_id"), "Handover recorded")
    return ser(await db.vehicle_handovers.find_one({"_id": res.inserted_id}))


@api.get("/returns")
async def list_returns(request: Request, vehicle_id: Optional[str] = None, rental_id: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if vehicle_id: extra["vehicle_id"] = vehicle_id
    if rental_id: extra["rental_id"] = rental_id
    return await _find("vehicle_returns", user, extra, sort=("created_at", -1))


@api.post("/returns")
async def create_return(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    body["type"] = "return"
    res = await db.vehicle_returns.insert_one(body)
    await log_audit(user, "vehicle_returned", "vehicle", body.get("vehicle_id"), "Return recorded")
    return ser(await db.vehicle_returns.find_one({"_id": res.inserted_id}))


# ---------- service requests ----------
@api.get("/service-requests")
async def list_srs(request: Request, city: Optional[str] = None, status: Optional[str] = None, priority: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all": extra["city"] = city
    if status: extra["status"] = status
    if priority: extra["priority"] = priority
    return await _find("service_requests", user, extra, sort=("created_at", -1))


@api.get("/service-requests/{sid}")
async def get_sr(sid: str, request: Request):
    user = await get_user(request)
    sr = await db.service_requests.find_one(org_filter(user, {"_id": oid(sid)}))
    if not sr:
        raise HTTPException(status_code=404, detail="Not found")
    out = ser(sr)
    out["service_record"] = ser(await db.vehicle_services.find_one({"service_request_id": sid}))
    return out


@api.post("/service-requests")
async def create_sr(body: dict, request: Request):
    user = await get_user(request)
    count = await db.service_requests.count_documents({"organization_id": user["organization_id"]})
    body["organization_id"] = user["organization_id"]
    body["code"] = f"SR-{2000 + count + 1}"
    body["status"] = body.get("status", "new")
    body["created_at"] = now_iso()
    body.setdefault("timeline", [{"stage": "new", "at": now_iso(), "by": user.get("name")}])
    res = await db.service_requests.insert_one(body)
    await log_audit(user, "service_request_created", "service_request", str(res.inserted_id),
                    f"Service request {body['code']} created")
    lvl = "red" if body.get("priority") == "critical" else "amber"
    await add_notification(user["organization_id"], lvl, "Service request created",
                           f"{body['code']} - {body.get('issue_type','')} - {body.get('vehicle_number','')}",
                           link="/service-requests", city=body.get("city"))
    return ser(await db.service_requests.find_one({"_id": res.inserted_id}))


@api.put("/service-requests/{sid}")
async def update_sr(sid: str, body: dict, request: Request):
    user = await get_user(request)
    body.pop("id", None); body.pop("_id", None); body.pop("service_record", None)
    sr = await db.service_requests.find_one(org_filter(user, {"_id": oid(sid)}))
    if not sr:
        raise HTTPException(status_code=404, detail="Not found")
    if body.get("status") and body["status"] != sr.get("status"):
        timeline = sr.get("timeline", [])
        timeline.append({"stage": body["status"], "at": now_iso(), "by": user.get("name")})
        body["timeline"] = timeline
        if body["status"] in ("inspection", "repair", "assigned"):
            await db.vehicles.update_one({"_id": oid(sr["vehicle_id"])}, {"$set": {"status": "service"}})
        elif body["status"] == "closed":
            await db.vehicles.update_one({"_id": oid(sr["vehicle_id"])}, {"$set": {"status": "available"}})
        await log_audit(user, "service_request_updated", "service_request", sid, f"{sr['code']} to {body['status']}")
    await db.service_requests.update_one({"_id": oid(sid)}, {"$set": body})
    return ser(await db.service_requests.find_one({"_id": oid(sid)}))


# ---------- vehicle services ----------

@api.delete("/service-requests/{sid}")
async def delete_service_request(sid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(sid)
    except: oid = sid
    res = await db.service_requests.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.get("/vehicle-services")
async def list_services(request: Request, vehicle_id: Optional[str] = None, city: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if vehicle_id: extra["vehicle_id"] = vehicle_id
    if city and city != "all": extra["city"] = city
    return await _find("vehicle_services", user, extra, sort=("start_date", -1))


@api.post("/vehicle-services")
async def create_service(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    res = await db.vehicle_services.insert_one(body)
    await log_audit(user, "service_completed", "vehicle_service", str(res.inserted_id),
                    f"Service recorded for {body.get('vehicle_number','')}")
    if body.get("service_request_id"):
        await db.service_requests.update_one({"_id": oid(body["service_request_id"])}, {"$set": {"status": "closed"}})
    if body.get("completion_date"):
        upd = {"status": "available"}
        if body.get("next_service_date"):
            upd["next_service_date"] = body["next_service_date"]
        await db.vehicles.update_one({"_id": oid(body["vehicle_id"])}, {"$set": upd})
        await add_notification(user["organization_id"], "green", "Service completed",
                               f"{body.get('vehicle_number','')} - {body.get('issue','service')}",
                               link=f"/fleet/{body['vehicle_id']}", city=body.get("city"))
    return ser(await db.vehicle_services.find_one({"_id": res.inserted_id}))


# ---------- locations ----------

@api.put("/vehicle-services/{vsid}")
async def update_vehicle_service(vsid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("id", "_id"): body.pop(k, None)
    try: oid = ObjectId(vsid)
    except: oid = vsid
    res = await db.vehicle_services.update_one({"_id": oid, "organization_id": user["organization_id"]}, {"$set": body})
    if res.matched_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.delete("/vehicle-services/{vsid}")
async def delete_vehicle_service(vsid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(vsid)
    except: oid = vsid
    res = await db.vehicle_services.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.get("/locations")
async def list_locations(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all": extra["city"] = city
    locs = await _find("locations", user, extra)
    for l in locs:
        l["current_vehicles"] = await db.vehicles.count_documents(
            {"organization_id": user["organization_id"], "parking": l["name"]})
    return locs


@api.post("/locations")
async def create_location(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    res = await db.locations.insert_one(body)
    return ser(await db.locations.find_one({"_id": res.inserted_id}))


# ---------- documents ----------
def doc_status(expiry):
    if not expiry:
        return "valid"
    try:
        e = datetime.fromisoformat(expiry.replace("Z", "+00:00")) if "T" in expiry else datetime.fromisoformat(expiry + "T00:00:00+00:00")
    except Exception:
        return "valid"
    now = datetime.now(timezone.utc)
    if e < now:
        return "expired"
    if e < now + timedelta(days=30):
        return "expiring_soon"
    return "valid"



@api.put("/locations/{lid}")
async def update_location(lid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("id", "_id"): body.pop(k, None)
    try: oid = ObjectId(lid)
    except: oid = lid
    res = await db.locations.update_one({"_id": oid, "organization_id": user["organization_id"]}, {"$set": body})
    if res.matched_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.delete("/locations/{lid}")
async def delete_location(lid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(lid)
    except: oid = lid
    res = await db.locations.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.get("/documents")
async def list_documents(request: Request, owner_type: Optional[str] = None, owner_id: Optional[str] = None,
                         city: Optional[str] = None, status: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if owner_type: extra["owner_type"] = owner_type
    if owner_id: extra["owner_id"] = owner_id
    if city and city != "all": extra["city"] = city
    docs = await _find("documents", user, extra)
    for d in docs:
        d["doc_status"] = doc_status(d.get("expiry_date"))
    if status:
        docs = [d for d in docs if d["doc_status"] == status]
    return docs


@api.post("/documents")
async def create_document(body: dict, request: Request):
    user = await get_user(request)
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    res = await db.documents.insert_one(body)
    await log_audit(user, "document_updated", "document", str(res.inserted_id),
                    f"{body.get('doc_type','Document')} added")
    return ser(await db.documents.find_one({"_id": res.inserted_id}))


# ---------- incidents ----------

@api.put("/documents/{did}")
async def update_document(did: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("id", "_id"): body.pop(k, None)
    try: oid = ObjectId(did)
    except: oid = did
    res = await db.documents.update_one({"_id": oid, "organization_id": user["organization_id"]}, {"$set": body})
    if res.matched_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.delete("/documents/{did}")
async def delete_document(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(did)
    except: oid = did
    res = await db.documents.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.get("/incidents")
async def list_incidents(request: Request, city: Optional[str] = None, status: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all": extra["city"] = city
    if status: extra["status"] = status
    return await _find("incidents", user, extra, sort=("created_at", -1))


@api.post("/incidents")
async def create_incident(body: dict, request: Request):
    user = await get_user(request)
    count = await db.incidents.count_documents({"organization_id": user["organization_id"]})
    body["organization_id"] = user["organization_id"]
    body["code"] = f"INC-{3000 + count + 1}"
    body["status"] = body.get("status", "reported")
    body["created_at"] = now_iso()
    res = await db.incidents.insert_one(body)
    await log_audit(user, "incident_reported", "incident", str(res.inserted_id), f"Incident {body['code']} reported")
    await add_notification(user["organization_id"], "red", "Incident reported",
                           f"{body['code']} - {body.get('incident_type','')}", link="/incidents", city=body.get("city"))
    return ser(await db.incidents.find_one({"_id": res.inserted_id}))


@api.put("/incidents/{iid}")
async def update_incident(iid: str, body: dict, request: Request):
    user = await get_user(request)
    body.pop("id", None); body.pop("_id", None)
    await db.incidents.update_one(org_filter(user, {"_id": oid(iid)}), {"$set": body})
    return ser(await db.incidents.find_one({"_id": oid(iid)}))


# ---------- notifications ----------

@api.delete("/incidents/{iid}")
async def delete_incident(iid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    try: oid = ObjectId(iid)
    except: oid = iid
    res = await db.incidents.delete_one({"_id": oid, "organization_id": user["organization_id"]})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"ok": True}

@api.get("/notifications")
async def list_notifications(request: Request):
    user = await get_user(request)
    f = {"organization_id": user["organization_id"]}
    if user.get("role") == "city_manager" and user.get("city"):
        f["$or"] = [{"city": user["city"]}, {"city": None}]
    docs = await db.notifications.find(f).sort("created_at", -1).to_list(50)
    return [ser(d) for d in docs]


@api.post("/notifications/read-all")
async def read_all(request: Request):
    user = await get_user(request)
    await db.notifications.update_many({"organization_id": user["organization_id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ---------- audit logs ----------
@api.get("/audit-logs")
async def list_audit(request: Request, limit: int = 30):
    user = await get_user(request)
    docs = await db.audit_logs.find(org_filter(user)).sort("created_at", -1).to_list(limit)
    return [ser(d) for d in docs]


# ---------- global search ----------
@api.get("/search")
async def global_search(request: Request, q: str = Query(...)):
    user = await get_user(request)
    if not q:
        return {"vehicles": [], "drivers": [], "rentals": [], "service_requests": []}
    rx = {"$regex": q, "$options": "i"}
    base = org_filter(user)
    vehicles = await db.vehicles.find({**base, "$or": [{"vehicle_number": rx}, {"registration_number": rx}]}).limit(6).to_list(6)
    drivers = await db.drivers.find({**base, "$or": [{"name": rx}, {"phone": rx}]}).limit(6).to_list(6)
    rentals = await db.rentals.find({**base, "$or": [{"rental_code": rx}, {"driver_name": rx}]}).limit(6).to_list(6)
    srs = await db.service_requests.find({**base, "$or": [{"code": rx}, {"vehicle_number": rx}]}).limit(6).to_list(6)
    return {
        "vehicles": [ser(v) for v in vehicles],
        "drivers": [ser(d) for d in drivers],
        "rentals": [ser(r) for r in rentals],
        "service_requests": [ser(s) for s in srs],
    }


# ---------- dashboard ----------
@api.get("/dashboard/summary")
async def dashboard_summary(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    base = org_filter(user)
    if city and city != "all":
        base = {**base, "city": city}

    async def count_v(status=None):
        f = dict(base)
        if status:
            f["status"] = status
        return await db.vehicles.count_documents(f)

    total = await count_v()
    fleet = {
        "total": total,
        "rented": await count_v("rented"),
        "available": await count_v("available"),
        "service": await count_v("service"),
        "inactive": await count_v("inactive"),
        "idle": await count_v("idle"),
        "accident": await count_v("accident"),
    }

    city_list = [user["city"]] if user.get("role") == "city_manager" and user.get("city") else CITIES
    cities = []
    for c in city_list:
        cf = {**org_filter(user), "city": c}
        cities.append({
            "city": c,
            "total": await db.vehicles.count_documents(cf),
            "rented": await db.vehicles.count_documents({**cf, "status": "rented"}),
            "available": await db.vehicles.count_documents({**cf, "status": "available"}),
            "service": await db.vehicles.count_documents({**cf, "status": "service"}),
        })

    all_rentals = await db.rentals.find(base).to_list(5000)
    active = expiring_today = expiring_soon = payment_pending = suspended = 0
    now = datetime.now(timezone.utc)
    for r in all_rentals:
        st = rental_computed_status(r)
        if r.get("status") == "suspended":
            suspended += 1
            continue
        if r.get("payment_status") in ("pending", "partial") and r.get("status") not in ("closed",):
            payment_pending += 1
        if st == "active":
            active += 1
        elif st in ("expiring_soon", "expired"):
            try:
                end = datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
                if end.date() == now.date():
                    expiring_today += 1
                else:
                    expiring_soon += 1
            except Exception:
                expiring_soon += 1
            if st != "expired":
                active += 1
    rentals = {
        "active": active, "expiring_today": expiring_today, "expiring_soon": expiring_soon,
        "payment_pending": payment_pending, "suspended": suspended,
    }

    attention = []
    crit = await db.service_requests.count_documents({**base, "priority": "critical", "status": {"$ne": "closed"}})
    if crit:
        attention.append({"level": "red", "label": f"{crit} critical service request(s)", "link": "/service-requests?priority=critical"})
    if expiring_today:
        attention.append({"level": "amber", "label": f"{expiring_today} rental(s) expiring today", "link": "/rentals?status=expiring"})
    if payment_pending:
        attention.append({"level": "amber", "label": f"{payment_pending} pending rental payment(s)", "link": "/rentals?status=pending_payment"})
    all_docs = await db.documents.find(base).to_list(5000)
    exp_driver = exp_vehicle = 0
    for d in all_docs:
        if doc_status(d.get("expiry_date")) == "expired":
            if d.get("owner_type") == "driver":
                exp_driver += 1
            else:
                exp_vehicle += 1
    if exp_driver:
        attention.append({"level": "red", "label": f"{exp_driver} expired driver document(s)", "link": "/documents?status=expired"})
    if exp_vehicle:
        attention.append({"level": "red", "label": f"{exp_vehicle} expired vehicle document(s)", "link": "/documents?status=expired"})
    waiting = await db.service_requests.count_documents({**base, "status": "new"})
    if waiting:
        attention.append({"level": "amber", "label": f"{waiting} vehicle(s) waiting for service assignment", "link": "/service-requests"})

    return {"fleet": fleet, "cities": cities, "rentals": rentals, "attention": attention, "cities_list": CITIES}


@api.get("/dashboard/recent")
async def dashboard_recent(request: Request, limit: int = 12):
    user = await get_user(request)
    docs = await db.audit_logs.find(org_filter(user)).sort("created_at", -1).to_list(limit)
    return [ser(d) for d in docs]


# ---------- reports ----------
@api.get("/reports")
async def reports(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    base = org_filter(user)
    if city and city != "all":
        base = {**base, "city": city}
    total = await db.vehicles.count_documents(base)
    services = await db.vehicle_services.find(base).to_list(5000)
    total_cost = sum(float(s.get("cost", 0) or 0) for s in services)
    payments = await db.rental_payments.find(base).to_list(10000)
    collected = sum(float(p.get("amount", 0)) for p in payments if p.get("type") != "refund")
    rentals = await db.rentals.find(base).to_list(5000)
    outstanding = sum(float(r.get("outstanding", 0)) for r in rentals if r.get("status") != "closed")
    docs = await db.documents.find(base).to_list(5000)
    expiring = sum(1 for d in docs if doc_status(d.get("expiry_date")) == "expiring_soon")
    expired = sum(1 for d in docs if doc_status(d.get("expiry_date")) == "expired")
    by_city = []
    for c in CITIES:
        cf = {**org_filter(user), "city": c}
        by_city.append({
            "city": c,
            "total": await db.vehicles.count_documents(cf),
            "rented": await db.vehicles.count_documents({**cf, "status": "rented"}),
            "available": await db.vehicles.count_documents({**cf, "status": "available"}),
            "service": await db.vehicles.count_documents({**cf, "status": "service"}),
        })
    return {
        "fleet": {"total": total, "by_city": by_city},
        "rentals": {"active": sum(1 for r in rentals if rental_computed_status(r) == "active"),
                    "total": len(rentals), "collected": collected, "outstanding": outstanding},
        "service": {"records": len(services), "total_cost": total_cost,
                    "open_requests": await db.service_requests.count_documents({**base, "status": {"$ne": "closed"}})},
        "compliance": {"expiring": expiring, "expired": expired},
        "drivers": {"total": await db.drivers.count_documents(base),
                    "active": await db.drivers.count_documents({**base, "status": "active"})},
    }


# ======================= NAYARA STUDIO — ORDER MANAGEMENT =======================
ORDER_STAGES = ["received", "processing", "on_hold", "completed"]


def order_due_status(o):
    if o.get("status") == "completed":
        return "completed"
    dd = o.get("due_date")
    if not dd:
        return "on_track"
    try:
        d = datetime.fromisoformat(dd.replace("Z", "+00:00")) if "T" in dd else datetime.fromisoformat(dd + "T23:59:59+00:00")
    except Exception:
        return "on_track"
    now = datetime.now(timezone.utc)
    if d < now:
        return "overdue"
    if d < now + timedelta(days=3):
        return "due_soon"
    return "on_track"


class CustomerBody(BaseModel):
    name: str
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


@api.get("/customers")
async def list_customers(request: Request, q: Optional[str] = None):
    user = await get_user(request)
    filt = {"organization_id": user["organization_id"]}
    if q:
        filt["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"phone": {"$regex": q, "$options": "i"}},
                       {"company": {"$regex": q, "$options": "i"}}]
    docs = await db.customers.find(filt).sort("name", 1).to_list(1000)
    out = []
    for c in docs:
        s = ser(c)
        s["order_count"] = await db.orders.count_documents({"organization_id": user["organization_id"], "customer_id": s["id"]})
        out.append(s)
    return out


@api.get("/customers/{cid}")
async def get_customer(cid: str, request: Request):
    user = await get_user(request)
    c = await db.customers.find_one(org_filter(user, {"_id": oid(cid)}))
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    out = ser(c)
    orders = await db.orders.find({"organization_id": user["organization_id"], "customer_id": cid}).sort("created_at", -1).to_list(500)
    out["orders"] = [ser(o) for o in orders]
    counts = {"total": len(out["orders"])}
    for st in ORDER_STAGES:
        counts[st] = sum(1 for o in out["orders"] if o.get("status") == st)
    out["counts"] = counts
    return out


@api.post("/customers")
async def create_customer(body: CustomerBody, request: Request):
    user = await get_user(request)
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.customers.insert_one(doc)
    await log_audit(user, "customer_created", "customer", str(res.inserted_id), f"Customer {body.name} added")
    return ser(await db.customers.find_one({"_id": res.inserted_id}))


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: dict, request: Request):
    user = await get_user(request)
    for k in ("id", "_id", "orders", "counts", "order_count"):
        body.pop(k, None)
    await db.customers.update_one(org_filter(user, {"_id": oid(cid)}), {"$set": body})
    return ser(await db.customers.find_one({"_id": oid(cid)}))


class OrderBody(BaseModel):
    order_number: Optional[str] = None
    customer_id: str
    order_date: Optional[str] = None
    due_date: Optional[str] = None
    product: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = "metres"
    priority: str = "medium"
    assigned_to: Optional[str] = None
    payment_status: str = "pending"
    total_amount: float = 0
    paid_amount: float = 0
    notes: Optional[str] = None


def _order_ser(o):
    s = ser(o)
    s["due_status"] = order_due_status(s)
    return s


@api.get("/orders")
async def list_orders(request: Request, status: Optional[str] = None, priority: Optional[str] = None,
                      assigned_to: Optional[str] = None, payment_status: Optional[str] = None,
                      due: Optional[str] = None, scope: Optional[str] = None, q: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if status and status != "all": extra["status"] = status
    if priority: extra["priority"] = priority
    if assigned_to: extra["assigned_to"] = assigned_to
    if payment_status: extra["payment_status"] = payment_status
    filt = org_filter(user, extra)
    if scope == "active":
        filt["status"] = {"$ne": "completed"}
    elif scope == "completed":
        filt["status"] = "completed"
    if q:
        filt["$or"] = [{"order_number": {"$regex": q, "$options": "i"}}, {"customer_name": {"$regex": q, "$options": "i"}},
                       {"product": {"$regex": q, "$options": "i"}}, {"customer_phone": {"$regex": q, "$options": "i"}}]
    docs = await db.orders.find(filt).sort("created_at", -1).to_list(2000)
    out = [_order_ser(o) for o in docs]
    if due:
        out = [o for o in out if o["due_status"] == due]
    return out


@api.get("/orders/{oid_}")
async def get_order(oid_: str, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return _order_ser(o)


async def _order_timeline(user, oid_, text):
    await db.orders.update_one({"_id": oid(oid_)}, {"$push": {"timeline": {"at": now_iso(), "by": user.get("name"), "text": text}}})


@api.post("/orders")
async def create_order(body: OrderBody, request: Request):
    user = await get_user(request)
    cust = await db.customers.find_one(org_filter(user, {"_id": oid(body.customer_id)}))
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    count = await db.orders.count_documents({"organization_id": user["organization_id"]})
    code = body.order_number or f"ORD-{1000 + count + 1}"
    total = float(body.total_amount or 0); paid = float(body.paid_amount or 0)
    doc = body.model_dump()
    doc.update({
        "organization_id": user["organization_id"], "order_number": code,
        "customer_name": cust["name"], "customer_phone": cust.get("phone", ""),
        "status": "received", "total_amount": total, "paid_amount": paid,
        "balance": max(total - paid, 0),
        "attachments": [], "created_at": now_iso(),
        "order_date": body.order_date or now_iso(),
        "timeline": [{"at": now_iso(), "by": user.get("name"), "text": "Order created"}],
    })
    if body.assigned_to:
        doc["timeline"].append({"at": now_iso(), "by": user.get("name"), "text": f"Assigned to {body.assigned_to}"})
    res = await db.orders.insert_one(doc)
    await log_audit(user, "order_created", "order", str(res.inserted_id), f"Order {code} created for {cust['name']}")
    await add_notification(user["organization_id"], "blue", "New order received", f"{code} · {cust['name']} · {body.product or ''}", link="/orders")
    return _order_ser(await db.orders.find_one({"_id": res.inserted_id}))


@api.put("/orders/{oid_}")
async def update_order(oid_: str, body: dict, request: Request):
    user = await get_user(request)
    for k in ("id", "_id", "due_status", "customer_name", "customer_phone", "timeline", "attachments", "order_number"):
        body.pop(k, None)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    events = []
    if body.get("status") and body["status"] != o.get("status"):
        events.append("Order completed" if body["status"] == "completed" else f"Moved to {body['status'].replace('_', ' ').title()}")
    if body.get("assigned_to") and body["assigned_to"] != o.get("assigned_to"):
        events.append(f"Assigned to {body['assigned_to']}")
    if body.get("due_date") and body["due_date"] != o.get("due_date"):
        events.append("Due date changed")
    if "notes" in body and body.get("notes") != o.get("notes"):
        events.append("Notes updated")
    if "total_amount" in body or "paid_amount" in body:
        total = float(body.get("total_amount", o.get("total_amount", 0)) or 0)
        paid = float(body.get("paid_amount", o.get("paid_amount", 0)) or 0)
        body["balance"] = max(total - paid, 0)
        body["total_amount"] = total; body["paid_amount"] = paid
    await db.orders.update_one({"_id": oid(oid_)}, {"$set": body})
    for e in events:
        await _order_timeline(user, oid_, e)
    if body.get("status") and body["status"] != o.get("status"):
        await log_audit(user, "order_status_changed", "order", oid_, f"{o['order_number']} → {body['status']}")
        if body["status"] == "completed":
            await add_notification(user["organization_id"], "green", "Order completed", f"{o['order_number']} · {o.get('customer_name','')}", link="/orders")
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.post("/orders/{oid_}/attachments")
async def add_attachment(oid_: str, body: dict, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    max_mb = 10
    org = await db.organizations.find_one({"org_id": user["organization_id"]})
    if org:
        max_mb = org.get("max_file_mb", 10)
    data = body.get("data", "")
    if len(data) > max_mb * 1.4 * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {max_mb} MB limit")
    att = {"id": str(ObjectId()), "name": body.get("name", "file"), "type": body.get("type", ""),
           "size": body.get("size", 0), "data": data, "uploaded_at": now_iso(), "uploaded_by": user.get("name")}
    await db.orders.update_one({"_id": oid(oid_)}, {"$push": {"attachments": att}})
    await _order_timeline(user, oid_, f"Attachment uploaded: {att['name']}")
    await log_audit(user, "attachment_uploaded", "order", oid_, f"Attachment added to {o['order_number']}")
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.delete("/orders/{oid_}/attachments/{aid}")
async def delete_attachment(oid_: str, aid: str, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    await db.orders.update_one({"_id": oid(oid_)}, {"$pull": {"attachments": {"id": aid}}})
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.get("/order-dashboard")
async def order_dashboard(request: Request):
    user = await get_user(request)
    base = {"organization_id": user["organization_id"]}
    orders = await db.orders.find(base).to_list(5000)
    kpis = {"total": len(orders)}
    for st in ORDER_STAGES:
        kpis[st] = sum(1 for o in orders if o.get("status") == st)
    kpis["overdue"] = sum(1 for o in orders if order_due_status(o) == "overdue")
    today = datetime.now(timezone.utc).date()
    todays = []
    due_soon = []
    recent_completed = []
    attention = []
    for o in orders:
        s = _order_ser(o)
        try:
            od = datetime.fromisoformat((o.get("order_date") or o.get("created_at")).replace("Z", "+00:00")).date()
            if od == today:
                todays.append(s)
        except Exception:
            pass
        if s["due_status"] == "due_soon":
            due_soon.append(s)
        if s["due_status"] == "overdue":
            attention.append({"level": "red", "label": f"{o['order_number']} overdue · {o.get('customer_name','')}", "link": "/orders"})
        if o.get("status") == "completed":
            recent_completed.append(s)
    recent_completed.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    for o in orders:
        if o.get("status") == "on_hold":
            attention.append({"level": "amber", "label": f"{o['order_number']} on hold · {o.get('customer_name','')}", "link": "/orders"})
    return {
        "kpis": kpis,
        "pipeline": {"received": kpis["received"], "processing": kpis["processing"], "completed": kpis["completed"]},
        "todays": todays[:8], "due_soon": sorted(due_soon, key=lambda x: x.get("due_date", ""))[:8],
        "recent_completed": recent_completed[:8], "attention": attention[:8],
    }


@api.get("/order-reports")
async def order_reports(request: Request):
    user = await get_user(request)
    orders = await db.orders.find({"organization_id": user["organization_id"]}).to_list(5000)
    by_status = {st: sum(1 for o in orders if o.get("status") == st) for st in ORDER_STAGES}
    overdue = sum(1 for o in orders if order_due_status(o) == "overdue")
    by_assignee = {}
    by_customer = {}
    by_month = {}
    for o in orders:
        by_assignee[o.get("assigned_to") or "Unassigned"] = by_assignee.get(o.get("assigned_to") or "Unassigned", 0) + 1
        by_customer[o.get("customer_name") or "—"] = by_customer.get(o.get("customer_name") or "—", 0) + 1
        try:
            m = datetime.fromisoformat((o.get("order_date") or o.get("created_at")).replace("Z", "+00:00")).strftime("%b %Y")
            by_month[m] = by_month.get(m, 0) + 1
        except Exception:
            pass
    top = lambda d: [{"name": k, "count": v} for k, v in sorted(d.items(), key=lambda x: x[1], reverse=True)[:8]]
    return {"total": len(orders), "by_status": by_status, "overdue": overdue,
            "by_assignee": top(by_assignee), "by_customer": top(by_customer),
            "by_month": [{"name": k, "count": v} for k, v in by_month.items()]}


@api.get("/order-search")
async def order_search(request: Request, q: str = Query(...)):
    user = await get_user(request)
    if not q:
        return {"orders": [], "customers": []}
    rx = {"$regex": q, "$options": "i"}
    base = {"organization_id": user["organization_id"]}
    orders = await db.orders.find({**base, "$or": [{"order_number": rx}, {"customer_name": rx}, {"product": rx}]}).limit(6).to_list(6)
    customers = await db.customers.find({**base, "$or": [{"name": rx}, {"phone": rx}, {"company": rx}]}).limit(6).to_list(6)
    return {"orders": [ser(o) for o in orders], "customers": [ser(c) for c in customers]}


# ================= PLATFORM ADMIN =================
INDUSTRY_LABELS = {"fleet": "Fleet & Rental", "fabric_order_management": "Fabric Order Management"}
DEFAULT_MODULES = {
    "fleet": ["dashboard", "fleet", "drivers", "rentals", "service", "locations", "documents", "incidents", "health", "reports", "settings"],
    "fabric_order_management": ["dashboard", "orders", "customers", "reports", "settings"],
}


def require_platform(user):
    if user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="Platform administrators only")


async def _company_row(o):
    uc = await db.users.count_documents({"organization_id": o["org_id"]})
    return {"org_id": o["org_id"], "name": o.get("name"), "industry": o.get("industry"),
            "industry_label": INDUSTRY_LABELS.get(o.get("industry"), o.get("industry")),
            "plan": o.get("plan", "Trial"), "status": o.get("status", "trial"), "users": uc,
            "created_at": o.get("created_at"), "modules": o.get("modules", []),
            "contact_name": o.get("contact_name"), "email": o.get("email"), "phone": o.get("phone"),
            "code": o.get("code"), "logo": o.get("logo")}


@api.get("/platform/summary")
async def platform_summary(request: Request):
    user = await get_user(request); require_platform(user)
    orgs = await db.organizations.find({"industry": {"$ne": "platform"}}).to_list(500)
    ids = [o["org_id"] for o in orgs]
    return {"total_companies": len(orgs),
            "active_companies": sum(1 for o in orgs if o.get("status") == "active"),
            "trial_companies": sum(1 for o in orgs if o.get("status") == "trial"),
            "total_users": await db.users.count_documents({"organization_id": {"$in": ids}}),
            "active_subscriptions": sum(1 for o in orgs if o.get("status") == "active")}


@api.get("/platform/companies")
async def platform_companies(request: Request, q: Optional[str] = None, industry: Optional[str] = None, status: Optional[str] = None):
    user = await get_user(request); require_platform(user)
    filt = {"industry": {"$ne": "platform"}}
    if industry and industry != "all": filt["industry"] = industry
    if status and status != "all": filt["status"] = status
    orgs = await db.organizations.find(filt).sort("created_at", 1).to_list(500)
    rows = [await _company_row(o) for o in orgs]
    if q:
        rows = [r for r in rows if q.lower() in (r["name"] or "").lower() or q.lower() in (r.get("code") or "").lower()]
    return rows


@api.get("/platform/companies/{org_id}")
async def platform_company(org_id: str, request: Request):
    user = await get_user(request); require_platform(user)
    o = await db.organizations.find_one({"org_id": org_id})
    if not o:
        raise HTTPException(status_code=404, detail="Company not found")
    row = await _company_row(o)
    last = await db.audit_logs.find({"organization_id": org_id}).sort("created_at", -1).limit(1).to_list(1)
    row["last_activity"] = last[0]["created_at"] if last else None
    return row


@api.post("/platform/companies")
async def platform_add_company(body: dict, request: Request):
    user = await get_user(request); require_platform(user)
    industry = body.get("industry", "fleet")
    raw_code = (body.get("code") or body.get("name", "")).strip().lower()
    code = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", raw_code)).strip("-")
    if not body.get("name") or not code:
        raise HTTPException(status_code=400, detail="Company name and code are required")
    if await db.organizations.find_one({"org_id": code}):
        raise HTTPException(status_code=400, detail="Company code already exists")
    admin = body.get("admin") or {}
    admin_email = (admin.get("email") or "").lower().strip()
    if admin_email and await db.users.find_one({"email": admin_email}):
        raise HTTPException(status_code=400, detail="Admin email already exists")
    doc = {"org_id": code, "name": body.get("name"), "industry": industry,
           "modules": DEFAULT_MODULES.get(industry, []), "max_file_mb": 10,
           "plan": body.get("plan", "Trial"), "status": body.get("status", "trial"),
           "contact_name": admin.get("name") or body.get("contact_name"), "email": admin_email or body.get("email"),
           "phone": admin.get("phone") or body.get("phone"), "code": code, "logo": body.get("logo"), "created_at": now_iso()}
    await db.organizations.insert_one(doc)
    admin_out = None
    if admin_email and admin.get("password"):
        udoc = {"email": admin_email, "password_hash": authlib.hash_password(admin["password"]),
                "name": admin.get("name") or "Company Admin", "role": "company_admin",
                "phone": admin.get("phone"), "city": None, "organization_id": code, "created_at": now_iso()}
        await db.users.insert_one(udoc)
        admin_out = {"name": udoc["name"], "email": admin_email}
    row = await _company_row(doc)
    return {"company": row, "admin": admin_out}



app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.vehicles.create_index([("organization_id", 1), ("status", 1), ("city", 1)])
    await db.vehicles.create_index("registration_number")
    await db.drivers.create_index([("organization_id", 1), ("city", 1)])
    await db.drivers.create_index("phone")
    await db.rentals.create_index([("organization_id", 1), ("status", 1)])
    await db.service_requests.create_index([("organization_id", 1), ("status", 1)])
    await db.audit_logs.create_index([("organization_id", 1), ("created_at", -1)])
    await db.orders.create_index([("organization_id", 1), ("status", 1)])
    await db.customers.create_index([("organization_id", 1)])
    # await seedlib.seed(db, authlib)  # disabled - do not reseed


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, request: Request):
    user = request.state.user
    if user["role"] not in ["admin", "operations_manager"]: raise HTTPException(403)
    c = await db.customers.find_one(org_filter(user, {"_id": oid(cid)}))
    if not c: raise HTTPException(404)
    await db.customers.delete_one({"_id": oid(cid)})
    await log_audit(user, "customer_deleted", "customer", cid, f"Deleted customer {c.get('name')}")
    return {"ok": True}

@api.delete("/orders/{oid_}")
async def delete_order(oid_: str, request: Request):
    user = request.state.user
    if user["role"] not in ["admin", "operations_manager"]: raise HTTPException(403)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o: raise HTTPException(404)
    await db.orders.delete_one({"_id": oid(oid_)})
    await log_audit(user, "order_deleted", "order", oid_, f"Deleted order {o.get('order_number')}")
    return {"ok": True}



# ==============================================================================
# Tasks API (Kanban)
# ==============================================================================

class TaskBody(BaseModel):
    title: str
    description: str = ""
    assignee: str = ""
    assignee_id: str = ""
    assignee_name: str = ""
    priority: str = "medium"
    status: str = "todo"
    due_date: str = ""
    checklist: list = []
    comments: list = []

@api.get("/tasks")
async def get_tasks(request: Request):
    user = await get_user(request)
    q = {"organization_id": user["organization_id"]}
    if user["role"] == "city_manager":
        q["assignee_id"] = user.get("id") or str(user.get("_id", ""))
    tasks = await db.tasks.find(q).sort("created_at", -1).to_list(1000)
    return [ser(t) for t in tasks]

@api.post("/tasks")
async def create_task(body: TaskBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    
    import uuid
    mapped = []
    for c in doc.get("checklist", []):
        if isinstance(c, str):
            mapped.append({"id": str(uuid.uuid4()), "text": c, "done": False})
        else:
            mapped.append(c)
    doc["checklist"] = mapped

    doc["created_at"] = now_iso()
    doc["created_by"] = user["name"]
    res = await db.tasks.insert_one(doc)
    return ser(await db.tasks.find_one({"_id": res.inserted_id}))

@api.put("/tasks/{tid}")
async def update_task(tid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    for k in ("_id", "id", "organization_id"):
        body.pop(k, None)
    body["updated_at"] = now_iso()
    q = {"_id": oid(tid), "organization_id": user["organization_id"]}
    await db.tasks.update_one(q, {"$set": body})
    return ser(await db.tasks.find_one({"_id": oid(tid)}))

@api.delete("/tasks/{tid}")
async def delete_task(tid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager"])
    q = {"_id": oid(tid), "organization_id": user["organization_id"]}
    await db.tasks.delete_one(q)
    return {"ok": True}

@api.get("/tasks/{tid}")
async def get_task(tid: str, request: Request):
    user = await get_user(request)
    task = await db.tasks.find_one({"_id": oid(tid), "organization_id": user["organization_id"]})
    if not task:
        raise HTTPException(404, "Task not found")
    return ser(task)

@api.put("/tasks/{tid}/status")
async def update_task_status(tid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager", "staff"])
    q = {"_id": oid(tid), "organization_id": user["organization_id"]}
    await db.tasks.update_one(q, {"$set": {"status": body.get("status"), "updated_at": now_iso()}})
    return {"ok": True}

import uuid

@api.post("/tasks/{tid}/checklist")
async def add_task_checklist(tid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager", "staff"])
    item = {"id": str(uuid.uuid4()), "text": body.get("text"), "done": False}
    await db.tasks.update_one({"_id": oid(tid), "organization_id": user["organization_id"]}, {"$push": {"checklist": item}})
    return item

@api.put("/tasks/{tid}/checklist")
async def update_task_checklist(tid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager", "staff"])
    # We update the specific checklist item
    await db.tasks.update_one(
        {"_id": oid(tid), "organization_id": user["organization_id"], "checklist.id": body.get("item_id")},
        {"$set": {"checklist.$.done": body.get("done")}}
    )
    return {"ok": True}

@api.post("/tasks/{tid}/comments")
async def add_task_comment(tid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager", "staff"])
    comment = {
        "id": str(uuid.uuid4()),
        "text": body.get("text"),
        "author": user["name"],
        "created_at": now_iso()
    }
    await db.tasks.update_one(org_filter(user, {"_id": oid(tid)}), {"$push": {"comments": comment}})
    return comment


app.include_router(api)
