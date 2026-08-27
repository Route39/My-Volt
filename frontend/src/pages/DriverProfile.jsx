import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, Phone, MapPin, Car, KeyRound, History, FileText, AlertTriangle, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton } from "../components/common/Primitives";
import { Field, PrimaryBtn, GhostBtn } from "../components/common/Page";
import { fmtDate } from "../lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function DriverProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [assign, setAssign] = useState(false);

  const load = useCallback(async () => { const { data } = await api.get(`/drivers/${id}`); setD(data); }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  const canEdit = ["admin", "operations_manager", "city_manager"].includes(user?.role);
  const current = d.assignments?.find((a) => !a.end);
  const activeRental = d.rentals?.find((r) => r.status === "active");

  return (
    <div>
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>

      <div className="mv-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 mv-rise">
        <Avatar className="w-20 h-20"><AvatarImage src={d.avatar} /><AvatarFallback className="bg-mv-elevated text-xl">{d.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap"><h1 className="font-display text-2xl font-bold">{d.name}</h1><StatusChip status={d.status} />{d.rental_status === "active" && <StatusChip status="active" label="Rental Active" />}</div>
          <div className="flex items-center gap-5 mt-2 text-sm text-mv-muted flex-wrap">
            <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {d.phone}</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {d.city}</span>
            <span className="flex items-center gap-1.5"><Car className="w-4 h-4" /> {d.current_vehicle_number || "No vehicle"}</span>
          </div>
        </div>
        {canEdit && <div className="flex gap-2"><GhostBtn onClick={() => setAssign(true)} data-testid="assign-vehicle-btn"><ArrowRightLeft className="w-4 h-4" /> Change Vehicle</GhostBtn></div>}
      </div>

      <Tabs defaultValue="personal" className="mt-6">
        <TabsList className="bg-mv-surface border border-mv-border flex-wrap h-auto">
          {["personal", "documents", "vehicle", "rental", "history", "incidents"].map((t) => <TabsTrigger key={t} value={t} className="data-[state=active]:bg-mv-elevated capitalize">{t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="personal" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[["Name", d.name], ["Phone", d.phone], ["Address", d.address], ["Emergency Contact", d.emergency_contact], ["Licence No.", d.license_number], ["City", d.city]].map(([k, v]) => (
              <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="text-sm font-medium mt-1">{v || "—"}</div></div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          {(d.documents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No documents.</div> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{d.documents.map((doc) => (
              <div key={doc.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-mv-dim" /> {doc.doc_type}</div><div className="text-xs text-mv-dim mt-1">Expires {fmtDate(doc.expiry_date)}</div></div><StatusChip status={doc.doc_status || "valid"} /></div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="vehicle" className="mt-4">
          {current ? (
            <button onClick={() => nav(`/fleet/${current.vehicle_id}`)} className="mv-card mv-card-hover p-5 w-full text-left">
              <div className="font-semibold flex items-center gap-2"><Car className="w-5 h-5 text-mv-primary" /> {current.vehicle_number}</div>
              <div className="text-sm text-mv-dim mt-1">Assigned {fmtDate(current.start, true)} · {current.city}</div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No vehicle currently assigned.</div>}
        </TabsContent>

        <TabsContent value="rental" className="mt-4">
          {activeRental ? (
            <button onClick={() => nav(`/rentals/${activeRental.id}`)} className="mv-card mv-card-hover p-5 w-full text-left">
              <div className="flex items-center justify-between"><span className="font-semibold flex items-center gap-2"><KeyRound className="w-5 h-5 text-mv-primary" /> {activeRental.rental_code}</span><StatusChip status="active" /></div>
              <div className="text-sm text-mv-dim mt-2">{activeRental.plan_name} · {fmtDate(activeRental.start)} → {fmtDate(activeRental.end)}</div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No active rental.</div>}
          {(d.rentals || []).length > 0 && <div className="mt-4"><div className="mv-label mb-2">Rental History</div><div className="mv-card divide-y divide-mv-border">{d.rentals.map((r) => (
            <button key={r.id} onClick={() => nav(`/rentals/${r.id}`)} className="w-full p-4 flex items-center justify-between hover:bg-mv-elevated transition-colors text-left"><div><div className="font-medium">{r.rental_code}</div><div className="text-xs text-mv-dim">{fmtDate(r.start)} → {fmtDate(r.end)}</div></div><StatusChip status={r.status} /></button>
          ))}</div></div>}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {(d.assignments || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No assignment history.</div> : (
            <div className="mv-card divide-y divide-mv-border">{d.assignments.map((a) => (
              <div key={a.id} className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><History className="w-4 h-4 text-mv-dim" /><div><div className="font-medium">{a.vehicle_number}</div><div className="text-xs text-mv-dim">{fmtDate(a.start, true)} → {a.end ? fmtDate(a.end, true) : "Present"}</div></div></div>{!a.end && <StatusChip status="active" label="Current" />}</div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          {(d.incidents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No incidents ✓</div> : (
            <div className="space-y-2">{d.incidents.map((i) => (<div key={i.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium">{i.code} · {i.incident_type}</div><div className="text-xs text-mv-dim">{fmtDate(i.created_at)}</div></div><StatusChip status={i.status} /></div>))}</div>
          )}
        </TabsContent>
      </Tabs>

      <AssignVehicleDialog open={assign} setOpen={setAssign} driver={d} onDone={() => { setAssign(false); load(); }} />
    </div>
  );
}

function AssignVehicleDialog({ open, setOpen, driver, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [vid, setVid] = useState("");
  useEffect(() => { if (open) api.get("/vehicles", { params: { status: "available", page_size: 100 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const save = async () => {
    if (!vid) { toast.error("Select a vehicle"); return; }
    try { await api.post(`/drivers/${driver.id}/assign-vehicle`, { vehicle_id: vid }); toast.success("Driver assigned ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Assign Vehicle</DialogTitle></DialogHeader>
        <Field label="Available Vehicle">
          <Select value={vid} onValueChange={setVid}>
            <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="assign-vehicle-select"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-assign-btn">Assign</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
